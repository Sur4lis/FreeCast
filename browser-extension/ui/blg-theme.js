/* BLG: bounded, disposable decoration. Playback and send handlers remain authoritative. */
(() => {
  'use strict';
  const root = document.documentElement;
  const get = id => document.getElementById(id);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const words = ['前方高能', '爷青回', '名场面', '稳住', '别立 flag', '狠狠期待', '冲', '不要慌'];
  const disposers = [], timers = new Set();
  let active = false, ambience, originalPlaceholder, originalLiveTitle;
  let driftTimer = 0, ranges = [];
  const make = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    node.dataset.blgInjected = '';
    return node;
  };
  function on(node, event, handler, options) {
    node.addEventListener(event, handler, options);
    disposers.push(() => node.removeEventListener(event, handler, options));
  }
  function watch(node, options, handler) {
    const observer = new MutationObserver(handler);
    observer.observe(node, options);
    disposers.push(() => observer.disconnect());
  }
  function later(fn, ms) {
    const id = setTimeout(() => { timers.delete(id); if (active) fn(); }, ms);
    timers.add(id);
    return id;
  }
  function cancel(id) { clearTimeout(id); timers.delete(id); }
  function paintRange(range) {
    const min = Number(range.min) || 0, max = range.max === '' ? 100 : Number(range.max);
    const progress = Math.max(0, Math.min(100, (Number(range.value) - min) / (max - min || 1) * 100));
    const value = progress.toFixed(2) + '%';
    if (range.style.getPropertyValue('--blg-progress') !== value) range.style.setProperty('--blg-progress', value);
  }
  function paintRanges() { if (active) ranges.forEach(paintRange); }
  const refreshRanges = () => queueMicrotask(paintRanges);
  function idleVisible() { return !document.hidden && !get('placeholder').hidden && !reduced.matches; }
  function drift() {
    driftTimer = 0;
    if (!active || !idleVisible()) return;
    if (ambience.querySelectorAll('.blg-dm').length < 4) {
      const node = make('span', 'blg-dm', words[Math.floor(Math.random() * words.length)]);
      // The upper and lower bands leave the tutorial's text clear.
      node.style.top = (Math.random() > .5 ? 8 + Math.random() * 12 : 81 + Math.random() * 11) + '%';
      node.addEventListener('animationend', () => node.remove(), { once: true });
      ambience.append(node);
    }
    driftTimer = later(drift, 11000 + Math.random() * 5000);
  }
  function syncAmbience() {
    if (!active) return;
    const paused = !idleVisible();
    if (document.body.classList.contains('blg-ambience-paused') !== paused) document.body.classList.toggle('blg-ambience-paused', paused);
    if (paused) {
      cancel(driftTimer); driftTimer = 0;
      ambience.querySelectorAll('.blg-dm').forEach(node => node.remove());
    } else if (!driftTimer) driftTimer = later(drift, 5000);
  }
  function keydown(event) {
    if (event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (event.target.closest('input, textarea, select, button, a, [contenteditable], [role="button"], [role="menu"], dialog')) return;
    if (document.querySelector('dialog[open]') || !get('themeMenu').hidden) return;
    const key = event.key.toLowerCase();
    if (key === 'b' && !get('returnLive').disabled) { event.preventDefault(); get('returnLive').click(); }
  }
  function enable() {
    if (active) return;
    active = true;
    ranges = [...document.querySelectorAll('input[type="range"]')];
    paintRanges();
    ambience = make('div'); ambience.id = 'blg-ambience'; ambience.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 18; i++) {
      const flake = make('i', 'blg-snowflake');
      flake.style.left = (i * 5.7) + '%';
      flake.style.setProperty('--blg-fall-time', (28 + i % 7 * 4) + 's');
      flake.style.setProperty('--blg-fall-delay', (-i * 3.7) + 's');
      if (i % 3) flake.style.width = flake.style.height = '3px';
      ambience.append(flake);
    }
    get('placeholder').prepend(ambience);
    const resize = new ResizeObserver(entries => {
      ambience.style.setProperty('--blg-fall-distance', (entries[0].contentRect.height + 20) + 'px');
    });
    resize.observe(get('placeholder')); disposers.push(() => resize.disconnect());
    const chatInput = get('chatText'); originalPlaceholder = chatInput.placeholder;
    chatInput.placeholder = '发条弹幕，一起冲';
    const live = get('returnLive'); originalLiveTitle = live.getAttribute('title'); live.title = '回到直播 · B 键';
    on(live, 'click', () => {
      live.classList.add('blg-recall');
      later(() => live.classList.remove('blg-recall'), 650);
    });
    on(document, 'input', refreshRanges);
    on(document, 'change', refreshRanges);
    on(document, 'click', event => {
      if (event.target.closest('[data-step], #reset, #resetDanmakuStyle, #miniCropReset')) refreshRanges();
    });
    on(document, 'keydown', keydown);
    on(document, 'visibilitychange', syncAmbience);
    on(reduced, 'change', syncAmbience);
    watch(get('placeholder'), { attributes: true, attributeFilter: ['hidden'] }, syncAmbience);
    watch(get('replayPosition'), { attributes: true, attributeFilter: ['min', 'max', 'disabled'] }, () => paintRange(get('replayPosition')));
    let previousFeedback = get('sendStatus').textContent;
    watch(get('sendStatus'), { childList: true, characterData: true, subtree: true }, () => {
      const text = get('sendStatus').textContent;
      if (text !== previousFeedback && text.startsWith('已发送到 ')) {
        get('sendChat').classList.add('blg-pinging');
        later(() => get('sendChat').classList.remove('blg-pinging'), 700);
      }
      previousFeedback = text;
    });
    syncAmbience();
  }
  function disable() {
    if (!active) return;
    active = false;
    disposers.splice(0).forEach(dispose => dispose());
    timers.forEach(clearTimeout); timers.clear(); driftTimer = 0;
    document.querySelectorAll('[data-blg-injected]').forEach(node => node.remove());
    ranges.forEach(range => range.style.removeProperty('--blg-progress')); ranges = [];
    document.body.classList.remove('blg-ambience-paused');
    get('returnLive').classList.remove('blg-recall'); get('sendChat').classList.remove('blg-pinging');
    if (originalLiveTitle === null) get('returnLive').removeAttribute('title'); else get('returnLive').title = originalLiveTitle;
    if (get('chatText').placeholder === '发条弹幕，一起冲') get('chatText').placeholder = originalPlaceholder;
  }
  const sync = () => root.dataset.theme === 'bluepink' ? enable() : disable();
  window.addEventListener('freecast-theme-change', sync);
  window.addEventListener('pagehide', disable);
  window.addEventListener('pageshow', sync);
  sync();
})();
