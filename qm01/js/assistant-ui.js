/* ============================================================
 * assistant-ui.js — AI 浮层的开关、定位与拖动
 * 不碰库存数据 / engine / ai.js 请求逻辑。
 *
 * 入口钮 #aiTrigger：保持现状，锚定中间携带区(.carry-panel)右下角，
 *   z-index 高于面板，随时可点。
 * 面板 #aiPanel：fixed + left/top，默认压在左列人物立绘区上方；
 *   头部可拖动（Pointer Events，4px 阈值），位置夹在视口内并记忆。
 *   最小化 / Esc 都只是收起成入口钮，恢复时回到上次位置。
 * ============================================================ */
(function () {
  "use strict";

  var trigger = document.getElementById("aiTrigger");
  var panel   = document.getElementById("aiPanel");
  var minBtn  = document.getElementById("aiClose"); // 头部唯一按钮：—（最小化）
  var head    = panel && panel.querySelector(".assistant-head");
  var carry   = document.getElementById("carryPanel");
  if (!trigger || !panel || !carry || !head) return;

  var TRIGGER = 52, GAP = 12, EDGE = 8, DRAG_THRESHOLD = 4;
  var POS_KEY = "qm01.assistant.pos.v1";

  function topH(){
    var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--top-h"));
    return isFinite(v) ? v : 64;
  }

  /* ---- 位置记忆 ---- */
  function loadPos(){
    try{
      var raw = localStorage.getItem(POS_KEY);
      if(raw){ var p = JSON.parse(raw); if(isFinite(p.left)&&isFinite(p.top)) return p; }
    }catch(e){ /* 隐私模式等：降级为内存默认 */ }
    return null;
  }
  function savePos(p){
    try{ localStorage.setItem(POS_KEY, JSON.stringify(p)); }catch(e){}
  }
  var saved = loadPos();

  function isOpen(){ return panel.style.display !== "none" && panel.style.display !== ""; }

  /* ---- 入口钮：锚定中间区右下角（保持现状，不参与面板拖动） ---- */
  function positionTrigger(){
    var cr = carry.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    trigger.style.right = Math.max(8, vw - cr.right + GAP) + "px";
    trigger.style.bottom = Math.max(GAP, vh - cr.bottom + GAP) + "px";
  }

  /* ---- 面板：left/top 定位，夹在视口内，底边不出视口 ---- */
  function defaultPos(){ return { left: 12, top: topH() + 12 }; }

  function clampPos(p){
    var vw = window.innerWidth, vh = window.innerHeight;
    var H = panel.offsetHeight || Math.min(640, vh - topH() - 24);
    var W = panel.offsetWidth  || Math.min(348, vw - 16);
    var maxLeft = Math.max(EDGE, vw - W - EDGE);
    var maxTop  = Math.max(EDGE, vh - H - EDGE);
    return {
      left: Math.min(Math.max(EDGE, p.left), maxLeft),
      top:  Math.min(Math.max(EDGE, p.top),  maxTop)
    };
  }

  function applyPos(p){
    var c = clampPos(p);
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.left = c.left + "px";
    panel.style.top  = c.top + "px";
    panel.style.width = Math.min(348, window.innerWidth - 16) + "px";
    return c;
  }

  function setOpen(open){
    panel.style.display = open ? "flex" : "none";
    trigger.classList.toggle("is-open", !!open);
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
    if(open){
      // 先显示再按真实尺寸夹取，保证恢复时面板一定在视口内
      var base = saved || defaultPos();
      var c = applyPos(base);
      saved = c;
    }
  }

  /* ---- 头部拖动：Pointer Events + setPointerCapture ---- */
  var drag = null;
  head.addEventListener("pointerdown", function(e){
    if(e.button!=null && e.button!==0) return;
    if(e.target.closest("button")) return; // 最小化按钮不触发拖动
    drag = { id:e.pointerId, startX:e.clientX, startY:e.clientY,
             originLeft:null, originTop:null, moved:false };
  });
  head.addEventListener("pointermove", function(e){
    if(!drag || e.pointerId!==drag.id) return;
    var dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    if(!drag.moved && Math.hypot(dx,dy) < DRAG_THRESHOLD) return;
    if(!drag.moved){
      drag.moved = true;
      panel.classList.add("dragging");
      try{ head.setPointerCapture(drag.id); }catch(err){}
      var r = panel.getBoundingClientRect();
      drag.originLeft = r.left; drag.originTop = r.top;
    }
    applyPos({ left: drag.originLeft + dx, top: drag.originTop + dy });
  });
  function endDrag(e){
    if(!drag || (e && e.pointerId!==drag.id)) return;
    if(drag.moved){
      panel.classList.remove("dragging");
      var r = panel.getBoundingClientRect();
      saved = clampPos({ left:r.left, top:r.top });
      savePos(saved);
    }
    drag = null;
  }
  head.addEventListener("pointerup", endDrag);
  head.addEventListener("pointercancel", endDrag);

  /* ---- 开关事件 ---- */
  trigger.addEventListener("click", function(){ setOpen(!isOpen()); });
  if(minBtn) minBtn.addEventListener("click", function(){ setOpen(false); });
  document.addEventListener("keydown", function(e){
    if(e.key === "Escape" && isOpen()) setOpen(false);
  });

  /* ---- 窗口缩放：入口跟随，面板夹回视口 ---- */
  window.addEventListener("resize", function(){
    positionTrigger();
    if(isOpen() && saved) applyPos(saved);
  });
  if(window.ResizeObserver) new ResizeObserver(positionTrigger).observe(carry);

  trigger.setAttribute("aria-expanded", "false");
  positionTrigger();
  if(document.readyState !== "complete") window.addEventListener("load", positionTrigger);
  setTimeout(positionTrigger, 300);

  /* 新消息出现时反馈区自动滚到底（显示层处理，不改 app.js） */
  var chat = document.getElementById("chat");
  if(chat && window.MutationObserver){
    new MutationObserver(function(){ chat.scrollTop = chat.scrollHeight; })
      .observe(chat, { childList:true, subtree:true });
  }
})();
