/* Local, dependency-free project detail rendering and media lifecycle.
 * No third-party source copied. The upstream tool response was oversized; source size and functions were not inspected.
 */
window.ProjectDetails = (() => {
  'use strict';
  const projects = window.PORTFOLIO_PROJECTS;
  const snapshots = new Map();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let active = null;
  let returnSource = null;
  let cleanup = null;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const sourceOf = value => value === 'ai' ? 'ai' : 'xr';
  function localAsset(value) {
    return typeof value === 'string' && /^assets\/[a-zA-Z0-9_./ -]+\.(?:png|jpe?g|webp|avif|mp4|webm)$/i.test(value) && !/(?:\.\.|[\\?#])/.test(value) ? value : '';
  }
  function match(hash) {
    const raw = hash.replace(/^#/, '');
    if (!raw.startsWith('project/')) return null;
    const [path, query = ''] = raw.split('?');
    return { id: path.slice('project/'.length), source: sourceOf(new URLSearchParams(query).get('source')) };
  }
  function href(id, source) {
    return '#project/' + encodeURIComponent(id) + '?source=' + sourceOf(source);
  }
  function image(item, eager = false) {
    const src = localAsset(item.src);
    if (!src) return '';
    const dimensions = Number.isInteger(item.width) && Number.isInteger(item.height) && item.width > 0 && item.height > 0
      ? ' width="' + item.width + '" height="' + item.height + '"' : '';
    return '<figure class="project-detail__figure"><button type="button" class="project-detail__zoom" data-detail-zoom aria-label="放大：' + escape(item.alt) + '">' +
      '<img src="' + escape(src) + '" alt="' + escape(item.alt) + '"' + dimensions + ' loading="' + (eager ? 'eager' : 'lazy') + '" decoding="async"' + (eager ? ' fetchpriority="high"' : '') + '>' +
      '<span class="project-detail__zoom-label" aria-hidden="true">放大查看 ↗</span></button>' +
      (item.caption ? '<figcaption>' + escape(item.caption) + '</figcaption>' : '') + '</figure>';
  }
  function media(block, eager = false) {
    if (!block) return '';
    if (block.kind === 'video') {
      const src = localAsset(block.src), poster = localAsset(block.poster);
      if (!src || !poster) return '';
      const dimensions = Number.isInteger(block.width) && Number.isInteger(block.height) ? ' width="' + block.width + '" height="' + block.height + '"' : '';
      return '<figure class="project-detail__video"><video poster="' + escape(poster) + '" preload="none" playsinline' + dimensions + ' data-detail-video="' + escape(src) + '" aria-label="' + escape(block.alt || '项目演示视频') + '"></video><button type="button" class="project-detail__video-start">播放视频</button>' +
        (block.caption ? '<figcaption>' + escape(block.caption) + '</figcaption>' : '') + '</figure>';
    }
    const items = (block.images || []).filter(item => localAsset(item.src));
    if (!items.length) return '';
    const kind = ['full', 'paired', 'split', 'original'].includes(block.kind) ? block.kind : 'original';
    return '<div class="project-detail__media project-detail__media--' + kind + '">' + items.map(item => image(item, eager)).join('') + '</div>';
  }
  function copy(title, text, level = 2) {
    if (!title && !text) return '';
    return '<div class="project-detail__copy">' + (title ? '<h' + level + '>' + escape(title) + '</h' + level + '>' : '') + (text ? '<p>' + escape(text) + '</p>' : '') + '</div>';
  }
  function section(block) {
    if (!block || (!block.text && !block.media)) return '';
    const split = block.media?.kind === 'split';
    return '<section class="project-detail__section' + (split ? ' project-detail__section--split' : '') + '" data-detail-reveal>' +
      copy(block.title, block.text) + media(block.media) +
      (block.note ? '<p class="project-detail__note">' + escape(block.note) + '</p>' : '') + '</section>';
  }
  function renderModules(project) {
    const allowed = new Set(['background', 'designs', 'outcome']);
    return (project.moduleOrder || []).filter(key => allowed.has(key)).map(key => {
      if (key !== 'designs') return section(project[key]);
      if (!project.designs?.length) return '';
      return '<section class="project-detail__section project-detail__designs" data-detail-reveal><h2>关键设计</h2>' + project.designs.map(block => '<div class="project-detail__design">' + copy(block.title, block.text, 3) + media(block.media) + '</div>').join('') + '</section>';
    }).join('');
  }
  function render(project, source) {
    const meta = (project.metadata || []).filter(item => item.value);
    const next = project.nextProjectId && project.nextProjectId !== project.projectId && projects[project.nextProjectId];
    return '<article class="project-detail" aria-labelledby="project-detail-title">' +
      '<header class="project-detail__header"><p class="project-detail__category">' + escape(project.category) + '</p><h1 id="project-detail-title" tabindex="-1">' + escape(project.title) + '</h1></header>' +
      media(project.hero, true) +
      (project.summary ? '<p class="project-detail__summary">' + escape(project.summary) + '</p>' : '') +
      (meta.length ? '<dl class="project-detail__metadata">' + meta.map(item => '<div><dt>' + escape(item.label) + '</dt><dd>' + escape(item.value) + '</dd></div>').join('') + '</dl>' : '') +
      renderModules(project) +
      '<footer class="project-detail__footer"><a data-detail-back href="#' + source + '">← 返回' + (source === 'ai' ? ' AI 应用与创作' : '沉浸交互与游戏') + '</a>' +
      (next ? '<a data-detail-next href="' + href(next.projectId, source) + '">下一个项目：' + escape(next.title) + ' →</a>' : '') +
      '<a href="#about">联系我 ↗</a></footer>' +
      '<dialog class="project-detail__dialog" aria-label="项目图片放大查看"><button type="button" class="project-detail__dialog-close" aria-label="关闭放大图片">关闭 ×</button><img alt=""><p class="project-detail__dialog-caption"></p></dialog></article>';
  }
  function leave() {
    const list = document.querySelector('#view-page.active:not(.is-project-detail) .plist[data-category]');
    if (list && (list.dataset.category === 'xr' || list.dataset.category === 'ai')) {
      snapshots.set(list.dataset.category, { scroll: window.scrollY });
    }
    if (active) returnSource = active.source;
    if (cleanup) cleanup();
    cleanup = null;
    active = null;
  }
  function restoreList(category) {
    if (category !== returnSource) { returnSource = null; return; }
    returnSource = null;
    const saved = snapshots.get(category);
    requestAnimationFrame(() => {
      if (location.hash !== '#' + category) return;
      const row = document.querySelector('.plist[data-category="' + category + '"] [data-project-id="journal"]');
      if (row) row.focus({ preventScroll: true });
      window.scrollTo(0, saved?.scroll || 0);
    });
  }
  function mount(container, route, focusTitle = true) {
    active = route;
    const project = Object.prototype.hasOwnProperty.call(projects, route.id) ? projects[route.id] : null;
    if (!project) {
      container.innerHTML = '<article class="project-detail project-detail--missing"><h1 id="project-detail-title" tabindex="-1">暂未接入此项目</h1><p>请选择已接入的项目，或返回作品分类。</p><a data-detail-back href="#' + route.source + '">← 返回作品分类</a><a href="#home">返回目录</a></article>';
      if (focusTitle) container.querySelector('h1').focus({ preventScroll: true });
      return;
    }
    container.innerHTML = render(project, route.source);
    const root = container.querySelector('.project-detail');
    const events = new AbortController();
    const options = { signal: events.signal };
    const dialog = root.querySelector('dialog');
    const dialogImage = dialog.querySelector('img');
    let focusReturn = null, oldOverflow = '', observer = null;
    const videos = [...root.querySelectorAll('video')];
    const stopVideos = () => videos.forEach(video => { video.pause(); });
    function closeZoom() { if (dialog.open) dialog.close(); }
    function resetZoom() {
      document.body.style.overflow = oldOverflow;
      dialogImage.removeAttribute('src');
      if (focusReturn?.isConnected) focusReturn.focus({ preventScroll: true });
      focusReturn = null;
    }
    root.addEventListener('click', event => {
      const zoom = event.target.closest('[data-detail-zoom]');
      if (zoom && root.contains(zoom)) {
        const img = zoom.querySelector('img');
        if (!img.complete || !img.naturalWidth || dialog.open) return;
        stopVideos();
        focusReturn = zoom; oldOverflow = document.body.style.overflow;
        dialogImage.src = img.currentSrc || img.src; dialogImage.alt = img.alt;
        dialog.querySelector('.project-detail__dialog-caption').textContent = img.alt;
        dialog.showModal(); document.body.style.overflow = 'hidden';
        dialog.querySelector('button').focus();
      }
      if (event.target.closest('.project-detail__dialog-close')) closeZoom();
      const play = event.target.closest('.project-detail__video-start');
      if (play) {
        const video = play.previousElementSibling;
        stopVideos();
        if (!video.querySelector('source')) {
          const source = document.createElement('source');
          source.src = video.dataset.detailVideo;
          source.type = source.src.endsWith('.webm') ? 'video/webm' : 'video/mp4';
          video.appendChild(source); video.controls = true; video.load();
        }
        play.hidden = true;
        video.play().catch(() => { play.hidden = false; });
      }
    }, options);
    dialog.addEventListener('close', resetZoom, options);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeZoom(); }, options);
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeZoom();
    }, options);
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Tab') { event.preventDefault(); dialog.querySelector('button').focus(); }
    }, options);
    videos.forEach(video => video.addEventListener('play', () => { videos.forEach(other => { if (other !== video) other.pause(); }); }, options));
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopVideos(); }, options);
    root.querySelectorAll('[data-detail-zoom] img').forEach(img => img.addEventListener('error', () => {
      img.closest('button').disabled = true;
      img.closest('button').querySelector('.project-detail__zoom-label').textContent = '图片暂不可用';
    }, options));
    function removeReveal() {
      if (observer) observer.disconnect();
      root.querySelectorAll('[data-detail-reveal]').forEach(node => node.classList.remove('is-detail-pending'));
    }
    if (!motion.matches && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.remove('is-detail-pending');
          observer.unobserve(entry.target);
        });
      }, { threshold: 0.08 });
      root.querySelectorAll('[data-detail-reveal]').forEach(node => {
        if (node.getBoundingClientRect().top < window.innerHeight) return;
        node.classList.add('is-detail-pending'); observer.observe(node);
      });
    }
    motion.addEventListener('change', removeReveal, options);
    cleanup = () => {
      removeReveal();
      if (dialog.open) { closeZoom(); resetZoom(); }
      events.abort();
      videos.forEach(video => { video.pause(); video.replaceChildren(); video.removeAttribute('src'); video.load(); });
    };
    if (focusTitle) root.querySelector('h1').focus({ preventScroll: true });
  }
  window.addEventListener('pagehide', () => { if (cleanup) cleanup(); });
  return { match, href, mount, leave, restoreList };
})();
