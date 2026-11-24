/* ============================================================
 * data.js — 三幕场景数据（物品占格按《三角洲行动》真实规格）
 * 品质：white/green/blue/purple/gold
 * value=商人回收价 market=交易行参考价（null=不可挂行）
 * w,h = 占格（宽×高）：步枪2×5、冲锋枪2×4、重甲4×3、中型甲3×2 …
 * kind：ammo=弹药 repair=维修件；caliber=口径；wpn=适用枪械
 * ============================================================ */

const QUALITY_RANK = { white: 1, green: 2, blue: 3, purple: 4, gold: 5 };

/* 演示数据：交易行手续费率（5%）。手续费 = Math.round(market * MARKET_FEE_RATE)。
   后续替换为真实费率时只改这一处。 */
const MARKET_FEE_RATE = 0.05;

/* ===== 批0：容器网格规格（列×行） =====
 * stash 仓库 / rig 胸挂 / pockets 口袋 / backpack 背包 / safe 安全箱
 * 旧代码仍引用 BAG_COLS/BAG_ROWS/SAFE_*，保留为别名指向新常量。 */
const STASH_COLS = 12, STASH_ROWS = 12;                 /* 右侧仓库 12×12 */
const RIG_COLS = 4, RIG_ROWS = 2;                       /* 胸挂 4×2=8  */
const POCKET_COLS = 5, POCKET_ROWS = 1;                 /* 口袋 5×1=5  */
const BACKPACK_COLS = 5, BACKPACK_ROWS = 4;             /* 背包 5×4=20 */
const SAFE_COLS = 3, SAFE_ROWS = 2;                     /* 安全箱 3×2=6 */
const STASH_CAPACITY = STASH_COLS * STASH_ROWS;
const RIG_CAPACITY = RIG_COLS * RIG_ROWS;
const POCKET_CAPACITY = POCKET_COLS * POCKET_ROWS;
const BACKPACK_CAPACITY = BACKPACK_COLS * BACKPACK_ROWS;
const SAFE_CAPACITY = SAFE_COLS * SAFE_ROWS;
/* 装备槽（左侧；批1b：新增 rig 胸挂槽，初始为空） */
const EQUIP_SLOTS = ["helmet","armor","rig","bag","primary","secondary","melee"];
const SLOT_LABEL = { helmet:"头盔", armor:"胸甲", rig:"胸挂", bag:"背包", primary:"主武器", secondary:"副武器", melee:"近战" };
/* —— 旧别名（批0适配层用，批1重渲染后可删） —— */
const BAG_COLS = STASH_COLS, BAG_ROWS = STASH_ROWS;

/* 武器 → 口径（说"AKM的子弹"要能定位到对应弹药） */
const WEAPON_CALIBER = [
  { wpns: ["AKM","AKMN"],                    caliber: "7.62x39", label: "7.62×39" },
  { wpns: ["AK-74","AK74","74N"],            caliber: "5.45x39", label: "5.45×39" },
  { wpns: ["MP5"],                           caliber: "9x19",    label: "9×19" },
  { wpns: [".338","AWM","大狙","栓狙"],      caliber: ".338",    label: ".338" }
];

/* 装备槽初始配置：批1重做为 {slotType,item} 结构。
 * primary=AKM / armor=6B23 / helmet=SSSh-94；secondary/bag/melee 留空。 */
const INITIAL_EQUIP_SETUP = {
  primary:   { name:"AKM 突击步枪", icon:"🔫", quality:"purple", value:42000, market:51000, durability:78, w:2, h:5, wpn:"AKM", slotType:"weapon", cat:"weapon" },
  armor:     { name:"6B23 防弹胸甲", icon:"🥋", quality:"blue", value:9800, market:12000, durability:22, w:3, h:2, slotType:"armor", cat:"gear" },
  helmet:    { name:"SSSh-94 头盔", icon:"⛑️", quality:"white", value:1200, market:null, durability:41, w:1, h:1, slotType:"helmet", cat:"gear" },
  bag:       null,
  rig:       null,
  secondary: null,
  melee:     null
};

/* ---------- 一幕：战前仓库（批1扩到约40件，显式 slotType/cat） ----------
 * cat 分类：weapon 武器 / gear 装备 / ammo 弹药 / med 医疗 / mat 材料
 * 数量写进 qty（弹药90发一组），名字保留 ×N 仅作数据源，界面用 baseName+角标 */
