/* ============================================================
 * app.js — 视图渲染 + 交互编排
 * ============================================================ */

/* 深拷贝（兼容旧版浏览器，替代 structuredClone） */
function clone(o){ return JSON.parse(JSON.stringify(o)); }

/* 全局桥接：drag.js / 浏览器环境共用（Node 假DOM 里 window 可能不存在） */
const G = (typeof window!=="undefined") ? window : (typeof globalThis!=="undefined" ? globalThis : this);

let state = null;
let scene = "pre";
/* 界面恒为战前：开场白只此一条，不随场景变化 */
const GREETING = "一幕·战前准备。这里是慢决策安全时段：配装、把金弹与甲修头修装入安全箱。";
let lastSnapshot = null;
let pendingPlan = null;
let pendingClarify = null;   // 连续追问上下文：只保存当前待补全意图及缺失字段
let busy = false;
let _uidc = 0;

/* 场景白名单：应用只可能处于 pre|post（界面上只有 pre，post 仅供内部/测试）。
   任何未知/缺失键（含历史 "in"/undefined）一律回退 pre，绝不落入战斗中分支。 */
function normalizeScene(s){ return (s==="pre"||s==="post") ? s : "pre"; }
/* 每个场景独立初始化（批0：多容器骨架，旧代码经 state.bag 别名访问仓库） */
function initState(s){
  scene = normalizeScene(s);
  _uidc = 0;
  state = createState(s);
  syncContainerLayouts(state); // 批3B：页面/场景初始化强制同步容器几何
  lastSnapshot = null;
  pendingPlan = null;
  pendingClarify = null;
}
initState("pre");

/* 演示脚本：界面恒为战前，三条统一脚本固定展示。
   post 场景仅内部/测试可达，脚本表内容相同。 */
