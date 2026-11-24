/* ============================================================
 * nlu.js — 自然语言理解层（离线规则，不依赖 LLM）
 * 归一化 → 同义词 → 动作/容器识别 → 物品模糊匹配 → 置信度
 * 供 engine.js / app.js 调用；本身不修改库存状态
 * ============================================================ */
const NLU = {

  /* ---------- 1. 文本归一化：去空格、全角→半角 ---------- */
  normalize(text){
    return String(text||"")
      .replace(/\s+/g,"")
      .replace(/[\uFF01-\uFF5E]/g, ch=> String.fromCharCode(ch.charCodeAt(0)-0xFEE0))
      .replace(/\u3000/g,"")
      .toLowerCase();
  },

  /* ---------- 2. 同义词表 ---------- */
  SYN:{
    action_in:  ["装进","放进","塞进","装入","放进去","装进去","塞进去","入箱","装入箱"],
    action_out: ["拿出","取出","拿走","拿出来","取出来","拿出去","移出","拿出箱"],
    action_sell:["卖","出售","卖掉","清掉","变现","挂行","挂交易行","卖掉","出掉","处理掉","清仓"],
    action_repair:["修满","补满","修好","修复","修理","修一下","修甲","把甲修","把头修"],
    action_loadout:["配装","配一套","起装","战备","跑刀","整套","装备方案","来一套","配个"],
    action_check:["坏","耐久","磨损","体检","检查","快不行"],
    action_buy:["购买","购入","买入","买","收一把","收个","收件"],
    action_organize:["整理仓库","整理背包","整理","收拾","归置"]
  },

  detectAction(normText){
    const t=normText;
    if(this.SYN.action_out.some(k=>t.includes(k))) return "retrieve";
    if(this.SYN.action_in.some(k=>t.includes(k)))  return "safe";
    // 阶段3别名：“放保险/放保箱/塞保险”等——指向安全箱且含放置动词，按入安全箱处理
    if(this.detectContainer(t)==="safe" && /[放装塞入]/.test(t)) return "safe";
    if(this.SYN.action_sell.some(k=>t.includes(k))) return "sell";
    if(this.SYN.action_repair.some(k=>t.includes(k))) return "repair";
    // 配装简称：“卡5万/卡五万/配个三万”等数字表达
    if(/卡\s*\d|卡\s*[一二三四五六七八九十]/.test(t)) return "loadout";
    if(/配\s*\d|配.*[万w]/.test(t)) return "loadout";
    if(this.SYN.action_loadout.some(k=>t.includes(k))) return "loadout";
    if(this.SYN.action_check.some(k=>t.includes(k))) return "durability";
    if(this.SYN.action_buy.some(k=>t.includes(k))) return "buy";
    if(this.SYN.action_organize.some(k=>t.includes(k))) return "organize";
    return null;
  },

  /* ---------- 类别 / 来源归一化（类别本身即有效筛选，不强制再补品质/口径） ---------- */
  CATEGORY:{
    ammo:  ["子弹","弹药"],
    weapon:["武器","步枪","冲锋枪","手枪","狙击枪","枪","近战"],
    gear:  ["护甲","防具","头盔","胸甲","胸挂","背包","防弹衣"],
    med:   ["医疗","药品","药"],
    mat:   ["材料","杂物"]
  },
  CATEGORY_LABEL:{ ammo:"弹药", weapon:"武器", gear:"装备", med:"医疗", mat:"材料" },

  /* 返回类别键 ammo|weapon|gear|med|mat，无法归一为 null */
  detectCategory(normText){
    const t = normText || "";
    const keys = Object.keys(this.CATEGORY);
    for(let i=0;i<keys.length;i++){
      const cat = keys[i];
      if(this.CATEGORY[cat].some(w=>t.includes(w))) return cat;
    }
    return null;
  },

  /* "身上/随身" → carried（限定已携带容器），"仓库" → stash */
  detectSource(normText){
    const t = normText || "";
    if(/身上|随身|已携带|携带|穿在身上|穿戴|装备栏/.test(t)) return "carried";
    if(/仓库/.test(t)) return "stash";
    return null;
  },

  /* ---------- 数量 / 排除保留（暂不支持时须澄清，不得忽略后执行） ---------- */
  /* 具体数量（如"5发/两堆"）→ {raw,n,unit}；"全部/所有/都"→ {all:true}；无 → null */
  detectQuantity(normText){
    const t = normText || "";
    if(/全部|所有|都|统统|整堆/.test(t)) return { all:true };
    const m = t.match(/(\d+|[一二两三四五六七八九十])\s*(发|个|件|堆|组|盒|张|枚|格)/);
    if(m) return { raw:m[0], n:m[1], unit:m[2] };
    return null;
  },

  /* 排除/保留条件关键词（命中即视为“暂不支持该条件”，需澄清） */
  detectExclusion(normText){
    const t = normText || "";
    const hits = [];
    ["除了","除","以外","除外","保留","留下","跳过","排除","别卖","不卖","不要卖"].forEach(w=>{
      if(t.includes(w)) hits.push(w);
    });
    return hits;
  },

  detectContainer(normText){
    const t=normText;
    // 阶段3别名：保险/保箱 = 安全箱（“保险箱”原已支持，一并保留）
    if(t.includes("安全箱")||t.includes("保险箱")||t.includes("保险")||t.includes("保箱")) return "safe";
    if(t.includes("背包")||t.includes("仓库")) return "bag";
    return null;
  },

  /* ---------- 3. 拼音近音归一化 ---------- */
  phoneticClass(pinyin){
    return pinyin
      .replace(/zh/g,"z").replace(/ch/g,"c").replace(/sh/g,"s")
      .replace(/ang/g,"an").replace(/eng/g,"en").replace(/ing/g,"in").replace(/ong/g,"un");
  },

  editDistance(a,b){
    const m=a.length, n=b.length;
    if(!m) return n; if(!n) return m;
    const prev=Array.from({length:n+1},(_,j)=>j);
    for(let i=1;i<=m;i++){
      let diag=prev[0];       // d[i-1][0]
      prev[0]=i;              // d[i][0]
      for(let j=1;j<=n;j++){
        const up=prev[j];     // d[i-1][j]（本行更新前）
        const left=prev[j-1]; // d[i][j-1]（本行已更新）
        const upleft=diag;    // d[i-1][j-1]
        const cost=(a[i-1]===b[j-1])?0:1;
        prev[j]=Math.min(up+1, left+1, upleft+cost);
        diag=up;              // 下一位的对角线 = 旧的 d[i-1][j]
      }
    }
    return prev[n];
  },

  simScore(a,b){
    const max=Math.max(a.length,b.length)||1;
    return 1 - this.editDistance(a,b)/max;
  },

  /* ---------- 4. 物品模糊匹配 ---------- */
  matchItems(normText, items, opts){
    opts=opts||{};
    const t=normText;
    if(!t) return [];
    const scope=opts.scope || null;     // 'safe'|'bag'|null：限制搜索范围
    const results=[];
    const seen=new Set();

    (items||[]).forEach(it=>{
      if(!it) return;
      // 范围过滤
      if(scope && it._container && it._container!==scope) return;
      const name=it.name||"";
      const aliases=it.aliases||[];
      const pyList=it.pinyin||[];
      let best={item:it, confidence:0, reason:""};

      // ① 精确名称/别名子串命中
      if(name && t.includes(name.toLowerCase()))
        best={item:it, confidence:1.0, reason:"名称精确命中"};
      for(const a of aliases){
        if(a && t.includes(a.toLowerCase()))
          if(1.0>best.confidence) best={item:it, confidence:1.0, reason:"别名命中: "+a};
      }
      // ② 拼音精确命中
      const tPy=pyText(t);
      for(const py of pyList)
        if(py && tPy.includes(py) && 0.92>best.confidence)
          best={item:it, confidence:0.92, reason:"拼音命中: "+py};
      // ③ 近音归一化
      const tPhon=this.phoneticClass(tPy);
      for(const py of pyList){
        const pyPhon=this.phoneticClass(py);
        if(pyPhon && !tPy.includes(py) && tPhon.includes(pyPhon) && 0.78>best.confidence)
          best={item:it, confidence:0.78, reason:"近音命中: "+py};
      }
      // ④ 编辑距离（要求至少3字符，减少短文本假阳性）
      for(const a of [name,...aliases]){
        if(!a||a.length<3) continue;
        const aPy=pyText(a);
        const winLen=Math.min(aPy.length,tPy.length);
        if(winLen<3) continue;
        let bestSim=0;
        for(let i=0;i+winLen<=tPy.length;i++){
          bestSim=Math.max(bestSim,this.simScore(aPy,tPy.slice(i,i+winLen)));
        }
        if(bestSim>=0.88 && bestSim*0.82>best.confidence)
          best={item:it, confidence:Math.round(bestSim*0.82*100)/100, reason:"编辑距离相似: "+a};
      }
      if(best.confidence>0 && !seen.has(it.name)){ results.push(best); seen.add(it.name); }
    });
    return results.sort((a,b)=>b.confidence-a.confidence);
  },

  /* ---------- 5. 完整解析入口 ---------- */
  parse(text, items, opts){
    opts=opts||{};
    const norm=this.normalize(text);
    const action=this.detectAction(norm);
    const container=this.detectContainer(norm);
    // scope 限定候选搜索范围；noAutoScope 用于“候选已按来源选好、不想被 safe 容器自动过滤”
    let scope=null;
    if(opts.scope) scope=opts.scope;
    else if(!opts.noAutoScope && container==="safe") scope="safe";
    // 省略"进"的口语
    let resolvedAction=action;
    if(!resolvedAction && container==="safe" && /[放装塞入]/.test(norm)) resolvedAction="safe";
    // 未识别意图 → 不返回候选
    let candidates = resolvedAction ? this.matchItems(norm, items, {scope}) : [];

    // 同分歧义检测
    let ambiguous=false;
    if(candidates.length>=2 && candidates[0].confidence===candidates[1].confidence && candidates[0].confidence>=0.85)
      ambiguous=true;

    return { normText:norm, action:resolvedAction, container, candidates, ambiguous };
  }
};

function pyText(text){
  const s = typeof toPinyinText==="function" ? toPinyinText(text) : String(text).toLowerCase();
  return s.replace(/\s+/g, "");   // 名称里的空格（如 "6B23 防弹胸甲"）不应参与拼音比对
}