const PRE_BAG = [
  // —— 备用武器（slotType 显式 weapon）——
  { name:"AKMN 突击步枪", icon:"🔫", quality:"purple", value:26000, market:31500, durability:92, w:2, h:5, wpn:"AKMN", slotType:"weapon", cat:"weapon" },
  { name:"AK-74N", icon:"🔫", quality:"blue", value:13800, market:16400, durability:71, w:2, h:5, wpn:"AK-74N", slotType:"weapon", cat:"weapon" },
  { name:"MP5 冲锋枪", icon:"🔫", quality:"blue", value:7200, market:8100, durability:55, w:2, h:4, wpn:"MP5", slotType:"weapon", cat:"weapon" },
  { name:"M9A3 手枪", icon:"🔫", quality:"green", value:3200, market:3900, durability:88, w:1, h:2, wpn:"M9A3", slotType:"weapon", cat:"weapon" },
  // —— 护甲 / 头盔 ——
  { name:"三级防弹甲", icon:"🥋", quality:"blue", value:11800, market:14500, durability:90, w:3, h:2, slotType:"armor", cat:"gear" },
  { name:"KN 防弹背心", icon:"🥋", quality:"green", value:5200, market:6300, durability:76, w:2, h:2, slotType:"armor", cat:"gear" },
  { name:"战术头盔", icon:"⛑️", quality:"blue", value:6400, market:7900, durability:83, w:1, h:1, slotType:"helmet", cat:"gear" },
  { name:"坦克帽", icon:"⛑️", quality:"white", value:900, market:null, durability:60, w:1, h:1, slotType:"helmet", cat:"gear" },
  // —— 背包 / 胸挂（2×2 容器物品，slotType 显式）——
  { name:"Lk 战术背包", icon:"🎒", quality:"blue", value:6800, market:8200, durability:100, w:2, h:2, slotType:"bag", cat:"gear", container:"backpack", layout:{cols:5,rows:4} },
  { name:"Scav 背包", icon:"🎒", quality:"white", value:1500, market:null, durability:100, w:2, h:2, slotType:"bag", cat:"gear", container:"backpack", layout:{cols:4,rows:5} },
  { name:"突击胸挂", icon:"🦺", quality:"green", value:4200, market:5100, durability:100, w:2, h:2, slotType:"rig", cat:"gear", container:"rig", layout:{cols:4,rows:2} },
  { name:"D3 胸挂", icon:"🦺", quality:"blue", value:7600, market:9000, durability:100, w:2, h:2, slotType:"rig", cat:"gear", container:"rig",
    layout:{ cols:4, rows:2, slots:[
      {x:0,y:0,w:1,h:2},  // 左侧竖条
      {x:1,y:0,w:1,h:1}, {x:1,y:1,w:1,h:1}, // 中间左列两个
      {x:2,y:0,w:1,h:1}, {x:2,y:1,w:1,h:1}, // 中间右列两个
      {x:3,y:0,w:1,h:2}   // 右侧竖条
    ] } },
  // —— 装备杂项 ——
  { name:"战术耳机", icon:"🎧", quality:"blue", value:4600, market:4700, durability:null, w:1, h:1, slotType:"other", cat:"gear" },
  // —— 弹药（1×1，90发一组，kind=ammo）——
  { name:".338 AP穿甲弹", icon:"🟧", quality:"gold", value:19800, market:24500, durability:null, kind:"ammo", w:1, h:1, caliber:".338", wpn:"栓动狙击枪", qty:40, maxStack:40, slotType:"other", cat:"ammo" },
  { name:"7.62 BP弹", icon:"🟧", quality:"purple", value:5400, market:6800, durability:null, kind:"ammo", w:1, h:1, caliber:"7.62x39", wpn:"AKM / AKMN", qty:90, slotType:"other", cat:"ammo" },
  { name:"5.45 PS弹", icon:"🟩", quality:"green", value:1300, market:1100, durability:null, kind:"ammo", w:1, h:1, caliber:"5.45x39", wpn:"AK-74N", qty:90, slotType:"other", cat:"ammo" },
  { name:"9mm PST弹", icon:"🟨", quality:"blue", value:2200, market:2700, durability:null, kind:"ammo", w:1, h:1, caliber:"9x19", wpn:"MP5", qty:90, slotType:"other", cat:"ammo" },
  { name:".44 马格南弹", icon:"🟧", quality:"purple", value:4800, market:5900, durability:null, kind:"ammo", w:1, h:1, caliber:".44", wpn:"左轮", qty:60, maxStack:60, slotType:"other", cat:"ammo" },
  // —— 医疗（cat=med）——
  { name:"急救包", icon:"🩹", quality:"blue", value:1800, market:null, durability:null, w:1, h:1, kind:"med", slotType:"other", cat:"med" },
  { name:"速效止痛药", icon:"💊", quality:"green", value:600, market:520, durability:null, w:1, h:1, kind:"med", slotType:"other", cat:"med" },
  { name:"军用输血针", icon:"💉", quality:"green", value:700, market:650, durability:null, w:1, h:1, kind:"med", slotType:"other", cat:"med" },
  { name:"绷带", icon:"🧻", quality:"white", value:240, market:null, durability:null, w:1, h:1, kind:"med", slotType:"other", cat:"med" },
  { name:"外科手术包", icon:"🩺", quality:"blue", value:3400, market:4100, durability:null, w:1, h:2, kind:"med", slotType:"other", cat:"med" },
  // —— 维修包（2×1 / 1×1，cat=mat，kind=repair）——
  { name:"高级护甲维修包", icon:"🧰", quality:"purple", value:6800, market:8200, durability:null, kind:"repair", w:2, h:1, slotType:"other", cat:"mat" },
  { name:"基础护甲维修包", icon:"🧰", quality:"blue", value:1500, market:1800, durability:null, kind:"repair", w:2, h:1, slotType:"other", cat:"mat" },
  { name:"高级头盔维修包", icon:"🔧", quality:"purple", value:4200, market:5100, durability:null, kind:"repair", w:1, h:1, slotType:"other", cat:"mat" },
  { name:"武器清洁套装", icon:"🧴", quality:"green", value:900, market:1050, durability:null, kind:"repair", w:1, h:1, slotType:"other", cat:"mat" },
  // —— 高价值杂物（紫/金，快捷指令演示）——
  { name:"金狮子雕像", icon:"🦁", quality:"gold", value:62000, market:78000, durability:null, w:2, h:2, slotType:"other", cat:"mat" },
  { name:"实体金币", icon:"🪙", quality:"gold", value:4800, market:5200, durability:null, w:1, h:1, slotType:"other", cat:"mat" },
  { name:"蓝宝石吊坠", icon:"💠", quality:"purple", value:21000, market:26500, durability:null, w:1, h:1, slotType:"other", cat:"mat" },
  { name:"情报文件", icon:"📁", quality:"purple", value:9800, market:12400, durability:null, w:1, h:1, slotType:"other", cat:"mat" },
  // —— 普通材料（白/绿）——
  { name:"军用指南针", icon:"🧭", quality:"green", value:1400, market:1600, durability:null, w:1, h:1, slotType:"other", cat:"mat" },
  { name:"胶带", icon:"🩹", quality:"green", value:260, market:240, durability:null, w:1, h:1, slotType:"other", cat:"mat" },
  { name:"打火机", icon:"🔥", quality:"white", value:320, market:null, durability:null, w:1, h:1, slotType:"other", cat:"mat" },
  { name:"螺丝刀", icon:"🪛", quality:"white", value:180, market:null, durability:null, w:1, h:1, slotType:"other", cat:"mat" },
  { name:"螺栓", icon:"🔩", quality:"white", value:120, market:null, durability:null, w:1, h:1, slotType:"other", cat:"mat" },
  { name:"能量棒", icon:"🍫", quality:"white", value:150, market:null, durability:null, w:1, h:1, slotType:"other", cat:"mat" },
  { name:"矿泉水", icon:"💧", quality:"white", value:80, market:null, durability:null, w:1, h:1, slotType:"other", cat:"mat" },
  // —— 近战（批3A：显式 slotType:melee，1×2；放仓库，不计入初始装备价值）——
  { name:"M9 匕首", icon:"🔪", quality:"green", value:900, market:1100, durability:100, w:1, h:2, slotType:"melee", cat:"weapon" }
];

