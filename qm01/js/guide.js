/* ============================================================
 * guide.js — QM-01 四步新手引导（纯展示层）
 *   1. 助手入口  2. 输入框/发送  3. 方案展示区  4. 仓库与角色装备
 * 不引入依赖、不调用 LLM、不改库存/交易/拖拽规则。
 * 页面初始化后自动启动一次；普通 render 不重启；
 * Esc/跳过清理；“使用指引”可重新启动。
 * ============================================================ */
(function () {
  "use strict";

  var started = false;   // 自动启动仅一次
  var active = false;    // 引导是否正在展示
  var step = 0;
  var overlay = null, card = null, rings = [];

  function byId(id){ return document.getElementById(id); }
  function visible(el){
    if(!el) return false;
    var r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }
  function byIds(list){ return (list||[]).map(byId).filter(Boolean); }

  /* 复用现有展开逻辑：入口钮 aria-expanded 为 false 时点它（触发 setOpen(true)） */
  function ensureAssistantOpen(){
    var t = byId("aiTrigger");
    if(t && t.getAttribute("aria-expanded") !== "true"){ t.click(); }
  }

  var STEPS = [
    {
      text:"我是QM-01·战术后勤。告诉我你的目标，我会协助处理物资、配装和出售。",
      resolve:function(){ return byIds(["aiTrigger"]); }
    },
    {
      text:"在这里输入需求，例如：帮我卖掉所有蓝色物品。也可以使用语音或快捷指令。",
      enter:function(){ ensureAssistantOpen(); },
      resolve:function(){ return byIds(["cmdInput","sendBtn"]); }
    },
    {
      text:"提交需求后，先核对物品、操作范围与收益。涉及出售时，需要你确认后才执行。",
      resolve:function(){
        var pv = byId("previewBar");
        if(visible(pv)) return [pv];
        var chat = byId("chat");
        return (chat && visible(chat)) ? [chat] : [];
      }
    },
    {
      text:"你仍可手动拖拽物品、调整装备。需要帮助时，可从“使用指引”重新查看。",
      resolve:function(){ return byIds(["charPanel","contextPanel"]); }
    }
  ];

  function build(){
    overlay = document.createElement("div");
    overlay.className = "qm-guide-overlay";
    document.body.appendChild(overlay);

    card = document.createElement("div");
    card.className = "qm-guide-card";
    card.setAttribute("role","dialog");
    card.setAttribute("aria-label","新手引导");
    document.body.appendChild(card);
  }

  function clearRings(){
    rings.forEach(function(r){ if(r.parentNode) r.parentNode.removeChild(r); });
    rings = [];
  }

  function placeRings(targets){
    targets.forEach(function(t, i){
      var ring = rings[i];
      if(!ring) return;
      var r = t.getBoundingClientRect();
      var pad = 4;
      ring.style.left = (r.left - pad) + "px";
      ring.style.top  = (r.top  - pad) + "px";
      ring.style.width  = (r.width  + pad*2) + "px";
      ring.style.height = (r.height + pad*2) + "px";
    });
  }

  function placeCard(tr){
    var vw = window.innerWidth, vh = window.innerHeight;
    var W = 300, gap = 16, m = 8;
    var h = card.offsetHeight || 200;
    var left, top;
    if(tr.right + gap + W <= vw - m){ left = tr.right + gap; }
    else if(tr.left - gap - W >= m){ left = tr.left - gap - W; }
    else { left = Math.max(m, Math.min(vw - W - m, tr.left)); }
    top = tr.top;
    if(top + h > vh - m){ top = Math.max(m, vh - h - m); }
    if(top < m){ top = m; }
    card.style.left = left + "px";
    card.style.top  = top + "px";
  }

  function centerCard(){
    var vw = window.innerWidth, vh = window.innerHeight;
    var h = card.offsetHeight || 200;
    card.style.left = Math.max(8, (vw - 300) / 2) + "px";
    card.style.top  = Math.max(24, (vh - h) / 2) + "px";
  }

  function render(){
    var s = STEPS[step];
    clearRings();

    var targets = (s.resolve ? s.resolve() : []).filter(visible);

    card.innerHTML = "";

    var stepEl = document.createElement("div");
    stepEl.className = "qm-guide-step";
    stepEl.textContent = "步骤 " + (step+1) + " / " + STEPS.length;
    card.appendChild(stepEl);

    var textEl = document.createElement("div");
    textEl.className = "qm-guide-text";
    textEl.textContent = s.text;
    card.appendChild(textEl);

    if(!targets.length){
      var dg = document.createElement("div");
      dg.className = "qm-guide-degrade";
      dg.textContent = "当前区域暂不可见，已改为居中说明。";
      card.appendChild(dg);
    }

    var actions = document.createElement("div");
    actions.className = "qm-guide-actions";
    var skipBtn = document.createElement("button");
    skipBtn.type = "button"; skipBtn.className = "qm-guide-btn qm-guide-skip"; skipBtn.textContent = "跳过";
    skipBtn.addEventListener("click", skip);
    var nav = document.createElement("div");
    nav.className = "qm-guide-nav";
    var prevBtn = document.createElement("button");
    prevBtn.type = "button"; prevBtn.className = "qm-guide-btn"; prevBtn.textContent = "上一步";
    prevBtn.disabled = (step === 0);
    prevBtn.addEventListener("click", prev);
    var nextBtn = document.createElement("button");
    nextBtn.type = "button"; nextBtn.className = "qm-guide-btn primary";
    nextBtn.textContent = (step === STEPS.length - 1) ? "开始体验" : "下一步";
    nextBtn.addEventListener("click", next);
    nav.appendChild(prevBtn); nav.appendChild(nextBtn);
    actions.appendChild(skipBtn); actions.appendChild(nav);
    card.appendChild(actions);

    targets.forEach(function(){
      var ring = document.createElement("div");
      ring.className = "qm-guide-ring";
      document.body.appendChild(ring);
      rings.push(ring);
    });

    if(targets.length){
      placeRings(targets);
      placeCard(targets[0].getBoundingClientRect());
    } else {
      centerCard();
    }

    nextBtn.focus();
  }

  function go(n){
    if(n < 0 || n >= STEPS.length) return;
    step = n;
    if(STEPS[step].enter) STEPS[step].enter();
    render();
  }
  function next(){ if(step === STEPS.length - 1){ finish(); } else { go(step + 1); } }
  function prev(){ go(step - 1); }

  function reposition(){
    if(!active) return;
    var s = STEPS[step];
    var targets = (s.resolve ? s.resolve() : []).filter(visible);
    if(targets.length){
      placeRings(targets);
      placeCard(targets[0].getBoundingClientRect());
    } else {
      centerCard();
    }
  }

  function onKey(e){
    if(!active) return;
    if(e.key === "Escape"){ if(e.preventDefault) e.preventDefault(); if(e.stopPropagation) e.stopPropagation(); skip(); return; }
    if(!card || !card.contains(e.target)){
      if(e.preventDefault) e.preventDefault();
      if(e.stopPropagation) e.stopPropagation();
      return;
    }
    if(e.key === "Tab"){
      var btns = card.querySelectorAll("button:not([disabled])");
      if(!btns.length) return;
      var first = btns[0], last = btns[btns.length - 1];
      if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    }
  }

  function start(){
    if(active) return;
    active = true;
    step = 0;
    build();
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", reposition, { passive:true });
    window.addEventListener("scroll", reposition, { passive:true, capture:true });
    render();
  }

  function cleanup(){
    active = false;
    if(overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    clearRings();
    if(card && card.parentNode) card.parentNode.removeChild(card);
    overlay = null; card = null; rings = [];
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", reposition);
    window.removeEventListener("scroll", reposition, true);
  }

  function skip(){ cleanup(); }

  function finish(){
    cleanup();
    ensureAssistantOpen();
    var inp = byId("cmdInput");
    if(inp){ try{ inp.focus(); }catch(e){} }
  }

  function bindEntry(){
    var e = byId("guideEntry");
    if(e) e.addEventListener("click", start);
  }

  function autoStart(){
    if(started) return;
    started = true;
    start();
  }

  function init(){
    bindEntry();
    if(document.readyState === "complete"){
      setTimeout(autoStart, 400);
    } else {
      window.addEventListener("load", function(){ setTimeout(autoStart, 400); });
    }
  }

  /* 供“使用指引”复用与测试的最小程序化入口 */
  window.QM01Guide = {
    start: start, skip: skip, finish: finish, next: next, prev: prev,
    step: function(){ return step; },
    text: function(){ return STEPS[step].text; },
    active: function(){ return active; },
    started: function(){ return started; },
    ringCount: function(){ return rings.length; },
    cardText: function(){ return card ? card.textContent : ""; },
    clean: function(){ return !overlay && !card && rings.length === 0; },
    keydown: onKey
  };

  init();
})();
