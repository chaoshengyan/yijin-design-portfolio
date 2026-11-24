/* ============================================================
 * ai.js — 真实 LLM 接入层 + 语音输入
 * 设计：LLM 只输出 {intent, params, reason} 的严格 JSON；
 * 具体操作由 engine.js 用真实背包数据计算并校验，模型不碰执行。
 * 兼容任意 OpenAI 协议接口（豆包Ark / DeepSeek / Kimi / OpenAI 等）。
 * ============================================================ */

const AI = {
  cfgKey: "qm_ai_cfg",
  getCfg(){
    try{ return JSON.parse(localStorage.getItem(this.cfgKey)) || {}; }catch(e){ return {}; }
  },
  setCfg(c){ localStorage.setItem(this.cfgKey, JSON.stringify(c)); },
  /* 仅在"保存并测试"真正请求成功后置 true；保存配置本身不算在线 */
  setTestOk(ok){ try{ localStorage.setItem(this.cfgKey+"_ok", ok ? "1" : "0"); }catch(e){} },
  isTestOk(){ try{ return localStorage.getItem(this.cfgKey+"_ok") === "1"; }catch(e){ return false; } },
  isReady(){
    const c = this.getCfg();
    return !!(c.baseUrl && c.apiKey && c.model);
  },

  /* 只读辅助：统一从容器对象 {items,...} 取物品数组，杜绝把容器当数组用。
   * 容错：历史数据若直接是数组也能读；空/异常返回 []。 */
  itemsOf(box){
    if(!box) return [];
    if(Array.isArray(box)) return box.filter(Boolean);
    return Array.isArray(box.items) ? box.items.filter(Boolean) : [];
  },
  /* 汇总全库存：五个容器 + 装备槽（槽内物品标注 inSlot）。返回纯对象数组。 */
  allItemsOf(state){
    const out = [];
    ["stash","rig","pockets","backpack","safe"].forEach(cn=>{
      this.itemsOf(state[cn]).forEach(it=> out.push({ it, container:cn, slot:null }));
    });
    const eq = state.equipped || {};
    Object.keys(eq).forEach(slot=>{
      const it = eq[slot] && eq[slot].item;
      if(it) out.push({ it, container:"equipped", slot });
    });
    return out;
  },

  /* 给模型的库存快照：仓库/口袋/胸挂/背包/安全箱 + 装备槽全部汇总。
   * id 为稳定物品 id（非数组下标）；loc 标注所在容器或装备槽。 */
  inventorySummary(state){
    const items = this.allItemsOf(state).map(({it,container,slot})=> ({
      id:it.id, n:it.name, q:it.quality, v:it.value, m:it.market||0,
      d:it.durability, cal:it.caliber||null, w:it.w||1, h:it.h||1,
      qty:it.qty||1, loc: slot ? ("slot:"+slot) : container
    }));
    return JSON.stringify(items);
  },

  /* 术语表摘要：只拼 term + aliases + rule（meaning 面向玩家，模型用不上），供模型理解黑话。
     glossary.js 未加载时安全降级为空串，不影响本地兜底。 */
  glossaryDigest(){
    const list = (typeof GLOSSARY!=="undefined" && Array.isArray(GLOSSARY)) ? GLOSSARY : [];
    return list.map(g => `- ${g.term}（${(g.aliases||[]).slice(0,4).join("/")}）：${g.rule}`).join("\n");
  },

  /* 相关物品候选（仅名称/类别/品质，绝不带 id/价格/耐久/占格）。
   * 本地 NLU 能匹配到就只发匹配候选；本地确定不了 → 退化为紧凑名称清单，
   * 绝不过度裁剪成“无物品”。 */
  relatedCandidates(text, state){
    const all = this.allItemsOf(state).map(x=>x.it);
    const seen = new Set();
    const out = [];
    if(text && typeof NLU!=="undefined"){
      const cands = NLU.matchItems(NLU.normalize(text), all, {});
      cands.forEach(c=>{
        const n = c.item.baseName || c.item.name;
        if(!seen.has(n)){ seen.add(n); out.push({ n, cat:c.item.cat, q:c.item.quality }); }
      });
    }
    if(out.length) return out;
    all.forEach(it=>{
      const n = it.baseName || it.name;
      if(!seen.has(n)){ seen.add(n); out.push({ n, cat:it.cat, q:it.quality }); }
    });
    return out;
  },

  systemPrompt(ctx){
    ctx = ctx || {};
    const scene = ctx.scene || "pre";
    const calibers = ctx.weaponCalibers || [];
    const candidates = ctx.candidates || [];
    const pending = ctx.pendingClarify || null;
    const calTxt = calibers.length ? calibers.join("、") : "无";
    const candTxt = candidates.length
      ? candidates.slice(0,30).map(c=>`${c.n}(${c.cat}${c.q?("/"+c.q):""})`).join("、")
      : "（本地未确定候选，请只输出结构化意图，不要据此判定“无物品”）";
    const pendTxt = pending ? `意图=${pending.intent}，待补字段=${pending.missing||"?"}` : "无";
    return `你是战术撤离射击手游《黑区撤离》的"QM-01·战术后勤"。你只把玩家口语解析成 {intent,params,reason}，不执行操作、不编造物品 id（物品名由本地引擎匹配真实库存并校验）。
【当前场景】${scene}
【当前装备武器口径】${calTxt}
【相关物品候选（仅名称/类别/品质）】${candTxt}
【当前待澄清字段】${pendTxt}
【可选意图】
1. safe：把物资放入安全箱。口语"保险/保箱"=安全箱。params 可含：
   - {"category":"ammo|weapon|gear|med|mat"}：只说类别（"子弹"→"ammo"）时用；类别本身即有效筛选。
   - {"source":"carried"}：说"身上的/随身"时限定已携带容器；不说就不加（默认仓库）。
   - {"caliber":"7.62x39|5.45x39|9x19|.338"}：点名某把枪的子弹（AKM/AKMN=7.62x39，AK-74/74N=5.45x39，MP5=9x19，AWM/狙=.338）；"要用的子弹"只有当前武器能唯一确定口径才加 caliber，否则省略让本地引擎澄清。
   - {"minQuality":"purple"}（紫色及以上）、{"exactQuality":"purple"}（只紫色，金色不动）。
   - {"item":"玩家点名的具体物品名"}：原样带出，本地引擎按真实库存匹配。
2. loadout：卡战备/跑刀配装。params: {"budget":数字,"compare":"gte|lte","pick":"closest"}；"X万"=X*10000、"五万"=50000；"卡/卡到N战备"→"gte"，"以内/以下/不超过/跑刀"→"lte"；没说预算默认50000。
3. durability：检查装备耐久/磨损/损坏。
4. sell：出售或挂交易行。params 可含：
   - {"item":"玩家点名的具体物品名"}：原样带出（本地引擎匹配并校验位置）。
   - {"category":"ammo|weapon|gear|med|mat"}：只说类别时用。
   - {"source":"carried"}：说"身上的/随身"时用。
   - {"maxQuality":"white|green|blue|purple|gold"}：处理该品质及以下；"蓝以下/蓝色以下"=blue。
   注意：出售只处理仓库物品；具体物品在装备栏/随身容器时由本地引擎说明位置与限制，不要替它下结论。
5. repair：修理装备。params: {"slot":"胸甲|头盔|主武器"}，没说就省略 slot。
6. buy：购买。无执行器，本地引擎提示"暂不支持"，你只归为此意图并带 {"category":"..."} 与 {"budget":数字}（"买五万左右的枪"→category=weapon,budget=50000），不要映射成配装、不要扣币。
7. organize：整理仓库。无执行器，归为此意图即可。
8. unknown：无法归入以上意图。
【品质枚举】white白 < green绿 < blue蓝 < purple紫 < gold金。
【黑话术语表】${this.glossaryDigest()}
【配装口径】战备值只统计装备栏七槽物品 v 之和；"卡N战备"=≥N取最接近，"N以内"=≤N取最大。
【输出要求】只输出一个 JSON 对象，不要任何解释或 markdown 代码块；reason 必须与 params 一致、不得编造结果：
{"intent":"...","params":{...},"reason":"一句中文说明你的判断"}`;
  },

  /* 配置校验：返回错误类型字符串，null 表示通过 */
  validateCfg(c){
    c = c || {};
    if(!c.baseUrl || !/^https?:\/\/.+/i.test(c.baseUrl)) return "baseUrl";
    if(!c.apiKey) return "apiKey";
    if(!c.model) return "model";
    return null;
  },

  /* 返回 {intent, params, reason, raw}；失败抛带 kind 的错误，由调用方走本地兜底。
   * ctx: {scene, weaponCalibers, candidates, pendingClarify}——只发最小上下文，不发完整库存/历史。
   * err.kind: "config" 配置缺失/格式错 | "http" 服务端返回非2xx | "network" 连不通 | "local" 本地脚本/返回格式异常 */
  async parse(text, state, ctx){
    const c = this.getCfg();
    const bad = this.validateCfg(c);
    if(bad){
      const name = {baseUrl:"Base URL", apiKey:"API Key", model:"模型 ID"}[bad];
      const err = new Error("配置缺失或格式错误：" + name);
      err.kind = "config"; err.field = bad; throw err;
    }
    let resp;
    try{
      const url = c.baseUrl.replace(/\/$/,"") + "/chat/completions";
      resp = await fetch(url, {
        method:"POST",
        headers:{ "Content-Type":"application/json", "Authorization":"Bearer " + c.apiKey },
        body: JSON.stringify({
          model: c.model,
          temperature: 0,
          messages:[
            { role:"system", content: this.systemPrompt(ctx) },
            { role:"user", content: text }
          ]
        })
      });
    }catch(e){
      const err = new Error("无法连接到服务：" + (e && e.message ? e.message : "网络错误"));
      err.kind = "network"; throw err;
    }
    if(!resp.ok){
      let detail = "";
      try{
        const j = await resp.json();
        const msg = (j && (j.message || (j.error && j.error.message))) || "";
        const code = (j && (j.code || (j.error && j.error.code))) || "";
        detail = [code, msg].filter(Boolean).join(" ");
      }catch(_){ /* 非 JSON 错误体，忽略 */ }
      const err = new Error("HTTP " + resp.status + (detail ? "：" + detail : ""));
      err.kind = "http"; err.status = resp.status; throw err;
    }
    let data;
    try{
      data = await resp.json();
    }catch(e){
      const err = new Error("服务端返回不是合法 JSON");
      err.kind = "local"; throw err;
    }
    const content = data.choices && data.choices[0] && data.choices[0].message.content || "";
    const json = this.extractJSON(content);
    if(!json || !json.intent){
      const err = new Error("模型返回格式错误（缺少 intent）");
      err.kind = "local"; throw err;
    }
    return json;
  },

  extractJSON(s){
    try{ return JSON.parse(s); }catch(e){}
    const m = s.match(/\{[\s\S]*\}/);
    if(m){ try{ return JSON.parse(m[0]); }catch(e){} }
    return null;
  },

  /* ---------------- 语音输入（Chrome 原生 Web Speech） ---------------- */
  recognition:null,
  voiceSupported(){ return "webkitSpeechRecognition" in window || "SpeechRecognition" in window; },
  startVoice(onText, onEnd){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR){ onEnd && onEnd(false); return null; }
    const rec = new SR();
    rec.lang = "zh-CN";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = e => {
      const said = e.results[0][0].transcript.replace(/[。！？\s]/g,"");
      onText && onText(said);
    };
    rec.onerror = ()=> onEnd && onEnd(false);
    rec.onend = ()=> onEnd && onEnd(true);
    rec.start();
    this.recognition = rec;
    return rec;
  }
};