/* ---------- 三幕：撤离收获 ---------- */
const POST_BAG = [
  { name: "金狮子雕像",   icon: "🦁", quality: "gold",   value: 62000, market: 78000, durability: null, w:2, h:2 },
  { name: "蓝宝石吊坠",   icon: "💠", quality: "purple", value: 21000, market: 26500, durability: null, w:1, h:1 },
  { name: "GPU 显卡",     icon: "📟", quality: "purple", value: 13500, market: 19800, durability: null, w:2, h:2 },
  { name: "情报文件",     icon: "📁", quality: "purple", value: 9800,  market: 12400, durability: null, w:1, h:1 },
  { name: "三级防弹甲",   icon: "🥋", quality: "blue",   value: 11800, market: 14500, durability: 90, w:3, h:2 },
  { name: "AK-74N",       icon: "🔫", quality: "blue",   value: 8600,  market: 11200, durability: 64, w:2, h:5 },
  { name: "MP5 冲锋枪",   icon: "🔫", quality: "blue",   value: 7200,  market: 7400,  durability: 55, w:2, h:4 },
  { name: "战术头盔",     icon: "⛑️", quality: "blue",   value: 6400,  market: 7900,  durability: 83, w:1, h:1 },

  { name: "急救包",       icon: "🩹", quality: "blue",   value: 1800,  market: null,  durability: null, w:1, h:1 },
  { name: "7.62 BP弹×60", icon: "🟧", quality: "blue",   value: 3200,  market: 4100,  durability: null, kind: "ammo", w:1, h:1, caliber:"7.62x39", wpn:"AKM" },
  { name: "9mm弹×90",     icon: "🟨", quality: "green",  value: 900,   market: 780,   durability: null, kind: "ammo", w:1, h:1, caliber:"9x19", wpn:"MP5" },
  { name: "军用指南针",   icon: "🧭", quality: "green",  value: 1400,  market: 1600,  durability: null, w:1, h:1 },
  { name: "实体金币",     icon: "🪙", quality: "gold",   value: 4800,  market: 5200,  durability: null, w:1, h:1 },
  { name: "螺丝刀",       icon: "🪛", quality: "white",  value: 180,   market: null,   durability: null, w:1, h:1 },
  { name: "军用输血针",   icon: "💉", quality: "green",  value: 700,   market: 650,   durability: null, w:1, h:1 },
  { name: "紫火药",       icon: "🧪", quality: "purple", value: 3400,  market: 4600,  durability: null, w:1, h:1 },

  { name: "输血袋",       icon: "🩸", quality: "purple", value: 2600,  market: 3100,  durability: null, w:1, h:1 },
  { name: "能量棒",       icon: "🍫", quality: "white",  value: 150,   market: null,   durability: null, w:1, h:1 },
  { name: "打火机",       icon: "🔥", quality: "white",  value: 320,   market: null,   durability: null, w:1, h:1 },
  { name: "破旧卷尺",     icon: "📏", quality: "white",  value: 90,    market: null,   durability: null, w:1, h:1 },
  { name: "螺栓×4",      icon: "🔩", quality: "white",  value: 120,   market: null,   durability: null, w:1, h:1 },
  { name: "矿泉水",       icon: "💧", quality: "white",  value: 80,    market: null,   durability: null, w:1, h:1 },
  { name: "胶带",         icon: "🩹", quality: "green",  value: 260,   market: 240,   durability: null, w:1, h:1 },
  { name: "帆布片",       icon: "🧵", quality: "green",  value: 380,   market: 520,   durability: null, w:1, h:1 }
];

