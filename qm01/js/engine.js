/* ============================================================
 * engine.js — 本地规则引擎（离线兜底 + LLM 输出的安全校验层）
 * LLM 只负责"听懂人话"→输出 intent+params；
 * 所有最终动作由本引擎按真实背包数据计算，杜绝幻觉误操作。
 * params: { minQuality, maxQuality, budget, strategy }
 * ============================================================ */

const Engine = {

  qualityLabel(q){
    return { white:"白", green:"绿", blue:"蓝", purple:"紫", gold:"金" }[q] || q;
  },

  /* ---------- 格位布局引擎（还原撤离类真实背包：物品占格不一） ---------- */
  /* 二维矩阵装箱：按输入顺序行优先放置，返回 {placed, occ} */
  layout(items, cols, rows){
    const occ = {};                 // "r,c" -> itemIndex
    const placed = [];
    items.forEach((it, i)=>{
      const w = it.w||1, h = it.h||1;
      let spot = null;
      outer:
      for(let r=0; r + h <= rows; r++){
        for(let c=0; c + w <= cols; c++){
          let ok = true;
          for(let dr=0; dr<h && ok; dr++)
            for(let dc=0; dc<w; dc++)
              if(occ[(r+dr)+","+(c+dc)]){ ok=false; break; }
          if(ok){ spot={r,c}; break outer; }
        }
      }
      if(spot){
        for(let dr=0; dr<h; dr++)
          for(let dc=0; dc<w; dc++)
            occ[(spot.r+dr)+","+(spot.c+dc)] = i;
        placed.push({ item:it, i, r:spot.r, c:spot.c, w, h });
      }
    });
    return { placed, occ };
  },

  /* 把一组物品装进一个独立容器（空箱），返回装得下的物品原序下标列表 */
  fitInto(items, cols, rows){
    const { placed } = this.layout(items, cols, rows);
    return placed.map(p=>p.i);
  },

  /* 批1：把候选物品装进"已有占用"的容器（box={items,cols,rows}），
   * 返回真正能放下的物品数组（按价值降序尝试，不修改 box） */
  fitIntoBox(box, candidates){
    const occ={};
    box.items.forEach(it=>{
      const d = (typeof itemDims==="function") ? itemDims(it) : { w:it.w||1, h:it.h||1 };
      for(let y=it.y;y<it.y+d.h;y++)for(let x=it.x;x<it.x+d.w;x++)occ[x+","+y]=true;
    });
    const picked=[];
    candidates.slice().sort((a,b)=>b.value-a.value).forEach(it=>{
      const w=it.w||1,h=it.h||1;
      let spot=null;
      outer:
      for(let y=0;y+h<=box.rows;y++)for(let x=0;x+w<=box.cols;x++){
        let ok=true;
        for(let yy=y;yy<y+h&&ok;yy++)for(let xx=x;xx<x+w;xx++)if(occ[xx+","+yy]){ok=false;break;}
        if(ok){spot={x,y};break outer;}
      }
      if(spot){
        for(let yy=spot.y;yy<spot.y+h;yy++)for(let xx=spot.x;xx<spot.x+w;xx++)occ[xx+","+yy]=true;
        picked.push(it);
      }
    });
    return picked;
  },

  /* 阶段3策略 premiumAmmoArmor：只从“随身容器”选取带入对局的高级子弹 + 甲修。
   *  取物来源（更正后口径）：口袋 pockets + 已装备的背包 backpack + 已装备的胸挂 rig。
   *    - 不取仓库 state.stash；不取装备栏里的武器/护甲/头盔；已在安全箱里的跳过；
   *    - 背包/胸挂仅在“已装备”（equipped.bag/rig 有 item）时其内物品才可用；未装备=容器锁定，不可用；
   *    - 容器内物品若自身 locked===true 也跳过。
   *  - 高级子弹：cat==='ammo'（兼容 kind==='ammo'）且 quality 为 purple/gold，按字段不按名字；
   *  - 甲修：护甲维修包（名字含“护甲维修”，明确排除“头盔维修/头修”）中品质最高的 1 件，
   *          “最高品质”只在随身容器候选内比较；平级取 value 高者，再平级取 id 稳定。
   * 纯函数，不写 state、不改物品对象。返回 {ammo:[], armor:item|null, sources:[], srcOf:Map}。 */
  pickPremiumAmmoArmor(state){
    // 仅“已装备且未锁定”的随身容器；口袋始终可用
    const carryBoxes = [];
    if(state.pockets) carryBoxes.push({name:"pockets", box:state.pockets});
    if(state.equipped && state.equipped.bag && state.equipped.bag.item && state.backpack)
      carryBoxes.push({name:"backpack", box:state.backpack});
    if(state.equipped && state.equipped.rig && state.equipped.rig.item && state.rig)
      carryBoxes.push({name:"rig", box:state.rig});
    // 已在安全箱里的同类物品不重复选取
    const safeKeys = new Set(((state.safe && state.safe.items) || []).map(it=>it._uid));
    const items = [];
    const srcOf = new Map();
    carryBoxes.forEach(c=>{
      c.box.items.forEach(it=>{
        if(!it || it.locked===true) return;
        if(safeKeys.has(it._uid)) return;
        srcOf.set(it._uid, c.name);
        items.push(it);
      });
    });
    const isAmmo = it => it.cat==="ammo" || it.kind==="ammo";
    const isArmorRepair = it => {
      const nm = (it.baseName||it.name||"");
      const isRepair = it.kind==="repair" || /维修|甲修/.test(nm);
      return isRepair && /护甲维修|甲修/.test(nm) && !/头盔|头修/.test(nm);
    };
    const ammo = items.filter(it=>isAmmo(it) && (it.quality==="purple"||it.quality==="gold"));
    const armorRepairs = items.filter(isArmorRepair);
    let armor=null;
    if(armorRepairs.length){
      armor = armorRepairs.slice().sort((a,b)=>{
        const qa=(QUALITY_RANK[a.quality]||0), qb=(QUALITY_RANK[b.quality]||0);
        if(qb!==qa) return qb-qa;                       // 品质最高优先
        if((b.value||0)!==(a.value||0)) return (b.value||0)-(a.value||0);
        return (""+a.id).localeCompare(""+b.id);        // 稳定 tie-break
      })[0];
    }
    return {ammo, armor, sources:carryBoxes.map(c=>c.name), srcOf};
  },

  /* ---------- 批2A：拖拽落点的统一合法性入口（纯试算，不写 state） ----------
   * arg: { itemId, toBox:"stash|rig|pockets|backpack|safe", x, y, locked:boolean }
   * 规则全部复用数据层：越界/重叠走占用矩阵，带 slots 的容器再走 slotFitsAt；
   * 同容器移动忽略自身；未装备(locked)的胸挂/背包拒收；容器类只能进仓库；
   * 可堆叠物本轮落在同类上仍按重叠拒绝（批4再做合并）。返回 {ok,reason}。 */
  canPlace(state, arg){
    const { itemId, toBox, x, y } = arg;
    const f = findItemById(state, itemId);
    if(!f) return { ok:false, reason:"物品不存在" };
    const box = state[toBox];
    if(!box) return { ok:false, reason:"目标容器不存在" };
    if(arg.locked) return { ok:false, reason:"该容器未装备" };

    const it = f.item;
    // 拖拽旋转是未落盘的临时姿态：arg.rot 优先，用临时尺寸做全部判定，不碰 it.rot
    const baseW = it.w||1, baseH = it.h||1;
    const trialRot = (arg.rot!=null ? arg.rot : it.rot)|0;
    const dim = (trialRot%2===1) ? { w:baseH, h:baseW } : { w:baseW, h:baseH };

    // 容器类物品（胸挂/背包）本轮只能放仓库，避免容器套容器（批3处理装备）
    if(toBox!=="stash" && (it.slotType==="rig" || it.slotType==="bag"))
      return { ok:false, reason:"胸挂/背包类只能放在仓库" };

    // 越界（物品左上角算出的格 + 临时占地超出外框）
    if(x==null || y==null || x<0 || y<0 || x+dim.w>box.cols || y+dim.h>box.rows)
      return { ok:false, reason:"超出容器边界" };

    // 占用矩阵：目标容器里除自身外的已占格（他人按各自真实 rot 占位）
    const occ={};
    box.items.forEach(o=>{
      if(o._uid===it._uid) return; // 同容器移动忽略自身（自身用下方临时 dim 另行判断）
      const od = itemDims(o);
      for(let yy=o.y; yy<o.y+od.h; yy++)
        for(let xx=o.x; xx<o.x+od.w; xx++) occ[xx+","+yy]=o;
    });
    for(let yy=y; yy<y+dim.h; yy++)
      for(let xx=x; xx<x+dim.w; xx++){
        if(occ[xx+","+yy]){
          const o = occ[xx+","+yy];
          // 可堆叠同类：批4处理；本轮按重叠拒绝
          return { ok:false, reason: o.stackable && it.stackable && (o.baseName||o.name)===(it.baseName||it.name)
            ? "堆叠合并将在后续开放" : "与其他物品重叠" };
        }
      }

    // 分隔层容器（D3胸挂）：物品必须完整落在单个隔层内（用临时旋转尺寸）
    const slots = this._boxSlots(state, toBox, arg.previewSlots);
    if(slots && slots.length){
      if(!slotFitsAt(slots, x, y, dim)) return { ok:false, reason:"不能跨越隔层" };
    }
    return { ok:true, reason:"" };
  },

  /* 指令B-吸附：枚举指定容器内该物品在给定旋转下的全部合法放置位。
     纯计算、不写 state；合法性完全复用 canPlace / canContainerChange，不复制放置规则。
     入参 arg：{itemId,toBox,rot,locked,previewSlots}；返回 [{x,y}]（按行优先，稳定）。 */
  legalSpotsInBox(state, arg){
    const toBox = arg.toBox;
    if(!state[toBox]) return [];
    const box = state[toBox];
    const f = findItemById(state, arg.itemId);
    if(!f) return [];
    const it = f.item;
    const trialRot = (arg.rot!=null ? arg.rot : it.rot)|0;
    const dim = (trialRot%2===1) ? { w:(it.h||1), h:(it.w||1) } : { w:(it.w||1), h:(it.h||1) };
    const fromContainerSlot = (f.container==="equipped" && (f.slot==="rig"||f.slot==="bag")) ? f.slot : null;
    const out=[];
    for(let y=0; y+dim.h<=box.rows; y++){
      for(let x=0; x+dim.w<=box.cols; x++){
        let ok=false;
        if(fromContainerSlot && toBox==="stash"){
          ok = this.canContainerChange(state,{ itemId:arg.itemId, slot:fromContainerSlot,
                 target:"stash", toStash:{x,y}, rot:trialRot }).ok;
        }else{
          ok = this.canPlace(state,{ itemId:arg.itemId, toBox, x, y, rot:trialRot,
                 locked:arg.locked, previewSlots:arg.previewSlots }).ok;
        }
        if(ok) out.push({x,y});
      }
    }
    return out;
  },

  /* 在合法位里找吸附目标。
     fx/fy=未取整的指针落点（浮点格坐标，已含抓取偏移换算）；radius=吸附半径（格宽倍数）。
     距离=落点到候选位左上角的欧氏距离（格单位）。半径内取最近；并列时优先指针所在格。
     无合法位/都超半径 → 返回 null（调用方维持整数格与冲突提示）。 */
  findSnapSpot(state, arg){
    const spots = this.legalSpotsInBox(state, arg);
    if(!spots.length) return null;
    const fx = +arg.fx, fy = +arg.fy;
    const radius = (arg.radius!=null ? arg.radius : 0.6);
    const cellX = Math.floor(fx), cellY = Math.floor(fy);
    let best=null, bestD=Infinity;
    for(let i=0;i<spots.length;i++){
      const s=spots[i], dx=s.x-fx, dy=s.y-fy;
      const d=Math.sqrt(dx*dx+dy*dy);
      if(d>radius) continue;
      if(d+1e-9 < bestD){ bestD=d; best=s; }
      else if(Math.abs(d-bestD)<=1e-9){
        // 并列：优先指针所在格；其次保留行优先的先到者
        const curCell=(best.x===cellX && best.y===cellY);
        const sCell=(s.x===cellX && s.y===cellY);
        if(sCell && !curCell){ best=s; bestD=d; }
      }
    }
    return best;
  },

  /* 取目标容器当前生效的 slots：优先调用方传入（预览），否则读已装备容器物品 */
  _boxSlots(state, boxName, overrideSlots){
    if(overrideSlots) return overrideSlots;
    if(boxName!=="rig" && boxName!=="backpack") return null;
    const eq = state.equipped[boxName];
    const item = eq && eq.item;
    return (item && item.layout && item.layout.slots) || null;
  },

  /* 提交一次拖拽移动：先 canPlace，通过后从旧容器取出、写新坐标并入箱。
   * 撤销由调用方（app.commitDrag）用 snapshot() 包裹，与快捷指令同一机制。 */
  moveItem(state, arg){
    const chk = this.canPlace(state, arg);
    if(!chk.ok) return { ok:false, reason:chk.reason };
    const f = findItemById(state, arg.itemId);
    const it = f.item;
    const newRot = (arg.rot!=null ? (arg.rot|0) : it.rot);
    const fromEquipped = f.container==="equipped";
    const samePos = !fromEquipped && f.container===arg.toBox && it.x===arg.x && it.y===arg.y && it.rot===newRot;
    if(samePos) return { ok:true, moved:false, reason:"位置未变" };
    // 从原位置取出：装备槽清空槽位，容器 splice
    if(fromEquipped) state.equipped[f.slot].item=null;
    else state[f.container].items.splice(f.index,1);
    it.x = arg.x; it.y = arg.y; it.rot = newRot;   // 旋转落盘（2B）；槽→网格写真实坐标
    state[arg.toBox].items.push(it);
    return { ok:true, moved:true, from:f.container, fromSlot:fromEquipped?f.slot:null, to:arg.toBox };
  },

  /* ================= 批3A：装备槽接收规则 =================
   * 槽位只接收匹配 slotType；槽内物品不占网格 x/y。
   * 3B 将在这里接入“容器内有物品时的卸下检查”——卸下已装备的胸挂/背包前，
   * 必须先确认其对应容器(rig/backpack)内已清空，否则拒绝卸下。本轮 rig/bag 仅记录
   * state.equipped，容器恒为灰罩且为空，故暂不涉及容器内物品。 */

  // 槽位 → 可接收的 slotType
  SLOT_ACCEPTS: { helmet:["helmet"], armor:["armor"], rig:["rig"], bag:["bag"],
                  primary:["weapon"], secondary:["weapon"], melee:["melee"] },

  // 在仓库里给某物品找首个可放空位（不写入）。
  // ignoreUid 先从占用中剔除——调用时被拖物品已从原位置移除，其腾出的格子可被旧物利用。
  _stashSpotFor(state, item, ignoreUid){
    const box = state.stash;
    const dim = itemDims(item);
    const occ = {};
    box.items.forEach(o=>{
      if(o._uid===ignoreUid) return;
      const od = itemDims(o);
      for(let yy=o.y; yy<o.y+od.h; yy++)
        for(let xx=o.x; xx<o.x+od.w; xx++) occ[xx+","+yy]=true;
    });
    for(let y=0; y+dim.h<=box.rows; y++)
      for(let x=0; x+dim.w<=box.cols; x++){
        let free=true;
        for(let yy=y; yy<y+dim.h && free; yy++)
          for(let xx=x; xx<x+dim.w; xx++) if(occ[xx+","+yy]){ free=false; break; }
        if(free) return {x,y};
      }
    return null;
  },

  /* 试算一次装备/替换/槽间移动，不改 state。
   * 返回 {ok,reason, plan:{sourceSlot,old,mode:'swap'|'stash'|null, spot}}。 */
  canEquip(state, arg){
    const slot = arg.slot;
    if(!this.SLOT_ACCEPTS[slot]) return {ok:false, reason:"装备槽不存在"};
    const f = findItemById(state, arg.itemId);
    if(!f) return {ok:false, reason:"物品不存在"};
    const it = f.item;
    const accepts = this.SLOT_ACCEPTS[slot];
    if(!accepts.includes(it.slotType))
      return {ok:false, reason:"类型不符：该槽位不接收此类物品"};

    const sourceSlot = (f.container==="equipped") ? f.slot : null;
    if(sourceSlot===slot) return {ok:false, reason:"物品已在该槽位"};

    const cur = state.equipped[slot] && state.equipped[slot].item; // 目标槽现有物
    if(!cur) return {ok:true, reason:"", plan:{sourceSlot, old:null, mode:null, spot:null}};

    // 目标槽已有物品：槽→槽且旧物可回原槽 → 互换；否则旧物回仓库首个空位
    if(sourceSlot && this.SLOT_ACCEPTS[sourceSlot].includes(cur.slotType))
      return {ok:true, reason:"", plan:{sourceSlot, old:cur, mode:"swap", spot:null}};

    const spot = this._stashSpotFor(state, cur, it._uid); // 被拖物将先移除，忽略其占位
    if(!spot) return {ok:false, reason:"仓库没有空位，无法替换"};
    return {ok:true, reason:"", plan:{sourceSlot, old:cur, mode:"stash", spot}};
  },

  /* 统一提交入口（调用方须先 snapshot）。执行装备/互换/旧物回仓库。 */
  equipItem(state, arg){
    const chk = this.canEquip(state, arg);
    if(!chk.ok) return {ok:false, reason:chk.reason};
    const p = chk.plan, slot = arg.slot;
    const f = findItemById(state, arg.itemId);
    const it = f.item;

    // 1) 从原位置取出
    if(f.container==="equipped"){
      state.equipped[f.slot].item = null;
    }else{
      state[f.container].items.splice(f.index,1);
    }

    // 2) 安置目标槽旧物
    if(p.old){
      if(p.mode==="swap"){
        state.equipped[p.sourceSlot].item = p.old; // 互换到原槽（槽内物不用 x/y）
      }else{
        p.old.x = p.spot.x; p.old.y = p.spot.y;
        state.stash.items.push(p.old);
      }
    }

    // 3) 新物入槽（槽位不使用网格坐标，rot 归一为 0；拖回网格时仍由 canPlace 判定）
    it.x = null; it.y = null; it.rot = 0;
    state.equipped[slot].item = it;

    return {ok:true, moved:true, slot, sourceSlot:p.sourceSlot, oldUid:p.old?p.old._uid:null, mode:p.mode};
  },

  /* ---- 批B：双击快速装备/卸下（纯试算辅助，不写 state） ---- */

  /* 双击装备：按 slotType 决定目标槽。
   * helmet/armor/rig/bag/melee 直映；weapon：主空→主，主有副空→副，两槽都有→替换主；
   * 非装备类（弹药/药品/材料等）返回 null（界面只抖动）。来源容器是否允许由调用方再判定。 */
  pickQuickSlot(state, item){
    const t = item && item.slotType;
    if(t==="helmet"||t==="armor"||t==="rig"||t==="bag"||t==="melee") return t;
    if(t==="weapon"){
      const p = state.equipped.primary && state.equipped.primary.item;
      const s = state.equipped.secondary && state.equipped.secondary.item;
      if(!p) return "primary";
      if(!s) return "secondary";
      return "primary"; // 两槽都有 → 替换主武器
    }
    return null;
  },

  /* 双击卸下：给已装备物品找仓库首个可放空位（原朝向优先，放不下再旋转；纯查找，不写 state）。
   * ignoreUid 先从仓库占用剔除（一般传物品自身 uid）。返回 {x,y,rot}（rot=建议落盘朝向）或 null。
   * 实际移动仍走 moveItem，不复制第二套移动规则。 */
  firstStashSpotAnyRot(state, item, ignoreUid){
    const box = state.stash;
    const baseW = item.w||1, baseH = item.h||1, curRot = item.rot|0;
    const tries = (baseW===baseH)
      ? [{w:baseW,h:baseH,rot:curRot}]
      : [{w:baseW,h:baseH,rot:curRot},{w:baseH,h:baseW,rot:curRot^1}];
    for(const tr of tries){
      const occ={};
      box.items.forEach(o=>{
        if(o._uid===ignoreUid) return;
        const od=itemDims(o);
        for(let yy=o.y;yy<o.y+od.h;yy++)
          for(let xx=o.x;xx<o.x+od.w;xx++) occ[xx+","+yy]=true;
      });
      for(let y=0;y+tr.h<=box.rows;y++){
        for(let x=0;x+tr.w<=box.cols;x++){
          let free=true;
          for(let yy=y;yy<y+tr.h&&free;yy++)
            for(let xx=x;xx<x+tr.w;xx++) if(occ[xx+","+yy]){ free=false; break; }
          if(free) return {x,y,rot:tr.rot};
        }
      }
    }
    return null;
  },

  /* ================= 批3B：容器类装备生效（装备 / 替换 / 卸下） =================
   * 纯试算：在深克隆上模拟全部转移，任一环节放不下即拒绝且不碰真实 state。
   * 落盘阶段复用同一克隆结果，保证原子（不存在中途失败的半成品）。 */

  // 是否为可变容器类槽
  _containerKindForSlot(slot){ return slot==="rig" ? "rig" : slot==="bag" ? "backpack" : null; },

  // 在克隆的仓库里按“原朝向优先、失败再旋转”放一件，返回是否成功
  _tryStash(stashBox, item, fixed){
    if(fixed){
      const dims = itemDims(item);
      if(fixed.x<0||fixed.y<0||fixed.x+dims.w>stashBox.cols||fixed.y+dims.h>stashBox.rows) return false;
      const occ={};
      stashBox.items.forEach(o=>{ const d=itemDims(o);
        for(let yy=o.y;yy<o.y+d.h;yy++)for(let xx=o.x;xx<o.x+d.w;xx++)occ[xx+","+yy]=1; });
      for(let yy=fixed.y;yy<fixed.y+dims.h;yy++)for(let xx=fixed.x;xx<fixed.x+dims.w;xx++)if(occ[xx+","+yy])return false;
      item.x=fixed.x; item.y=fixed.y;
      stashBox.items.push(item); return true;
    }
    return placeInContainer(stashBox, null, item); // 整矩形 first-fit，内部已处理旋转
  },

  // 面积大→小、同面积保序（稳定）
  _ordered(items){
    return items.map((it,idx)=>({it,idx}))
      .sort((a,b)=> ((b.it.w||1)*(b.it.h||1))-((a.it.w||1)*(a.it.h||1)) || a.idx-b.idx)
      .map(o=>o.it);
  },

  /* 试算。arg: { itemId, slot:'rig'|'bag', toStash?:{x,y} 仅拖容器到具体仓库格时 }。
   * 返回 {ok,reason,kind,transferCount,swapSlots?,sim}。sim 为可直接落盘的克隆。 */
  canContainerChange(state, arg){
    // target:'slot' 拖向装备槽（装备/替换/互换）；'stash' 拖向仓库网格（卸下）
    const target = arg.target==="stash" ? "stash" : "slot";
    const kind = this._containerKindForSlot(arg.slot);
    if(!kind) return {ok:false, reason:"非法容器槽"};
    const f = findItemById(state, arg.itemId);
    if(!f) return {ok:false, reason:"物品不存在"};
    const item = f.item;
    if(target==="slot" && item.slotType !== (kind==="rig"?"rig":"bag"))
      return {ok:false, reason:"类型不符：该槽位不接收此类物品"};

    // 在深克隆上模拟（JSON 克隆含 equipped/容器布局/物品 rot；bag 别名是不可枚举 getter，无需克隆）
    const sim = JSON.parse(JSON.stringify({
      stash:state.stash, rig:state.rig, pockets:state.pockets,
      backpack:state.backpack, safe:state.safe, equipped:state.equipped
    }));
    // 槽位名 bag 对应容器 backpack：克隆/查找统一用容器名 kind，槽位用 slotName
    const slotName = kind==="backpack" ? "bag" : kind;
    const sf = findItemById(sim, item.id);
    if(!sf) return {ok:false, reason:"物品不存在"};
    const sourceSlot = sf.container==="equipped" ? sf.slot : null;
    const isOwnEquipped = sourceSlot===slotName;
    // 拖向自己已在的槽位 = 无意义操作，拒绝；拖向仓库（卸下）不受此限
    if(target==="slot" && isOwnEquipped) return {ok:false, reason:"物品已在该槽位"};
    const cur = sim.equipped[slotName].item;
    let transferCount=0, swapSlots=null;

    // ---- 场景A：已装备容器 → 仓库（卸下，含拖到具体格） ----
    if(target==="stash" && isOwnEquipped){
      sim.equipped[slotName].item=null;
      const contents = sim[kind].items.slice(); sim[kind].items.length=0;
      if((arg.rot|0)%2===1) sf.item.rot=1; // 拖到仓库时允许旋转本体（_tryStash 用 itemDims 判定）
      if(!this._tryStash(sim.stash, sf.item, arg.toStash||null))
        return {ok:false, reason:"仓库空间不足，无法放置该容器"};
      for(const it of this._ordered(contents)){
        if(!placeInContainer(sim.stash, null, it))
          return {ok:false, reason:"仓库空间不足，无法转移容器内的物品"};
      }
      transferCount=contents.length;
      syncContainerLayouts(sim);
      return {ok:true, reason:"", kind, mode:"unequip", transferCount, sim,
              fromSlot:slotName, toBox:"stash", toStash:arg.toStash||null};
    }

    // ---- 场景B：装备/替换进槽 ----
    // 从源取出
    if(sf.container==="equipped") sim.equipped[sf.slot].item=null;
    else sim[sf.container].items.splice(sf.index,1);

    // 目标槽现有容器：其内部物品先按“新容器布局”重排，溢出转仓库；旧容器本体也回仓库
    let oldContainer=null, oldContents=[];
    if(cur){
      oldContainer=cur;
      oldContents=sim[kind].items.slice(); sim[kind].items.length=0;
    }

    // 新容器入槽，再同步几何
    sf.item.x=null; sf.item.y=null; sf.item.rot=0;
    sim.equipped[slotName].item=sf.item;
    syncContainerLayouts(sim);
    const nb=sim[kind], nSlots=nb.slots||null;

    // 槽→槽且为同类容器互换：旧容器去源槽；否则旧容器回仓库
    if(cur && sourceSlot){
      oldContainer.x=null; oldContainer.y=null; oldContainer.rot=0;
      sim.equipped[sourceSlot].item=oldContainer;
      swapSlots=[kind, sourceSlot==="bag"?"backpack":sourceSlot];
      syncContainerLayouts(sim);
    }else if(cur){
      if(!placeInContainer(sim.stash, null, oldContainer))
        return {ok:false, reason:"仓库空间不足，无法换下原容器"};
    }

    // 旧内容重排进新容器（隔层+旋转），溢出按序转仓库
    const overflow = repackContainer(nb, nSlots, oldContents);
    transferCount=overflow.length;
    for(const it of this._ordered(overflow)){
      if(!placeInContainer(sim.stash, null, it))
        return {ok:false, reason:"仓库空间不足，无法转移容器内的物品"};
    }
    return {ok:true, reason:"", kind, mode: cur?(sourceSlot?"swap":"replace"):"equip",
            transferCount, sim, swapSlots,
            toSlot:slotName, sourceSlot:sourceSlot, hasOld:!!cur};
  },

  /* 落盘：直接采用试算克隆的结果（原子），由调用方在 snapshot() 后调用。
   * 返回变更摘要，供界面只刷新受影响容器/槽。 */
  commitContainerChange(state, plan){
    if(!plan || !plan.ok || !plan.sim) return {ok:false, reason:plan?plan.reason:"无计划"};
    const s=plan.sim;
    state.stash=s.stash; state.rig=s.rig; state.pockets=s.pockets;
    state.backpack=s.backpack; state.safe=s.safe; state.equipped=s.equipped;
    syncContainerLayouts(state);
    adoptState(state);
    return {ok:true, mode:plan.mode, transferCount:plan.transferCount,
            toSlot:plan.toSlot, sourceSlot:plan.sourceSlot, fromSlot:plan.fromSlot};
  },


  caliberFromWeapon(text){
    for(const m of WEAPON_CALIBER){
      if(m.wpns.some(w => text.includes(w))) return m.caliber;
    }
    return null;
  },
  /* 从口语直接识别口径（"7.62"/"9mm"/"5.45"/".338"），找不到再退回武器名匹配 */
  caliberFromText(text){
    const t = text || "";
    if(/9mm|9毫米|9x19|9×19/.test(t)) return "9x19";
    if(/7\.62|762|7\.62x39/.test(t)) return "7.62x39";
    if(/5\.45|545/.test(t)) return "5.45x39";
    if(/\.338|338/.test(t)) return ".338";
    return this.caliberFromWeapon(t);
  },
  caliberLabel(cal){
    const m = WEAPON_CALIBER.find(x=>x.caliber===cal);
    return m ? m.label : cal;
  },

  /* 全库存枚举（仓库 + 随身容器 + 装备栏），带位置；供“指定物品”按位置处理。
   * 容器对象统一取 .items；装备槽 item 放在 equipped[slot].item。 */
  allInventory(state){
    const out=[];
    ["stash","rig","pockets","backpack","safe"].forEach(cn=>{
      const box=state[cn];
      if(box && Array.isArray(box.items)) box.items.forEach(it=>{ if(it) out.push({item:it, container:cn, slot:null}); });
    });
    const eq=state.equipped||{};
    Object.keys(eq).forEach(slot=>{ const it=eq[slot]&&eq[slot].item; if(it) out.push({item:it, container:"equipped", slot}); });
    return out;
  },

  /* 位置中文名（用于说明“物品在哪里、为何不能卖/为何只能这样处理”） */
  locLabel(container, slot){
    if(container==="equipped") return "装备栏（"+(SLOT_LABEL[slot]||slot)+"）";
    return {stash:"仓库", rig:"胸挂", pockets:"口袋", backpack:"背包", safe:"安全箱"}[container] || (container||"未知");
  },

  /* 当前装备主/副武器的适配口径（去重）；无装备武器 → [] */
  equippedCalibers(state){
    const eq=state.equipped||{};
    const cals=[];
    ["primary","secondary"].forEach(k=>{
      const it=eq[k]&&eq[k].item;
      if(!it) return;
      const c=this.caliberFromWeapon(it.wpn || it.baseName || it.name || "");
      if(c && !cals.includes(c)) cals.push(c);
    });
    return cals;
  },

  /* “身上的”随身容器（口袋恒可用；背包/胸挂仅在已装备时可用）内的物品，带 _container 标注 */
  carriedContainerItems(state){
    const out=[];
    const boxes=[];
    if(state.pockets) boxes.push({name:"pockets", box:state.pockets});
    if(state.equipped && state.equipped.bag && state.equipped.bag.item && state.backpack)
      boxes.push({name:"backpack", box:state.backpack});
    if(state.equipped && state.equipped.rig && state.equipped.rig.item && state.rig)
      boxes.push({name:"rig", box:state.rig});
    boxes.forEach(c=>{ (c.box.items||[]).forEach(it=>{ if(it) out.push(Object.assign({_container:c.name}, it)); }); });
    return out;
  },

  /* 本地关键词路由（NLU 驱动；LLM 模式下意图由模型给） */
  intentOf(text){
    const norm = NLU.normalize(text);
    return NLU.detectAction(norm);
  },

  /* 意图已知后的实体匹配：不依赖文本里的动作动词（连续追问时玩家可能只回物品名/口径）。
   * 返回与 NLU.parse 同构的 {normText, container, candidates, ambiguous}。 */
  matchForIntent(text, items){
    const norm = NLU.normalize(text||"");
    const container = NLU.detectContainer(norm);
    const candidates = NLU.matchItems(norm, items||[], {});
    const ambiguous = candidates.length>=2
      && candidates[0].confidence===candidates[1].confidence
      && candidates[0].confidence>=0.85;
    return { normText:norm, container, candidates, ambiguous };
  },

  /* 把 build 结果归入五种互斥返回类型，供“本地优先/LLM 补充”与测试统计：
   *   preview      可预览（confirm=true）
   *   needs-params 缺参数（clarify / 缺预算）
   *   blocked      规则拦截（场景/位置/容量/空结果等 noop）
   *   unsupported  无执行器（buy/organize）
   *   not-understood 确实未理解（intent 为空）
   */
  classify(plan){
    if(!plan) return "not-understood";
    const a = plan.actions || {};
    if(a.code === "unsupported") return "unsupported";
    if(plan.intent == null) return "not-understood";
    if(plan.clarify || a.code === "budgetMissing") return "needs-params";
    if(plan.confirm) return "preview";
    if(a.type === "toSafe" || a.type === "retrieve" || a.type === "loadout") return "exec";
    return "blocked";   // noop 且非澄清 → 规则拦截/空结果
  },

    /* 从口语粗提部位 */
    localSlot(text){
      if(/头盔|头/.test(text)) return "头盔";
      if(/甲|胸甲|防具|防弹衣/.test(text)) return "胸甲";
      if(/武器|枪/.test(text)) return "主武器";
      return null;
    },

  /* 从口语里粗提参数（LLM 不可用时的增强兜底） */
  localParams(text){
    const p = {};
    // 安全箱：品质语义——"X及以上/以上"→下限；裸说"X色的/物品"→精确品质
    const qMap = [["金","gold"],["紫","purple"],["蓝","blue"],["绿","green"],["白","white"]];
    // 阶段3别名：保险/保箱=安全箱
    const safeCtx = /安全箱|保险箱|入箱|保险|保箱/.test(text);
    if(safeCtx){
      // 阶段3：自由口语“高级子弹 + 甲修 …放保险”→ 走专用策略 premiumAmmoArmor（两者都点名时）
      const wantsPremiumAmmo = /高级子弹|高级弹|金弹|紫弹|好子弹/.test(text);
      const wantsArmorRepair = /甲修|护甲维修|修甲/.test(text);
      if(wantsPremiumAmmo && wantsArmorRepair) p.strategy = "premiumAmmoArmor";
      if(/紫色及以上|紫色以上|紫以上|紫品及以上|紫色起步/.test(text)) p.minQuality = "purple";
      else if(/金色及以上|金色以上|金以上/.test(text)) p.minQuality = "gold";
      else if(/蓝色及以上|蓝色以上|蓝以上/.test(text)) p.minQuality = "blue";
      else if(/绿色及以上|绿色以上|绿以上/.test(text)) p.minQuality = "green";
      else {
        for(const [word,q] of qMap){
          if(text.includes(word)){ p.exactQuality = q; break; }
        }
      }
      // 武器口径限定："AKM的子弹进安全箱" / "7.62的子弹" → 只取该武器对应口径
      const cal = this.caliberFromText(text);
      if(cal && /弹/.test(text)) p.caliber = cal;
    }
    // 战备目标：5万/五万/50000 统一解析（含 gte/lte 方向）
    const lt = this.parseLoadoutTarget(text);
    if(lt.ok){ p.budget = lt.budget; if(lt.compare) p.compare = lt.compare; }
    // 出售品质上限（本地直接解析，减少 LLM 依赖）："蓝以下/蓝色以下"=blue
    if(/蓝以下|蓝色以下|蓝品及以下|蓝色及以下/.test(text)) p.maxQuality = "blue";
    else if(/绿以下|绿色以下|绿品及以下/.test(text)) p.maxQuality = "green";
    else if(/白以下|白色以下/.test(text)) p.maxQuality = "white";
    else if(/紫以下|紫色以下/.test(text)) p.maxQuality = "purple";
    else if(/金以下|金色以下/.test(text)) p.maxQuality = "gold";
    return p;
  },

  build(intent, state, params){
    params = params || {};
    const bag = state.bag;
    // 场景白名单仅 pre|post；缺失/未知（含历史 "in"）归一到 pre，不设静默分支
    const scene = (state.scene === "post") ? "post" : "pre";
    /* 批0：候选物品带稳定 id；idx 仅 layout 自动排样时临时使用 */
    const withIdx = bag
      .map((it,i)=> it ? Object.assign({idx:i}, it) : null)
      .filter(Boolean);

    /* 指令C-1：精确“蓝色物品出售”本流程（区别于旧“蓝品及以下”批量）。
       触发：脚本预设 exactSell:'blue'，或文本含“蓝”且不含“以下/及以下/以内”。 */
    const sellText = (params && params._text) ? String(params._text) : "";
    const bulkWords = /以下|及以下|以内|全卖|清包|批量|都卖|全部卖|统统/;
    const exactBlueSell = (params && params.exactSell === "blue")
      || (intent === "sell" && /蓝/.test(sellText) && !bulkWords.test(sellText));

    /* ---- 意图为空 → 澄清，不执行任何操作 ---- */
    if(!intent){
      return {
        intent:null, confirm:false,
        reply:"没理解你的意思。可以试试：配一套跑刀装 / 把甲修放进安全箱 / 把蓝色以下的卖了 / 修理装备",
        steps:["意图识别：未匹配任何动作 → <b>澄清，不执行任何操作</b>"],
        actions:{ type:"noop" }
      };
    }

    /* ---- 能力边界：购买 / 整理仓库 —— 无执行器，明确提示暂不支持 ---- */
    if(intent === "buy"){
      const norm = params._text ? NLU.normalize(params._text) : "";
      const category = params.category || NLU.detectCategory(norm);
      const lt = params._text ? this.parseLoadoutTarget(params._text) : {ok:false};
      const bits=[];
      if(category) bits.push("品类="+(NLU.CATEGORY_LABEL[category]||category));
      if(lt.ok) bits.push("预算="+lt.budget.toLocaleString());
      return {
        intent, confirm:false,
        reply:`暂不支持购买功能：当前原型没有购买执行器，不会自动扣币、也不会转成预算配装。${bits.length?"（已识别 "+bits.join("，")+"，仅识别不执行）":""}`,
        steps:[
          `识别意图：<b>购买</b>（暂无执行器）`,
          ...(category?[`品类归一：${NLU.CATEGORY_LABEL[category]||category}`]:[]),
          ...(lt.ok?[`预算识别：${lt.budget.toLocaleString()}（仅识别，不执行）`]:[]),
          `能力边界：无购买执行器 → 明确提示暂不支持，不追问品类、不自动扣币`
        ],
        actions:{ type:"noop", code:"unsupported", feature:"buy" }
      };
    }
    if(intent === "organize"){
      return {
        intent, confirm:false,
        reply:`暂不支持整理仓库功能：当前原型没有整理执行器。`,
        steps:[`识别意图：<b>整理仓库</b>（暂无执行器）`, `能力边界：无整理执行器 → 明确提示暂不支持`],
        actions:{ type:"noop", code:"unsupported", feature:"organize" }
      };
    }

    /* ---- 场景门禁：应用只处于 pre|post（界面恒为 pre），无战斗中静默分支 ---- */
    if(intent === "loadout" && scene !== "pre"){
      return {
        intent, confirm:false,
        reply:"配装是战前准备环节的操作。请在「战前准备」场景进行配装。",
        steps:[`场景校验：loadout 仅战前开放`],
        actions:{ type:"noop" }
      };
    }
    // 战前准备已开放批量出售：不再按场景拒绝，改用“只卖仓库”的范围保护（见 sell 分支 skippedCarry）

    /* ---------------- ① 战前：往安全箱装带入局物资 ---------------- */
    if(intent === "safe"){
      if(state.scene && state.scene !== "pre"){
        return {
          intent, confirm:false,
          reply: "当前不是战前准备阶段，带出的物资已经安全，不需要再放安全箱。安全箱是<b>战前</b>用来保护带入局物资的。",
          steps:[`场景校验：safe 意图仅在"战前准备"场景开放`, `当前为非战前场景 → 拒绝执行（防误用）`],
          actions:{ type:"noop" }
        };
      }
      // 归一化：类别 / 来源 / “要用的子弹”口径；basePool 按来源选择（仓库 vs 随身容器）
      const norm = params._text ? NLU.normalize(params._text) : "";
      const category = params.category || NLU.detectCategory(norm);
      const source = params.source || NLU.detectSource(norm);
      const wantsUsableAmmo = /要用的子弹|用得上的子弹|能用的子弹|当前枪的子弹|现在枪的子弹|这把枪的子弹/.test(norm);
      const basePool = source === "carried" ? this.carriedContainerItems(state) : withIdx;
      // 实体匹配：意图已知，不依赖动作动词（连续追问只回物品名/口径也能匹配）
      const nlu = params._text ? this.matchForIntent(params._text, basePool) : null;
      let pool, cond;
      // 预设策略（演示脚本，稳定直出，不经过文本歧义）：金弹 + 维修件
      if(params.strategy === "premium"){
        const ppool = withIdx.filter(it=> (it.kind==="ammo" && it.quality==="gold") || it.kind==="repair");
        const ppick = this.fitIntoBox(state.safe, ppool);
        const pcell = ppick.reduce((s,p)=>s+(p.w||1)*(p.h||1),0);
        const free = SAFE_CAPACITY - state.safe.items.reduce((s,it)=>{const d=itemDims(it);return s+d.w*d.h;},0);
        return { intent, confirm:false,
          reply:`已按安全箱规划：装得下 ${ppick.length} 件高价值物资（金色弹药 + 甲修/头修，新增占用 ${pcell} 格，剩余 ${free-pcell}/${SAFE_CAPACITY} 格），即使本局白给也不会掉落。`,
          steps:[
            `识别意图：<b>战前安全箱装载</b>（预设策略，演示稳定直出）`,
            `领域知识过滤：只选<b>金色弹药</b>与<b>护甲/头盔维修件</b>，非战斗高值物不占格位`,
            `格位装箱：考虑箱内已有占用 → 装入 ${ppick.map(p=>p.baseName||p.name).join("、")||"无"}`,
            `引擎校验：id 合法 → 生成<b>移动</b>动作（可撤销，执行时写坐标）`],
          actions:{ type:"toSafe", ids:ppick.map(p=>p.id) }
        };
      }
      // 预设策略③（阶段3）：带入对局的“高级子弹 + 甲修”放安全箱
      //   高级子弹=弹药类 quality purple/gold（按字段，不按名字）；
      //   甲修=护甲维修包（名字含“护甲维修”）中品质最高的 1 件，不含头盔维修、不含更低品质。
      //   沿用“带入对局的东西放安全箱”取物口径=仓库(state.stash)；整体预检，放不下就整体不执行。
      if(params.strategy === "premiumAmmoArmor"){
        const sel = this.pickPremiumAmmoArmor(state);
        const carryLabel = {pockets:"口袋", backpack:"背包", rig:"胸挂"};
        const srcText = sel.sources.length ? sel.sources.map(s=>carryLabel[s]).join("、") : "（背包/胸挂均未装备，仅口袋可用）";
        if(!sel.ammo.length || !sel.armor){
          // 只找到一类 → 整体不执行，说明缺哪一类；两类都没有 → 统一提示
          let reason;
          if(!sel.ammo.length && !sel.armor)
            reason = "身上没有符合条件的高级子弹（紫/金弹药）和护甲维修包（取物只限随身的口袋、已装备背包/胸挂，不会去仓库拿）。";
          else if(!sel.ammo.length)
            reason = "身上找到了护甲维修包，但随身容器里没有高级子弹（紫/金弹药）；本次整体未执行，也不会回退去仓库取。";
          else
            reason = "身上找到了高级子弹，但随身容器里没有护甲维修包；本次整体未执行，也不会回退去仓库取。";
          return { intent, confirm:false,
            reply:reason,
            steps:["识别意图：<b>战前安全箱装载</b>（预设策略 premiumAmmoArmor）",
                   "取物来源：随身容器 = "+srcText+"（不取仓库、不取装备栏、已在安全箱的跳过）",
                   "选取不完整 → 整体不执行、不部分移动"],
            actions:{ type:"noop", code:"premiumMissing", missingAmmo:!sel.ammo.length, missingArmor:!sel.armor } };
        }
        const targets = sel.ammo.concat(sel.armor?[sel.armor]:[]);
        const fit = this.fitIntoBox(state.safe, targets);   // 与执行同一排布算法
        const fitIds = new Set(fit.map(p=>p.id));
        const overflow = targets.filter(p=>!fitIds.has(p.id));
        if(overflow.length){
          const free = SAFE_CAPACITY - state.safe.items.reduce((s,it)=>{const d=itemDims(it);return s+d.w*d.h;},0);
          return { intent, confirm:false,
            reply:`安全箱放不下，本次<b>整体未执行</b>：${overflow.map(p=>p.baseName||p.name).join("、")} 没有可容纳的空位（安全箱剩余 ${free}/${SAFE_CAPACITY} 格）。请先腾格后再试。`,
            steps:[
              "识别意图：<b>战前安全箱装载</b>（高级子弹 + 甲修）",
              `选取：${targets.map(p=>(p.baseName||p.name)+"("+((p.w||1)*(p.h||1))+"格)").join("、")}`,
              `<span class="loss">整体预检失败</span>：放不下 ${overflow.map(p=>p.baseName||p.name).join("、")} → 不静默少装、不产生部分移动`],
            actions:{ type:"noop", code:"safeOverflow", overflow:overflow.map(p=>p.id) } };
        }
        const cells = fit.reduce((s,p)=>s+(p.w||1)*(p.h||1),0);
        const freeNow = SAFE_CAPACITY - state.safe.items.reduce((s,it)=>{const d=itemDims(it);return s+d.w*d.h;},0);
        const ammoNames = sel.ammo.map(p=>p.baseName||p.name).join("、")||"无";
        const armorName = sel.armor ? (sel.armor.baseName||sel.armor.name) : "无";
        return { intent, confirm:false,
          reply:`已规划把带入对局的高级子弹与甲修放进安全箱：高级子弹 ${sel.ammo.length} 堆（${ammoNames}）+ 甲修（${armorName}），共 ${fit.length} 件、新增占用 ${cells} 格，剩余 ${freeNow-cells}/${SAFE_CAPACITY} 格；死亡也不掉落，可一键撤销。`,
          steps:[
            "识别意图：<b>战前安全箱装载</b>（预设策略，演示稳定直出）",
            "取物来源：随身容器 = "+srcText+"（不取仓库、不取装备栏、已在安全箱的跳过）",
            "品质按字段判定：高级子弹=弹药且 quality 为 purple/gold（不看名字）",
            "甲修=随身护甲维修包中品质最高 1 件，排除头盔维修包与更低品质",
            `整体预检通过 → 装入 ${fit.map(p=>p.baseName||p.name).join("、")}；生成<b>移动</b>动作（一次撤销恢复全部位置）`],
          actions:{ type:"toSafe", ids:fit.map(p=>p.id), strategy:"premiumAmmoArmor" } };
      }
      // 排除/保留条件暂不支持 → 明确澄清，不忽略后执行
      if(NLU.detectExclusion(norm).length){
        return { intent, confirm:false, clarify:true, clarifyIntent:"safe",
          reply:"暂不支持排除/保留条件（如“除了…以外”“保留…”“不要放…”）。请直接说明要放进安全箱的物品、类别或品质范围。",
          steps:["排除/保留条件暂不支持 → 澄清，不忽略执行"],
          actions:{ type:"noop", code:"clarify", missing:"exclusion" } };
      }
      // 具体数量（如“5发/两堆”）暂不支持 → 明确澄清，不忽略后执行
      const safeQty = NLU.detectQuantity(norm);
      if(safeQty && !safeQty.all){
        return { intent, confirm:false, clarify:true, clarifyIntent:"safe",
          reply:"暂不支持按数量放入，安全箱按整堆/整件处理。请直接说明要放入的物品、类别或品质。",
          steps:["具体数量暂不支持 → 澄清，不忽略执行"],
          actions:{ type:"noop", code:"clarify", missing:"quantity" } };
      }
      // 未指明容器 → 追问
      if(nlu && !nlu.container && !params.caliber && !params.exactQuality && !params.minQuality){
        return { intent, confirm:false, clarify:true, clarifyIntent:"safe",
          reply:"放进哪里？请说明：放进<b>安全箱</b> 还是 放进<b>背包</b>？",
          steps:["未检测到目标容器 → 请求澄清"],
          actions:{ type:"noop", code:"clarify", missing:"container" }
        };
      }
      // 同分歧义 → 返回候选卡片
      if(nlu && nlu.ambiguous && nlu.candidates.length>=2){
        return {
          intent, confirm:true,
          reply: `「${nlu.normText}」匹配到多件物资，请选择：`,
          steps:[`模糊匹配：同置信度=${nlu.candidates[0].confidence.toFixed(2)} → 需玩家确认`, ...nlu.candidates.slice(0,4).map(c=>`${c.item.name}（${c.reason}）`)],
          actions:{ type:"disambig", options:nlu.candidates.slice(0,4).map(c=>({name:c.item.name, id:c.item.id})) }
        };
      }
      if(nlu && nlu.candidates.length && nlu.candidates[0].confidence>=0.85){
        pool = nlu.candidates.filter(c=>c.confidence>=0.85).map(c=>c.item);
        cond = `（指定：${pool.map(p=>p.baseName||p.name).join("、")}）`;
      } else if(wantsUsableAmmo){
        const cals = this.equippedCalibers(state);
        if(cals.length === 1){
          pool = basePool.filter(it=> (it.kind==="ammo"||it.cat==="ammo") && it.caliber===cals[0]);
          cond = `（仅 ${this.caliberLabel(cals[0])} 口径弹药）`;
        } else if(cals.length > 1){
          return { intent, confirm:false, clarify:true, clarifyIntent:"safe",
            reply:`当前装备了多种口径武器，请说明“要用的子弹”是哪种口径：${cals.map(c=>this.caliberLabel(c)).join("、")}。`,
            steps:[`“要用的子弹”需按口径澄清：${cals.map(c=>this.caliberLabel(c)).join("、")}`],
            actions:{ type:"noop", code:"clarify", missing:"caliber", caliberOptions:cals } };
        } else {
          return { intent, confirm:false,
            reply:`当前未装备能确定口径的武器，无法判断“要用的子弹”。请直接说明口径，如“把7.62的子弹放进安全箱”。`,
            steps:[`“要用的子弹”依赖当前武器口径，但未装备武器`],
            actions:{ type:"noop" } };
        }
      } else if(params.caliber){
        pool = basePool.filter(it=> (it.kind==="ammo"||it.cat==="ammo") && it.caliber===params.caliber);
        cond = `（仅 ${this.caliberLabel(params.caliber)} 口径弹药）`;
      } else if(category){
        pool = basePool.filter(it=> it.cat===category);
        cond = `（仅${NLU.CATEGORY_LABEL[category]||category}类别${source==="carried"?"，来自随身容器":""}）`;
        if(!pool.length){
          return { intent, confirm:false,
            reply:`${source==="carried"?"随身容器":"仓库"}里没有${NLU.CATEGORY_LABEL[category]||category}类物资。`,
            steps:[`类别筛选：${NLU.CATEGORY_LABEL[category]||category}（来源：${source==="carried"?"随身容器":"仓库"}）→ 无匹配`],
            actions:{ type:"noop" } };
        }
      } else if(params.exactQuality){
        pool = basePool.filter(it=> it.quality === params.exactQuality);
        cond = `（仅 ${this.qualityLabel(params.exactQuality)} 品）`;
      } else if(params.minQuality){
        const minRank = QUALITY_RANK[params.minQuality] || 1;
        pool = basePool.filter(it=> QUALITY_RANK[it.quality] >= minRank);
        cond = `（${this.qualityLabel(params.minQuality)} 品及以上）`;
      } else {
        return {
          intent, confirm:false, clarify:true, clarifyIntent:"safe",
          reply: "你想把哪些物资放进安全箱？可说：把甲修放进安全箱 / 把紫色以上放进安全箱 / 把AKM的子弹放进安全箱。",
          steps:["未检测到具体物品或筛选条件 → <b>不执行默认装载</b>，请求澄清"],
          actions:{ type:"noop", code:"clarify", missing:"item" }
        };
      }
      const picked = this.fitIntoBox(state.safe, pool);
      const usedCells = picked.reduce((s,p)=>s+(p.w||1)*(p.h||1),0);
      const freeNow = SAFE_CAPACITY - state.safe.items.reduce((s,it)=>{const d=itemDims(it);return s+d.w*d.h;},0);
      return {
        intent, confirm:false,
        reply: picked.length
          ? `安全箱规划：装得下 ${picked.length} 件物资${cond}（新增占用 ${usedCells} 格，剩余 ${freeNow-usedCells}/${SAFE_CAPACITY} 格），死亡不掉落。`
          : `安全箱装不下这些物资${cond}（剩余空间不足）。`,
        steps:[
          `识别意图：<b>战前安全箱装载</b>${params._fromLLM?' · LLM':''}`,
          `物品匹配：${nlu?nlu.candidates.slice(0,3).map(c=>`${c.item.baseName||c.item.name}(${c.confidence.toFixed(2)})`).join("、"):"口径/品质筛选"}`,
          `格位装箱：考虑箱内已有占用 → 装入 ${picked.map(p=>p.baseName||p.name).join("、")||"无"}`,
          `引擎校验：id 合法 → 生成<b>移动</b>动作（可撤销，执行时写坐标）`
        ],
        actions:{ type:"toSafe", ids:picked.map(p=>p.id) }
      };
    }

    /* ---------------- ①b 战前：从安全箱取出物资 ---------------- */
    if(intent === "retrieve"){
      if(state.scene && state.scene !== "pre"){
        return { intent, confirm:false, reply:"取出操作仅在战前准备阶段可用。",
          steps:[`场景校验：retrieve 仅战前开放`], actions:{ type:"noop" } };
      }
      const safeBox = state.safe;
      const safeArr = safeBox.items;
      const safeItems = safeArr.map((it,i)=> Object.assign({idx:i}, it));
      const nlu = params._text ? NLU.parse(params._text, safeItems, {scope:"safe"}) : null;
      if(nlu && nlu.ambiguous && nlu.candidates.length>=2){
        return { intent, confirm:true,
          reply:`安全箱里有多件匹配物资，请选择：`,
          steps:["同分歧义 → 玩家确认", ...nlu.candidates.slice(0,4).map(c=>c.item.name)],
          actions:{ type:"disambig", options:nlu.candidates.slice(0,4).map(c=>({name:c.item.name, id:c.item.id})) }
        };
      }
      if(nlu && nlu.candidates.length && nlu.candidates[0].confidence>=0.85){
        const top=nlu.candidates[0]; const found=findItemById(state, top.item.id);
        if(!found || found.container!=="safe") return { intent, confirm:false, reply:"物品定位失效。", steps:[], actions:{type:"noop"} };
        const item=found.item;
        return { intent, confirm:false,
          reply:`已将「${item.name}」从安全箱取出，放回背包。`,
          steps:[`识别意图：<b>安全箱取出</b>`, `匹配：${item.name}（${top.reason}）`, `生成<b>反向移动</b>动作（可撤销）`],
          actions:{ type:"retrieve", ids:[item.id] }
        };
      }
      const bagNlu = params._text ? NLU.parse(params._text, withIdx, {scope:"bag"}) : null;
      if(bagNlu && bagNlu.candidates.length && bagNlu.candidates[0].confidence>=0.85)
        return { intent, confirm:false,
          reply:`安全箱里没有「${bagNlu.candidates[0].item.name}」——它在仓库背包里，不在安全箱。`,
          steps:[`安全箱查找：无匹配`, `背包查找：${bagNlu.candidates[0].item.name}（${bagNlu.candidates[0].reason}）`],
          actions:{ type:"noop" } };
      return { intent, confirm:false,
        reply:`安全箱里没有找到匹配的物资。${safeArr.length?`安全箱现有：${safeArr.map(it=>it.baseName||it.name).join("、")}`:"安全箱为空。"}`,
        steps:[`安全箱查找：无匹配 → 不生成空移动动作`],
        actions:{ type:"noop" } };
    }

    /* ---------------- ② 卡战备 / N以内 配装（指令A：严格七槽、确定性求解） ---------------- */
    if(intent === "loadout"){
      // 目标数值与方向：优先用已解析参数；否则从原话解析（5w/5万/五万/50000）。
      // 阶段3：解析不出预算时明确拒绝（未识别预算），不再静默退回默认 5 万。
      let target = { budget: params.budget, compare: params.compare || null };
      if(target.budget==null){
        const parsed = params._text ? this.parseLoadoutTarget(params._text) : {ok:false};
        if(parsed.ok){ target.budget=parsed.budget; if(!target.compare) target.compare=parsed.compare; }
        else {
          return { intent, confirm:false,
            reply:`<span class="loss">未识别预算</span>：没听清要卡到多少战备值。请带上一个数字，例如“帮我起装卡5w战备”“配一套5万以内的”。`,
            steps:[`识别意图：<b>配装</b>，但缺少可用的预算数字`,
                   `解析结果：<span class="loss">${parsed.reason||"未识别预算"}</span> → 不使用默认值、不执行任何换装`],
            actions:{ type:"noop", code:"budgetMissing" } };
        }
      }
      if(!target.compare) target.compare="lte";
      const N=+target.budget, compare=target.compare;

      const sol=this.solveLoadoutTarget(state,{budget:N,compare});
      if(!sol.ok){
        return { intent, confirm:false,
          reply:`配不成这套：${sol.reason}。`,
          steps:[`识别意图：<b>${compare==="gte"?"卡战备":"N以内"}配装</b>（目标 ${N.toLocaleString()}）${params._fromLLM?' · 来源：LLM 语义解析':''}`,
                 `<span class="loss">无解：${sol.reason}</span>，不降低标准、不擅自改向`],
          actions:{ type:"noop" } };
      }
      const chosen=sol.slots.filter(s=>s.id).map(s=>s.name);
      const total=sol.total, diff=sol.diff;
      const dirTxt = compare==="gte" ? `卡到 ${N.toLocaleString()}` : `${N.toLocaleString()} 以内`;
      if(sol.noChange){
        return { intent, confirm:false,
          reply:`当前装备已是最接近 ${dirTxt} 的方案：合计战备值 <span class="num">${total.toLocaleString()}</span>，无需换装。`,
          steps:[`识别意图：<b>${compare==="gte"?"卡战备":"N以内"}配装</b>（目标 ${N.toLocaleString()}）${params._fromLLM?' · 来源：LLM 语义解析':''}`,
                 `当前装备合计 ${total.toLocaleString()}，已是全部达标方案里最接近目标的一套 → 不换装、不写撤销`],
          actions:{ type:"loadout", ids:sol.ids, total, compare, noChange:true } };
      }
      const tail = compare==="gte"
        ? `达标 ${N.toLocaleString()}，仅高出 ${diff.toLocaleString()}`
        : `在 ${N.toLocaleString()} 以内，余 ${(N-total).toLocaleString()}`;
      return {
        intent, confirm:false,
        reply: `方案已生成：${chosen.join(" + ")}，合计战备值 <span class="num">${total.toLocaleString()}</span>，${tail}。可一键穿戴或换一套。`,
        steps:[
          `识别意图：<b>${compare==="gte"?"卡战备（≥目标取最接近）":"N以内（≤目标取最接近）"}</b>（目标 ${N.toLocaleString()} · 跑刀=低成本高机动）${params._fromLLM?' · 来源：LLM 语义解析':''}`,
          `候选范围：仓库/口袋/胸挂/背包/安全箱 + 当前已装备；只算装备栏七槽（${sol.slots.filter(s=>s.id).length} 件），弹药/医疗不计入`,
          `引擎校验：战备值 ${total.toLocaleString()} ${compare==="gte"?"≥":"≤"} ${N.toLocaleString()}；并列按件数更少→槽位顺序取，结果可复现`,
          `换下装备经现有槽位/容器规则预检，放不下则整体拒绝；一次穿戴可一键撤销`,
          `分层设计：新手一键穿戴；老玩家拖拽替换单件`
        ],
        actions:{ type:"loadout", ids:sol.ids, total, compare, diff, slots:sol.slots }
      };
    }

    /* ---------------- ③ 装备耐久体检 ---------------- */
    if(intent === "durability"){
      const warns = [];
      EQUIP_SLOTS.forEach((st)=>{
        const e = state.equipped[st] && state.equipped[st].item;
        if(e && e.durability!=null && e.durability<40){
          warns.push({ where:`已穿戴·${SLOT_LABEL[st]}`, slot:st, name:e.baseName||e.name, dur:e.durability, fix:(e.value*0.08)|0, id:e.id });
        }
      });
      withIdx.forEach(it=>{
        if(it.durability!=null && it.durability<40){
          warns.push({ where:"仓库", name:it.baseName||it.name, dur:it.durability, fix:(it.value*0.08)|0, id:it.id });
        }
      });
      const betterArmor = withIdx.find(it=>it.slotType==="armor" && it.durability>=80);
      const chest = state.equipped.armor && state.equipped.armor.item;
      return {
        intent, confirm:true,
        reply: warns.length
          ? (chest && chest.durability<40
              ? `体检发现 <span class="loss">${warns.length} 件</span>低耐久装备，最危险的是已穿戴「${chest.baseName||chest.name}」仅剩 ${chest.durability}%——下一战可能挡不住第一轮火力。`
              : `体检发现 <span class="loss">${warns.length} 件</span>低耐久装备，建议尽快处理。`)
          : "全部装备耐久健康，无需处理。",
        steps:[
          `识别意图：<b>装备健康巡检</b>（阈值：耐久 < 40% 预警）`,
          ...warns.map(w=>`<span class="loss">${w.name}（${w.where}）耐久 ${w.dur}%</span>`),
          betterArmor
            ? `建议：用仓库内「${betterArmor.baseName||betterArmor.name}」(${betterArmor.durability}%)替换胸甲，比修理旧甲更划算（修理费约 ${warns[0]?warns[0].fix:0}，且旧甲后续仍脆）`
            : `建议：修理低耐久装备`,
          `不可逆性检查：状态变更类操作，提供撤销`
        ],
        actions:{ type:"swapArmor", armorSlot:"armor", armorId: betterArmor ? betterArmor.id : null, warns }
      };
    }

    /* ---------------- ③b 修理装备 ---------------- */
    if(intent === "repair"){
      const wantSlot = params.slot || (params._text ? this.localSlot(params._text) : null);
      const targets = [];
      EQUIP_SLOTS.forEach((st)=>{
        const e = state.equipped[st] && state.equipped[st].item;
        if(!e || e.durability==null) return;
        const label = SLOT_LABEL[st];
        if(wantSlot && label !== wantSlot) return;
        if(e.durability >= 100) return;
        const cost = Math.round((100 - e.durability) / 100 * e.value * 0.05);
        targets.push({ slot:st, slotLabel:label, id:e.id, name:e.baseName||e.name, from:e.durability, to:100, cost });
      });
      if(!targets.length){
        return {
          intent, confirm:false,
          reply: wantSlot ? `「${wantSlot}」当前不需要修理（耐久已满或未装备）。` : "已穿戴装备耐久均为满，无需修理。",
          steps:[`识别意图：<b>装备修理</b>`, `扫描已穿戴装备：没有需要修理的对象`],
          actions:{ type:"noop" }
        };
      }
      const totalCost = targets.reduce((s,t)=>s+t.cost,0);
      const poor = state.money < totalCost;
      return {
        intent, confirm:true,
        reply: `${wantSlot||"全部防具"}将修至满耐久：${targets.map(t=>`${t.name} ${t.from}%→100%`).join("、")}。预计费用 <span class="loss">${totalCost.toLocaleString()}</span> L币${poor?"（当前余额不足）":""}。`,
        steps:[
          `识别意图：<b>装备修理</b>${wantSlot?`（部位：${wantSlot}）`:"（未指定部位，修理全部未满耐久装备）"}${params._fromLLM?' · 来源：LLM 语义解析':''}`,
          ...targets.map(t=>`${t.name}：耐久 ${t.from}% → 100%，按装备价值 5% 计费 = ${t.cost.toLocaleString()}`),
          `合计 ${totalCost.toLocaleString()} L币；扣费类不可逆操作 → 二次确认`,
          poor ? `<span class="loss">余额不足，需要先变现物资（可让我挂交易行）</span>` : `引擎校验：余额 ${state.money.toLocaleString()} ≥ 费用，可执行`
        ],
        actions:{ type:"repair", targets, totalCost, blocked:poor }
      };
    }

    /* ---------------- ④ 批量清包/比价出售 ---------------- */
    if(intent === "sell"){
      /* 指令C-1：仓库精确蓝出售——独立流程，不与旧“蓝品及以下”混用，不用旧“扣费前 market 全额”文案 */
      if(exactBlueSell){
        const sb = this.sellBlueRows(state);
        const skipN = sb.skippedLocked.length + sb.illegal.length;
        if(!sb.rows.length){
          const why = sb.illegal.length ? "仓库内没有可出售的蓝色物品（蓝色物品价格数据异常，已禁选）。"
            : sb.skippedLocked.length ? "仓库内的蓝色物品均处于锁定状态，无可出售对象。"
            : "仓库内没有蓝色物品可出售。";
          return { intent, confirm:false, reply:why,
            steps:[`筛选：仅仓库 state.stash 内 quality==='blue'，精确匹配（不含蓝品及以下）`],
            actions:{ type:"noop" } };
        }
        const skipNote = skipN
          ? `；已跳过 ${skipN} 件（${[...sb.skippedLocked,...sb.illegal].map(x=>x.name+"："+x.reason).join("、")}）` : "";
        // 范围保护：带入局容器/装备槽里的蓝色物品不参与出售，只提示跳过数量
        const carryBlue = this.carryItems(state).filter(it=>it.quality==="blue");
        const carryNote = carryBlue.length ? `；已跳过 ${carryBlue.length} 件带入局物资` : "";
        return {
          intent, confirm:true,
          reply:`仓库内蓝色物品共 ${sb.rows.length} 件：<span class="gain">${sb.list.length} 件挂交易行</span>（预计净收益 ${sb.listNet.toLocaleString()}，扣手续费后仍更划算），${sb.direct.length} 件直接出售（即时到账 ${sb.directIncome.toLocaleString()}）${skipNote}${carryNote}。`,
          steps:[
            `筛选：仅仓库 state.stash 内 <b>精确蓝色（quality==='blue'）</b>，不含白/绿，也不含装备栏与其他容器`,
            `逐堆比价（整堆价，不乘数量）：net=交易行价−手续费(5%)，net>本身价则挂行，否则直接出售；market=null 不可挂行`,
            `挂行仅模拟挂单、收益不到账；直卖即时到账。本操作不可撤销`
          ],
          actions:{
            type:"sellBlue",
            rows: sb.rows,
            directIncome: sb.directIncome, listNet: sb.listNet, feeTotal: sb.feeTotal,
            skipped:[...sb.skippedLocked, ...sb.illegal],
            scopeNote: scene==="pre" ? "战前：仅出售仓库物品" : "",
            skippedCarry: carryBlue.length
          }
        };
      }
      // 归一化：类别 / 来源
      const sellNorm = params._text ? NLU.normalize(params._text) : "";

      // 排除/保留条件暂不支持 → 明确澄清，不忽略后执行
      if(NLU.detectExclusion(sellNorm).length){
        return { intent, confirm:false, clarify:true, clarifyIntent:"sell",
          reply:"暂不支持排除/保留条件（如“除了…以外”“保留…”“不卖…”）。请直接说明要出售的物品、类别或品质范围。",
          steps:["排除/保留条件暂不支持 → 澄清，不忽略执行"],
          actions:{ type:"noop", code:"clarify", missing:"exclusion" } };
      }
      // 具体数量（如“5发/两堆”）暂不支持 → 明确澄清（出售按整堆，不拆分）
      const sellQty = NLU.detectQuantity(sellNorm);
      if(sellQty && !sellQty.all){
        return { intent, confirm:false, clarify:true, clarifyIntent:"sell",
          reply:"暂不支持按数量拆分出售，出售按整堆进行。请直接说明要出售的物品或类别。",
          steps:["数量拆分出售暂不支持 → 澄清，不忽略执行"],
          actions:{ type:"noop", code:"clarify", missing:"quantity" } };
      }

      const sellCategory = params.category || NLU.detectCategory(sellNorm);
      const sellSource = params.source || NLU.detectSource(sellNorm);

      // 指定物品：在全库存（仓库 + 随身容器 + 装备栏）里匹配，按位置决定能否出售
      const invItems = this.allInventory(state).map(x=>Object.assign({_container:x.container, _slot:x.slot}, x.item));
      const nluAll = params._text ? this.matchForIntent(params._text, invItems) : null;

      // 去重（按 id 保最高置信度），带位置信息
      const byId = new Map();
      (nluAll && nluAll.candidates || []).forEach(c=>{
        const id = c.item.id;
        const prev = byId.get(id);
        if(!prev || c.confidence > prev.confidence) byId.set(id, {confidence:c.confidence, item:c.item, loc:c.item._container, slot:c.item._slot, reason:c.reason});
      });
      const itemCands = [...byId.values()];
      const confident = itemCands.filter(c=>c.confidence>=0.6);

      // 多候选 → 点选，不凭相似名称直接出售；单候选但不确定（拼错型号等）也点选确认
      if(confident.length >= 2 || (confident.length===1 && confident[0].confidence<0.85)){
        const opts = confident.slice(0,4).map(c=>({name:c.item.baseName||c.item.name, id:c.item.id, loc:this.locLabel(c.loc,c.slot)}));
        return { intent, confirm:true,
          reply:`「${sellNorm}」匹配到${confident.length>1?"多件":"一件候选"}物资，请选择要卖哪件：`,
          steps:["指定物品出售：多候选/不确定 → 点选，不自动出售", ...opts.map(o=>`${o.name}（${o.loc}）`)],
          actions:{ type:"disambig", options:opts }
        };
      }
      if(confident.length === 1){
        const top = confident[0];
        const it = top.item;
        if(it._container === "stash"){
          const gain = it.value || 0;
          const carryMatched = this.carryItems(state).filter(o=> o.id===it.id);
          const carryNote = carryMatched.length ? `；已跳过 ${carryMatched.length} 件带入局物资` : "";
          return { intent, confirm:true,
            reply:`已选定「${it.baseName||it.name}」出售，预计回收 <span class="gain">${gain.toLocaleString()}</span>${carryNote}。`,
            steps:[`识别意图：<b>指定物品出售</b>`, `匹配：${it.baseName||it.name}（仓库）`, `预计回收 ${gain.toLocaleString()} → 二次确认`],
            actions:{ type:"sell", directIds:[it.id], gain, listings:[], direct:[it],
              scopeNote: scene==="pre" ? "战前：仅出售仓库物品" : "", skippedCarry: carryMatched.length }
          };
        }
        // 指定物品在身上/随身容器 → 说明位置与限制，不“没听懂”、不自动卸装
        const loc = this.locLabel(it._container, it._slot);
        return { intent, confirm:false,
          reply:`「${it.baseName||it.name}」当前在${loc}，不在仓库，不能出售。出售只处理仓库内物品；如需出售请先把它移到仓库。`,
          steps:[`指定物品出售：${it.baseName||it.name} 位于 ${loc}`, `范围保护：出售仅限仓库，不自动卸装、不改位置`],
          actions:{ type:"noop", code:"carriedItem", itemId:it.id, loc } };
      }

      // “身上”限定已携带容器：出售仍只处理仓库 → 明确说明，不自动改成仓库
      if(sellSource === "carried"){
        return { intent, confirm:false,
          reply:`“身上”的物资在随身容器，不在仓库，不能出售。出售只处理仓库物品；如需出售请先移入仓库。`,
          steps:[`来源=随身容器 → 出售仅限仓库，不自动改范围`],
          actions:{ type:"noop", code:"carriedSource" } };
      }

      // 类别筛选（“子弹”→“弹药”等）：类别本身即有效筛选，不强制再补品质/口径
      if(sellCategory){
        const catPool = withIdx.filter(it=> it.cat===sellCategory);
        if(!catPool.length){
          return { intent, confirm:false,
            reply:`仓库里没有${NLU.CATEGORY_LABEL[sellCategory]||sellCategory}类物资可出售。`,
            steps:[`类别筛选：${NLU.CATEGORY_LABEL[sellCategory]||sellCategory}（仓库）→ 无匹配`],
            actions:{ type:"noop" } };
        }
        const catListings = catPool.filter(it=> it.market && it.market > it.value);
        const catDirect = catPool.filter(it=> !(it.market && it.market > it.value));
        const catGain = catDirect.reduce((s,it)=>s+it.value,0);
        const catExtra = catListings.reduce((s,it)=>s+it.market,0) - catListings.reduce((s,it)=>s+it.value,0);
        return { intent, confirm:true,
          reply:`已按${NLU.CATEGORY_LABEL[sellCategory]||sellCategory}类别筛选仓库物资：${catListings.length} 件挂交易行（多赚约 ${catExtra.toLocaleString()}），${catDirect.length} 件直接出售（+${catGain.toLocaleString()}）。`,
          steps:[
            `识别意图：<b>按类别出售</b>（${NLU.CATEGORY_LABEL[sellCategory]||sellCategory}）`,
            `范围：仅仓库 state.stash；随身容器/装备栏不参与`,
            `逐件比价：交易行参考价 > 回收价 → 挂行，否则直接出售`
          ],
          actions:{ type:"sell", listIds: catListings.map(i=>i.id), directIds: catDirect.map(i=>i.id), gain: catGain, listings: catListings, direct: catDirect,
            scopeNote: scene==="pre" ? "战前：仅出售仓库物品" : "", skippedCarry: 0 }
        };
      }

      // 未指定物品/类别 → 检查是否指定了品质筛选（旧“蓝品及以下”批量）
      if(!params.maxQuality && nluAll && (!nluAll.candidates.length || nluAll.candidates[0].confidence<0.6)){
        return { intent, confirm:false, clarify:true, clarifyIntent:"sell",
          reply:"你想卖哪些物资？可说：把蓝色以下的卖了 / 把AKM卖了 / 把军用无线电卖了。",
          steps:["未检测到具体物品、类别或品质条件 → 请求澄清，不默认批量出售"],
          actions:{ type:"noop", code:"clarify", missing:"item" } };
      }
      const maxRank = params.maxQuality ? (QUALITY_RANK[params.maxQuality] || 3) : 3;
      const candidates = withIdx.filter(it=> QUALITY_RANK[it.quality] <= maxRank);
      const listings = candidates.filter(it=> it.market && it.market > it.value);
      const direct   = candidates.filter(it=> !(it.market && it.market > it.value));
      const sumMarket = listings.reduce((s,it)=>s+it.market,0);
      const sumDirect = direct.reduce((s,it)=>s+it.value,0);
      const extra = sumMarket - listings.reduce((s,it)=>s+it.value,0);
      const capLabel = this.qualityLabel(params.maxQuality || "blue");
      const protectedItems = withIdx.filter(i=> QUALITY_RANK[i.quality] > maxRank).map(i=>i.name);
      // 范围保护：带入局容器/装备槽中符合本次筛选条件的物品一律不卖，只统计跳过数量
      const carryMatched = this.carryItems(state).filter(it=> QUALITY_RANK[it.quality] <= maxRank);
      const carryNote = carryMatched.length ? `已跳过 ${carryMatched.length} 件带入局物资。` : "";
      const scopeNote = scene==="pre" ? "战前：仅出售仓库物品。" : "";
      return {
        intent, confirm:true,
        reply:`已分类 ${candidates.length} 件${capLabel}品及以下物资：<span class="gain">${listings.length} 件挂交易行</span>（多赚约 ${extra.toLocaleString()}），${direct.length} 件直接出售。${protectedItems.length?`${protectedItems.slice(0,4).join("、")} 等高品质物资自动保留。`:""}${carryNote}`,
        steps:[
          `识别意图：<b>批量清包 + 收益最大化</b>${params._fromLLM?' · 来源：LLM 语义解析':''}`,
          ...(scopeNote?[`${scopeNote}${carryNote}`]:[]),
          `品质保护：仅处理 ${capLabel} 品及以下，更高品质（${protectedItems.join("、")||"无"}）自动排除`,
          `逐件比价：交易行参考价 > 商人回收价 → 挂行，否则直接出售`,
          `预计：直接出售 +${sumDirect.toLocaleString()} 即时到账；挂行预计回笼 ${sumMarket.toLocaleString()}（扣费前）；二次确认+6秒撤销`
        ],
        actions:{
          type:"sell",
          listIds: listings.map(i=>i.id),
          directIds: direct.map(i=>i.id),
          gain: sumDirect,
          listings, direct,
          scopeNote, skippedCarry: carryMatched.length
        }
      };
    }
    return null;
  },

  /* ================= 指令A：卡战备 / N以内 配装目标（纯函数、确定性、不调LLM） ================= */

  /* 装备价值：只统计装备栏七槽，用 value（商人回收价）；不含任何容器内物品。
     app.js 三处顶部/出战显示统一调用本函数，口径唯一。 */
  gearValue(state){
    return EQUIP_SLOTS.reduce((s,k)=>s+(((state.equipped[k]||{}).item||{}).value||0),0);
  },

  /* 收集七槽候选：五个容器 + 当前已装备；容器类（胸挂/背包）按 canContainerChange 预检，
     不通过则剔除并记原因。返回 {pool:{helmet,armor,rig,bag,weapon,melee}, rejected:[...]}。
     纯读取，不改 state。 */
  loadoutCandidates(state){
    const pool={helmet:[],armor:[],rig:[],bag:[],weapon:[],melee:[]};
    const rejected=[];
    const consider=(it,loc)=>{
      if(!it) return;
      const t=it.slotType;
      if(t==="rig"||t==="bag"){
        // 已在自己对应槽里的容器是"保持不动"候选，无需换装预检
        const ownSlot=(t==="rig")?"rig":"bag";
        if(!(loc==="equipped:"+ownSlot)){
          const chk=this.canContainerChange(state,{itemId:it.id,slot:ownSlot,target:"slot"});
          if(!chk.ok){ rejected.push({id:it.id,name:it.name,slot:ownSlot,reason:chk.reason}); return; }
        }
      }
      if(pool[t]) pool[t].push({id:it.id,name:it.name,value:it.value||0,loc});
    };
    ["stash","pockets","rig","backpack","safe"].forEach(b=>{
      ((state[b]||{}).items||[]).forEach(it=>consider(it,b));
    });
    EQUIP_SLOTS.forEach(k=>{ const it=(state.equipped[k]||{}).item; if(it) consider(it,"equipped:"+k); });
    // 去重（同 id 可能既在容器又被枚举；保留首次定位）
    Object.keys(pool).forEach(t=>{
      const seen=new Set();
      pool[t]=pool[t].filter(c=>{ if(seen.has(c.id)) return false; seen.add(c.id); return true; });
    });
    return {pool,rejected};
  },

  /* 求最接近目标的七槽方案。opt:{budget:N, compare:'gte'|'lte'}。
     gte：合计≥N 取差值最小；lte：合计≤N 取最大。并列→件数少→槽位序字典序。
     至少装备一件；无解返回 {ok:false,reason}，不降低标准、不静默改向。 */
  solveLoadoutTarget(state,opt){
    opt=opt||{};
    const N=+opt.budget, compare=(opt.compare==="gte"?"gte":"lte");
    if(!(N>=0)) return {ok:false,reason:"缺少有效的战备目标数值"};
    const {pool,rejected}=this.loadoutCandidates(state);
    const slotKeys=["helmet","armor","rig","bag","primary","secondary","melee"];
    const singleSlots=[["helmet","helmet"],["armor","armor"],["rig","rig"],["bag","bag"],["melee","melee"]];
    // 武器：主、副共享 weapon 池，不重复；主槽优先。每项 {p,s}
    const wOpts=[{p:null,s:null}];
    pool.weapon.forEach(p=>{
      wOpts.push({p,s:null});
      pool.weapon.forEach(s=>{ if(s.id!==p.id) wOpts.push({p,s}); });
    });
    // 非武器槽：每槽 [空, 候选...]，逐层笛卡尔积（稳定行优先）
    const combos=[[]];
    singleSlots.forEach(([key])=>{
      const choices=[null].concat(pool[key]);
      const grown=[];
      combos.forEach(pre=>choices.forEach(c=>grown.push(pre.concat([{key,c}]))));
      combos.length=0; grown.forEach(g=>combos.push(g));
    });
    const fits=v=>compare==="gte"? v>=N : v<=N;
    // 当前装备七槽现状（用于 B 条：当前已最接近则不换装；并列时现状优先）
    const curSel={};
    slotKeys.forEach(k=>{ const it=(state.equipped[k]||{}).item; curSel[k]=it?it.id:null; });
    const isNow=sel=>slotKeys.every(k=>{ const c=sel[k]; return c?curSel[k]===c.id:curSel[k]==null; });
    const idxOf=(sel,k)=>{
      const c=sel[k]; if(!c) return -1;
      const arr=(k==="primary"||k==="secondary")?pool.weapon:pool[k];
      return arr.findIndex(x=>x.id===c.id);
    };
    let best=null;
    const better=(a,b)=>{
      if(a.diff!==b.diff) return a.diff<b.diff;          // 最接近 N
      if(a.count!==b.count) return a.count<b.count;      // 并列：件数更少
      if(a.isNow!==b.isNow) return a.isNow;              // 仍并列：保持现状优先（不换装）
      for(const k of slotKeys){                          // 逐槽：靠前槽被占用优先；同槽候选下标小优先
        const ia=idxOf(a.sel,k), ib=idxOf(b.sel,k);
        if(ia!==ib){ if(ia<0) return false; if(ib<0) return true; return ia<ib; }
      }
      return false;
    };
    wOpts.forEach(w=>{
      combos.forEach(cmb=>{
        const sel={helmet:null,armor:null,rig:null,bag:null,primary:w.p,secondary:w.s,melee:null};
        cmb.forEach(x=>{ sel[x.key]=x.c; });
        const chosen=slotKeys.map(k=>sel[k]).filter(Boolean);
        if(!chosen.length) return;                       // 排除全空
        const total=chosen.reduce((s,c)=>s+c.value,0);
        if(!fits(total)) return;
        const diff=Math.abs(total-N);
        const cand={total,diff,count:chosen.length,isNow:isNow(sel),sel};
        if(!best||better(cand,best)) best=cand;
      });
    });
    if(!best){
      const reason=compare==="gte"
        ? "全部候选加起来也不到 "+N.toLocaleString()+"，无法卡到该战备（不降低标准）"
        : "最便宜的单件也超过 "+N.toLocaleString()+"，没有 "+N.toLocaleString()+" 以内的方案";
      return {ok:false,reason,compare,budget:N,rejected};
    }
    const slots=slotKeys.map(k=>{
      const c=best.sel[k];
      return {slot:k,label:SLOT_LABEL[k],id:c?c.id:null,name:c?c.name:null,
              price:c?c.value:0,loc:c?c.loc:null,usedEquipped:!!(c&&(""+c.loc).indexOf("equipped:")===0)};
    });
    const ids=slots.filter(s=>s.id).map(s=>s.id);
    const usedEquipped=slots.some(s=>s.usedEquipped);
    // 当前装备是否已等于该方案（逐槽 id 一致）
    const noChange=slotKeys.every(k=>{
      const cur=(state.equipped[k]||{}).item;
      const want=best.sel[k];
      return want ? (cur&&cur.id===want.id) : !cur;
    });
    return {ok:true,compare,budget:N,total:best.total,diff:best.diff,noChange,
            slots,ids,usedEquipped,rejected,
            counts:{helmet:pool.helmet.length,armor:pool.armor.length,rig:pool.rig.length,
                    bag:pool.bag.length,weapon:pool.weapon.length,melee:pool.melee.length}};
  },

  /* 数字 + 方向解析：支持 5万/5 万/五万/50000/5w/5W（normalize 后 w 不区分大小写，×10000）；
     "卡/卡到/卡个…战备"→gte，"以内/以下/不超过"→lte，无方向词默认 lte。
     阶段3：配装语境下解析不出预算 → {ok:false,reason:"未识别预算"}，调用方必须提示，
     禁止静默退回默认值。纯函数，不写 state。 */
  parseLoadoutTarget(text){
    const t=NLU.normalize(text);
    const cn={零:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
    let budget=null;
    // 数字 + 万/w（5万、5w、5W → 50000；normalize 已转小写）
    let m=t.match(/(\d+(?:\.\d+)?)\s*[万w]/);
    if(m) budget=Math.round(parseFloat(m[1])*10000);
    else if(/万/.test(t)){
      const mm=t.match(/([零一二两三四五六七八九])万/);   // 五万、两万
      if(mm) budget=cn[mm[1]]*10000;
    }else{
      const md=t.match(/(\d{3,})/);                       // 50000
      if(md) budget=parseInt(md[1],10);
    }
    const compare=/卡|刚好|压线/.test(t) ? "gte"
      : /以内|以下|不超过|不高于|≤/.test(t) ? "lte" : null;
    if(budget==null){
      const wantsBudget=/配装|配一套|起装|战备|跑刀|预算|以内|以下/.test(t);
      return {ok:false,reason:wantsBudget?"未识别预算":"没有识别到战备数值"};
    }
    return {ok:true,budget,compare:compare||"lte"};
  },

  /* 带入局容器 + 装备槽内的全部物品（批量出售的范围保护对象，永不出售） */
  carryItems(state){
    const out=[];
    const boxes=["rig","backpack","pockets","safe"];
    boxes.forEach(k=>{ const c=state[k]; if(c && Array.isArray(c.items)) c.items.forEach(it=>{ if(it) out.push(it); }); });
    const eq=state.equipped||{};
    Object.keys(eq).forEach(k=>{ const s=eq[k]; if(s && s.item) out.push(s.item); });
    return out;
  },

  /* ================= 指令C-1：仓库精确蓝出售（整堆价、确定性纯函数） =================
   * 口径（用户确认）：
   *  - 范围仅 state.stash.items，精确 quality==='blue'；不碰装备栏/口袋/胸挂/背包/安全箱
   *  - 整堆计价：fee=round(market*MARKET_FEE_RATE)，net=market-fee，均不乘 qty；qty 仅显示
   *  - market 有效且 net>value → list(挂交易行)；net<=value 或 market===null → direct(直接出售)
   *  - value 缺失/负/非有限，或 market 除 null 外非法 → 禁选(illegal)，不当作 0 出售
   *  - 物品级 locked===true 跳过；当前数据无物品锁（仅容器灰罩），分支供真实锁定使用
   */
  sellBlueRows(state){
    const rows=[], skippedLocked=[], illegal=[];
    state.stash.items.forEach(it=>{
      if(it.quality!=="blue") return;
      const vOk = typeof it.value==="number" && isFinite(it.value) && it.value>=0;
      const mNull = it.market===null || it.market===undefined;
      const mOk  = mNull || (typeof it.market==="number" && isFinite(it.market) && it.market>=0);
      if(it.locked===true){ skippedLocked.push({uid:it._uid,name:it.name,reason:"物品已锁定"}); return; }
      if(!vOk || !mOk){
        illegal.push({uid:it._uid,name:it.name,reason:!vOk?"本身价格缺失或非法":"交易行价格非法"});
        return;
      }
      const fee = mNull ? null : Math.round(it.market*MARKET_FEE_RATE);
      const net = mNull ? null : it.market-fee;
      const way = mNull ? "direct" : (net>it.value ? "list" : "direct");
      rows.push({
        uid:it._uid, id:it.id, name:it.baseName||it.name, qty:(typeof it.qty==="number"?it.qty:1),
        value:it.value, market:mNull?null:it.market, fee, net, way, loc:"stash",
        fingerprint:it._uid+"|"+(it.x)+","+(it.y)+"|"+(typeof it.qty==="number"?it.qty:1)+"|"+it.quality+"|"+(it.locked===true)+"|"+it.value+"|"+(mNull?"null":it.market)
      });
    });
    const list=rows.filter(r=>r.way==="list"), direct=rows.filter(r=>r.way==="direct");
    const sum = arr=>arr.reduce((s,r)=>s+(r.way==="list"?r.net:r.value),0);
    return {
      rows, list, direct, illegal, skippedLocked,
      directIncome:sum(direct), listNet:sum(list),
      feeTotal:list.reduce((s,r)=>s+(r.fee||0),0),
      totalExpected:sum(direct)+sum(list)
    };
  },

  /* 已勾选行的实时汇总（整堆价、不乘 qty）。rows 为 sellBlueRows.rows 的勾选子集。
     弹窗底部与测试共用此口径，避免两处各算一份。 */
  sellSummary(rows){
    rows = rows || [];
    const list = rows.filter(r=>r.way==="list"), direct = rows.filter(r=>r.way==="direct");
    const directIncome = direct.reduce((s,r)=>s+r.value,0);
    const listNet = list.reduce((s,r)=>s+r.net,0);
    const feeTotal = list.reduce((s,r)=>s+(r.fee||0),0);
    return {
      directCount:direct.length, listCount:list.length,
      directIncome, listNet, feeTotal,
      totalExpected:directIncome+listNet
    };
  },

  /* 提交出售：在克隆上整批重核，任一不符整体拒绝（过期提交/部分提交防护）。
   * selectedUids 为勾选行 uid 集合；expect 为打开弹窗时的指纹表（uid→fingerprint）。
   * 直卖按 value 即时加余额；挂单仅移入 state.listings 模拟挂单，不加钱、不扣手续费。
   * 不改入参；返回 {ok,sim,directIncome,listUids,reason}。是否清空 lastSnapshot 由 app 决定。 */
  commitSellBlue(state, selectedUids, expect){
    const sim=JSON.parse(JSON.stringify(state));
    if(!Array.isArray(sim.listings)) sim.listings=[];
    const want=new Set(selectedUids||[]);
    if(!want.size) return {ok:false,reason:"未勾选任何物品"};
    const chosen=[], reasons=[];
    want.forEach(uid=>{
      const cur=sim.stash.items.find(it=>it._uid===uid);
      if(!cur){ reasons.push("物品已不在仓库或已被处理"); return; }
      if(cur.quality!=="blue"){ reasons.push((cur.baseName||cur.name)+"：品质已变化"); return; }
      if(cur.locked===true){ reasons.push((cur.baseName||cur.name)+"：已锁定"); return; }
      if(expect && expect[uid]!=null){
        const mNull=cur.market===null||cur.market===undefined;
        const fp=uid+"|"+(cur.x)+","+(cur.y)+"|"+(typeof cur.qty==="number"?cur.qty:1)+"|"+cur.quality+"|"+(cur.locked===true)+"|"+cur.value+"|"+(mNull?"null":cur.market);
        if(fp!==expect[uid]){ reasons.push((cur.baseName||cur.name)+"：状态已变化，请刷新后重新确认"); return; }
      }
      chosen.push(cur);
    });
    if(reasons.length) return {ok:false,reason:reasons[0],reasons};
    let directIncome=0; const listUids=[];
    for(const it of chosen){
      const mNull=it.market===null||it.market===undefined;
      const vOk=typeof it.value==="number"&&isFinite(it.value)&&it.value>=0;
      const mOk=mNull||(typeof it.market==="number"&&isFinite(it.market)&&it.market>=0);
      if(!vOk||!mOk) return {ok:false,reason:(it.baseName||it.name)+"：价格数据非法，已停止整批出售"};
      const fee=mNull?null:Math.round(it.market*MARKET_FEE_RATE);
      const net=mNull?null:it.market-fee;
      const way=mNull?"direct":(net>it.value?"list":"direct");
      const idx=sim.stash.items.findIndex(x=>x._uid===it._uid);
      const [gone]=sim.stash.items.splice(idx,1);
      if(way==="direct"){ directIncome+=gone.value; }
      else{
        listUids.push(gone._uid);
        sim.listings.push({ uid:gone._uid, id:gone.id, name:gone.baseName||gone.name,
          qty:(typeof gone.qty==="number"?gone.qty:1), market:gone.market, fee, net, listedAt:"sim" });
      }
    }
    sim.money+=directIncome;
    syncContainerLayouts(sim);
    return {ok:true,sim,directIncome,listUids,chosenCount:chosen.length};
  },

  /* 原子应用一套七槽方案。先在深克隆上逐步试算，任一环节放不下即整体拒绝（不穿一半）。
     普通槽复用 equipItem / moveItem，容器槽复用 canContainerChange 的克隆结果；全部成功才落盘。
     调用方须在确认 ok 后、调用前 snapshot()。返回 {ok,reason,sim,noChange}。 */
  applyLoadout(state, opt){
    const sol=this.solveLoadoutTarget(state,opt);
    if(!sol.ok) return {ok:false,reason:sol.reason};
    if(sol.noChange) return {ok:true,noChange:true,total:sol.total,sim:null};
    // 深克隆工作副本（含 bag getter 的字段无需克隆）
    let work=JSON.parse(JSON.stringify({
      stash:state.stash,rig:state.rig,pockets:state.pockets,
      backpack:state.backpack,safe:state.safe,equipped:state.equipped
    }));
    adoptState(work);
    const targets=sol.slots.filter(s=>s.id);
    // 1) 装入目标：已在正确槽位的物品无需动作；容器槽走 canContainerChange 克隆采纳；普通槽走 equipItem
    for(const s of targets){
      const inPlace=(work.equipped[s.slot]||{}).item;
      if(inPlace && inPlace.id===s.id) continue;
      if(s.slot==="rig"||s.slot==="bag"){
        const chk=this.canContainerChange(work,{itemId:s.id,slot:s.slot,target:"slot"});
        if(!chk.ok) return {ok:false,reason:(s.name||"容器")+"："+chk.reason};
        work=chk.sim; adoptState(work);
      }else{
        const chk=this.equipItem(work,{itemId:s.id,slot:s.slot});
        if(!chk.ok) return {ok:false,reason:(s.name||"装备")+"："+chk.reason};
      }
    }
    // 2) 目标为空、但当前仍挂着装备的槽：卸下到仓库（普通走 moveItem，容器走 canContainerChange）
    for(const s of sol.slots){
      if(s.id) continue;
      const cur=(work.equipped[s.slot]||{}).item;
      if(!cur) continue;
      if(s.slot==="rig"||s.slot==="bag"){
        const chk=this.canContainerChange(work,{itemId:cur.id,slot:s.slot,target:"stash"});
        if(!chk.ok) return {ok:false,reason:"换下的"+s.label+"："+chk.reason};
        work=chk.sim; adoptState(work);
      }else{
        const spot=this.firstStashSpotAnyRot(work,cur,cur._uid);
        if(!spot) return {ok:false,reason:"仓库没有空位，无法换下"+s.label};
        const mv=this.moveItem(work,{itemId:cur.id,toBox:"stash",x:spot.x,y:spot.y,rot:spot.rot});
        if(!mv.ok) return {ok:false,reason:"换下"+s.label+"："+mv.reason};
      }
    }
    // 3) 终态校验：七槽逐槽与方案一致、装备价值等于求解合计
    syncContainerLayouts(work);
    const okFinal=sol.slots.every(s=>{
      const it=(work.equipped[s.slot]||{}).item;
      return s.id ? (it&&it.id===s.id) : !it;
    });
    if(!okFinal) return {ok:false,reason:"方案落盘后与目标不一致（已整体回退）"};
    return {ok:true,noChange:false,total:sol.total,sol,sim:work};
  }
};
