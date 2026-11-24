/* ============================================================
 * ui-sfx.js — 轻量 UI 音效（纯展示层，无依赖、不调 LLM）
 *  - 优先用 Web Audio API 合成短促低音量电子音（项目无音频素材，不下载）。
 *  - 首次用户交互（pointerdown/keydown）后才初始化/恢复 AudioContext；
 *    自动打开新手引导、普通 render、拖拽移动均不发声。
 *  - 音效映射：click 轻点击 / confirm 转移成功 / complete 业务执行成功 / warn 失败拦截。
 *  - 不重写现有点击/拖拽逻辑；失败静默降级，绝不阻断原功能。
 * ============================================================ */
(function () {
  "use strict";

  var enabled = true;          // 内存态，不持久化
  var ctx = null, master = null;
  var THROTTLE_MS = 100;
  var lastAt = {};

  function ts(){
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  function ensureCtx(){
    if(ctx){
      if(ctx.state === "suspended"){ try{ ctx.resume(); }catch(e){} }
      return ctx;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return null;
    try{
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.15;                 // 总音量约 15%
      master.connect(ctx.destination);
    }catch(e){ ctx = null; master = null; return null; }
    return ctx;
  }

  /* 短促、低音量；单次 30–200ms；节点播放后释放 */
  function tone(name, type, freq, durMs){
    if(!enabled || !ctx || !master) return;
    var t = ts();
    if(lastAt[name] && (t - lastAt[name]) < THROTTLE_MS) return;   // 同动作去重 + 快速连点节流
    lastAt[name] = t;
    try{
      var start = ctx.currentTime;
      var dur = Math.max(30, Math.min(200, durMs)) / 1000;
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.45, start + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(g); g.connect(master);
      osc.start(start); osc.stop(start + dur + 0.02);
      osc.onended = function(){ try{ osc.disconnect(); g.disconnect(); }catch(e){} };
    }catch(e){ /* 播放失败静默降级 */ }
  }

  var API = {
    click:    function(){ tone("click", "square", 700, 40); },
    confirm:  function(){ tone("confirm", "sine", 880, 90); },
    complete: function(){ tone("complete", "sine", 1046, 140); },
    warn:     function(){ tone("warn", "triangle", 240, 160); },
    isEnabled: function(){ return enabled; },
    setEnabled: function(v){ enabled = !!v; },
    toggle: function(){ enabled = !enabled; if(enabled) this.click(); return enabled; },
    _ensureCtx: ensureCtx,
    _ctx: function(){ return ctx; }
  };

  /* 首次用户交互才初始化/恢复（点击/按键）；自动引导不触发 */
  function firstInteraction(){
    ensureCtx();
    document.removeEventListener("pointerdown", firstInteraction, true);
    document.removeEventListener("keydown", firstInteraction, true);
  }
  document.addEventListener("pointerdown", firstInteraction, true);
  document.addEventListener("keydown", firstInteraction, true);

  /* 事件委托：按钮/页签点击 → 轻点击音（不重复绑定、不重写原逻辑） */
  document.addEventListener("click", function (e){
    if(!enabled || !ctx) return;
    var el = e.target;
    if(!el || !el.closest) return;
    if(el.closest("#sfxToggle")) return;   // 开关自身由 toggle 处理，避免双击
    var btn = el.closest("button, .cat-btn, .mk-tab, .script-btn, .disambig-btn");
    if(btn && !btn.disabled) API.click();
  }, true);

  /* 头部“音效：开/关”按钮（仅控制音效，不影响语音识别；内存态） */
  function bindToggle(){
    var b = document.getElementById("sfxToggle");
    if(!b) return;
    b.style.cursor = "pointer";
    b.style.background = "none";
    b.style.border = "1px solid var(--line)";
    b.style.color = "var(--text-dim)";
    b.style.borderRadius = "var(--radius)";
    b.style.padding = "4px 10px";
    b.style.fontSize = "12px";
    function refresh(){
      b.textContent = "音效：" + (enabled ? "开" : "关");
      b.style.opacity = enabled ? "1" : ".55";
    }
    b.addEventListener("click", function(){ API.toggle(); refresh(); });
    refresh();
  }
  bindToggle();

  window.UISFX = API;
})();
