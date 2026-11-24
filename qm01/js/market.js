/* ============================================================
 * market.js — 交易行（原型内模拟市场，只买不卖）
 *
 * 关键口径（已确认 A′ 方案）：
 *  - 商品"定义与价格"一律以战前权威模板为准：PRE_BAG + INITIAL_EQUIP_SETUP，
 *    pre / post 两场景完全一致，不读 POST_BAG 同名物品，不改任何现有 value/market。
 *  - MARKET_CATALOG 只存 {name(模板名), cat, stock}，不存任何价格/属性副本。
 *    买入价、列表价、悬停价、出售弹窗价，运行时统一读模板的 market / value 字段。
 *  - 每件买入物品走 enrichItem 发全局唯一 uid（沿用现有计数器），属性全部继承模板，
 *    不另存 value/market；因此悬停、出售、卡战备求解器行为与原仓库物品完全一致。
 *  - 仅取 market 非 null 的模板上架（不可挂行物品不进交易行）。
 *  - 整堆计价：买入价=模板 market，不乘 qty。
 * ============================================================ */

/* 14 种演示商品：只存模板名、分类、初始库存（价格不入库）。
 * cat 仅用于交易行分类标签：weapon / gear / ammo / med / mat */
const MARKET_CATALOG = [
  { name:"AKM 突击步枪",  cat:"weapon", stock:1 },
  { name:"AKMN 突击步枪", cat:"weapon", stock:2 },
  { name:"AK-74N",        cat:"weapon", stock:3 },
  { name:"MP5 冲锋枪",    cat:"weapon", stock:4 },
  { name:"M9A3 手枪",     cat:"weapon", stock:8 },
  { name:"三级防弹甲",    cat:"gear",   stock:2 },
  { name:"6B23 防弹胸甲", cat:"gear",   stock:2 },
  { name:"Lk 战术背包",   cat:"gear",   stock:3 },
  { name:"D3 胸挂",       cat:"gear",   stock:3 },
  { name:".338 AP穿甲弹", cat:"ammo",   stock:5 },
  { name:"7.62 BP弹",     cat:"ammo",   stock:10 },
  { name:"外科手术包",    cat:"med",    stock:4 },
  { name:"蓝宝石吊坠",    cat:"mat",    stock:2 },
  { name:"实体金币",      cat:"mat",    stock:6 }
];

/* 交易行初始状态：每场景一份独立库存（createState 时调用） */
function freshMarket(){
  return { stock: MARKET_CATALOG.map(c=>({ name:c.name, cat:c.cat, stock:c.stock })) };
}