const SCENES = {
  pre: {
    title: "战前准备（仓库）",
    gridLabel: "战术仓库 · 物品按真实占格排版",
    bag: PRE_BAG
  },
  // 场景白名单仅 pre|post；历史 "in"（局内行动/战斗中）已移除，未知键回退 pre。
  // post 仅供内部/测试与数据使用，用户界面无入口。
  post: {
    title: "撤离结算（行动收获）",
    gridLabel: "行动收获 · 物品按真实占格排版",
    bag: POST_BAG
  }
};

/* ============================================================
 * 物品词库：别名 aliases + 拼音 pinyin（供 nlu.js 模糊/语音识别）
 * 别名按"名称关键子串"命中；拼音只收录 DEMO 物品里参与模糊匹配的字，
 * 未登录字在转换时保留原形，不影响精确别名命中。
 * ============================================================ */

/* 高频口语 / 语音误识别别名：键为名称中必含的关键子串 */
const ITEM_ALIASES = {
  "高级护甲维修包": ["甲修", "高级甲修", "护甲维修包", "修甲包", "假修", "甲休", "甲秀"],
  "基础护甲维修包": ["甲修", "基础甲修", "低级甲修", "小甲修"],
  "高级头盔维修包": ["头修", "高级头修", "头盔维修包", "修头包"],
  ".338 AP穿甲弹×40": ["点338", "338弹", "点338弹", "狙击弹", "awm弹", "马格南弹", "大狙弹"],
  "7.62 BP弹×60": ["762弹", "7.62弹", "ak弹", "akm弹", "akmn弹", "步枪弹", "bp弹", "阿卡弹", "阿卡"],
  "9mm PST弹×90": ["9毫米", "9mm弹", "手枪弹", "mp5弹", "pst弹"],
  "9mm弹×90": ["9毫米", "9mm弹", "手枪弹", "mp5弹"],
  "AKM 突击步枪": ["akm", "阿卡母", "ak母"],
  "AKMN 突击步枪": ["akmn", "阿卡母恩"],
  "AK-74N": ["ak74", "74n", "ak74n", "阿卡74"],
  "MP5 冲锋枪": ["mp5", "mp五", "冲锋枪"],
  "6B23 防弹胸甲": ["6b23", "6b23防弹衣", "6b23防弹胸甲", "6B23"],
  "急救包": ["急救", "血包", "医疗包"],
  "速效止痛药": ["止痛", "止痛药", "止疼药"],
  "军用输血针": ["输血针", "扎针", "红针"],
  "输血袋": ["血袋", "输血"],
  "战术头盔": ["头盔", "脑壳"],
  "三级防弹甲": ["防弹甲", "三级甲", "胸甲", "护甲"],
  "军用电台": ["电台"],
  "金狮子雕像": ["金狮子", "狮子", "金雕像"],
  "蓝宝石吊坠": ["蓝宝石", "吊坠", "宝石"],
  "M9 匕首": ["匕首", "小刀", "近战刀", "刀"]
};