const DEMO_SCRIPTS_STAGE3 = [
  { cmd:"sell",    text:"帮我卖掉所有蓝色物品", params:{ exactSell:"blue" } },
  { cmd:"loadout", text:"帮我起装卡5w战备", params:{ budget:50000, compare:"gte" } },
  { cmd:"safe",    text:"带入对局的高级子弹和甲修放保险", params:{ strategy:"premiumAmmoArmor" } }
];
const SCENE_SCRIPTS = {
  pre: DEMO_SCRIPTS_STAGE3,
  post: DEMO_SCRIPTS_STAGE3
};

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const fmt = n => n.toLocaleString();
/* 音效：接入已有成功/失败分支；UISFX 未加载或播放失败时静默降级，绝不阻断原功能 */
function sfx(name){ try{ if(typeof UISFX!=="undefined" && UISFX && typeof UISFX[name]==="function") UISFX[name](); }catch(e){} }
function escapeHtml(s){
  return String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* ---------------- 渲染（批1：多容器 · 真实坐标） ---------------- */
let activeCat = "all";   // 分类筛选：只弱化不重排

/* 开发预览开关 ?preview=rig:d3,bag:scav —— 只改显示，不写回 state。
 * rig: assault(4×2)/d3(2×4)；bag: lk(5×4)/scav(4×5)。
 * 未知键/值忽略并 console.warn，绝不报错。批3槽位逻辑完成后移除。 */
const PREVIEW_LAYOUTS = {
  rig: {
    assault:{cols:4,rows:2,name:"突击胸挂",slots:null},
    d3:{cols:4,rows:2,name:"D3胸挂",slots:[
      {x:0,y:0,w:1,h:2},
      {x:1,y:0,w:1,h:1},{x:1,y:1,w:1,h:1},
      {x:2,y:0,w:1,h:1},{x:2,y:1,w:1,h:1},
      {x:3,y:0,w:1,h:2}
    ]}
  },
  bag: { lk:{cols:5,rows:4,name:"Lk战术背包"}, scav:{cols:4,rows:5,name:"Scav背包"} }
};
const previewGeom = { rig:null, backpack:null };
const previewName = { rig:null, backpack:null };
const previewSlots = { rig:null, backpack:null };
(function parsePreview(){
  try{
    const loc = (typeof window!=="undefined" && window.location && window.location.search) || "";
    const m = /[?&]preview=([^&]+)/.exec(loc);
    if(!m) return;
    m[1].split(",").forEach(pair=>{
      const [k,v] = pair.split(":").map(s=>s && s.trim());
      if(!PREVIEW_LAYOUTS[k]){ console.warn(`[预览] 忽略未知容器键: ${k}`); return; }
      const spec = PREVIEW_LAYOUTS[k][v];
      if(!spec){ console.warn(`[预览] 忽略未知值: ${k}:${v}`); return; }
      const kind = k==="bag" ? "backpack" : "rig";
      previewGeom[kind] = { cols:spec.cols, rows:spec.rows, slots:spec.slots||null };
      previewSlots[kind] = spec.slots || null;
      previewName[kind] = spec.name;
    });
    const on = [previewName.rig, previewName.backpack].filter(Boolean);
    if(on.length){
      console.log(`%c预览模式（仅显示，不影响库存/指令/撤销）：${on.join("、")}`,
        "color:#35D4C7;font-weight:bold");
    }
  }catch(e){ /* 预览失败绝不影响页面 */ }
})();

const BOX_MAP = [
  ["grid","stash"], ["rigGrid","rig"], ["pocketsGrid","pockets"],
  ["backpackGrid","backpack"], ["safeGrid","safe"]
];
const BOX_CAP = { rig:"8", pockets:"5", backpack:"20", safe:"6" };
const BOX_COUNT_ID = { rig:"rigCount", pockets:"pocketsCount", backpack:"backpackCount", safe:"safeCount" };

/* 一件物品的 cell HTML（视觉图/文字回退 + 数量角标，按 x/y/rot 定位） */
/* 源图自然朝向为横向的武器（按非透明内容包围盒实测；缩略图画布统一 512×512，naturalWidth 无法区分）。
 * 仅收武器：竖向占格(h>w) + 横向源图时自动旋转 90°，让枪口朝上，与仓库格/武器条/装备槽同一套。 */
const LANDSCAPE_WPN_BASE = new Set(["AKM 突击步枪","AKMN 突击步枪","AK-74N","MP5 冲锋枪","M9A3 手枪"]);
/* 统一图片方向判定：用户手动旋转(it.rot)优先；否则竖向占格且源图横向 → 自动旋转 90°。
 * 仓库格、武器条、装备槽共用此函数，保证方向一致。 */
function cellImgRotated(it){
  if(it && (it.rot%2===1)) return true;
  if(!it) return false;
  const d = itemDims(it);
  const base = it.baseName || it.name;
  return !!(d.h > d.w && it.cat==="weapon" && LANDSCAPE_WPN_BASE.has(base));
}
function cellHTML(it, dim){
  const dimmed = (activeCat!=="all" && it.cat!==activeCat) ? " dimmed" : "";
  const qty = (it.qty && it.qty>1) ? `<span class="cell-qty">${it.qty}</span>` : "";
  const style = `--r:${it.y+1};--c:${it.x+1};--w:${dim.w};--h:${dim.h};`;
  const nm = it.baseName || it.name;
  const src = (typeof ItemImages!=="undefined"&&ItemImages) ? ItemImages.itemImage(it) : null;
  const rotated = cellImgRotated(it);
  if(src){
    const nameBar = ItemImages.showName(it)
      ? `<span class="cell-name-bar">${nm}</span>` : "";
    return `<div class="cell has-img q-${it.quality}${dimmed}" data-uid="${it._uid}" style="${style}">
      <img class="cell-img${rotated?' rotated':''}" src="${src}" alt="" draggable="false"
        onerror="this.remove();var c=this.parentNode;if(c)c.classList.remove('has-img');var f=c&&c.querySelector('[data-fallback]');if(f){f.className='cell-name';f.style.display='';}">
      ${nameBar}${qty}<span data-fallback style="display:none">${nm}</span></div>`;
  }
  return `<div class="cell q-${it.quality}${dimmed}" data-uid="${it._uid}" style="${style}">
    <span class="cell-name">${nm}</span>${qty}</div>`;
}

/* 渲染一个容器：行列由内联 --cols/--rows 提供（rig/backpack 可随装备/预览变化） */
function renderBox(elId, boxName){
  const box = state[boxName];
  let cols = box.cols, rows = box.rows, slots = null;
  if(boxName==="rig" || boxName==="backpack"){
    const L = effectiveLayout(state, boxName, previewGeom[boxName]);
    cols = L.cols; rows = L.rows; slots = L.slots;
  }
  const el = $(elId);
  if(el.style && el.style.setProperty){
    el.style.setProperty("--cols", cols);
    el.style.setProperty("--rows", rows);
  }else if(el.style){ el.style["--cols"]=cols; el.style["--rows"]=rows; }
  if(el.classList) el.classList.toggle("has-slots", !!(slots && slots.length));
  // 隔层视觉叠层：纯绝对占格、pointer-events:none，不改变物品坐标、不占布局
  const slotLayer = (slots||[]).map(s=>
    `<div class="slot-div" style="--r:${s.y+1};--c:${s.x+1};--w:${s.w};--h:${s.h};"></div>`).join("");
  el.innerHTML = slotLayer + box.items.map(it=>cellHTML(it,itemDims(it))).join("");
  const cid = BOX_COUNT_ID[boxName];
  if(cid){
    const used = box.items.reduce((s,it)=>{const d=itemDims(it);return s+d.w*d.h;},0);
    $(cid).textContent = `${used}/${cols*rows}`;
  }
}

/* 胸挂/背包是否已装备（批3接入拖拽，批1恒为初始态） */
function isRigEquipped(){ return !!state.equipped.rig && !!state.equipped.rig.item; }
function isBagEquipped(){ return !!state.equipped.bag && !!state.equipped.bag.item; }

/* 一个 2×2 装备槽的内容（头盔/甲/胸挂/背包/近战） */
/* 空槽剪影（assets/slots 线描 SVG，深色资源在 CSS 里用 mask 统一染成 dim 单色）。
   映射只依赖槽位类型，不改物品名/容器名；缺文件由 CSS 静默兜底。 */
const SLOT_SILHOUETTE = {
  helmet:"assets/slots/helmet.svg",
  armor:"assets/slots/armor.svg",
  rig:"assets/slots/rig.svg",
  bag:"assets/slots/backpack.svg",
  melee:"assets/slots/knife.svg",
  primary:"assets/slots/rifle.svg",
  secondary:"assets/slots/pistol.svg"
};
function slotSilhouetteHTML(slotKey, extraCls){
  // 内联 SVG（file:// 下 mask-image 加载本地 SVG 常被拦截）；单色化靠 CSS color+opacity
  const svg = (typeof SlotIcons!=="undefined"&&SlotIcons) ? SlotIcons.svgFor(slotKey) : "";
  if(!svg) return "";
  return `<span class="slot-sil ${extraCls||""}" aria-hidden="true">${svg}</span>`;
}
function eqSlotHTML(slotKey){
  const e = state.equipped[slotKey];
  const it = e && e.item;
  if(!it) return slotSilhouetteHTML(slotKey, "eq-sil");
  const nm = it.baseName||it.name;
  const src = (typeof ItemImages!=="undefined"&&ItemImages) ? ItemImages.itemImage(it) : null;
  if(src){
    const fb = nm.replace(/'/g,"&#39;");
    return `<div class="eq-item has-img q-${it.quality}" data-uid="${it._uid}">
      <img class="eq-img" src="${src}" alt="" draggable="false"
        onerror="var c=this.parentNode;if(c){c.classList.remove('has-img');var b=c.querySelector('.eq-name-bar');if(b)b.remove();this.remove();c.insertBefore(document.createTextNode('${fb}'),c.firstChild);}">
      <span class="eq-name-bar">${nm}</span></div>`;
  }
  return `<div class="eq-item q-${it.quality}" data-uid="${it._uid}">${nm}</div>`;
}
/* 武器横条左图位：已装备显示武器缩略图，未装备显示步枪(主)/手枪(副)剪影 */
function weaponIconHTML(slotKey, it){
  if(!it) return slotSilhouetteHTML(slotKey, "ws-sil");
  const src = (typeof ItemImages!=="undefined"&&ItemImages) ? ItemImages.itemImage(it) : null;
  if(src){
    // 复用仓库格同一套图片渲染（class cell-img + rotated），方向与仓库一致、不另写一套
    const d = itemDims(it);
    const rotated = cellImgRotated(it);
    // 图位框宽高比取武器视觉朝向（竖占格+横源图自动旋转后为竖向），框内 contain 等比填满
    const ar = rotated ? (d.h/d.w) : (d.w/d.h);
    return `<span class="ws-thumb" style="aspect-ratio:${(ar).toFixed(3)}">
      <img class="cell-img${rotated?' rotated':''}" src="${src}" alt="" draggable="false"
        onerror="if(this.parentNode)this.parentNode.remove();"></span>`;
  }
  // 已装备但无缩略图：图位回退为对应武器剪影（右侧文字信息仍完整）
  return slotSilhouetteHTML(slotKey, "ws-sil");
}
/* 武器横条左图位（写入独立的 #wph-* 容器，与可拖文本区分开，不影响抓取热区）：
   已装备→武器缩略图；未装备→步枪(主)/手枪(副)剪影；无缩略图→剪影兜底。 */
function renderWeaponIcon(slotKey){
  const holder = document.getElementById("wph-"+slotKey);
  if(!holder) return;
  const it = state.equipped[slotKey] && state.equipped[slotKey].item;
  holder.innerHTML = weaponIconHTML(slotKey, it);
}
/* 武器横条文本区（#eq-*）：名称 / 口径 / 耐久；空槽给占位文案。左图位由 renderWeaponIcon 负责。 */
function weaponStripHTML(slotKey){
  const e = state.equipped[slotKey];
  const it = e && e.item;
  if(!it) return `<div class="ws-empty"><span class="ws-empty-txt">${e.label} · 空</span></div>`;
  const cal = it.caliber
    || (it.wpn ? Engine.caliberFromWeapon(it.wpn) || Engine.caliberFromWeapon(it.baseName||it.name) : null);
  const calText = cal ? Engine.caliberLabel(cal) : "—";
  const low = it.durability!=null && it.durability<40;
  const nm = it.baseName||it.name;
  return `<div class="ws-grab q-${it.quality==='white'?'white':it.quality}" data-uid="${it._uid}">
    <div class="ws-txt">
      <div class="ws-name">${nm}</div>
      <div class="ws-meta">口径 ${calText}</div>
      <div class="ws-dur ${low?'low':''}">耐久 ${it.durability!=null?it.durability+'%':'—'}${low?' · 需检修':''}</div>
    </div>
  </div>`;
}

function render(){
  // 五个 2×2 竖槽
  ["helmet","armor","rig","bag","melee"].forEach(k=>{ $(`eq-${k}`).innerHTML = eqSlotHTML(k); });
  // 两条武器横条；品质色挂在横条边框上
  ["primary","secondary"].forEach(k=>{
    const it = state.equipped[k] && state.equipped[k].item;
    $(`eq-${k}`).innerHTML = weaponStripHTML(k);
    renderWeaponIcon(k);
    const strip = $(`eq-${k}`).closest ? $(`eq-${k}`).closest(".weapon-strip") : null;
    if(strip && strip.classList){
      ["q-white","q-green","q-blue","q-purple","q-gold"].forEach(c=>strip.classList.remove("has-"+c));
      if(it) strip.classList.add("has-"+it.quality);
    }
  });

  // 五个容器网格
  BOX_MAP.forEach(([elId,boxName])=>renderBox(elId,boxName));

  // 胸挂/背包灰罩：真实装备优先；未装备时预览按"已装备"显示
  const rigEq = isRigEquipped(), bagEq = isBagEquipped();
  const rigPreview = !!previewGeom.rig, bagPreview = !!previewGeom.backpack;
  $("rigSection").classList.toggle("locked", !rigEq && !rigPreview);
  $("backpackSection").classList.toggle("locked", !bagEq && !bagPreview);
  // 标题：真实装备名 > 预览名 > 默认名
  const rigEqName = rigEq ? (state.equipped.rig.item.baseName||state.equipped.rig.item.name) : null;
  const bagEqName = bagEq ? (state.equipped.bag.item.baseName||state.equipped.bag.item.name) : null;
  $("rigName").textContent = rigEqName || (rigPreview && previewName.rig) || "胸挂";
  $("backpackName").textContent = bagEqName || (bagPreview && previewName.backpack) || "背包";
  // 左上角预览徽标
  const badge = $("previewBadge");
  const on = [previewName.rig, previewName.backpack].filter(Boolean);
  if(badge){
    if(on.length){ badge.textContent = `预览模式 · ${on.join(" / ")}（仅显示）`; badge.style.display="block"; }
    else badge.style.display="none";
  }

  // 顶部 / 中部数值：装备价值（口径统一走 Engine.gearValue，只算七槽 value），负重暂无重量字段
  const gear = Engine.gearValue(state);
  $("gearVal").textContent = fmt(gear);
  $("moneyVal").textContent = fmt(state.money);
  $("carrySummary").textContent = `${fmt(gear)} L币 · 负重 —`;
  $("charWeight").textContent = `0.0 / 88 千克`;

  // 界面恒为战前准备（无局内/结算场景入口；交易行为覆盖层，不改场景键）
  $("sceneTitle").textContent = "战前准备";
  $("gridLabel").textContent = "携带容器";
  $("contextTitle").textContent = "仓库";
  $("contextHint").textContent = "12 × 12";

  // 立绘/手持武器只读外观：入口统一，撤销 / AI 起装 / 初始渲染都经过这里
  if(typeof renderCharacterAppearance === "function") renderCharacterAppearance(state);
}

/* 渲染演示脚本：界面恒为战前，标题固定，不再随场景变化 */
function renderScripts(){
  const list = SCENE_SCRIPTS[scene] || SCENE_SCRIPTS.pre;
  $("scriptLab").textContent = "演示脚本";
  $("scriptBox").innerHTML = list.map((s,i)=>
    `<button class="script-btn" data-i="${i}"><b>${["①","②","③"][i]}</b>"${s.text}"</button>`
  ).join("") || `<div style="font-size:11px;color:var(--text-dim);padding:4px 2px;line-height:1.7;">
    当前暂无演示脚本。</div>`;
  $("scriptBox").querySelectorAll(".script-btn").forEach(btn=>{
    btn.onclick = ()=>{
      const s = list[+btn.dataset.i];
      handleCommand(s.text, true, s.params);
    };
  });
}

/* ---------------- 对话区 ---------------- */
function addMsg(role, who, html, steps){
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.innerHTML = `<div class="who">${who}</div>
    <div class="bubble">${html}${
      steps && steps.length
        ? `<details class="plan-detail"><summary>查看规划过程（${steps.length} 步）</summary>
           <div class="thinkchain">${steps.map((s,i)=>`<span class="step"><b>步骤${i+1}：</b>${s}</span>`).join("")}</div></details>`
        : ""
    }</div>`;
  $("chat").appendChild(div);
  $("chat").scrollTop = $("chat").scrollHeight;
}

/* ---------------- 方案执行 ---------------- */
function snapshot(){
  lastSnapshot = {
    stash: clone(state.stash),
    rig: clone(state.rig),
    pockets: clone(state.pockets),
    backpack: clone(state.backpack),
    safe: clone(state.safe),
    equipped: clone(state.equipped),
    money: state.money,
    listings: clone(state.listings || []),
    market: clone(state.market || { stock: [] })
  };
}
function showUndo(text){
  $("undoText").textContent = text;
  $("undoToast").classList.add("show");
  clearTimeout(showUndo._t);
  showUndo._t = setTimeout(()=> $("undoToast").classList.remove("show"), 6000);
}
$("undoBtn").onclick = ()=>{
  if(!lastSnapshot) return;
  const s = lastSnapshot;
  state.stash = s.stash; state.rig = s.rig; state.pockets = s.pockets;
  state.backpack = s.backpack; state.safe = s.safe;
  state.equipped = s.equipped;
  state.money = s.money;
  if(s.listings) state.listings = s.listings; // 撤销非出售操作时保留已模拟挂单记录
  if(s.market) state.market = s.market;        // 撤销非买入操作时恢复交易行库存
  adoptState(state);   // 重新挂 state.bag → stash 别名
  syncContainerLayouts(state); // 批3B：恢复后强制同步容器几何，防止快照与 equipped 不一致
  lastSnapshot = null;
  render();
  addMsg("sys","系统", "已撤销上一步操作，背包恢复到操作前状态。（对应尼尔森原则：用户控制与自由 / 容错恢复）");
  $("undoToast").classList.remove("show");
};

/* 高亮：传入物品对象数组（按 uid 定位 DOM），可选先淡出 */
async function flashItems(items, cls="flash", fade=false){
  items.forEach(it=>{
    const el = document.querySelector(`.cell[data-uid="${it._uid}"],.eq-item[data-uid="${it._uid}"],.ws-grab[data-uid="${it._uid}"]`);
    if(el){ el.classList.add(cls); if(fade) el.classList.add("move-out"); }
  });
  await sleep(950);
}
/* 批0：按稳定 id 从其当前容器取出一件物品（装备槽除外），返回该物品 */
function takeById(id){
  const f = findItemById(state, id);
  if(!f) return null;
  if(f.container === "equipped") return null;
  const box = state[f.container];      // {items,cols,rows}
  box.items.splice(f.index, 1);
  return f.item;
}
function takeByIds(ids){
  return ids.map(takeById).filter(Boolean);
}
/* 把物品放入某容器并 first-fit 写坐标；放不下返回 false（不放入） */
function putInBox(box, item){
  return placeFirstFit(box, item);
}
/* 对某容器按当前物品重新压实坐标（取出后整理） */
function repack(box){
  const items = box.items.slice();
  repackBox(box, items);
}

function execute(plan){
  const a = plan.actions;
  const prevSnapBefore = lastSnapshot;   // 进入前已有的撤销记录（预检失败时还原，不被覆盖）
  snapshot();

  if(a.type === "toSafe"){
    const items = takeByIds(a.ids);
    flashItems(items, "flash", true).then(()=>{
      const moved=[], left=[];
      items.forEach(it=>{ (placeFirstFit(state.safe,it)?moved:left).push(it); });
      left.forEach(it=>placeFirstFit(state.stash,it));   // 放不下的退回仓库
      render();
      showUndo("已移入安全箱");
      addMsg("sys","系统", `已完成：${moved.map(i=>i.baseName||i.name).join("、")||"无"} 移入安全箱（按占格自动排布）。`);
      sfx("confirm");
    });
  }

  if(a.type === "retrieve"){
    const items = a.ids
      .map(id=>{
        const f = findItemById(state, id);
        if(f && f.container==="safe"){ state.safe.items.splice(f.index,1); return f.item; }
        return null;
      })
      .filter(Boolean);
    repack(state.safe);
    items.forEach(it=>placeFirstFit(state.stash,it));
    render();
    showUndo("已从安全箱取出");
    addMsg("sys","系统", `已完成：${items.map(i=>i.baseName||i.name).join("、")} 从安全箱取出，放回仓库。`);
    sfx("confirm");
  }

  if(a.type === "loadout"){
    // 整方案预检 + 原子落盘（普通槽 equipItem / 容器槽 canContainerChange 克隆），不穿一半
    const res = Engine.applyLoadout(state, { budget:a.total!=null?a.total:(a.budget!=null?a.budget:50000),
                                            compare:a.compare||"lte" });
    const prevSnap = lastSnapshot;   // execute 顶部已 snapshot；失败/无换装时还原，避免污染已有撤销
    if(!res.ok){
      lastSnapshot = null;
      if(prevSnapBefore) lastSnapshot = prevSnapBefore;
      render();
      addMsg("sys","系统", "这套配装执行不了：" + res.reason + "。装备未改动。");
      sfx("warn");
    }else if(res.noChange){
      lastSnapshot = null;
      if(prevSnapBefore) lastSnapshot = prevSnapBefore;
      addMsg("sys","系统", "当前装备已是最接近目标的方案，未做改动。");
    }else{
      const sim = res.sim;
      state.stash=sim.stash; state.rig=sim.rig; state.pockets=sim.pockets;
      state.backpack=sim.backpack; state.safe=sim.safe; state.equipped=sim.equipped;
      syncContainerLayouts(state); adoptState(state);
      render();
      const worn = (a.slots||[]).filter(s=>s.id).map(s=>s.name);
      flashItems((a.slots||[]).filter(s=>s.id)
        .map(s=>findItemById(state,s.id)).filter(Boolean).map(f=>f.item)).then(()=>{
        showUndo("已穿戴方案");
        addMsg("sys","系统", "已一键穿戴该方案（"+(worn.join(" + ")||"无")+"）；单件可拖拽替换。点击右下角可撤销，恢复原装备。");
        sfx("confirm");
      });
    }
  }

  if(a.type === "swapArmor"){
    const slot = a.armorSlot || "armor";
    const oldChest = state.equipped[slot] && state.equipped[slot].item;
    if(a.armorId!=null){
      const newArmor = takeById(a.armorId);
      if(newArmor){
        if(oldChest) placeFirstFit(state.stash, oldChest);   // 旧甲回仓库
        state.equipped[slot].item = newArmor;
        flashItems([newArmor]).then(()=>{
          render(); showUndo("已更换胸甲");
          addMsg("sys","系统", `已穿戴「${newArmor.baseName||newArmor.name}」(${newArmor.durability}%)，旧胸甲放回仓库。`);
          sfx("confirm");
        });
      }
    } else if(oldChest){
      oldChest.durability = Math.min(100, oldChest.durability + 55);
      render(); showUndo("已修理胸甲");
      addMsg("sys","系统", `「${oldChest.baseName||oldChest.name}」已修理至 ${oldChest.durability}%。`);
      sfx("confirm");
    }
  }

  if(a.type === "repair"){
    a.targets.forEach(t=>{
      const e = state.equipped[t.slot] && state.equipped[t.slot].item;
      if(e) e.durability = 100;
    });
    state.money -= a.totalCost;
    render();
    showUndo("已修理装备");
    addMsg("sys","系统",
      `已将 ${a.targets.map(t=>t.name).join("、")} 修至满耐久，花费 <span class="loss">${fmt(a.totalCost)}</span> L币（6 秒内可撤销并退款）。`);
    sfx("complete");
  }

  if(a.type === "sell"){
    const listItems = takeByIds(a.listIds || []);
    const directItems = takeByIds(a.directIds || []);
    const all = [...listItems, ...directItems];
    flashItems(all, "flash", true).then(()=>{
      state.money += a.gain;
      render();
      showUndo(`已出售/挂行 ${all.length} 件`);
      addMsg("sys","系统",
        `<span class="gain">+${fmt(a.gain)}</span> L币即时到账；${listItems.length} 件已在交易行挂牌，成交后预计再回笼 ${fmt(listItems.reduce((s,i)=>s+(i.market||0),0))}（演示中物品已移出仓库）。`);
      sfx("complete");
    });
  }
}

/* ---------------- 指令C-1：仓库精确蓝出售确认弹窗（独立、不可撤销） ---------------- */
let sellRowsState = null;       // 打开时的行（含 fingerprint）
let sellExpect = null;          // uid → fingerprint，提交时二次核对
let sellSubmitting = false;     // 防重复提交
function fmtN(n){ return (n==null || (typeof n==="number" && !isFinite(n))) ? "—" : fmt(n); }
function openSellBlueModal(plan){
  const a = plan.actions;
  sellRowsState = a.rows.slice();
  sellExpect = {};
  a.rows.forEach(r=>{ sellExpect[r.uid] = r.fingerprint; });
  sellSubmitting = false;

  // 跳过提示（锁定 / 非法价格）
  let skipHtml = "";
  if(a.skipped && a.skipped.length){
    skipHtml = `<div class="sell-skip">已跳过 ${a.skipped.length} 件仓库内蓝色物品：${
      a.skipped.map(x=>x.name+"（"+x.reason+"）").join("、")}</div>`;
  }
  // 战前范围提示 + 带入局物资跳过数量（复用同一提示组件）
  if(a.scopeNote){
    skipHtml = `<div class="sell-skip">${a.scopeNote}${a.skippedCarry ? `　已跳过 ${a.skippedCarry} 件带入局物资` : ""}</div>` + skipHtml;
  }

  const head = ['','物品','数量','本身价','交易行价','手续费','每堆净收益','处理方式'];
  let html = skipHtml + '<div class="sell-thead">' + head.map((h,i)=>
    i===0?'<span></span>':`<span class="${i===2?'c-qty':(i>=3&&i<=6?'num':'')}">${h}</span>`).join("") + '</div>';
  html += sellRowsState.map(r=>{
    const ck = `<input type="checkbox" data-sell-uid="${r.uid}" checked>`;
    const wayLabel = r.way==="list" ? '<span class="sell-way list">挂交易行</span>' : '<span class="sell-way direct">直接出售</span>';
    const sellSrc = (typeof ItemImages!=="undefined"&&ItemImages) ? ItemImages.itemImage({name:r.name,baseName:r.name}) : null;
    const sellIco = sellSrc
      ? `<span class="sell-ico"><img src="${sellSrc}" alt="" draggable="false"
          onerror="this.remove();var p=this.parentNode;if(p)p.textContent='▫';"></span>`
      : `<span class="sell-ico">▫</span>`;
    return `<div class="sell-row" data-row="${r.uid}">${ck}
      <span class="c-name">${sellIco}<span class="sell-txt" title="${r.name}">${r.name}</span></span>
      <span class="c-qty">${r.qty}</span>
      <span class="num">${fmtN(r.value)}</span>
      <span class="num">${fmtN(r.market)}</span>
      <span class="num">${r.fee==null?"—":fmtN(r.fee)}</span>
      <span class="num">${r.net==null?"—":fmtN(r.net)}</span>${wayLabel}</div>`;
  }).join("");
  $("sellTable").innerHTML = html;

  $("sellTable").querySelectorAll('input[data-sell-uid]').forEach(cb=>{
    cb.addEventListener("change", ()=>{
      const row = cb.closest(".sell-row");
      if(row) row.classList.toggle("off", !cb.checked);
      updateSellSummary();
    });
  });

  $("sellMask").classList.add("show");
  updateSellSummary();
}
function selectedSellRows(){
  if(!sellRowsState) return [];
  const cbs = $("sellTable").querySelectorAll('input[data-sell-uid]');
  const on = new Set();
  cbs.forEach(cb=>{ if(cb.checked) on.add(String(cb.dataset.sellUid)); });
  return sellRowsState.filter(r=>on.has(String(r.uid)));
}
function updateSellSummary(){
  const rows = selectedSellRows();
  const { directCount, listCount, directIncome, listNet, feeTotal, totalExpected:total }
    = Engine.sellSummary(rows);
  $("sellSummary").innerHTML =
    `<div class="sr"><span>直接出售：${directCount} 堆 · 确定收入</span><b class="gain">${fmtN(directIncome)}</b></div>`
    + `<div class="sr"><span>挂交易行：${listCount} 堆 · 预计净收益（手续费合计 ${fmtN(feeTotal)}）</span><b>${fmtN(listNet)}</b></div>`
    + `<div class="sr sr-total"><span>总预计收益<span class="pending">（含尚未成交的挂单收益，不代表已到账）</span></span><b>${fmtN(total)}</b></div>`;
  $("sellConfirm").disabled = rows.length===0 || sellSubmitting;
}
function closeSellBlueModal(){
  $("sellMask").classList.remove("show");
  sellRowsState = null; sellExpect = null; sellSubmitting = false;
  $("sellConfirm").disabled = false;
}
// 纯落盘（无 DOM）：成功后整对象替换 + 清空撤销记录（方案B）。调用方负责渲染/提示。
function applySellResult(res){
  state.stash=res.sim.stash; state.rig=res.sim.rig; state.pockets=res.sim.pockets;
  state.backpack=res.sim.backpack; state.safe=res.sim.safe; state.equipped=res.sim.equipped;
  state.money=res.sim.money; state.listings=res.sim.listings;
  if(res.sim.market) state.market=res.sim.market;
  adoptState(state); syncContainerLayouts(state);
  lastSnapshot = null;
}
async function confirmSellBlue(){
  if(sellSubmitting || !sellRowsState) return;
  const rows = selectedSellRows();
  if(!rows.length) return;
  sellSubmitting = true;
  $("sellConfirm").disabled = true;
  const res = Engine.commitSellBlue(state, rows.map(r=>r.uid), sellExpect);
  if(!res.ok){
    // 过期/校验失败：整体不执行、不清撤销记录，提示后关闭，由用户重新发起
    closeSellBlueModal();
    addMsg("sys","系统", "出售已取消："+(res.reason||"校验未通过")+"。未改动任何物品与余额，请重新确认。");
    sfx("warn");
    return;
  }
  // 成功：落盘（不可撤销）→ 清空此前撤销记录（方案B，弹窗已明示）
  applySellResult(res);
  const dirN = res.chosenCount - res.listUids.length, listN = res.listUids.length;
  closeSellBlueModal();
  render();
  $("undoToast").classList.remove("show");
  addMsg("sys","系统",
    `已处理 ${res.chosenCount} 堆仓库内蓝色物品：直接出售 ${dirN} 堆，<span class="gain">+${fmt(res.directIncome)}</span> L币即时到账；${listN} 堆已<span class="accent">模拟挂交易行</span>（成交前收益不到账、不扣余额）。<b>本次出售不可撤销，此前操作的撤销记录已清除。</b>`);
  sfx("complete");
}
$("sellCancel").onclick = closeSellBlueModal;
$("sellConfirm").onclick = confirmSellBlue;
$("sellMask").addEventListener("click", e=>{ if(e.target===$("sellMask")) closeSellBlueModal(); });

/* 渲染通用出售预览（指定物品 / 按类别出售共用）；确认后经 pvConfirm → execute */
function renderSellPreview(plan){
  pendingPlan = plan;
  const a = plan.actions;
  $("pvTitle").textContent = `不可逆操作确认：出售 ${(a.directIds||[]).length} 件 / 挂行 ${(a.listIds||[]).length} 件`;
  $("pvList").innerHTML =
    `<div class="gain">挂交易行：${(a.listings||[]).map(i=>`${i.name}(${fmt(i.market)})`).join("、")||"无"}</div>
     <div class="loss">直接出售：${(a.direct||[]).map(i=>`${i.name}(${fmt(i.value)})`).join("、")||"无"}</div>
     <div style="margin-top:4px;color:var(--text-dim)">高品质物资已自动排除 · 执行后 6 秒内可撤销</div>`;
  $("pvConfirm").style.display = "";
  $("pvConfirm").disabled = false;
  $("previewBar").classList.add("show");
}

/* ---------------- 指令入口 ---------------- */
async function handleCommand(text, forceLocal, presetParams){
  if(busy) return;
  if(pendingPlan){
    addMsg("sys","系统", "已有待确认方案，请先确认或取消。");
    return;
  }
  addMsg("user","玩家", text);
  busy = true;
  setControlsDisabled(true);
  try{

  // 连续追问：带动作动词的完整新任务 → 清掉旧澄清上下文；否则记住，供无动作的追问合并
  const localAction = Engine.intentOf(text);
  if(localAction) pendingClarify = null;
  const priorClarify = pendingClarify;

  // ---- 1) 本地优先：标准明确表达直接本地解析 ----
  let intent = localAction;
  let params = Object.assign(Engine.localParams(text), presetParams ? clone(presetParams) : {});
  params._text = text;
  if(!intent && priorClarify){
    intent = priorClarify.intent;
    params._pending = true;
  }
  let plan = intent ? Engine.build(intent, state, params) : null;
  let fromLLM = false;
  let llmNote = "";

  // ---- 2) 本地未命中 / 参数不全 → 再用现有 LLM 补充（不发完整库存/历史） ----
  const localOutcome = Engine.classify(plan);
  if(!forceLocal && AI.isReady() && (localOutcome === "not-understood" || localOutcome === "needs-params")){
    setThinking(true);
    try{
      const ctx = {
        scene: state.scene,
        weaponCalibers: Engine.equippedCalibers(state),
        candidates: AI.relatedCandidates(text, state),
        pendingClarify: priorClarify
      };
      const r = await AI.parse(text, state, ctx);
      if(r.intent && r.intent !== "unknown"){
        intent = r.intent;
        params = Object.assign(r.params || {}, { _text: text, _fromLLM: true });
        fromLLM = true;
        llmNote = r.reason || "";
        plan = Engine.build(intent, state, params);
      }
    }catch(err){
      addMsg("sys","系统", "LLM 请求失败（"+err.message+"），已自动切换本地规则引擎。");
    }
    setThinking(false);
  }

  if(!intent || !plan){
    addMsg("ai","QM-01",
      (fromLLM?"模型将该指令判定为未知意图。":"本地规则库未匹配该表达。") +
      "可尝试：把紫色以上放进安全箱 / 配一套3万的装备 / 把胸甲修满 / 蓝色以下卖掉。"
      + (!AI.isReady() ? "（配置大模型后可听懂任意口语说法）" : ""));
    sfx("warn");
    return;
  }
  await sleep(220);
  // 澄清上下文：只保存当前待补全意图；一旦产出可执行/可确认方案即清空
  pendingClarify = plan.clarify
    ? { intent: plan.clarifyIntent || intent, missing: plan.actions && plan.actions.missing }
    : null;
  const outcome = Engine.classify(plan);
  if(outcome === "blocked" || outcome === "unsupported") sfx("warn");
  // reason 只在与真实参数/执行结果一致（preview/exec）时展示，避免与拦截/澄清结果矛盾
  const showReason = fromLLM && llmNote && (outcome === "preview" || outcome === "exec");
  addMsg("ai","QM-01",
    (showReason?`<div style="font-size:10.5px;color:var(--green);margin-bottom:3px;">LLM 理解：${llmNote}</div>`:"") + plan.reply,
    plan.steps);

  // 指令C-1：精确蓝出售 → 独立居中勾选弹窗（不走通用 previewBar，也不走旧 sell 执行/撤销）
  if(plan.confirm && plan.actions && plan.actions.type==="sellBlue"){
    openSellBlueModal(plan);
    return;
  }

  if(plan.confirm){
    pendingPlan = plan;
    const a = plan.actions;
    $("pvTitle").textContent =
      a.type==="sell" ? `不可逆操作确认：出售 ${(a.directIds||[]).length} 件 / 挂行 ${(a.listIds||[]).length} 件` :
      a.type==="disambig" ? "请选择你指的物资" :
      a.type==="swapArmor" ? "操作确认：装备状态将变更" : "操作确认";
    if(a.type==="sell"){
      renderSellPreview(plan);
    } else if(a.type==="disambig"){
      $("pvList").innerHTML = a.options.map(o=>
        `<button class="disambig-btn" data-id="${o.id}">${o.name}${o.loc ? "（"+o.loc+"）" : ""}</button>`).join("");
      $("pvConfirm").style.display = "none";   // 歧义只能点选，不提供笼统确认
      $("pvList").querySelectorAll(".disambig-btn").forEach(btn=>{
        btn.addEventListener("click", ()=>{
          const chosen = a.options.find(o=> String(o.id)===btn.dataset.id);
          $("previewBar").classList.remove("show");
          $("pvConfirm").style.display = "";
          pendingPlan = null;
          if(!chosen) return;
          // 按 id 直接构造执行动作，避免二次解析再次命中歧义
          let plan;
          if(intent==="safe"){
            plan = { intent, confirm:false, reply:`已选择「${chosen.name}」，装入安全箱。`,
              steps:[`玩家点选确认：${chosen.name}`], actions:{ type:"toSafe", ids:[chosen.id] } };
          } else if(intent==="retrieve"){
            plan = { intent, confirm:false, reply:`已选择「${chosen.name}」，从安全箱取出。`,
              steps:[`玩家点选确认：${chosen.name}`], actions:{ type:"retrieve", ids:[chosen.id] } };
          } else if(intent==="sell"){
            const found = findItemById(state, chosen.id);
            const item = found && found.container === "stash" ? found.item : null;
            if(!item){
              addMsg("ai","QM-01", `「${chosen.name}」不在仓库，不能出售（出售只处理仓库物品）。`);
              return;
            }
            // 澄清后进入原出售预览（confirm），不直接执行
            plan = { intent, confirm:true,
              reply:`已选定「${item.baseName||item.name}」出售，预计回收 <span class="gain">${fmt(item.value||0)}</span>。`,
              steps:[`玩家点选确认：${chosen.name}`, `进入出售预览 → 二次确认`],
              actions:{ type:"sell", listIds:[], directIds:[item.id], gain:item.value||0, listings:[], direct:[item],
                scopeNote:"战前：仅出售仓库物品", skippedCarry:0 } };
            renderSellPreview(plan);
            return;
          }
          if(plan) execute(plan);
        });
      });
    } else {
      $("pvList").innerHTML = plan.reply + `<div style="margin-top:4px;color:var(--text-dim)">执行后 6 秒内可撤销</div>`;
    }
    $("pvConfirm").disabled = false;   // 新方案待确认，复位确认钮
    if(a.type !== "disambig") $("pvConfirm").style.display = "";
    $("previewBar").classList.add("show");
  } else {
    execute(plan);
  }

  }catch(err){
    console.error("[handleCommand]", err);
    addMsg("sys","系统", "处理出错，请重试。（"+err.message+"）");
  }finally{
    busy = false;
    setControlsDisabled(false);
  }
}

function setThinking(on){
  $("aiTag").textContent = on ? "AI 解析中…" : (AI.isReady() ? "AI 大模型在线" : "AI 本地模式 · 点此配置");
  $("aiTag").classList.toggle("off", !AI.isReady() && !on);
}

/* 处理中禁用所有可触发指令的控件，防止“点了两次/重复执行” */
function setControlsDisabled(on){
  $("sendBtn").disabled = on;
  $("voiceBtn").disabled = on;
  document.querySelectorAll(".script-btn").forEach(b=> b.disabled = on);
}

/* ---------------- AI 配置弹窗 ---------------- */
/* 标签三态：测试真正通过=在线；配置填全但未通过=已配置·测试未通过；未配置=本地模式 */
function refreshAiTag(){
  const tag = $("aiTag");
  if(AI.isReady() && AI.isTestOk()){
    tag.textContent = "AI 大模型在线";
    tag.classList.remove("off");
  }else if(AI.isReady()){
    tag.textContent = "AI 已配置 · 测试未通过";
    tag.classList.remove("off");
  }else{
    tag.textContent = "AI 本地模式 · 点此配置";
    tag.classList.add("off");
  }
}
$("aiTag").onclick = ()=>{
  const c = AI.getCfg();
  $("cfgBase").value = c.baseUrl || "";
  $("cfgKey").value = c.apiKey || "";
  $("cfgModel").value = c.model || "";
  $("cfgMask").classList.add("show");
};
$("cfgCancel").onclick = ()=> $("cfgMask").classList.remove("show");
$("cfgSave").onclick = async ()=>{
  const cfg = { baseUrl:$("cfgBase").value.trim(), apiKey:$("cfgKey").value.trim(), model:$("cfgModel").value.trim() };
  AI.setCfg(cfg);
  AI.setTestOk(false); // 重新测试前先清旧在线标记，只有本次真正成功才置回
  $("cfgSave").textContent = "测试中…";
  let ok = false;
  try{
    await AI.parse("测试：配一套3万的装备", state);
    ok = true;
    AI.setTestOk(true);
    $("cfgMask").classList.remove("show");
    addMsg("sys","系统", "大模型连接成功，已切换为 LLM 语义解析模式（执行仍经本地引擎安全校验）。");
  }catch(err){
    let title, body;
    if(err && err.kind === "config"){
      title = "配置校验失败";
      body = err.message + "。请补全后再测试。";
    }else if(err && err.kind === "http"){
      title = "服务端返回错误（HTTP " + (err.status||"") + "）";
      body = (err.message || "") + "\n请核对 Base URL 与模型 ID 是否匹配、Key 是否有效。";
    }else if(err && err.kind === "network"){
      title = "网络连接失败";
      body = (err.message || "") + "\n请检查网络、Base URL 是否可访问。";
    }else{
      // 本地脚本异常 / 返回格式异常：不得标为"连接失败"，也不暴露任何配置原文
      title = "本地处理异常";
      body = (err && err.message ? err.message : "未知本地错误")
        + "\n该错误发生在浏览器本地（非网络问题）。已保存配置，演示仍可用本地引擎。";
    }
    alert(title + "\n" + body + "\n\n演示仍可用本地规则引擎兜底。");
  }
  $("cfgSave").textContent = "保存并测试";
  refreshAiTag();
  return ok;
};

/* ---------------- 语音输入 ---------------- */
let voicing = false;
$("voiceBtn").onclick = ()=>{
  if(!AI.voiceSupported()){
    addMsg("sys","系统", "当前浏览器不支持语音识别，请用 Chrome/Edge，或直接文字输入。");
    return;
  }
  if(voicing) return;
  voicing = true;
  $("voiceBtn").classList.add("recording");
  $("cmdInput").placeholder = "正在聆听…请说话";
  AI.startVoice(
    (said)=>{ $("cmdInput").value = said; },
    ()=>{
      voicing = false;
      $("voiceBtn").classList.remove("recording");
      $("cmdInput").placeholder = "也可直接输入指令";
      if($("cmdInput").value.trim()) $("sendBtn").click();
    }
  );
};

$("pvConfirm").onclick = ()=>{
  if(!pendingPlan) return;
  $("pvConfirm").disabled = true;      // 立即禁用，防止同一计划执行两次
  $("previewBar").classList.remove("show");
  const p = pendingPlan; pendingPlan = null;
  execute(p);
};
$("pvCancel").onclick = ()=>{
  pendingPlan = null;
  $("pvConfirm").disabled = false;
  $("pvConfirm").style.display = "";
  $("previewBar").classList.remove("show");
  addMsg("sys","系统", "已取消，未做任何改动。");
};

/* 分类标签：只弱化不匹配，不重排 */
document.querySelectorAll("#categoryRail .cat-btn").forEach(btn=>{
  btn.onclick = ()=>{
    document.querySelectorAll("#categoryRail .cat-btn").forEach(b=>b.classList.remove("on"));
    btn.classList.add("on");
    activeCat = btn.dataset.cat;
    render();
  };
});

/* “开始行动”：出战摘要弹窗（不进入下一幕） */
$("phasePrimary").onclick = ()=>{
  const gear = Engine.gearValue(state);
  $("deployGearVal").textContent = fmt(gear);
  $("deployMoney").textContent = fmt(state.money);
  const safeItems = state.safe.items;
  $("deploySafeList").innerHTML = safeItems.length
    ? safeItems.map(it=>`<div class="ds-line"><span>${it.baseName||it.name}${it.qty>1?` ×${it.qty}`:""}</span>
        <span class="dim mono">${fmt(it.value)}</span></div>`).join("")
    : `<span class="dim">安全箱为空</span>`;
  $("deployMask").classList.add("show");
};
$("deployCancel").onclick = ()=> $("deployMask").classList.remove("show");
$("deployGo").onclick = ()=>{
  $("deployMask").classList.remove("show");
  addMsg("sys","QM-01", "出战摘要已确认（演示不切换场景）：装备价值 " +
    fmt(Engine.gearValue(state)) +
    " L币，安全箱 " + state.safe.items.length + " 件，死亡不掉落。");
};

/* 仅真实场景按钮（带 data-scene）触发场景切换；交易行入口(#openMarket)虽是 .scene-btn
   但无 data-scene，由 initMarketUI 单独绑定打开覆盖层，不调用 initState。 */
document.querySelectorAll(".scene-btn[data-scene]").forEach(btn=>{
  btn.onclick = ()=>{
    const target = normalizeScene(btn.dataset.scene);
    document.querySelectorAll(".scene-btn[data-scene]").forEach(b=>b.classList.remove("on"));
    btn.classList.add("on");
    initState(target);
    $("chat").innerHTML = "";
    $("previewBar").classList.remove("show");
    render();
    renderScripts();
    addMsg("sys","QM-01", GREETING);
  };
});
$("sendBtn").onclick = ()=>{
  const v = $("cmdInput").value.trim();
  if(!v) return;
  $("cmdInput").value = "";
  handleCommand(v);
};
$("cmdInput").addEventListener("keydown", e=>{ if(e.key==="Enter") $("sendBtn").click(); });

/* 自适应格子尺寸：取「高度项」与「右栏实测宽度/12」的较小值，整数、下限28。
 * 只写根变量 --cell-size，不重渲染（resize 不丢输入/不打断动画）。
 * 右栏轨道是 minmax(0,1fr)，宽度只取决于视口、与 --cell-size 无关，
 * 且容器链 min-width:0，故不会"改格子→改列宽"来回抖动。 */
const CELL_MIN=28, CELL_MAX=46;
function updateCellSize(){
  try{
    const body = document.querySelector(".context-body");
    const root = document.documentElement;
    let size = Math.round(Math.max(CELL_MIN, Math.min(CELL_MAX, window.innerHeight*0.0445)));
    if(body){
      const cs = getComputedStyle(body);
      const pad = (parseFloat(cs.paddingLeft)||0)+(parseFloat(cs.paddingRight)||0);
      // clientWidth 含 padding、不含纵向滚动条；offsetWidth-clientWidth=滚动条宽
      const W = body.clientWidth - pad;
      const wSize = Math.floor(W/12);
      if(wSize>=CELL_MIN) size = Math.min(size, wSize);
      // 窄到放不下12个28px时仍守住28px（由 CSS overflow-x:hidden 兜底，不出横滚条）
    }
    root.style.setProperty("--cell-size", size+"px");
  }catch(e){ /* 假DOM/异常时保留 CSS 变量 */ }
}
let __cellRaf=0;
function scheduleCellSize(){
  if(typeof requestAnimationFrame==="function"){
    if(__cellRaf) cancelAnimationFrame(__cellRaf);
    __cellRaf=requestAnimationFrame(updateCellSize);
  }else{ updateCellSize(); }
}

/* 初始 */
updateCellSize();
/* ---------------- 批2A：拖拽提交 + 局部刷新 ---------------- */
/* 拖拽提交：snapshot + Engine.moveItem + 局部重渲染 + 撤销 toast
 * 与快捷指令共享同一 snapshot/undo 栈（lastSnapshot 被后者覆盖属预期：
 * 三脚本和拖拽互斥，不会连续触发两个待撤销的动作） */
function refreshCountsAndGear(){
  // 只刷新受影响的计数与顶部汇总，不重渲染网格
  ["rig","pockets","backpack","safe"].forEach(k=>{
    const cid = { rig:"rigCount", pockets:"pocketsCount", backpack:"backpackCount", safe:"safeCount" }[k];
    if(!$(cid)) return;
    const box = state[k];
    const used = box.items.reduce((s,it)=>{const d=itemDims(it);return s+d.w*d.h;},0);
    $(cid).textContent = used+"/"+box.cols*box.rows;
  });
  const gear = Engine.gearValue(state);
  $("gearVal").textContent = fmt(gear);
  $("moneyVal").textContent = fmt(state.money);
  $("carrySummary").textContent =
    `${fmt(gear)} L币 · 负重 —`;
}
function refreshBox(elId, boxName){
  renderBox(elId, boxName);
  refreshCountsAndGear();
}

/* 批3A：只重渲染一个装备槽（竖槽或武器条），不整页 render。
 * 武器条品质边框(has-q)随 render 统一逻辑由 strip 自身保留，这里同步一次。 */
function refreshSlot(slot){
  if(["helmet","armor","rig","bag","melee"].includes(slot)){
    $(`eq-${slot}`).innerHTML = eqSlotHTML(slot);
  }else if(slot==="primary"||slot==="secondary"){
    $(`eq-${slot}`).innerHTML = weaponStripHTML(slot);
    renderWeaponIcon(slot);
    // 同步武器横条品质边框（与 render 主流程一致）
    const it = state.equipped[slot] && state.equipped[slot].item;
    const strip = $(`eq-${slot}`).closest ? $(`eq-${slot}`).closest(".weapon-strip") : null;
    if(strip && strip.classList){
      ["q-white","q-green","q-blue","q-purple","q-gold"].forEach(c=>strip.classList.remove("has-"+c));
      if(it) strip.classList.add("has-"+it.quality);
    }
  }
  refreshCountsAndGear();
  // 拖拽装备 / 替换 / 卸下 / 双击都收口到 refreshSlot：提交成功后再换外观
  if(typeof renderCharacterAppearance === "function") renderCharacterAppearance(state);
}

/* 批3B：可变容器（胸挂/背包）单一控制表。
 * 槽位名(bag) 与 容器名(backpack) 是两套 key，曾导致局部刷新漏刷、灰罩不摘。
 * 统一从此表归一：slot=state.equipped 的 key；box=state[box] 容器 key；其余为 DOM id。 */
const CONTAINER_CONTROL = {
  rig:      { box:"rig",      slot:"rig", grid:"rigGrid",      section:"rigSection",      name:"rigName",      eq:"eq-rig",      defaultTitle:"胸挂" },
  backpack: { box:"backpack", slot:"bag", grid:"backpackGrid", section:"backpackSection", name:"backpackName", eq:"eq-bag",      defaultTitle:"背包" }
};
/* 槽位名或容器名 → 规范容器名（rig/backpack）；无法识别返回 null（不静默吞掉） */
function containerKeyOf(key){
  if(key==="rig") return "rig";
  if(key==="backpack" || key==="bag") return "backpack";
  return null;
}
/* 批3B：刷新一个可变容器（rig/backpack）：网格(含slots叠层) + 灰罩 + 标题 + 槽位，不整页 render。
 * 入参既收容器名(rig/backpack)也收槽位名(rig/bag)；布局已由 syncContainerLayouts 写好。 */
function refreshContainerSection(key){
  const boxKey = containerKeyOf(key);
  if(!boxKey){
    console.warn("未知容器 key: " + key + "（应为 rig / backpack / bag）");
    return;
  }
  const m = CONTAINER_CONTROL[boxKey];
  renderBox(m.grid, m.box);                              // 网格内联 --cols/--rows + slots 叠层
  const it = state.equipped[m.slot] && state.equipped[m.slot].item; // 槽位名 bag，勿用 backpack
  $(m.section).classList.toggle("locked", !it);          // 灰罩：局部刷新以真实装备为准
  $(m.name).textContent = it ? (it.baseName||it.name) : m.defaultTitle;
  $(m.eq).innerHTML = eqSlotHTML(m.slot);
  refreshCountsAndGear();
}

/* ============================================================
   指令B-悬停详情：非拖拽时，悬停网格物品或装备栏物品显示四项
   （名称 / 交易行价格 / 本身价格 / 手续费）。单件价、不乘数量；
   market=null 时交易行价与手续费显示“—”。拖拽中/离开立即隐藏。纯展示。
   ============================================================ */
const TIP_FIELDS = ["交易行价格","本身价格","手续费"];
function fmtThousands(n){
  if(n==null || !isFinite(n)) return "—";
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
/* 纯函数：由物品得到四项展示数据，便于单测 */
function itemTipData(it){
  const name = it.baseName || it.name || "—";
  const hasMarket = (it.market!=null && isFinite(it.market));
  const market = hasMarket ? fmtThousands(it.market) : "—";
  const self = fmtThousands(it.value);
  const fee = hasMarket ? fmtThousands(Math.round(it.market * MARKET_FEE_RATE)) : "—";
  return { name, market, self, fee };
}
let tipEl=null, tipUid=null;
function hideTip(){
  if(tipEl && tipEl.parentNode) tipEl.parentNode.removeChild(tipEl);
  tipEl=null; tipUid=null;
}
function buildTipHTML(d){
  const row=(k,v)=>'<div class="item-tip-row"><span>'+k+'</span><b>'+v+'</b></div>';
  return '<div class="item-tip-name">'+d.name+'</div>'
    + row(TIP_FIELDS[0], d.market)
    + row(TIP_FIELDS[1], d.self)
    + row(TIP_FIELDS[2], d.fee);
}
function placeTip(x,y){
  if(!tipEl) return;
  const pad=10, gap=14;
  const w=tipEl.offsetWidth, h=tipEl.offsetHeight;
  const vw=window.innerWidth, vh=window.innerHeight;
  // 默认在指针右下；靠右/靠下时翻转，保证不溢出视口
  let left=x+gap, top=y+gap;
  if(left+w+pad>vw) left=x-w-gap;
  if(left<pad) left=pad;
  if(top+h+pad>vh) top=y-h-gap;
  if(top<pad) top=pad;
  tipEl.style.left=left+"px"; tipEl.style.top=top+"px";
}
function showTipFor(uid, x, y){
  const f=findItemById(state, uid);
  if(!f) return;
  if(tipUid===String(uid) && tipEl){ placeTip(x,y); return; }
  hideTip();
  tipEl=document.createElement("div");
  tipEl.className="item-tip";
  tipEl.innerHTML=buildTipHTML(itemTipData(f.item));
  document.body.appendChild(tipEl);
  tipUid=String(uid);
  placeTip(x,y);
}
function initItemTip(){
  // 网格 .cell / 装备槽 .eq-item / 武器条 .ws-grab 都带 data-uid
  const hitFrom=(target)=>{
    if(!target.closest) return null;
    const node=target.closest(".cell[data-uid],.eq-item[data-uid],.ws-grab[data-uid]");
    return node;
  };
  document.addEventListener("pointerover",(e)=>{
    if(document.body.classList.contains("is-dragging")){ hideTip(); return; }
    const node=hitFrom(e.target); if(!node){ return; }
    showTipFor(node.getAttribute("data-uid"), e.clientX, e.clientY);
  }, true);
  document.addEventListener("pointermove",(e)=>{
    if(document.body.classList.contains("is-dragging")){ if(tipEl) hideTip(); return; }
    const node=hitFrom(e.target);
    if(node){ showTipFor(node.getAttribute("data-uid"), e.clientX, e.clientY); }
    else if(tipEl) hideTip();
  }, true);
  document.addEventListener("pointerdown",()=>{ hideTip(); }, true);
  window.addEventListener("scroll",()=>hideTip(), true);
}

/* ============================================================
 * 阶段2：交易行全屏视图（只买；我的挂单只读；不接 AI/语音）
 * 纯展示与交互，所有计算走 Market / Engine 纯函数；不重建主界面状态。
 * ============================================================ */
const mkUI = {
  tab:"buy", cat:"all", kw:"", sort:"", buyName:null, submitting:false,
  el(id){ return document.getElementById(id); },
  open(){
    if(typeof Market==="undefined") return;
    Market.ensure(state);
    this.tab="buy"; this.cat="all"; this.kw=""; this.sort="";
    this.el("mkSearch").value=""; this.el("mkSort").value="";
    this.el("mkCats").querySelectorAll(".cat-btn").forEach(b=>b.classList.toggle("on",b.dataset.mkcat==="all"));
    this.el("marketView").style.display="flex";
    this.setTabs(); this.renderAll();
  },
  close(){ this.el("marketView").style.display="none"; render(); },
  setTabs(){
    this.el("mkBuyPane").style.display = this.tab==="buy" ? "flex" : "none";
    this.el("mkMinePane").style.display = this.tab==="mine" ? "block" : "none";
    document.querySelectorAll(".mk-tab").forEach(b=>b.classList.toggle("on",b.dataset.mktab===this.tab));
  },
  renderAll(){
    this.el("mkMoney").textContent = fmt(state.money);
    this.el("mkBackScene").textContent = "战前准备";
    this.renderOverview();
    if(this.tab==="buy") this.renderBuy(); else this.renderMine();
  },
  renderOverview(){
    const ov = Market.overview(state);
    this.el("mkListCount").textContent = ov.count + "/" + ov.cap;
    this.el("mkListNet").textContent = fmtThousands(ov.netTotal);
    this.el("mkListEmpty").style.display = ov.count ? "none" : "block";
  },
  qClass(q){ return ({white:"q-white",green:"q-green",blue:"q-blue",purple:"q-purple",gold:"q-gold"})[q] || "q-white"; },
  catName(c){ return ({weapon:"武器",gear:"防具",ammo:"弹药",med:"医疗",mat:"材料"})[c] || c; },
  ico(it, fallback){
    const src = (typeof ItemImages!=="undefined"&&ItemImages) ? ItemImages.itemImage(it) : null;
    if(src) return '<img src="'+src+'" alt="" draggable="false" onerror="this.remove();var p=this.parentNode;if(p)p.textContent='+JSON.stringify(String(fallback||"▫"))+';">';
    return escapeHtml(fallback||it&&it.icon||"▫");
  },
  renderBuy(){
    const list = Market.products(state,{kw:this.kw,cat:this.cat,sort:this.sort});
    const tb = this.el("mkTbody");
    if(!list.length){ tb.innerHTML = '<tr><td colspan="8"><div class="mk-empty">没有符合条件的商品</div></td></tr>'; this.renderAdvice(null); return; }
    tb.innerHTML = list.map(p=>{
      const pv = Market.buyPreview(state,p.name);
      const disabled = !pv.ok;
      const btnTxt = pv.ok ? "买入" : (pv.reason==="余额不足" ? "余额不足" : pv.reason==="该商品已售罄" ? "已售罄" : "放不下");
      const qtyTip = p.qty>1 ? "<small>×"+p.qty+"</small>" : "";
      return '<tr data-name="'+escapeHtml(p.name)+'">'
        +'<td><div class="mk-name"><span class="mk-ico">'+this.ico(p,p.icon||"▫")+'</span>'
        +'<span class="mk-nm">'+escapeHtml(p.baseName||p.name)+qtyTip+'</span></div></td>'
        +'<td><span class="mk-cat-tag">'+this.catName(p.cat)+'</span></td>'
        +'<td><span class="mk-q '+this.qClass(p.quality)+'">'+Engine.qualityLabel(p.quality)+'</span></td>'
        +'<td class="mk-stock">'+p.w+'×'+p.h+'</td>'
        +'<td class="r mk-value">'+fmtThousands(p.value)+'</td>'
        +'<td class="r mk-price">'+fmtThousands(p.market)+'</td>'
        +'<td class="mk-stock'+(p.stock<=0?" zero":"")+'">'+p.stock+'</td>'
        +'<td class="r"><button class="btn primary mk-buy" data-buy="'+escapeHtml(p.name)+'" '
        +(disabled?'disabled title="'+escapeHtml(pv.reason)+'"':'')+'>'+btnTxt+'</button></td></tr>';
    }).join("");
    this.renderAdvice(list);
  },
  /* 底部建议栏：仅客观信息（余额/空间/与回收价对比），不做推荐 */
  renderAdvice(list){
    const box = this.el("mkAdvice");
    const parts = [];
    parts.push("当前余额 <b>"+fmtThousands(state.money)+"</b> L币");
    const free = state.stash.cols*state.stash.rows - state.stash.items.reduce((n,it)=>n+(it.w||1)*(it.h||1),0);
    parts.push("仓库空余约 <b>"+free+"</b> 格（按占格粗算，最终以自动落点为准）");
    if(list && list.length){
      const cheapest = list.slice().sort((a,b)=>a.market-b.market)[0];
      const afford = list.filter(p=>state.money>=p.market).length;
      parts.push('当前列表中 <b>'+afford+'/'+list.length+'</b> 件余额足够，最便宜 <b>'
        +escapeHtml(cheapest.baseName||cheapest.name)+' '+fmtThousands(cheapest.market)+'</b>');
      const worse = list.filter(p=>p.market>p.value).length;
      parts.push('其中 <span class="bad">'+worse+'</span> 件交易行价高于商人回收价（买入为演示，不构成推荐）');
    }
    box.innerHTML = parts.join("　·　");
  },
  renderMine(){
    const ls = Market.listings(state);
    const tb = this.el("mkMineBody");
    if(!ls.length){ tb.innerHTML = '<tr><td colspan="6"><div class="mk-empty">暂无挂单<br>出售仓库内蓝色物品时，净收益更高的会模拟挂到交易行。</div></td></tr>'; return; }
    tb.innerHTML = ls.map(r=>'<tr>'
      +'<td><div class="mk-name"><span class="mk-ico">'+this.ico({name:r.name,baseName:r.name},"▫")+'</span><span class="mk-nm">'+escapeHtml(r.name)+'</span></div></td>'
      +'<td>'+(r.qty||1)+'</td>'
      +'<td class="r">'+fmtThousands(r.market)+'</td>'
      +'<td class="r">'+fmtThousands(r.fee)+'</td>'
      +'<td class="r">'+fmtThousands(r.net)+'</td>'
      +'<td><span class="mk-status">已模拟挂单·未成交</span></td></tr>').join("");
  },
  openBuy(name){
    const pv = Market.buyPreview(state,name);
    if(!pv.ok){ addMsg("sys","系统", "无法买入："+pv.reason); return; }
    this.buyName = name;
    const after = state.money - pv.price;
    this.el("buyBody").innerHTML =
      '<div class="buy-line"><span>物品</span><b>'+escapeHtml(name)+'</b></div>'
      +'<div class="buy-line"><span>交易行价（整堆）</span><b class="mono">'+fmtThousands(pv.price)+'</b></div>'
      +'<div class="buy-line"><span>当前余额</span><span class="dim mono">'+fmtThousands(state.money)+'</span></div>'
      +'<div class="buy-line buy-total"><span>买入后余额</span><b class="mono">'+fmtThousands(after)+'</b></div>'
      +'<div class="buy-line buy-after">物品将自动放入当前场景仓库可用位置。</div>';
    this.el("buyMask").classList.add("show");
  },
  closeBuy(){ this.el("buyMask").classList.remove("show"); this.buyName=null; },
  async confirmBuy(){
    if(this.submitting || !this.buyName) return;
    const name = this.buyName;
    this.submitting = true;
    this.el("buyConfirm").disabled = true;
    const res = Market.commitBuy(state,name);
    this.submitting = false;
    this.el("buyConfirm").disabled = false;
    if(!res.ok){ this.closeBuy(); addMsg("sys","系统", "买入已取消："+(res.reason||"校验未通过")+"。未扣余额、未动库存。"); return; }
    // 成功：落盘（不可撤销）→ 清空此前撤销记录（弹窗已明示）
    const sim = res.sim;
    state.stash=sim.stash; state.rig=sim.rig; state.pockets=sim.pockets;
    state.backpack=sim.backpack; state.safe=sim.safe; state.equipped=sim.equipped;
    state.money=sim.money; state.market=sim.market;
    adoptState(state); syncContainerLayouts(state);
    lastSnapshot = null;
    this.closeBuy();
    addMsg("sys","QM-01", "已买入「"+name+"」，花费 "+fmtThousands(res.price)+" L币，已放入仓库。本次买入不可撤销。");
    this.renderAll();
  }
};
function initMarketUI(){
  if(typeof Market==="undefined") return;
  const $m=id=>document.getElementById(id);
  $m("openMarket").addEventListener("click",()=>mkUI.open());
  $m("closeMarket").addEventListener("click",()=>mkUI.close());
  document.querySelectorAll(".mk-tab").forEach(b=>b.addEventListener("click",()=>{ mkUI.tab=b.dataset.mktab; mkUI.setTabs(); mkUI.renderAll(); }));
  $m("mkSearch").addEventListener("input",e=>{ mkUI.kw=e.target.value; mkUI.renderBuy(); });
  $m("mkCats").addEventListener("click",e=>{
    const b=e.target.closest(".cat-btn"); if(!b) return;
    mkUI.cat=b.dataset.mkcat;
    $m("mkCats").querySelectorAll(".cat-btn").forEach(x=>x.classList.toggle("on",x===b));
    mkUI.renderBuy();
  });
  $m("mkSort").addEventListener("change",e=>{ mkUI.sort=e.target.value; mkUI.renderBuy(); });
  $m("mkTbody").addEventListener("click",e=>{
    const btn=e.target.closest("[data-buy]"); if(!btn||btn.disabled) return;
    mkUI.openBuy(btn.getAttribute("data-buy"));
  });
  $m("buyCancel").addEventListener("click",()=>mkUI.closeBuy());
  $m("buyConfirm").addEventListener("click",()=>mkUI.confirmBuy());
  $m("buyMask").addEventListener("click",e=>{ if(e.target===$m("buyMask")) mkUI.closeBuy(); });
}

G.QM = {
  getState: function(){ return state; },
  /* 测试钩子：只读当前场景键、白名单归一、市场 UI 与初始化 */
  getScene: function(){ return scene; },
  normalizeScene: normalizeScene,
  initStateForTest: function(s){ initState(s); },
  marketUI: function(){ return mkUI; },
  isBoxLocked: function(name){
    // 未装备的胸挂/背包本轮拒收；预览 override 只影响显示，真实 state 仍按未装备判断
    if(name==="rig") return !isRigEquipped();
    if(name==="backpack") return !isBagEquipped();
    return false;
  },
  commitDrag: function(payload){
    // 批3B：从 rig/bag 装备槽拖出的是容器本体 → 走容器卸下（容器内物品转仓）
    const f0 = findItemById(state, payload.itemId);
    if(f0 && f0.container==="equipped" && (f0.slot==="rig"||f0.slot==="bag")){
      const kind = f0.slot==="rig" ? "rig":"bag";
      // 双击卸下不传坐标 → 走首个空位（toStash 省略）；拖拽给了数字坐标才是具体落点
      const hasSpot = (typeof payload.x==="number" && typeof payload.y==="number");
      const cArg = { itemId:payload.itemId, slot:kind, target:"stash", rot:payload.rot||0 };
      if(hasSpot) cArg.toStash={x:payload.x,y:payload.y};
      const pre = Engine.canContainerChange(state, cArg);
      if(!pre.ok) return false;
      snapshot();
      const r = Engine.commitContainerChange(state, pre);
      if(!r.ok) return false;
      refreshContainerSection(kind); refreshBox("grid","stash");
      showUndo(payload._undoText||("已卸下"+(kind==="rig"?"胸挂":"背包")));
      return true;
    }
    // 先纯试算，非法落点不压入撤销快照（与界面红绿判定同一入口）
    const pre = Engine.canPlace(state, Object.assign({locked:this.isBoxLocked(payload.toBox)}, payload));
    if(!pre.ok) return false;
    snapshot();
    const r = Engine.moveItem(state, payload);
    if(!r.ok || !r.moved) return false;
    const srcEl = { stash:"grid", rig:"rigGrid", pockets:"pocketsGrid", backpack:"backpackGrid", safe:"safeGrid" };
    // 源是装备槽（槽→网格）：清空并刷新该槽
    if(r.fromSlot && r.fromSlot!=="rig" && r.fromSlot!=="bag") refreshSlot(r.fromSlot);
    else if(r.fromSlot) refreshContainerSection(r.fromSlot==="rig"?"rig":"backpack");
    else refreshBox(srcEl[r.from], r.from);
    if(r.to!==r.from) refreshBox(srcEl[r.to], r.to);
    showUndo(payload._undoText||"已移动物品");
    return true;
  },

  /* 批3A/3B：装备 / 替换 / 槽间移动。容器类(rig/bag)走 3B 容器入口；其余走 3A。 */
  commitEquip: function(payload){
    const src0 = findItemById(state, payload.itemId);
    const isContainerSlot = payload.slot==="rig" || payload.slot==="bag";
    const itemIsContainer = src0 && (src0.item.slotType==="rig"||src0.item.slotType==="bag");
    // 容器槽之间或容器物品进容器槽：统一走容器变更（处理布局与物品转移）
    if(isContainerSlot && itemIsContainer){
      const pre = Engine.canContainerChange(state, { itemId:payload.itemId, slot:payload.slot });
      if(!pre.ok) return false;
      snapshot();
      const r = Engine.commitContainerChange(state, pre);
      if(!r.ok) return false;
      const kinds=new Set();
      // 目标槽（槽位名 rig/bag）→ 容器名归一；swapSlots 已是容器名；sourceSlot 是槽位名
      [containerKeyOf(payload.slot)].concat(pre.swapSlots||[]).concat(r.sourceSlot?[r.sourceSlot]:[])
        .forEach(k=>{ const ck=containerKeyOf(k); if(ck) kinds.add(ck); });
      kinds.forEach(refreshContainerSection);
      refreshBox("grid","stash"); // 旧容器本体/溢出物品回仓
      showUndo(payload._undoText||"已更换装备");
      return true;
    }
    const pre = Engine.canEquip(state, payload);
    if(!pre.ok) return false;
    // 拖动物若来自容器，记下用于刷新；来自槽位先记源槽
    const src = findItemById(state, payload.itemId);
    const srcSlot = src && src.container==="equipped" ? src.slot : null;
    const srcBox  = src && src.container!=="equipped" ? src.container : null;
    snapshot();
    const r = Engine.equipItem(state, payload);
    if(!r.ok || !r.moved) return false;
    // 受影响槽：目标槽 + 源槽（槽间互换）+ 旧物被换回的源槽
    const slots = new Set([payload.slot]);
    if(srcSlot) slots.add(srcSlot);
    if(r.sourceSlot) slots.add(r.sourceSlot);
    slots.forEach(refreshSlot);
    // 容器：从容器拖入时刷新源容器；旧物回仓库时刷新仓库
    if(srcBox) refreshBox({stash:"grid",rig:"rigGrid",pockets:"pocketsGrid",backpack:"backpackGrid",safe:"safeGrid"}[srcBox], srcBox);
    if(r.mode==="stash") refreshBox("grid","stash");
    showUndo(payload._undoText||"已更换装备");
    return true;
  },

  /* 批B：双击快速装备/卸下。纯试算通过后复用现有提交入口（每个入口内部仅一次 snapshot）。
   * 任何失败/无操作/非可装备：只抖动一次，不写 state、不压快照、不发助手消息。 */
  quickToggle: function(uid){
    const f = findItemById(state, uid);
    if(!f) return false;
    const it=f.item;
    const shake=(el)=>{ if(el){ el.classList.add("shake"); setTimeout(()=>el.classList.remove("shake"),320); } };
    const shakeSelf=()=>{
      if(f.container==="equipped"){
        const el=document.querySelector('[data-slot="'+f.slot+'"] [data-uid="'+uid+'"]');
        shake(el||document.querySelector('[data-uid="'+uid+'"]'));
      }else{
        const gridId={stash:"grid",rig:"rigGrid",pockets:"pocketsGrid",backpack:"backpackGrid",safe:"safeGrid"}[f.container];
        const g=gridId?document.getElementById(gridId):null;
        shake(g?g.querySelector('.cell[data-uid="'+uid+'"]'):document.querySelector('.cell[data-uid="'+uid+'"]'));
      }
    };

    // —— 已装备 → 双击卸下（统一回仓库首个空位；容器槽走 3B 内容转移，原朝向优先再旋转）——
    if(f.container==="equipped"){
      let ok=false;
      if(f.slot==="rig"||f.slot==="bag"){
        const pre=Engine.canContainerChange(state,{itemId:uid,slot:f.slot,target:"stash"});
        if(pre.ok) // 复用 commitDrag 的容器卸下分支；不传 toStash→内部首个空位（原朝向优先、失败旋转、内容转仓）
          ok=this.commitDrag({itemId:uid,toBox:"stash",_undoText:"已卸下物品"});
      }else{
        // 普通装备（含主副武器）：纯查首个空位（原朝向优先、失败旋转），提交复用 commitDrag（moveItem）
        const spot=Engine.firstStashSpotAnyRot(state,it,it._uid);
        if(spot)
          ok=this.commitDrag({itemId:uid,toBox:"stash",x:spot.x,y:spot.y,rot:spot.rot,_undoText:"已卸下物品"});
      }
      if(!ok) shakeSelf();
      return ok;
    }

    // —— 在容器中 → 双击装备 ——
    const slot=Engine.pickQuickSlot(state,it);
    if(!slot){ shakeSelf(); return false; } // 非装备类（弹药/药品/材料）：只抖动
    // 来源限制：仓库开放全部装备类；口袋/胸挂/背包/安全箱本轮只开放 weapon
    if(f.container!=="stash" && it.slotType!=="weapon"){ shakeSelf(); return false; }
    const payload={itemId:uid,slot:slot,_undoText:"已装备物品"};
    const isContainerSlot=(slot==="rig"||slot==="bag");
    const preTry = isContainerSlot
      ? Engine.canContainerChange(state,{itemId:uid,slot})
      : Engine.canEquip(state,payload);
    if(!preTry.ok){ shakeSelf(); return false; }
    const ok=this.commitEquip(payload); // 内部纯试算+单次 snapshot；失败不压快照
    if(!ok) shakeSelf();
    return ok;
  },
  /* 测试钩子：直接转发到内部容器刷新，便于在假DOM下验证未知 key 的告警行为（生产不调用） */
  _refreshContainerSection: function(key){ refreshContainerSection(key); },
  /* 测试钩子：悬停详情纯函数（四项/千分位/费率/缺失显—），供 test_tooltip */
  _itemTipData: function(it){ return itemTipData(it); },
  _fmtThousands: fmtThousands,
  /* 测试钩子：出售事务（不可撤销一致性），供 test_sell_blue */
  _state: function(){ return state; },
  _snapshot: function(){ snapshot(); },
  _hasUndo: function(){ return !!lastSnapshot; },
  _execute: function(plan){ return execute(plan); },      // 阶段3测试：直接驱动方案执行
  _undo: function(){                                       // 阶段3测试：等价点击撤销条
    const b=document.getElementById("undoBtn"); if(b&&b.onclick) b.onclick();
  },
  _applySellResult: function(res){ applySellResult(res); },
  _sellRows: function(){ return sellRowsState; },
  _lastSnap: function(){ return lastSnapshot; },
  _openSellBlueModal: function(plan){ openSellBlueModal(plan); },
  _sellRowsFromState: function(){ return Engine.sellBlueRows(state); },
  /* 测试钩子：交易行（阶段2） */
  _marketOpen: function(){ mkUI.open(); },
  _marketClose: function(){ mkUI.close(); },
  _marketTab: function(t){ mkUI.tab=t; mkUI.setTabs(); mkUI.renderAll(); },
  _marketRender: function(){ mkUI.renderAll(); },
  _marketBuy: function(name){ return Market.commitBuy(state,name); },
  _marketApplyBuy: function(name){
    // 复刻确认按钮落盘路径（含清空撤销）
    const res=Market.commitBuy(state,name);
    if(!res.ok) return res;
    const sim=res.sim;
    state.stash=sim.stash; state.rig=sim.rig; state.pockets=sim.pockets;
    state.backpack=sim.backpack; state.safe=sim.safe; state.equipped=sim.equipped;
    state.money=sim.money; state.market=sim.market;
    adoptState(state); syncContainerLayouts(state); lastSnapshot=null;
    return res;
  },
  _mkMoneyText: function(){ return document.getElementById("mkMoney").textContent; },
  _mkViewShown: function(){ return document.getElementById("marketView").style.display; }
};

if(typeof window!=="undefined" && window.addEventListener)
  window.addEventListener("resize", scheduleCellSize, {passive:true});
render();
renderScripts();
refreshAiTag();
initItemTip();
initMarketUI();
/* 截图/验收专用：URL 带 ?mkt=buy|mine|confirm 时自动打开交易行（正常双击无此参数，不触发） */
(function(){
  try{
    if(typeof location==="undefined" || !location.search) return;
    const qs=new URLSearchParams(location.search);
    const m=qs.get("mkt");
    const shot=qs.get("shot");
    if(shot==="scripts"){
      setTimeout(()=>{ const p=document.getElementById("aiPanel"); if(p) p.style.display="flex"; },120);
      return;
    }
    if(shot==="sellblue"){
      setTimeout(()=>{ try{
        const sb=Engine.sellBlueRows(state);
        openSellBlueModal({actions:{type:"sellBlue",rows:sb.rows,skipped:[]}});
      }catch(e){} },150);
      return;
    }
    if(!m && shot==="s3safe"){
      // 阶段3验收截图：留在主界面，直接执行脚本③（高级子弹+甲修放保险）
      setTimeout(()=>{ try{
        const plan=Engine.build("safe",state,{strategy:"premiumAmmoArmor"});
        if(plan.actions&&plan.actions.type==="toSafe") execute(plan);
      }catch(e){} },120);
      return;
    }
    if(!m) return;
    setTimeout(()=>{
      mkUI.open();
      if(m==="mine"){ mkUI.tab="mine"; mkUI.setTabs(); mkUI.renderAll(); }
      if(m==="confirm"){ const b=document.querySelector('[data-buy="M9A3 手枪"]'); if(b) b.click(); }
      if(m==="minelist"){
        // 造两条模拟挂单（验收截图用，仅在该 URL 参数下）
        const sb=Engine.sellBlueRows(state);
        const lr=sb.rows.filter(r=>r.way==="list").slice(0,2);
        if(lr.length){ const exp={}; sb.rows.forEach(r=>exp[r.uid]=r.fingerprint);
          const cs=Engine.commitSellBlue(state,lr.map(r=>r.uid),exp);
          if(cs.ok) applySellResult(cs); }
        mkUI.tab="mine"; mkUI.setTabs(); mkUI.renderAll();
      }
    },120);
  }catch(e){}
})();
setTimeout(()=> addMsg("sys","QM-01",
  "我是 QM-01·战术后勤,一键帮助您完成资源管理。"), 300);
