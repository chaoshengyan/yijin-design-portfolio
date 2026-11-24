/* ============================================================
 * drag.js — 批2A/2B 物品拖拽+红绿高亮+拖动中旋转；批3A 装备槽作为落点
 * 不做容器变形/卸下(3B)、不做堆叠(批4)。
 *
 * 两类落点：
 *  - 网格容器 stash/rig/pockets/backpack/safe → Engine.canPlace（越界/重叠/slots/locked/容器类）
 *  - 装备槽 helmet/armor/rig/bag/melee/primary/secondary → Engine.canEquip（slotType 匹配/替换/互换）
 * 抓取偏移用于网格落点（物品左上角所在格）；槽内物品不占 x/y，拖到网格才用 canPlace+rot。
 * 本文件只改幽灵层与高亮 class，不重渲染；提交统一走 QM.commitDrag / QM.commitEquip（内部 snapshot）。
 * ============================================================ */
(function () {
  "use strict";
  var G = (typeof window!=="undefined") ? window : (typeof globalThis!=="undefined" ? globalThis : this);

  function dropCell(p){
    var leftPx = p.clientX - p.offsetX, topPx = p.clientY - p.offsetY;
    var gx = leftPx - p.rect.left - (p.scrollLeft||0);
    var gy = topPx  - p.rect.top  - (p.scrollTop||0);
    return { x: Math.floor(gx/p.cellSize), y: Math.floor(gy/p.cellSize), leftPx:leftPx, topPx:topPx };
  }
  function dimsAt(w,h,rot){ return (rot%2===1) ? { w:h, h:w } : { w:w, h:h }; }
  function convertOffset(offW,offH,oldW,oldH,newW,newH){
    var nx = (oldW>0) ? offW*newW/oldW : 0;
    var ny = (oldH>0) ? offH*newH/oldH : 0;
    return { ox: Math.max(0, Math.min(nx,newW)), oy: Math.max(0, Math.min(ny,newH)) };
  }
  G.QDrag = { dropCell: dropCell, dimsAt: dimsAt, convertOffset: convertOffset };
  if (typeof document==="undefined" || typeof Engine==="undefined") return;

  var BOX_ELS = [
    ["grid","stash"], ["rigGrid","rig"], ["pocketsGrid","pockets"],
    ["backpackGrid","backpack"], ["safeGrid","safe"]
  ];
  // data-slot → 落点元素（竖槽是 .equip-slot，武器条是 .weapon-strip）
  var SLOT_KEYS = ["helmet","armor","rig","bag","melee","primary","secondary"];
  var THRESH = 4;
  /* 指令B-吸附：吸附半径（格宽倍数）。调手感只改这一处。 */
  var SNAP_RADIUS = 0.6;

  function state(){ return G.QM && G.QM.getState(); }
  function cellSize(){ return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cell-size")) || 40; }
  function isLocked(box){ return G.QM ? !!G.QM.isBoxLocked(box) : false; }
  function boxNameOf(el){
    for(var i=0;i<BOX_ELS.length;i++){ if(el.id===BOX_ELS[i][0]) return BOX_ELS[i][1]; }
    return null;
  }
  function scrollerOf(grid){ return grid.closest ? grid.closest(".scroll") : null; }
  function slotElOf(key){ return document.querySelector('[data-slot="'+key+'"]'); }

  var drag=null, ghost=null, hint=null, hoverEl=null, slotTag=null;
  /* 指令B-吸附：候选合法位缓存。key=容器|旋转|物品id；进新容器/旋转/一次放置后失效重算。 */
  var snapCache={ key:null, spots:null };
  function snapCacheKey(box,rot,uid){ return box+"|"+(rot|0)+"|"+uid; }
  function invalidateSnap(){ snapCache={ key:null, spots:null }; }
  /* 批B：双击配对。只记录"合格点击"（左键按下→抬起全程未超 4px）。
   * {uid,t}；拖动一旦成立/取消/失焦/右键都清空，避免与旧点击误配。纯时间戳，不用定时器。 */
  var clickInfo=null, downCandidate=null;
  var DBL_INTERVAL=300;
  function clearClickPair(){ clickInfo=null; }

  function clearSlotTag(){
    if(slotTag && slotTag.parentNode) slotTag.parentNode.removeChild(slotTag);
    slotTag=null;
  }
  // 装备槽悬停提示气泡（黄色“替换·转移N件”/红色原因）；离开或松手立即移除
  function showSlotTag(slotEl, text, bad){
    clearSlotTag();
    slotTag=document.createElement("div");
    slotTag.className="slot-tag"+(bad?" bad":"");
    slotTag.textContent=text;
    document.body.appendChild(slotTag);
    var r=slotEl.getBoundingClientRect();
    var tw=slotTag.offsetWidth, th=slotTag.offsetHeight;
    var left=Math.max(6, Math.min(r.left + r.width/2 - tw/2, window.innerWidth-tw-6));
    var top=r.top - th - 6;
    if(top<6) top=r.bottom+6;
    slotTag.style.left=left+"px"; slotTag.style.top=top+"px";
  }

  function clearHoverEl(){
    if(hoverEl){ hoverEl.classList.remove("drop-ok","drop-bad","drop-lock","slot-ok","slot-bad","slot-swap"); hoverEl=null; }
    clearSlotTag();
  }
  function clearHint(){
    if(hint && hint.parentNode) hint.parentNode.removeChild(hint);
    hint=null;
    clearHoverEl();
  }
  function removeGhost(){ if(ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost); ghost=null; }

  function cancelDrag(){
    if(!drag) return;
    if(drag.srcEl) drag.srcEl.classList.remove("dragging-src","shake");
    clearHint(); removeGhost();
    document.body.classList.remove("is-dragging");
    invalidateSnap(); // 一次放置/取消结束，候选缓存失效，下次拖动重算
    drag=null;
  }

  /* 抓取：网格 .cell 或装备槽内的可抓元素（竖槽 .eq-item / 武器条 .ws-grab） */
  function onDown(e){
    if(e.button!=null && e.button!==0){ clearClickPair(); downCandidate=null; return; } // 非左键（含右键）不计入双击
    var t = e.target;
    if(!t.closest || t.closest(".assistant-panel")){ clearClickPair(); return; }

    var cell = t.closest(".cell");
    var grid = cell ? t.closest(".container-grid,.item-grid,.secure-grid") : null;
    var slotGrab = t.closest(".eq-item,.ws-grab");
    var slotWrap = slotGrab ? slotGrab.closest("[data-slot]") : null;
    if(!cell && !slotGrab){ clearClickPair(); return; }

    var st = state(); if(!st){ clearClickPair(); return; }
    var f = findItemById(st, cell ? cell.getAttribute("data-uid") : slotGrab.getAttribute("data-uid"));
    if(!f){ clearClickPair(); return; }
    if(cell && f.container==="equipped"){ clearClickPair(); return; } // 防御：网格里不应出现槽内物

    var fromBox = cell ? boxNameOf(grid) : null;
    var fromSlot = cell ? null : (slotWrap && slotWrap.getAttribute("data-slot"));
    if(cell && !fromBox){ clearClickPair(); return; }

    var r = (cell||slotGrab).getBoundingClientRect();
    var cs = cellSize();
    drag = {
      pointerId:e.pointerId, uid:f.item._uid, item:f.item, fromBox:fromBox, fromSlot:fromSlot,
      fromContainer:f.container, srcSlot:f.slot||null,
      srcEl:cell||slotGrab,
      startX:e.clientX, startY:e.clientY,
      offsetX:e.clientX-r.left, offsetY:e.clientY-r.top,
      baseW:f.item.w||1, baseH:f.item.h||1,
      liveRot:f.item.rot|0, wPx:r.width, hPx:r.height, moved:false,
      lastX:e.clientX, lastY:e.clientY, rightFlipped:false,
      offGW:(e.clientX-r.left)/cs, offGH:(e.clientY-r.top)/cs
    };
    // 批B：先记为"待确认点击"，若 onMove 越过 4px 成为拖动则作废
    downCandidate={uid:String(f.item._uid),t:Date.now()};
  }

  /* 命中：先判装备槽（左区），再判网格容器 */
  function hitTarget(){
    for(var i=0;i<SLOT_KEYS.length;i++){
      var el=slotElOf(SLOT_KEYS[i]); if(!el) continue;
      var rs=el.getBoundingClientRect();
      if(drag.lastX>=rs.left && drag.lastX<rs.right && drag.lastY>=rs.top && drag.lastY<rs.bottom)
        return {kind:"slot", el:el, slot:SLOT_KEYS[i]};
    }
    for(var j=0;j<BOX_ELS.length;j++){
      var g=document.getElementById(BOX_ELS[j][0]);
      var rc=g.getBoundingClientRect();
      if(drag.lastX>=rc.left && drag.lastX<rc.right && drag.lastY>=rc.top && drag.lastY<rc.bottom)
        return {kind:"box", el:g, name:BOX_ELS[j][1], rc:rc};
    }
    return null;
  }

  function updateHover(){
    if(!drag.moved) return;
    var target=hitTarget();
    clearHint();
    if(!target) return;
    hoverEl=target.el;

    if(target.kind==="slot"){
      var stSlot=state();
      var occupied = !!(stSlot.equipped[target.slot] && stSlot.equipped[target.slot].item);
      var chkS, transfer=0;
      if(target.slot==="rig"||target.slot==="bag"){
        // 容器槽：走容器变更试算（装备/替换/互换/卸下），非容器物品会得到类型不符
        chkS = Engine.canContainerChange(stSlot,{itemId:drag.uid, slot:target.slot});
        transfer = chkS.ok ? (chkS.transferCount|0) : 0;
      }else{
        chkS = Engine.canEquip(stSlot,{itemId:drag.uid, slot:target.slot});
      }
      // 匹配且已有物品→黄色“替换/互换”；不匹配一律红色；空槽匹配→绿色
      var cls = chkS.ok ? (occupied ? "slot-swap" : "slot-ok") : "slot-bad";
      target.el.classList.add(cls);
      if(chkS.ok && occupied){
        // 黄提示：容器槽显示实际将转入仓库的件数（替换=溢出件数）
        var label=(target.slot==="rig"||target.slot==="bag")
          ? (transfer>0 ? "替换 · 将转移 "+transfer+" 件物品" : "替换")
          : "替换";
        showSlotTag(target.el,label);
      }else if(!chkS.ok){
        showSlotTag(target.el, chkS.reason || "不可放置", true);
      }
      drag._target={kind:"slot", slot:target.slot, ok:chkS.ok};
      return;
    }

    // 网格容器
    var cs=cellSize(), locked=isLocked(target.name);
    var sc=scrollerOf(target.el);
    var dc=dropCell({
      clientX:drag.lastX, clientY:drag.lastY, rect:target.rc, cellSize:cs,
      offsetX:drag.offGW*cs, offsetY:drag.offGH*cs,
      scrollLeft:sc?sc.scrollLeft:0, scrollTop:sc?sc.scrollTop:0
    });
    var dim=dimsAt(drag.baseW,drag.baseH,drag.liveRot);
    // 指令B-吸附：用“未取整指针落点（浮点格坐标）”到候选位左上角算距离，半径内吸向最近合法位。
    // 候选位按 (容器,旋转,uid) 缓存；装备槽不参与；锁定容器不吸附。
    var fx=(dc.leftPx-target.rc.left-(sc?sc.scrollLeft:0))/cs;
    var fy=(dc.topPx-target.rc.top-(sc?sc.scrollTop:0))/cs;
    var snapped=null;
    if(!locked && Engine.legalSpotsInBox && Engine.findSnapSpot){
      var skey=snapCacheKey(target.name,drag.liveRot,drag.uid);
      if(snapCache.key!==skey){
        snapCache={ key:skey, spots:Engine.legalSpotsInBox(state(),{itemId:drag.uid,toBox:target.name,rot:drag.liveRot,locked:locked}) };
      }
      snapped=Engine.findSnapSpot(state(),{itemId:drag.uid,toBox:target.name,rot:drag.liveRot,locked:locked,fx:fx,fy:fy,radius:SNAP_RADIUS});
      if(snapped){ dc.x=snapped.x; dc.y=snapped.y; }
    }
    // 源=已装备的容器(rig/bag)且悬停网格：只允许卸下到仓库，走容器专用试算（含内容转移、本体落点/旋转）
    var containerSrcSlot = (drag.fromContainer==="equipped" && (drag.fromSlot==="rig"||drag.fromSlot==="bag")) ? drag.fromSlot : null;    var chk;
    if(containerSrcSlot && target.name==="stash"){
      chk=Engine.canContainerChange(state(),{itemId:drag.uid, slot:containerSrcSlot, target:"stash",
            toStash:{x:dc.x,y:dc.y}, rot:drag.liveRot});
    }else{
      chk=Engine.canPlace(state(),{itemId:drag.uid,toBox:target.name,x:dc.x,y:dc.y,rot:drag.liveRot,locked:locked});
    }
    target.el.classList.add(locked?"drop-lock":(chk.ok?"drop-ok":"drop-bad"));
    var cols=parseInt(target.el.style.getPropertyValue("--cols"),10);
    var rows=parseInt(target.el.style.getPropertyValue("--rows"),10);
    if(!locked && isFinite(cols)&&isFinite(rows)&&dc.x>=0&&dc.y>=0&&dc.x<cols&&dc.y<rows){
      hint=document.createElement("div");
      hint.className="drop-hint "+(chk.ok?"ok":"bad");
      hint.style.setProperty("--r",dc.y+1); hint.style.setProperty("--c",dc.x+1);
      hint.style.setProperty("--w",dim.w); hint.style.setProperty("--h",dim.h);
      target.el.appendChild(hint);
    }
    drag._target={kind:"box", box:target.name, x:dc.x, y:dc.y, ok:chk.ok};
  }

  function rotate(){
    if(!drag || !drag.moved) return;
    if(drag.baseW===drag.baseH) return; // 正方形无变化无提示
    var old=dimsAt(drag.baseW,drag.baseH,drag.liveRot);
    drag.liveRot ^= 1;
    invalidateSnap(); // 旋转改变占地，候选合法位整体重算（key 也含 rot，双保险）
    var nw=dimsAt(drag.baseW,drag.baseH,drag.liveRot);
    var cv=convertOffset(drag.offGW,drag.offGH,old.w,old.h,nw.w,nw.h);
    drag.offGW=cv.ox; drag.offGH=cv.oy;
    var cs=cellSize();
    drag.wPx=nw.w*cs; drag.hPx=nw.h*cs;
    if(ghost){ ghost.style.width=drag.wPx+"px"; ghost.style.height=drag.hPx+"px"; }
    drag.offsetX=drag.offGW*cs; drag.offsetY=drag.offGH*cs;
    updateHover();
  }

  function onMove(e){
    if(!drag || e.pointerId!==drag.pointerId) return;
    drag.lastX=e.clientX; drag.lastY=e.clientY;
    if(!drag.moved){
      if(Math.hypot(e.clientX-drag.startX, e.clientY-drag.startY) < THRESH) return;
      drag.moved=true;
      clearClickPair(); downCandidate=null; // 一旦成为拖动（即便后来移回），本次及待配对点击一律作废
      drag.srcEl.classList.add("dragging-src");
      document.body.classList.add("is-dragging");
      ghost=document.createElement("div");
      ghost.className="drag-ghost q-"+drag.item.quality;
      ghost.style.width=drag.wPx+"px"; ghost.style.height=drag.hPx+"px";
      var gsrc=(window.ItemImages&&ItemImages.itemImage)?ItemImages.itemImage(drag.item):null;
      if(gsrc){
        var gi=document.createElement("img");
        gi.src=gsrc; gi.alt=""; gi.draggable=false;
        gi.className="ghost-img";
        gi.onerror=function(){this.remove();ghost.textContent=(drag.item.baseName||drag.item.name);};
        ghost.appendChild(gi);
      }else{
        ghost.textContent=(drag.item.baseName||drag.item.name);
      }
      document.body.appendChild(ghost);
    }
    ghost.style.left=(e.clientX-drag.offsetX)+"px";
    ghost.style.top=(e.clientY-drag.offsetY)+"px";
    updateHover();
  }

  function onUp(e){
    if(!drag || e.pointerId!==drag.pointerId) return;
    var d=drag, tg=d._target;
    var committed=false;
    if(d.moved && tg && tg.ok && G.QM){
      if(tg.kind==="slot" && G.QM.commitEquip)
        committed=G.QM.commitEquip({itemId:d.uid, slot:tg.slot});
      else if(tg.kind==="box" && G.QM.commitDrag)
        committed=G.QM.commitDrag({itemId:d.uid,toBox:tg.box,x:tg.x,y:tg.y,rot:d.liveRot});
    }
    if(d.moved && !committed){ // 非法/取消落点：抖动，不写 state（槽内物/rot 全程未改）
      d.srcEl.classList.add("shake");
      setTimeout(function(){ d.srcEl.classList.remove("shake"); },320);
    }
    // 批B：未发生拖动才是"合格点击"，进入双击配对；拖动分支已在 onMove 清空
    if(!d.moved && downCandidate && String(downCandidate.uid)===String(d.uid)){
      var now=Date.now();
      if(clickInfo && String(clickInfo.uid)===String(d.uid) && (now-clickInfo.t)<DBL_INTERVAL){
        clearClickPair(); downCandidate=null; // 双击成立：立即清空，第三次点击不连判
        cancelDrag();
        if(G.QM && G.QM.quickToggle){ try{ G.QM.quickToggle(String(d.uid)); }catch(err){} }
        return;
      }
      clickInfo={uid:String(d.uid),t:now}; // 第一次/未达间隔：仅记录，单击无副作用
    }
    downCandidate=null;
    cancelDrag();
  }

  document.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", function(){ clearClickPair(); downCandidate=null; cancelDrag(); }, true);
  window.addEventListener("blur", function(){ clearClickPair(); downCandidate=null; cancelDrag(); });

  document.addEventListener("keydown", function(e){
    if(!drag || !drag.moved) return;
    if(e.code==="KeyR"){
      var tag=(e.target && e.target.tagName) ? String(e.target.tagName).toLowerCase() : "";
      if(tag==="input"||tag==="textarea"||(e.target&&e.target.isContentEditable)) return;
      e.preventDefault();
      if(!e.repeat) rotate();
      return;
    }
    if(e.key==="Escape"){
      e.stopPropagation(); e.preventDefault();
      clearClickPair(); downCandidate=null;
      var el=drag.srcEl; cancelDrag();
      if(el) el.classList.remove("dragging-src");
    }
  }, true);

  document.addEventListener("mousedown", function(e){
    if(e.button===2){ clearClickPair(); downCandidate=null; } // 右键不参与双击
    if(drag && drag.moved && e.button===2 && !drag.rightFlipped){ drag.rightFlipped=true; rotate(); }
  }, true);
  document.addEventListener("contextmenu", function(e){
    if(drag && drag.moved){
      e.preventDefault(); e.stopPropagation();
      if(!drag.rightFlipped) rotate();
      drag.rightFlipped=true;
    }
  }, true);
  document.addEventListener("pointerup", function(){ if(drag) drag.rightFlipped=false; }, true);
})();