/* 紧凑拼音表：覆盖物品名/别名中需要做近音匹配的汉字（不带声调） */
const PINYIN = {
  "维":"wei","修":"xiu","包":"bao","甲":"jia","头":"tou","盔":"kui","弹":"dan","药":"yao",
  "穿":"chuan","急":"ji","救":"jiu","止":"zhi","痛":"tong","镇":"zhen","输":"shu","血":"xue",
  "针":"zhen","袋":"dai","枪":"qiang","冲":"chong","锋":"feng","步":"bu","狙":"ju","击":"ji",
  "阿":"a","卡":"ka","母":"mu","恩":"en","假":"jia","休":"xiu","秀":"xiu","高":"gao",
  "级":"ji","基":"ji","础":"chu","低":"di","小":"xiao","脑":"nao","壳":"ke","电":"dian",
  "台":"tai","金":"jin","狮":"shi","子":"zi","雕":"diao","像":"xiang","蓝":"lan","宝":"bao",
  "石":"shi","吊":"diao","坠":"zhui","防":"fang","三":"san","胸":"xiong","护":"hu","医":"yi",
  "疗":"liao","红":"hong","手":"shou","穿":"chuan","马":"ma","格":"ge","南":"nan","点":"dian",
  "母":"mu","五":"wu","利":"li","拉":"la"
};

/* 把一段中英混排文本转成拼音串（未登录汉字保留原字，字母/数字小写保留） */
function toPinyinText(text){
  return String(text).toLowerCase().split("").map(ch=> PINYIN[ch] || ch).join("");
}

/* 全局稳定 id 计数器：每次 enrich（启动常量 + 每次深拷贝建状态）都发新 id，
 * 保证同一局内任意物品 id 唯一；id 与 _uid 同源（flash 按 _uid 定位 DOM）。 */
let _ITEM_ID_SEQ = 0;
function nextItemId(){ _ITEM_ID_SEQ++; return "it" + _ITEM_ID_SEQ; }

/* 给单件物品补 aliases / pinyin + 批0/批1新增字段 */
function inferSlotType(it){
  if (it.slotType) return it.slotType;                 // 批1：数据显式声明优先
  if (it.kind === "ammo" || it.kind === "repair" || it.kind === "med") return "other";
  if (it.wpn) return "weapon";
  if (/头盔/.test(it.name)) return "helmet";
  if (/防弹甲|防弹背心/.test(it.name)) return "armor";
  if (/背包|突击包/.test(it.name)) return "bag";
  if (/胸挂|弹挂/.test(it.name)) return "rig";
  return "other";
}
/* 批1：分类推断（分类轨弱显用），数据显式 cat 优先 */
function inferCat(it){
  if (it.cat) return it.cat;
  const st = it.slotType || inferSlotType(it);
  if (st === "weapon") return "weapon";
  if (["helmet","armor","bag","rig"].includes(st)) return "gear";
  if (it.kind === "ammo") return "ammo";
  if (it.kind === "med") return "med";
  return "mat";
}

/* 堆叠数量：显式 qty 优先；否则从名字尾部 ×N 解析；默认 1 */
function parseQty(it){
  if (typeof it.qty === "number") return it.qty;
  const m = /×\s*(\d+)\s*$/.exec(it.name);
  return m ? parseInt(m[1], 10) : 1;
}
/* 界面基础名：去掉名字尾部 ×N */
function baseNameOf(name){ return String(name).replace(/\s*×\s*\d+\s*$/, ""); }

function enrichItem(it){
  const aliases = ITEM_ALIASES[it.name] ? ITEM_ALIASES[it.name].slice() : [];
  it.aliases = aliases;
  // 名称与全部别名的无调拼音，供近音匹配
  it.pinyin = [it.name, ...aliases].map(toPinyinText);
  // —— 批0：稳定 id（每次 enrich 发全局唯一 id，_uid 同源供 DOM 定位）——
  const uid = nextItemId();
  it.id = uid;
  it._uid = uid;
  // —— 槽位类型 / 分类（显式优先）——
  it.slotType = inferSlotType(it);
  it.cat = inferCat(it);
  // —— 堆叠数量 + 基础名（界面用 baseName + 角标，不显示名字里的 ×N）——
  it.qty = parseQty(it);
  it.baseName = baseNameOf(it.name);
  it.stackable = it.kind === "ammo";
  it.maxStack = it.maxStack || (it.stackable ? 90 : 1);
  // —— 显式坐标暂空（createState 时由 first-fit 写入）——
  it.x = null; it.y = null; it.rot = 0;
  return it;
}

/* ============================================================
 * 批1：多容器状态 + 显式坐标（first-fit）+ 装备槽位结构 + 校验
 * ============================================================ */

const CONTAINER_GEOM = {
  stash:    { cols: STASH_COLS,    rows: STASH_ROWS },
  rig:      { cols: RIG_COLS,      rows: RIG_ROWS },
  pockets:  { cols: POCKET_COLS,   rows: POCKET_ROWS },
  backpack: { cols: BACKPACK_COLS, rows: BACKPACK_ROWS },
  safe:     { cols: SAFE_COLS,     rows: SAFE_ROWS }
};

/* —— 可变容器布局（批1c）——
 * 未装备时的默认灰格；装备容器物品后改读物品 layout。
 * 容量不变式：rig 恒为 8、backpack 恒为 20（行列可变、总格数不变）。 */
