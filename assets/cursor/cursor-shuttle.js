/* My Style 展开区：会转向的羽毛球鼠标。
   只在 (hover:hover) and (pointer:fine) 设备启用；不拦截任何点击；只改 transform。
   初始化成功后给 <html> 加 cursor-shuttle-ready；鼠标在生效范围内时再加 cursor-shuttle-active，
   cursor.css 据此隐藏系统鼠标。本脚本没运行时，cursor.css 里的三张 PNG 规则照常兜底。 */
(function(){
  'use strict';
  if(!window.matchMedia || !window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;
  if(!window.requestAnimationFrame) return;

  var SIZE = 32;                         /* 显示尺寸 px */
  var K = SIZE / 56;                     /* viewBox 56 → 显示尺寸 */
  var TIP_X = 28 * K, TIP_Y = 45 * K;    /* 球头尖端：对准真实鼠标坐标，也是旋转和缩放中心 */
  var INIT_DEG = 35;                     /* 初始角度：沿用气泡图标的倾斜（球头朝左下）。PNG 朝向不同就改这里 */
  var EASE = 0.2;                        /* 每帧向目标角度靠近的比例 */
  var MIN_MOVE = 4;                      /* 两次采样移动不足 4px 不更新目标角度 */
  var HOVER_SCALE = 1.2, PRESS_SCALE = 0.85;
  var CLICKABLE = '.ip-bubble-hit, #acv-style-toggle, #acv-ip-collapse a, #acv-ip-collapse button, #acv-ip-collapse [role="button"]';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var root = document.documentElement;
  var PATHS = ['M21 38a7 7 0 0 0 14 0Z','M22 38 15 14 M28 38V12 M34 38 41 14','M15 14q13-5 26 0','M18.5 26q9.5-3.5 19 0'];
  var d = PATHS.join(' ');
  var lineW = (1.7 / K).toFixed(2), haloW = (4 / K).toFixed(2);

  var el = document.createElement('div');
  el.id = 'cursor-shuttle';
  el.setAttribute('aria-hidden','true');
  el.style.cssText = 'position:fixed;left:0;top:0;width:'+SIZE+'px;height:'+SIZE+'px;z-index:80;pointer-events:none;' +
    'visibility:hidden;will-change:transform;transform-origin:'+TIP_X+'px '+TIP_Y+'px;contain:layout style;';
  el.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56" width="'+SIZE+'" height="'+SIZE+'" focusable="false" ' +
    'style="display:block;overflow:visible;pointer-events:none;transform-origin:'+TIP_X+'px '+TIP_Y+'px;transition:transform .15s ease" ' +
    'fill="none" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="'+d+'" stroke="rgba(8,8,7,.55)" stroke-width="'+haloW+'"/>' +
    '<path d="'+d+'" stroke="#fff7ee" stroke-width="'+lineW+'"/></svg>';
  var svg = el.firstChild;

  var x = 0, y = 0, hasPoint = false;
  var sampleX = 0, sampleY = 0, hasSample = false;
  var angle = INIT_DEG, target = INIT_DEG;
  var visible = false, raf = 0, hovering = false, pressing = false, lastScale = 1;

  function inRange(){
    if(!hasPoint) return false;
    if((location.hash.replace('#','') || 'home') !== 'about') return false;
    var dlg = document.getElementById('wechat-dialog');
    if(dlg && dlg.open) return false;
    var hero = document.getElementById('ip-hero');
    var toggle = document.getElementById('acv-style-toggle');
    if(!hero || !toggle || !hero.classList.contains('is-open')) return false;
    var top = toggle.getBoundingClientRect().top;
    var bottom = hero.getBoundingClientRect().bottom;   /* 展开区（IP）底部，含缩放 */
    return y >= top && y <= bottom && x >= 0 && x <= window.innerWidth;
  }
  function applyScale(){
    var s = pressing ? PRESS_SCALE : (hovering ? HOVER_SCALE : 1);
    if(s !== lastScale){ lastScale = s; svg.style.transform = s === 1 ? '' : 'scale('+s+')'; }
  }
  function draw(){
    el.style.transform = 'translate3d('+(x - TIP_X)+'px,'+(y - TIP_Y)+'px,0) rotate('+angle.toFixed(2)+'deg)';
  }
  function frame(){
    raf = 0;
    if(!visible) return;
    if(reduced.matches){ angle = target = INIT_DEG; }
    else {
      var diff = ((target - angle) % 360 + 540) % 360 - 180;   /* 最短旋转方向 */
      if(Math.abs(diff) < 0.05) angle = target; else angle += diff * EASE;
    }
    draw();
    raf = requestAnimationFrame(frame);
  }
  function show(){
    if(visible) return;
    visible = true;
    hasSample = false;
    el.style.visibility = 'visible';
    root.classList.add('cursor-shuttle-active');
    if(!raf) raf = requestAnimationFrame(frame);
  }
  function hide(){
    if(!visible) return;
    visible = false;
    hovering = pressing = false;
    applyScale();
    el.style.visibility = 'hidden';
    root.classList.remove('cursor-shuttle-active');
    if(raf){ cancelAnimationFrame(raf); raf = 0; }
  }
  function refresh(){ if(inRange()) show(); else hide(); }

  function onMove(e){
    if(e.pointerType && e.pointerType !== 'mouse'){ hide(); return; }
    x = e.clientX; y = e.clientY; hasPoint = true;
    refresh();
    if(!visible) return;
    var t = e.target;
    hovering = !!(t && t.closest && t.closest(CLICKABLE));
    applyScale();
    if(!hasSample){ sampleX = x; sampleY = y; hasSample = true; return; }
    var dx = x - sampleX, dy = y - sampleY;
    if(dx*dx + dy*dy >= MIN_MOVE*MIN_MOVE){
      /* 未旋转时球头朝下（屏幕 +y）；让球头指向移动方向、羽毛在后 */
      target = Math.atan2(dy, dx) * 180 / Math.PI - 90;
      sampleX = x; sampleY = y;
    }
  }
  function onDown(e){ if(!visible || (e.pointerType && e.pointerType !== 'mouse')) return; pressing = true; applyScale(); }
  function onUp(){
    if(pressing){ pressing = false; applyScale(); }
    /* 点击可能刚好收起/展开 My Style 或打开弹窗，下一帧重新判断范围 */
    requestAnimationFrame(refresh);
  }

  function init(){
    if(!document.body) return;
    document.body.appendChild(el);
    document.addEventListener('pointermove', onMove, {passive:true});
    document.addEventListener('pointerdown', onDown, {passive:true});
    document.addEventListener('pointerup', onUp, {passive:true});
    document.addEventListener('pointercancel', onUp, {passive:true});
    document.addEventListener('click', function(){ requestAnimationFrame(refresh); setTimeout(refresh, 450); }, {passive:true});
    document.addEventListener('mouseleave', hide);
    document.addEventListener('visibilitychange', function(){ if(document.hidden) hide(); });
    window.addEventListener('blur', hide);
    window.addEventListener('scroll', refresh, {passive:true});
    window.addEventListener('resize', refresh, {passive:true});
    window.addEventListener('hashchange', function(){ hide(); });
    root.classList.add('cursor-shuttle-ready');
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* ===== [MS-COLLECT] My Style 气泡收集进度（独立代码块，开始） =====
   与上面的羽毛球鼠标互不依赖；手机也运行。状态只在内存里，刷新即重置。 */
(function(){
  'use strict';
  var HOLD = 400;
  var seen = new Set();
  var timers = new Map();
  var queued = false;
  function bubbles(){ return Array.prototype.slice.call(document.querySelectorAll('#ip-hero .ip-bubble')); }
  function keyOf(el, list){
    return el.id || el.getAttribute('data-id') || ('i' + (list || bubbles()).indexOf(el));
  }
  function sync(){
    queued = false;
    var hero = document.getElementById('ip-hero');
    if(!hero) return;
    var list = bubbles();
    var total = list.length;
    var live = new Set();
    list.forEach(function(el){
      var k = keyOf(el, list);
      live.add(k);
      if(seen.has(k)){
        if(!el.classList.contains('ms-seen')) el.classList.add('ms-seen');
      }else if(el.classList.contains('open')){
        if(!timers.has(k)){
          timers.set(k, setTimeout(function(){
            timers.delete(k);
            var cur = bubbles().filter(function(b){ return keyOf(b) === k; })[0];
            if(cur && cur.classList.contains('open')){ seen.add(k); schedule(); }
          }, HOLD));
        }
      }else if(timers.has(k)){
        clearTimeout(timers.get(k)); timers.delete(k);
      }
    });
    timers.forEach(function(t, k){ if(!live.has(k)){ clearTimeout(t); timers.delete(k); } });
    if(!total) return;
    var line = hero.querySelector(':scope > .ms-collect');
    if(!line){
      line = document.createElement('button');
      line.type = 'button';
      line.className = 'ms-collect';
      line.setAttribute('aria-live', 'polite');
      hero.appendChild(line);
    }
    var n = 0;
    live.forEach(function(k){ if(seen.has(k)) n++; });
    var done = n >= total;
    var txt = done ? (total + '/' + total + ' \u00b7 看起来高冷其实是装的，＋我别逼我跪下来求你') : (n + '/' + total);
    if(line.textContent !== txt) line.textContent = txt;
    if(line.classList.contains('is-done') !== done) line.classList.toggle('is-done', done);
    if(line.disabled === done) line.disabled = !done;
  }
  function schedule(){
    if(queued) return;
    queued = true;
    setTimeout(sync, 0);
  }
  function start(){
    new MutationObserver(schedule).observe(document.body, {
      childList:true, subtree:true, attributes:true, attributeFilter:['class']
    });
    document.addEventListener('click', function(e){
      var t = e.target && e.target.closest ? e.target.closest('.ms-collect.is-done') : null;
      if(!t) return;
      var target = document.querySelector('.about-cv .acv-connect');
      if(!target) return;
      var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      try{ target.scrollIntoView({ block:'start', behavior: reduced ? 'auto' : 'smooth' }); }
      catch(err){ target.scrollIntoView(true); }
    });
    schedule();
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
/* ===== [MS-COLLECT] 结束 ===== */

/* ===== [MS-HIT] My Style 气泡击球反馈（独立代码块，开始） =====
   只在 hover:hover + pointer:fine 设备启用；位移用独立的 translate 属性加在 .ip-bubble-icon-core 上，
   由 Web Animations 播放，结束后自动清除，不留内联样式。不支持 translate 或减少动态效果时不生效。 */
(function(){
  'use strict';
  if(!window.matchMedia || !window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;
  if(!window.CSS || !CSS.supports || !CSS.supports('translate', '1px 1px')) return;
  if(!Element.prototype.animate) return;
  var DIST = 10, OUT_MS = 70, BACK_MS = 350, WINDOW_MS = 250, MIN_MOVE = 4;
  var trail = [];
  var playing = new WeakMap();
  document.addEventListener('mousemove', function(e){
    trail.push({ x:e.clientX, y:e.clientY, t:performance.now() });
    if(trail.length > 16) trail.shift();
  }, { passive:true });
  document.addEventListener('pointerdown', function(e){
    if(e.pointerType && e.pointerType !== 'mouse') return;
    if(e.button) return;
    var hit = e.target && e.target.closest ? e.target.closest('#ip-hero.is-open .ip-bubble-hit') : null;
    if(!hit) return;
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var core = hit.querySelector('.ip-bubble-icon-core');
    if(!core) return;
    var now = performance.now(), dx = 0, dy = 0, i;
    var last = trail[trail.length - 1];
    if(last && now - last.t <= WINDOW_MS){
      for(i = trail.length - 1; i >= 0; i--){
        if(now - trail[i].t > WINDOW_MS) break;
        var sx = e.clientX - trail[i].x, sy = e.clientY - trail[i].y;
        if(Math.sqrt(sx*sx + sy*sy) >= 8){ dx = sx; dy = sy; break; }
      }
    }
    if(Math.sqrt(dx*dx + dy*dy) < MIN_MOVE){
      var r = core.getBoundingClientRect();
      dx = (r.left + r.width/2) - e.clientX;
      dy = (r.top + r.height/2) - e.clientY;
    }
    var len = Math.sqrt(dx*dx + dy*dy);
    if(len < 0.5){ dx = 0; dy = -1; len = 1; }
    var hero = document.getElementById('ip-hero');
    var scale = hero && hero.offsetWidth ? (hero.getBoundingClientRect().width / hero.offsetWidth) || 1 : 1;
    var k = DIST / len / scale;
    var ox = dx * k, oy = dy * k;
    var total = OUT_MS + BACK_MS;
    var prev = playing.get(core);
    if(prev){ try{ prev.cancel(); }catch(err){} }
    try{
      var anim = core.animate([
        { translate:'0px 0px', offset:0, easing:'cubic-bezier(.2,.8,.3,1)' },
        { translate:ox.toFixed(2)+'px '+oy.toFixed(2)+'px', offset:OUT_MS/total, easing:'cubic-bezier(.3,0,.3,1)' },
        { translate:(-ox*0.22).toFixed(2)+'px '+(-oy*0.22).toFixed(2)+'px', offset:0.68, easing:'ease-out' },
        { translate:'0px 0px', offset:1 }
      ], { duration:total, fill:'none' });
      playing.set(core, anim);
    }catch(err){}
  }, true);
})();
/* ===== [MS-HIT] 结束 ===== */

/* ===== [MS-RALLY] 羽毛球气泡「对拍」彩蛋（独立代码块，开始） =====
   只在 hover:hover + pointer:fine 设备启用。目标气泡取 PROFILE.personaBubbles 里 icon 为 shuttle 的那个。 */
(function(){
  'use strict';
  if(!window.matchMedia || !window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;
  var GAP = 1500, GOAL = 5, FADE = 600, SPIN = 400;
  var count = 0, lastAt = 0, label = null;
  function targetId(){
    try{
      if(typeof PROFILE !== 'undefined' && PROFILE && PROFILE.personaBubbles){
        for(var i = 0; i < PROFILE.personaBubbles.length; i++){
          if(PROFILE.personaBubbles[i].icon === 'shuttle') return PROFILE.personaBubbles[i].id;
        }
      }
    }catch(err){}
    return 'ipb-05';
  }
  function reduced(){ return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function show(n, hit){
    if(label && label.parentNode) label.parentNode.removeChild(label);
    var ref = hit.querySelector('.ip-bubble-icon-core') || hit;
    var r = ref.getBoundingClientRect();
    var el = document.createElement('span');
    el.className = 'ms-rally';
    el.setAttribute('aria-hidden', 'true');
    el.textContent = '\u00d7' + n;
    el.style.left = Math.round(r.right - 6) + 'px';
    el.style.top = Math.round(r.top - 8) + 'px';
    document.body.appendChild(el);
    label = el;
    var done = function(){ if(el.parentNode) el.parentNode.removeChild(el); if(label === el) label = null; };
    if(el.animate){
      var rise = reduced() ? '0px 0px' : '0px -6px';
      var a = el.animate([
        { opacity:1, translate:'0px 0px', offset:0 },
        { opacity:1, offset:0.45 },
        { opacity:0, translate:rise, offset:1 }
      ], { duration:FADE, easing:'ease-out', fill:'forwards' });
      a.onfinish = done; a.oncancel = done;
    }
    setTimeout(done, FADE + 200);
  }
  function spin(){
    if(reduced()) return;
    var svg = document.querySelector('#cursor-shuttle svg');
    if(!svg || !svg.animate || !window.CSS || !CSS.supports || !CSS.supports('rotate', '1deg')) return;
    try{ svg.animate([{ rotate:'0deg' }, { rotate:'360deg' }], { duration:SPIN, easing:'cubic-bezier(.3,.1,.2,1)', fill:'none' }); }catch(err){}
  }
  document.addEventListener('click', function(e){
    var hit = e.target && e.target.closest ? e.target.closest('#ip-hero.is-open .ip-bubble-hit') : null;
    if(!hit) return;
    var bubble = hit.closest('.ip-bubble');
    if(!bubble || bubble.id !== targetId()) return;
    var now = performance.now();
    if(now - lastAt > GAP) count = 0;
    lastAt = now;
    count++;
    show(count, hit);
    if(count >= GOAL){
      count = 0; lastAt = 0;
      spin();
      try{ if(typeof window.toast === 'function') window.toast('好球！'); }catch(err){}
    }
  });
  window.addEventListener('hashchange', function(){
    count = 0; lastAt = 0;
    if(label && label.parentNode) label.parentNode.removeChild(label);
    label = null;
  });
})();
/* ===== [MS-RALLY] 结束 ===== */