const Market = {
  /* 权威模板：战前 PRE_BAG + 初始装备（AKM / 6B23 在装备模板里）。按名字取。 */
  _templateByName(name){
    const fromBag = PRE_BAG.find(t=>t.name===name);
    if(fromBag) return fromBag;
    for(const k in INITIAL_EQUIP_SETUP){
      const def = INITIAL_EQUIP_SETUP[k];
      if(def && def.name===name) return def;
    }
    return null;
  },

  /* 确保 state.market 存在（旧快照/旧测试构造的 state 可能没有） */
  ensure(state){
    if(!state.market || !Array.isArray(state.market.stock)) state.market = freshMarket();
    return state.market;
  },

  /* 单条商品的运行时视图：价格与属性全部读权威模板，stock 读当前场景库存。
   * 模板缺失或 market=null（不应发生）时返回 null。 */
  product(state, entry){
    const tpl = this._templateByName(entry.name);
    if(!tpl || !(typeof tpl.market==="number" && isFinite(tpl.market) && tpl.market>0)) return null;
    return {
      name:tpl.name, baseName:tpl.baseName || (typeof baseNameOf==="function"?baseNameOf(tpl.name):tpl.name),
      icon:tpl.icon, quality:tpl.quality, cat:entry.cat || tpl.cat,
      value:tpl.value, market:tpl.market, slotType:tpl.slotType,
      w:tpl.w, h:tpl.h, qty:(typeof tpl.qty==="number"?tpl.qty:1),
      stock:entry.stock
    };
  },

  /* 全部在售商品（库存字段实时）；可选过滤 {kw,cat,sort}
   * kw 匹配 baseName/name 子串；cat=all 不过滤；
   * sort: "price-asc" | "price-desc" | ""（默认目录顺序） */
  products(state, opt){
    opt = opt || {};
    const mk = this.ensure(state);
    let list = mk.stock.map(e=>this.product(state,e)).filter(Boolean);
    if(opt.cat && opt.cat!=="all") list = list.filter(p=>p.cat===opt.cat);
    if(opt.kw){
      const k = String(opt.kw).trim().toLowerCase();
      if(k) list = list.filter(p=>(p.baseName||p.name).toLowerCase().indexOf(k)>=0
                              || p.name.toLowerCase().indexOf(k)>=0);
    }
    if(opt.sort==="price-asc") list = list.slice().sort((a,b)=>a.market-b.market || a.stock-b.stock);
    else if(opt.sort==="price-desc") list = list.slice().sort((a,b)=>b.market-a.market || a.stock-b.stock);
    return list;
  },

  /* 我的挂单：直接读 state.listings（出售流程产生的模拟挂单） */
  listings(state){ return Array.isArray(state.listings) ? state.listings : []; },

  /* 市场概况：挂单数（上限 8）、每堆净收益合计 */
  overview(state){
    const ls = this.listings(state);
    return { count:ls.length, cap:8, netTotal:ls.reduce((s,r)=>s+(r.net||0),0) };
  },

  /* 造一件待入箱的新物品：深拷模板 + enrichItem 发全新唯一 id/_uid。
   * 不复制旧 id/_uid/坐标；value/market/品质/尺寸/qty 全部继承模板（不另存副本）。 */
  _instantiate(name){
    const tpl = this._templateByName(name);
    if(!tpl) return null;
    const it = JSON.parse(JSON.stringify(tpl));
    delete it.id; delete it._uid;
    it.x=null; it.y=null; it.rot=0; it.locked=false;
    enrichItem(it);
    return it;
  },

  /* 买入预检（纯计算，不改 state）：库存/余额/仓库空位。
   * 返回 {ok,reason,price,item?,spot?}；spot 为建议落点 {x,y,rot}。 */
  buyPreview(state, name){
    const mk = this.ensure(state);
    const entry = mk.stock.find(e=>e.name===name);
    if(!entry) return {ok:false,reason:"商品不存在"};
    const tpl = this._templateByName(name);
    if(!tpl || !(typeof tpl.market==="number" && isFinite(tpl.market)))
      return {ok:false,reason:"商品价格数据缺失"};
    if(entry.stock<=0) return {ok:false,reason:"该商品已售罄"};
    const price = tpl.market;
    if(typeof state.money!=="number" || state.money < price)
      return {ok:false,reason:"余额不足",price};
    const it = this._instantiate(name);
    const spot = Engine.firstStashSpotAnyRot(state, it, null);
    if(!spot){ return {ok:false,reason:"仓库没有空位，放不下该物品",price}; }
    return {ok:true,reason:"",price,item:it,spot};
  },

  /* 提交买入：在克隆上整批执行（扣余额、入箱、库存−1），任一不符整体拒绝。
   * 不改入参；返回 {ok,sim,reason,price,uid}。是否清空 lastSnapshot 由 app 决定。 */
  commitBuy(state, name){
    const mk = this.ensure(state);
    const entry = mk.stock.find(e=>e.name===name);
    if(!entry) return {ok:false,reason:"商品不存在"};
    if(entry.stock<=0) return {ok:false,reason:"该商品已售罄"};
    const tpl = this._templateByName(name);
    if(!tpl || !(typeof tpl.market==="number" && isFinite(tpl.market)))
      return {ok:false,reason:"商品价格数据缺失"};
    const price = tpl.market;
    if(typeof state.money!=="number" || state.money < price)
      return {ok:false,reason:"余额不足"};
    const sim = JSON.parse(JSON.stringify(state));
    if(!sim.market || !Array.isArray(sim.market.stock)) return {ok:false,reason:"市场状态异常"};
    const sEntry = sim.market.stock.find(e=>e.name===name);
    if(!sEntry || sEntry.stock<=0) return {ok:false,reason:"该商品已售罄"};
    // 在克隆态里造新物品（uid 全局唯一），再找空位
    const it = this._instantiate(name);
    const spot = Engine.firstStashSpotAnyRot(sim, it, null);
    if(!spot) return {ok:false,reason:"仓库没有空位，放不下该物品"};
    if(sim.money < price) return {ok:false,reason:"余额不足"};
    sim.money -= price;
    it.x=spot.x; it.y=spot.y; it.rot=spot.rot;
    sim.stash.items.push(it);
    sEntry.stock -= 1;
    if(typeof syncContainerLayouts==="function") syncContainerLayouts(sim);
    return {ok:true,sim,reason:"",price,uid:it._uid};
  }
};