var DEFAULT_LAYOUT = {
  rig:      { cols: 4, rows: 2 },
  backpack: { cols: 5, rows: 4 },
  pockets:  { cols: POCKET_COLS, rows: POCKET_ROWS },
  safe:     { cols: SAFE_COLS,   rows: SAFE_ROWS },
  stash:    { cols: STASH_COLS,  rows: STASH_ROWS }
};
var CONTAINER_CAPACITY = { rig: 8, backpack: 20, pockets: 5, safe: 6, stash: 144 };

/* 当前有效布局：已装备容器物品 → 物品 layout；否则默认灰格。
 * 将来批3 装备/卸下流程：
 *   1) state.equipped[kind].item = 容器物品（卸下置 null）；
 *   2) const L = effectiveLayout(state, kind) 取新行列；
 *   3) 把 box.cols/rows 更新为 L，并对 box.items 调 repackBox 重排；
 *   4) 必须调 validateBox(box, kind)：容量不符 / 物品越界 / 重叠则放弃切换
 *      或交由 AI 询问如何处理（如卖掉哪些），不得留下非法布局。 */
function effectiveLayout(state, kind, override){
  // 批3B：真实装备优先；未装备时预览 override 才生效（预览永不覆盖真实装备）
  // 容器名 backpack 对应装备槽键 bag
  const slotKey = kind==="backpack" ? "bag" : kind;
  const it = state.equipped[slotKey] && state.equipped[slotKey].item;
  if(it && it.layout){
    return { cols:it.layout.cols, rows:it.layout.rows, slots:it.layout.slots||null };
  }
  if(override && override.cols && override.rows){
    return { cols:override.cols, rows:override.rows, slots:override.slots||null };
  }
  return { cols:DEFAULT_LAYOUT[kind].cols, rows:DEFAULT_LAYOUT[kind].rows, slots:null };
}

/* 深拷贝一批物品并补字段 */
function prepareItems(list){
  return list.map(it => enrichItem(JSON.parse(JSON.stringify(it))));
}

/* 装备槽位初始结构：{label, item}，按 INITIAL_EQUIP_SETUP 填充 */
function initialEquippedSlots(){
  const built = {};
  EQUIP_SLOTS.forEach(st => { built[st] = { label: SLOT_LABEL[st], item:null }; });
  Object.keys(INITIAL_EQUIP_SETUP).forEach(st=>{
    const def = INITIAL_EQUIP_SETUP[st];
    if(def && EQUIP_SLOTS.includes(st)) built[st].item = prepareItems([def])[0];
  });
  return built;
}

/* 旋转后有效宽高：rot 奇数交换 */
function itemDims(it){
  const w = it.w||1, h = it.h||1;
  return (it.rot%2===1) ? { w:h, h:w } : { w, h };
}

/* first-fit：容器内找第一个空位写入 x/y；放不下返回 false。container 是 {items,cols,rows} */
function placeFirstFit(box, item){
  const g = { cols:box.cols, rows:box.rows };
  const { w, h } = itemDims(item);
  const occ = Array.from({length:g.rows},()=>new Array(g.cols).fill(false));
  box.items.forEach(it=>{
    const d = itemDims(it);
    for(let yy=it.y; yy<it.y+d.h; yy++)
      for(let xx=it.x; xx<it.x+d.w; xx++)
        if(yy>=0&&yy<g.rows&&xx>=0&&xx<g.cols) occ[yy][xx]=true;
  });
  for(let y=0;y<=g.rows-h;y++){
    for(let x=0;x<=g.cols-w;x++){
      let ok=true;
      for(let yy=y;yy<y+h&&ok;yy++)
        for(let xx=x;xx<x+w;xx++)
          if(occ[yy][xx]){ ok=false; break; }
      if(ok){ item.x=x; item.y=y; box.items.push(item); return true; }
    }
  }
  return false;
}

/* 批量 first-fit（大物优先），返回放不下的物品 */
function placeAllFirstFit(box, items){
  const left=[];
  items.slice().sort((a,b)=>(b.w*b.h)-(a.w*a.h)).forEach(it=>{
    if(!placeFirstFit(box,it)) left.push(it);
  });
  return left;
}

/* 对一个容器清空后重新 first-fit 压实（移动后用于安全箱等） */
function repackBox(box, items){
  box.items.length = 0;
  return placeAllFirstFit(box, items);
}

/* ================= 批3B：容器类装备生效（布局同步 + 隔层装箱） ================= */

/* 按 state.equipped 推导某可变容器(rig/backpack)的真实布局：
 * 已装备容器物品 → 物品 layout；否则默认灰格。注意：不含预览 override
 * （预览只在渲染层 app.js 生效，判定与 state 一律以真实装备为准）。 */
function containerLayoutOf(state, kind){
  const slotKey = kind==="backpack" ? "bag" : kind;
  const it = state.equipped[slotKey] && state.equipped[slotKey].item;
  if(it && it.layout) return { cols:it.layout.cols, rows:it.layout.rows, slots:it.layout.slots||null };
  return { cols:DEFAULT_LAYOUT[kind].cols, rows:DEFAULT_LAYOUT[kind].rows, slots:null };
}

