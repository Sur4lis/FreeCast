(() => {
  'use strict';
  const keys = ['a', 'b'], defaults = () => ({ x: .1, y: .1, w: .8, h: .8 });
  const regions = { a: defaults(), b: defaults() };
  const status = $('autoSyncStatus'), dialog = $('autoSyncDialog');
  let session = null, undo = null, roomKey = '', draft = null;
  let mode = 'single', draftMode = mode, draftSource = '';
  const fullFrame = () => ({ x: 0, y: 0, w: 1, h: 1 });

  function say(text) { status.textContent = text; }
  function unavailable() {
    if (!running || demo || keys.some(key => !channels[key])) return '请先连接两路直播。';
    if (paused || window.replay?.active) return '请回到直播并继续播放，再自动对齐。';
    if (window.vocal?.active || window.vocal?.loading) return '当前自动对齐仅支持原声音轨，请先关闭 AI 音频处理。';
    if (document.hidden) return '请保持播放器页面在前台。';
    if (keys.some(key => {
      const c = channels[key], m = c.media;
      return c.error || c.closed || c.recovering || c.refreshing || m.paused || m.seeking || m.readyState < 3 || !m.videoWidth || !m.videoHeight;
    })) return '请等待两路画面稳定播放，再自动对齐。';
    return null;
  }
  function signature() {
    return JSON.stringify([generation, offset, $('base').value, pauseLag, getDelays(), mode,
      ...keys.map(key => [channels[key]?.loadRevision, channels[key]?.room.id, channels[key]?.media.videoWidth, channels[key]?.media.videoHeight]),
      Boolean(window.vocal?.active), Boolean(window.vocal?.ready)]);
  }
  function sourceSignature() {
    return JSON.stringify([generation, ...keys.map(key => [channels[key]?.loadRevision,
      channels[key]?.room.id, channels[key]?.media.videoWidth, channels[key]?.media.videoHeight])]);
  }
  function sourceSize(key) {
    const m = channels[key]?.media;
    return { width: m?.videoWidth || 1, height: m?.videoHeight || 1 };
  }
  // A single source-pixel rule is used by numeric edits, dragging and capture.
  // Eight rows retain tiny timer text; twelve columns avoid near-empty selections.
  function normalizeRegion(key, region) {
    const { width, height } = sourceSize(key);
    const w = clamp(Math.round(region.w * width), Math.min(12, width), width);
    const h = clamp(Math.round(region.h * height), Math.min(8, height), height);
    return { x: clamp(Math.round(region.x * width), 0, width - w) / width,
      y: clamp(Math.round(region.y * height), 0, height - h) / height, w: w / width, h: h / height };
  }
  function sampleSize(key, crop, currentMode) {
    // Keep small official clock glyphs intact while locating the A inset.
    const source = sourceSize(key), limit = key === 'b' && currentMode === 'single' ? 1920 : 256;
    const width = source.width * crop.w, height = source.height * crop.h;
    const scale = Math.min(1, limit / Math.max(width, height));
    return { width: Math.max(2, Math.round(width * scale)), height: Math.max(2, Math.round(height * scale)) };
  }
  function refreshRegions() {
    const next = JSON.stringify(keys.map(key => [channels[key]?.room.platform, channels[key]?.room.id]));
    if (next !== roomKey) { roomKey = next; for (const key of keys) regions[key] = defaults(); }
  }
  function finish(text) {
    const previous = session; session = null;
    if (previous) {
      clearInterval(previous.watchdog);
      previous.worker.terminate();
      for (const key of keys) {
        const handle = previous.callbacks[key];
        if (handle != null) previous.channels[key].media.cancelVideoFrameCallback?.(handle);
      }
    }
    $('autoSyncStart').disabled = false;
    $('autoSyncCancel').hidden = true;
    if (text) say(text);
  }
  function invalidate(text = '播放状态已改变，请重新自动对齐。') {
    if (session) finish(text);
    undo = null; $('autoSyncUndo').hidden = true;
  }
  function check(current) {
    if (session !== current) return false;
    const problem = unavailable();
    if (problem || current.signature !== signature() || keys.some(key => channels[key] !== current.channels[key])) {
      finish(problem || '播放设置或直播源已改变，请重新自动对齐。'); return false;
    }
    return true;
  }

  function bufferedTargets(targets) {
    return keys.every(key => {
      const ranges = channels[key].media.buffered, target = targets[key];
      for (let i = 0; i < ranges.length; i++) if (Number.isFinite(target) && target >= ranges.start(i) + .05 && target <= ranges.end(i) - .05) return true;
      return false;
    });
  }
  function anchorTargets(targets, now) {
    const delay = getDelays();
    for (const key of keys) {
      // Automatic alignment has an explicit pair of matching media targets.
      // Anchor both clocks so download bursts, pending manual steps and seek
      // settling cannot add a second adjustment to this calibration.
      Object.assign(channels[key].playout ||= {}, { started: true, target: targets[key], at: now,
        delay: delay[key], manualShift: 0, adjusting: true, settleUntil: now + 3000, driftAt: null });
    }
  }
  function apply(current, result) {
    if (!check(current)) return;
    const now = performance.now(), positions = Object.fromEntries(keys.map(key => [key, channels[key].media.currentTime]));
    const value = Math.round((offset + positions.a - positions.b - result.mediaDelta) * 10) / 10;
    if (!Number.isFinite(value) || Math.abs(value) > 60) { finish('匹配出的偏移超出 ±60 秒或直播时间轴不可用，未修改偏移。'); return; }
    const previousDelay = Sync.delays(offset, 0), nextDelay = Sync.delays(value, 0);
    const targets = Object.fromEntries(keys.map(key => [key, positions[key] - (nextDelay[key] - previousDelay[key])]));
    if (!bufferedTargets(targets)) { say('已找到一致画面，正在等待足够的直播缓冲…'); return; }
    const previous = offset, sourceGeneration = generation;
    finish();
    updateOffset(value); anchorTargets(targets, now); window.configurations?.changed();
    if (previous !== offset) {
      undo = { previous, applied: offset, generation: sourceGeneration, positions, at: now };
      $('autoSyncUndo').hidden = false;
    }
    say(`已自动对齐：偏移 ${offset > 0 ? '+' : ''}${offset.toFixed(1)} 秒。可继续手动微调。`);
  }

  function capture(current, key, at, mediaTime) {
    if (!check(current)) return;
    if (current.busy[key] || at - current.lastSample[key] < .24) return;
    const m = current.channels[key].media, previous = current.lastMedia[key];
    if (previous && (mediaTime <= previous.mediaTime || Math.abs((mediaTime - previous.mediaTime) - (at - previous.at)) > .35)) {
      finish('检测到画面停顿或播放位置跳变，请稳定播放后重试。'); return;
    }
    try {
      const crop = current.regions[key], ctx = current.contexts[key], { width, height } = current.sizes[key];
      ctx.drawImage(m, crop.x * m.videoWidth, crop.y * m.videoHeight, crop.w * m.videoWidth, crop.h * m.videoHeight, 0, 0, width, height);
      const rgba = ctx.getImageData(0, 0, width, height).data;
      current.lastSample[key] = at; current.lastMedia[key] = { at, mediaTime }; current.busy[key] = true;
      current.worker.postMessage({ key, at, mediaTime, rgba, width, height }, [rgba.buffer]);
    } catch (error) {
      finish(error.name === 'SecurityError' ? '此直播源不允许读取画面，请使用手动偏移。' : '读取画面失败，请重试或使用手动偏移。');
    }
  }

  function start() {
    const problem = unavailable();
    if (problem) { say(problem); return; }
    invalidate(); refreshRegions();
    const current = {
      channels: { ...channels }, signature: signature(), started: performance.now() / 1000,
      mode, regions: { a: normalizeRegion('a', regions.a), b: mode === 'single' ? fullFrame() : normalizeRegion('b', regions.b) },
      contexts: {}, sizes: {}, callbacks: {}, busy: {}, lastSample: { a: -Infinity, b: -Infinity }, lastMedia: {},
      stability: new VisualSync.Stability()
    };
    try {
      current.worker = new Worker('visual-sync-worker.js');
      current.worker.postMessage({ type: 'configure', mode: current.mode });
      for (const key of keys) {
        const canvas = document.createElement('canvas'), size = sampleSize(key, current.regions[key], current.mode);
        current.sizes[key] = size; canvas.width = size.width; canvas.height = size.height;
        current.contexts[key] = canvas.getContext('2d', { willReadFrequently: true });
        if (!current.contexts[key]) throw Error('Canvas unavailable');
      }
    } catch {
      current.worker?.terminate(); say('当前浏览器无法启动画面匹配，请使用手动偏移。'); return;
    }
    session = current;
    $('autoSyncStart').disabled = true; $('autoSyncCancel').hidden = false;
    say(mode === 'single' ? '正在官方 B 画面中寻找 A 选区，确认时间差后自动对齐；最多等待 90 秒…' : '正在校正两路选区的位置和大小，再比较共同画面的时间差；最多等待 90 秒…');
    current.worker.onerror = event => { event.preventDefault(); if (session === current) finish('画面匹配出错，请重试或使用手动偏移。'); };
    current.worker.onmessage = ({ data }) => {
      if (session !== current) return;
      if (data.type === 'ready') { current.busy[data.key] = false; return; }
      if (data.type === 'error') { finish('画面匹配出错，请重试或使用手动偏移。'); return; }
      if (data.type === 'located' || data.type === 'registered') {
        if (check(current)) {
          current.stability = new VisualSync.Stability();
          say(data.type === 'registered' ? '已校正选区偏差，正在复核共同画面的时间差…' : '已在 B 中找到对应区域，正在复核两路的时间差…');
        }
        return;
      }
      if (data.type !== 'result' || !check(current)) return;
      if (current.stability.observe(data.result, data.at)) { apply(current, data.result); return; }
      const messages = {
        collecting: '正在收集画面，时间差越大，需要等待越久…',
        locating: '正在官方 B 画面中寻找 A 选区…',
        registering: '正在校正两路选区的位置和大小…',
        'registration-ambiguous': '选区内有多个相似区域，继续确认共同画面…',
        'location-ambiguous': '官方画面中有多个相似区域，继续确认；可取消后改为分别框选 A / B。',
        unmatched: mode === 'single' ? '暂未找到相同画面；请确认 A 选区来自官方画面，也可改为分别框选 A / B。' : '暂未找到相同画面；可取消后重新框选两路共同的比赛区域。',
        static: '画面变化不足，等待运动画面后再判断…',
        ambiguous: '有多个相似位置，继续收集画面确认…',
        match: '已找到一致画面，正在复核时间差…'
      };
      say(messages[data.result.status] || messages.collecting);
    };
    for (const key of keys) {
      const m = current.channels[key].media;
      if (!m.requestVideoFrameCallback) continue;
      const frame = (now, metadata) => {
        if (session !== current) return;
        capture(current, key, (metadata.expectedDisplayTime ?? now) / 1000, metadata.mediaTime);
        if (session === current) current.callbacks[key] = m.requestVideoFrameCallback(frame);
      };
      current.callbacks[key] = m.requestVideoFrameCallback(frame);
    }
    current.watchdog = setInterval(() => {
      if (!check(current)) return;
      const now = performance.now() / 1000;
      if (now - current.started >= VisualSync.HISTORY_SECONDS) { finish('未找到可靠匹配，偏移保持不变。请框选共同的比赛区域后重试。'); return; }
      for (const key of keys) {
        const m = current.channels[key].media;
        if (!m.requestVideoFrameCallback) capture(current, key, now, m.currentTime);
        if (session !== current) return;
        if (now - Math.max(current.started, current.lastSample[key]) > 3) { finish('未收到持续的视频帧，请开启两路画面并保持页面在前台后重试。'); return; }
      }
    }, 250);
  }

  // Snapshots retain source pixels; the enlarged crop makes narrow timer strips legible.
  const percent = value => String(Number((value * 100).toFixed(4)));
  const editable = key => key === 'a' || draftMode === 'dual';
  const regionSay = text => { $('syncRegionNotice').textContent = text; };
  const editorZoom = { a: 1, b: 1 };
  let editorFocus = '';
  function centerSelection(key) {
    const viewport = $('syncViewport' + key.toUpperCase()), surface = $('syncSurface' + key.toUpperCase());
    const panel = surface.closest?.('fieldset'), grid = surface.closest?.('.sync-region-grid');
    if (panel && grid) grid.scrollTop += panel.getBoundingClientRect().top - grid.getBoundingClientRect().top;
    const rect = surface.getBoundingClientRect(), r = draft[key];
    viewport.scrollLeft = Math.max(0, (r.x + r.w / 2) * rect.width - viewport.clientWidth / 2);
    viewport.scrollTop = Math.max(0, (r.y + r.h / 2) * rect.height - viewport.clientHeight / 2);
  }
  function renderEditor() {
    if (editorFocus && !editable(editorFocus)) editorFocus = '';
    dialog.setAttribute('data-region-focus', editorFocus);
    for (const key of keys) {
      const suffix = key.toUpperCase(), active = editable(key);
      if (!active) editorZoom[key] = 1;
      $('syncRegionExpand' + suffix).textContent = editorFocus === key ? '返回双路视图' : '放大编辑';
      $('syncRegionExpand' + suffix).disabled = !active;
      $('syncRegionExpand' + suffix).setAttribute('aria-expanded', String(editorFocus === key));
      $('syncRegionZoom' + suffix).disabled = !active;
      $('syncRegionZoom' + suffix).value = String(editorZoom[key]);
      $('syncSurface' + suffix).style.width = editorZoom[key] * 100 + '%';
    }
  }
  function paint(key) {
    const suffix = key.toUpperCase(), r = draft[key], box = $('syncSelection' + suffix);
    const { width, height } = sourceSize(key), active = editable(key);
    Object.assign(box.style, { left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' });
    box.hidden = !active;
    for (const field of ['x', 'y', 'w', 'h']) {
      const input = $('syncRegion' + suffix + field);
      input.value = percent(r[field]); input.disabled = !active;
      input.min = field === 'w' ? percent(Math.min(12, width) / width) : field === 'h' ? percent(Math.min(8, height) / height) : '0';
      input.max = field === 'x' ? percent(1 - r.w) : field === 'y' ? percent(1 - r.h) : '100';
    }
    $('syncRegionSize' + suffix).textContent = active
      ? `选区 ${Math.round(r.w * width)} × ${Math.round(r.h * height)} 像素 · 最小 ${Math.min(12, width)} × ${Math.min(8, height)} 像素`
      : `全画面搜索 · ${width} × ${height} 像素`;
    if (!active) return;
    const preview = $('syncPreview' + suffix), detail = $('syncDetail' + suffix);
    const scale = Math.min(320 / (r.w * preview.width), 100 / (r.h * preview.height));
    detail.width = Math.max(1, Math.round(r.w * preview.width * scale));
    detail.height = Math.max(1, Math.round(r.h * preview.height * scale));
    const ctx = detail.getContext('2d'); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(preview, r.x * preview.width, r.y * preview.height, r.w * preview.width, r.h * preview.height, 0, 0, detail.width, detail.height);
  }
  function renderMode() {
    const single = draftMode === 'single';
    $('syncRegionMode').value = draftMode;
    $('syncRegionBFields').hidden = single; $('syncRegionBHint').hidden = !single;
    $('syncDetailBContainer').hidden = single;
    $('syncSurfaceB').setAttribute('aria-disabled', String(single));
    $('syncRegionLegendB').textContent = single ? 'B 路 · 官方画面（自动定位）' : 'B 路 · 官方画面';
    $('autoSyncHelp').textContent = single
      ? '框选 A 中来自官方画面的小窗或计时条，B 会自动定位。计时器需保留完整“分:秒”，建议同时框入两侧计分信息；只选小数字可能无法匹配。避开弹幕、黑边和无关画面，也可输入百分比坐标。此选区只用于匹配。'
      : '分别框选 A / B 中大部分重叠的比赛范围或计时条，框边无需完全一致，程序会校正位置和大小差异。A 选区尽量留在官方小窗内，避开主播背景、弹幕和黑边。计时器需保留完整“分:秒”，建议同时框入两侧计分信息。此选区只用于匹配。';
    renderEditor();
    for (const key of keys) paint(key);
  }
  function snapshot() {
    for (const key of keys) {
      const m = channels[key]?.media, canvas = $('syncPreview' + key.toUpperCase());
      if (!m?.videoWidth || !m.videoHeight || m.readyState < 2) throw Error('请先连接两路有画面的直播。');
      canvas.width = m.videoWidth; canvas.height = m.videoHeight;
      canvas.getContext('2d').drawImage(m, 0, 0, canvas.width, canvas.height);
      draft[key] = normalizeRegion(key, draft[key]);
    }
    draftSource = sourceSignature();
  }
  $('autoSyncMode').value = mode;
  $('autoSyncMode').addEventListener('change', event => {
    mode = event.target.value === 'dual' ? 'dual' : 'single';
    invalidate();
    say(mode === 'single' ? '只需框选 A 中来自官方画面的区域，B 会自动定位。' : '分别框选两路大部分重叠的比赛区域，框边无需完全一致，再开始自动对齐。');
  });
  $('autoSyncRegion').addEventListener('click', () => {
    if (session) finish('已取消本次匹配；选好区域后重新开始。');
    refreshRegions(); draft = { a: { ...regions.a }, b: { ...regions.b } }; draftMode = mode;
    editorFocus = ''; editorZoom.a = editorZoom.b = 1;
    try { snapshot(); renderMode(); regionSay(''); dialog.showModal(); }
    catch (error) { say(error.message); }
  });
  $('syncRegionMode').addEventListener('change', event => {
    draftMode = event.target.value === 'dual' ? 'dual' : 'single'; renderMode();
  });
  $('syncRefreshPreview').addEventListener('click', () => {
    try {
      if (draftSource !== sourceSignature()) { refreshRegions(); draft = { a: { ...regions.a }, b: { ...regions.b } }; }
      snapshot(); renderMode(); regionSay('画面已刷新。');
    } catch (error) { regionSay(error.message); }
  });
  $('syncRegionReset').addEventListener('click', () => {
    for (const key of keys) { draft[key] = normalizeRegion(key, defaults()); paint(key); }
  });
  $('syncRegionCancel').addEventListener('click', () => dialog.close());
  $('syncRegionSave').addEventListener('click', () => {
    if (draftSource !== sourceSignature()) { regionSay('直播源或分辨率已改变，请刷新画面后重新框选。'); return; }
    for (const key of keys) regions[key] = normalizeRegion(key, draft[key]);
    mode = draftMode; $('autoSyncMode').value = mode; invalidate();
    dialog.close(); say('匹配区域已更新，点击“自动对齐”开始。');
  });
  for (const key of keys) {
    const suffix = key.toUpperCase(), surface = $('syncSurface' + suffix);
    $('syncRegionExpand' + suffix).addEventListener('click', () => {
      if (!draft || !editable(key)) return;
      editorFocus = editorFocus === key ? '' : key;
      editorZoom[key] = editorFocus ? 2 : 1;
      renderEditor(); centerSelection(key);
    });
    $('syncRegionZoom' + suffix).addEventListener('change', event => {
      if (!draft || !editable(key)) return;
      const value = Number(event.target.value);
      editorZoom[key] = [1, 2, 4].includes(value) ? value : 1;
      renderEditor(); centerSelection(key);
    });
    let drag = null;
    const point = event => {
      const rect = surface.getBoundingClientRect();
      return { x: clamp((event.clientX - rect.left) / rect.width, 0, 1), y: clamp((event.clientY - rect.top) / rect.height, 0, 1) };
    };
    surface.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !draft || !editable(key)) return;
      event.preventDefault(); surface.focus?.({ preventScroll: true });
      const handle = event.target?.dataset?.handle;
      const action = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'].includes(handle) ? 'resize'
        : event.target === $('syncSelection' + suffix) ? 'move' : 'draw';
      drag = { ...point(event), id: event.pointerId, previous: { ...draft[key] }, moved: false, action, handle };
      surface.setPointerCapture(event.pointerId);
    });
    surface.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const p = point(event); drag.moved ||= p.x !== drag.x || p.y !== drag.y;
      const previous = drag.previous, dx = p.x - drag.x, dy = p.y - drag.y;
      if (drag.action === 'move') {
        draft[key] = normalizeRegion(key, { ...previous, x: previous.x + dx, y: previous.y + dy });
      } else if (drag.action === 'resize') {
        const { width, height } = sourceSize(key), minW = Math.min(12, width) / width, minH = Math.min(8, height) / height;
        let left = previous.x, top = previous.y, right = left + previous.w, bottom = top + previous.h;
        if (drag.handle.includes('w')) left = clamp(left + dx, 0, right - minW);
        if (drag.handle.includes('e')) right = clamp(right + dx, left + minW, 1);
        if (drag.handle.includes('n')) top = clamp(top + dy, 0, bottom - minH);
        if (drag.handle.includes('s')) bottom = clamp(bottom + dy, top + minH, 1);
        // Snap edges before deriving the size so a half-pixel drag cannot move
        // the opposite edge when position and size round in different directions.
        left = Math.round(left * width) / width; right = Math.round(right * width) / width;
        top = Math.round(top * height) / height; bottom = Math.round(bottom * height) / height;
        draft[key] = normalizeRegion(key, { x: left, y: top, w: right - left, h: bottom - top });
      } else {
        draft[key] = normalizeRegion(key, { x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(drag.x - p.x), h: Math.abs(drag.y - p.y) });
      }
      paint(key);
    });
    const end = event => {
      if (!drag || drag.id !== event.pointerId) return;
      if (event.type === 'pointercancel' || !drag.moved) draft[key] = drag.previous;
      const id = drag.id; drag = null; if (surface.hasPointerCapture(id)) surface.releasePointerCapture(id); paint(key);
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) surface.addEventListener(type, end);
    surface.addEventListener('keydown', event => {
      if (!draft || !editable(key) || event.altKey || event.ctrlKey || event.metaKey) return;
      const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!direction) return;
      event.preventDefault();
      const { width, height } = sourceSize(key), step = event.shiftKey ? 10 : 1, r = draft[key];
      draft[key] = normalizeRegion(key, { ...r, x: r.x + direction[0] * step / width, y: r.y + direction[1] * step / height });
      paint(key);
      const box = $('syncSelection' + suffix).getBoundingClientRect(), viewport = $('syncViewport' + suffix).getBoundingClientRect();
      if ((box.width < viewport.width && (box.left < viewport.left || box.right > viewport.right)) ||
          (box.height < viewport.height && (box.top < viewport.top || box.bottom > viewport.bottom))) centerSelection(key);
    });
    for (const field of ['x', 'y', 'w', 'h']) $('syncRegion' + suffix + field).addEventListener('change', event => {
      if (!editable(key)) return;
      const value = event.target.valueAsNumber;
      if (Number.isFinite(value)) draft[key] = normalizeRegion(key, { ...draft[key], [field]: value / 100 });
      paint(key);
    });
  }
  $('autoSyncStart').addEventListener('click', start);
  $('autoSyncCancel').addEventListener('click', () => finish('已取消，偏移保持不变。'));
  $('autoSyncUndo').addEventListener('click', () => {
    const previous = undo;
    if (!previous || previous.generation !== generation || previous.applied !== offset) { invalidate(); say('播放设置已改变，撤销已失效。'); return; }
    if (window.vocal?.active || window.vocal?.loading) { invalidate(); say('AI 音频状态已改变，撤销已失效；请关闭 AI 后重新自动对齐。'); return; }
    const now = performance.now(), targets = Object.fromEntries(keys.map(key => [key, previous.positions[key] + (now - previous.at) / 1000]));
    if (!bufferedTargets(targets)) { say('撤销所需画面不在缓冲区，偏移保持不变。'); return; }
    updateOffset(previous.previous); anchorTargets(targets, now); window.configurations?.changed(); invalidate(); say('已恢复自动对齐前的偏移。');
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && session) finish('页面已切到后台，本次自动对齐已取消。'); });
  for (const id of ['audioA', 'videoB']) $(id).addEventListener('seeking', () => { if (session) finish('播放位置已改变，请稳定播放后重新自动对齐。'); });
  window.addEventListener('pagehide', () => finish());
  window.autoSync = { invalidate };
})();