/* 把 rig/backpack 的 cols/rows/slots 与当前装备同步（布局不另存，统一由 equipped 推导）。
 * 调用时机：createState 末尾、装备/替换/卸下提交后、撤销恢复后、页面初始化。
 * 只同步几何字段，不移动任何物品（重排由引擎在切换时负责）。 */
function syncContainerLayouts(state){
  ["rig","backpack"].forEach(kind=>{
    const box = state[kind];
    if(!box) return;
    const L = containerLayoutOf(state, kind);
    box.cols = L.cols; box.rows = L.rows;
    box.slots = L.slots; // 无隔层时为 null/[]，canPlace 据此判定
  });
  return state;
}

/* 两个朝向下的占地：以物品当前 rot 优先，失败再尝试另一朝向。
 * 返回 [{rot,dims}]，去重（正方形只返回一个）。 */
function _rotTries(it){
  const w=it.w||1, h=it.h||1, r=(it.rot|0)%2;
  const a={ rot:r, dims: r? {w:h,h:w}:{w,h} };
  if(w===h) return [a];
  const r2=(r+1)%2;
  return [a, { rot:r2, dims: r2? {w:h,h:w}:{w,h} }];
}

function _boxOccupied(box){
  const occ={};
  box.items.forEach(o=>{
    const d=itemDims(o);
    for(let yy=o.y; yy<o.y+d.h; yy++)
      for(let xx=o.x; xx<o.x+d.w; xx++) occ[xx+","+yy]=true;
  });
  return occ;
}

/* 在单个隔层 slots=null（整矩形）或某隔层内尝试放置一件物品。
 * 原朝向优先，放不下再旋转；成功写 x/y/rot 并返回 true。纯几何，不做容量校验。 */
function _placeInRegion(box, region, occ, item, tries){
  for(const t of tries){
    const {w,h}=t.dims;
    if(w>region.w || h>region.h) continue;
    for(let y=region.y; y+h<=region.y+region.h; y++){
      for(let x=region.x; x+w<=region.x+region.w; x++){
        let clear=true;
        for(let yy=y; yy<y+h && clear; yy++)
          for(let xx=x; xx<x+w; xx++) if(occ[xx+","+yy]){ clear=false; break; }
        if(clear){
          item.x=x; item.y=y; item.rot=t.rot;
          box.items.push(item);
          for(let yy=y; yy<y+h; yy++)
            for(let xx=x; xx<x+w; xx++) occ[xx+","+yy]=true;
          return true;
        }
      }
    }
  }
  return false;
}

/* 把一件物品放进容器（slots 为隔层数组时逐隔层尝试；null 时按整矩形）。
 * 保持原朝向优先，失败再换朝向；成功返回 true。 */
function placeInContainer(box, slots, item){
  const occ=_boxOccupied(box);
  const tries=_rotTries(item);
  if(slots && slots.length){
    for(const s of slots){
      if(_placeInRegion(box, s, occ, item, tries)) return true;
    }
    return false;
  }
  return _placeInRegion(box, {x:0,y:0,w:box.cols,h:box.rows}, occ, item, tries);
}

/* 确定性批量装箱：按占地面积从大到小、同面积保持原顺序（稳定排序）。
 * 返回放不下的物品（保持其原字段不动）。 */
function repackContainer(box, slots, items){
  box.items.length=0;
  const ordered=items.map((it,idx)=>({it,idx}))
    .sort((a,b)=>{
      const da=(a.it.w||1)*(a.it.h||1), db=(b.it.w||1)*(b.it.h||1);
      return db-da || a.idx-b.idx;
    }).map(o=>o.it);
  const left=[];
  for(const it of ordered){ if(!placeInContainer(box, slots, it)) left.push(it); }
  return left;
}

/* —— 分隔层容器（如 D3 胸挂）：物品必须完整落在某一个隔层内，不能跨隔层 ——
 * slots: [{x,y,w,h}]，格坐标。下列为纯函数，供将来拖拽放置/校验复用。 */

/* 校验隔层布局自身：不越界、互不重叠、并集铺满整个外框（面积守恒、无缺格） */
function validateSlots(cols, rows, slots){
  const errors=[];
  const cover={};
  let area=0;
  (slots||[]).forEach((s,i)=>{
    if(s.x<0||s.y<0||s.x+s.w>cols||s.y+s.h>rows)
      errors.push(`隔层${i}越界(${s.x},${s.y},${s.w}×${s.h})`);
    for(let y=s.y;y<s.y+s.h;y++)for(let x=s.x;x<s.x+s.w;x++){
      const k=x+","+y;
      if(cover[k]!=null) errors.push(`隔层${i}与隔层${cover[k]}在${k}重叠`);
      else cover[k]=i;
      area++;
    }
  });
  if(area!==cols*rows) errors.push(`隔层面积和${area}≠外框${cols*rows}（有缺格或重叠）`);
  return { ok:errors.length===0, errors };
}

/* 一件物品（已含 x,y，dims 为旋转后尺寸）是否完整落在某一个隔层内 */
function slotFitsAt(slots, x, y, dims){
  return (slots||[]).some(s=>
    x>=s.x && y>=s.y && x+dims.w<=s.x+s.w && y+dims.h<=s.y+s.h);
}

/* 校验：容器内物品不重叠、不越界、都有坐标；
 * 若提供 slots（分隔层容器），每件物品还必须完整落在单个隔层内。 */
function validateBox(box, label, slots){
  const errors=[];
  /* 分隔层容器：先校验隔层自身合法 */
  if(slots && slots.length){
    validateSlots(box.cols, box.rows, slots).errors.forEach(e=>errors.push(`${label}:${e}`));
  }
  /* 容量不变式：行列可变，但总格数恒定（rig=8、backpack=20、pockets=5、safe=6） */
  if(CONTAINER_CAPACITY[label]!=null && box.cols*box.rows !== CONTAINER_CAPACITY[label]){
    errors.push(`${label}:容量不变式被破坏 ${box.cols}×${box.rows}=${box.cols*box.rows}≠${CONTAINER_CAPACITY[label]}`);
  }
  const owner={};
  box.items.forEach((it,idx)=>{
    const nm = it.baseName||it.name;
    if(it.x==null||it.y==null){ errors.push(`${label}:${nm} 无坐标`); return; }
    const d=itemDims(it);
    if(it.x<0||it.y<0||it.x+d.w>box.cols||it.y+d.h>box.rows)
      errors.push(`${label}:${nm} 越界(${it.x},${it.y},${d.w}×${d.h})`);
    if(slots && slots.length && !slotFitsAt(slots, it.x, it.y, d))
      errors.push(`${label}:${nm} 跨隔层或未落在任何隔层内(${it.x},${it.y},${d.w}×${d.h})`);
    for(let y=it.y;y<it.y+d.h;y++)for(let x=it.x;x<it.x+d.w;x++){
      const k=x+","+y;
      if(owner[k]!=null) errors.push(`${label}:${nm} 与 ${box.items[owner[k]].baseName||box.items[owner[k]].name} 在${k}重叠`);
      else owner[k]=idx;
    }
  });
  return { ok:errors.length===0, errors };
}

/* 新建一份多容器状态。批1只展示 pre */
function createState(scene){
  // 白名单 pre|post；缺失/未知（含历史 "in"）一律回退 pre，保证 state.scene 永不为非法值
  scene = (scene === "post") ? "post" : "pre";
  const state = {
    scene,
    stash:    { items:[], cols:STASH_COLS, rows:STASH_ROWS },
    rig:      { items:[], cols:RIG_COLS, rows:RIG_ROWS },
    pockets:  { items:[], cols:POCKET_COLS, rows:POCKET_ROWS },
    backpack: { items:[], cols:BACKPACK_COLS, rows:BACKPACK_ROWS },
    safe:     { items:[], cols:SAFE_COLS, rows:SAFE_ROWS },
    equipped: initialEquippedSlots(),
    money: scene === "post" ? 186420 : 128400,
    listings: [],
    market: (typeof freshMarket==="function") ? freshMarket() : { stock: [] },
    gearPlan: [],
    gearPlanTotal: null
  };
  const source = scene === "post" ? POST_BAG : PRE_BAG;
  const overflow = placeAllFirstFit(state.stash, prepareItems(source));
  state.stashOverflow = overflow.length;
  syncContainerLayouts(state); // 批3B：rig/backpack 几何与初始装备(空槽)同步为默认灰格
  return adoptState(state);
}

/* 兼容适配：state.bag=仓库物品数组（旧引擎/渲染仍读 state.bag）；
 * state.safe / state.stash 等本身是 {items,cols,rows} 容器对象（新代码用）。
 * 旧代码若读 state.safe 期望数组会拿到容器对象，由引擎批1适配取 .items。 */
function adoptState(state){
  Object.defineProperty(state, "bag", {
    get(){ return state.stash.items; }, configurable:true, enumerable:false
  });
  return state;
}

/* 全局物品索引：跨容器/装备槽按稳定 id 查找，返回 {item,container,index,slot?} */
function findItemById(state, id){
  const containers = ["stash","rig","pockets","backpack","safe"];
  for(const cn of containers){
    const box = state[cn];
    const arr = box.items;
    const index = arr.findIndex(it => it && it.id === id);
    if(index >= 0) return { item:arr[index], container:cn, index };
  }
  for(const st of EQUIP_SLOTS){
    const it = state.equipped[st] && state.equipped[st].item;
    if(it && it.id === id) return { item:it, container:"equipped", index:st, slot:st };
  }
  return null;
}

/* 启动时给数据源常量挂字段（别名表依赖）；createState 会再深拷贝发新 id */
[PRE_BAG, POST_BAG].forEach(arr => arr.forEach(enrichItem));
Object.values(INITIAL_EQUIP_SETUP).forEach(def=>{ if(def) enrichItem(def); });
