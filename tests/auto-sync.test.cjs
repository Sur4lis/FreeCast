const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Sync = require('../browser-extension/ui/sync.js');
const VisualSync = require('../browser-extension/ui/visual-sync-core.js');

function setup() {
  class Element {
    constructor() { this.listeners = {}; this.style = {}; this.hidden = true; this.value = ''; this.attributes = {}; this.captured = new Set(); this.draws = []; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    fire(type, fields = {}) { for (const fn of this.listeners[type] || []) fn({ target: this, type, preventDefault() {}, ...fields }); }
    get valueAsNumber() { return Number(this.value); }
    getContext() { return { drawImage: (...args) => this.draws.push(args), getImageData: (x, y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }) }; }
    setAttribute(name, value) { this.attributes[name] = value; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 480, height: 270 }; }
    setPointerCapture(id) { this.captured.add(id); }
    hasPointerCapture(id) { return this.captured.has(id); }
    releasePointerCapture(id) { this.captured.delete(id); }
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  const elements = new Map();
  const $ = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  $('base').value = '3';
  const timers = new Map(), workers = [], applied = [];
  let next = 0, now = 10000;
  const context = {
    console, $, Sync, VisualSync, clamp: Sync.clamp, delays: Sync.delays, generation: 1, offset: 5, pauseLag: 0,
    running: true, paused: false, demo: false, channels: {},
    performance: { now: () => now },
    document: { hidden: false, createElement: () => new Element(), addEventListener() {} },
    addEventListener() {},
    setInterval(fn) { timers.set(++next, fn); return next; },
    clearInterval(id) { timers.delete(id); },
    save() { applied.push(context.offset); },
    Worker: class {
      constructor() { workers.push(this); this.sent = []; }
      postMessage(value) { this.sent.push(value); }
      terminate() { this.terminated = true; }
    },
    configurations: { changed() {} }
  };
  context.window = context;
  vm.createContext(context);
  const app = fs.readFileSync('browser-extension/ui/app.js', 'utf8');
  vm.runInContext(app.slice(app.indexOf('function getDelays('), app.indexOf('class Channel')), context);
  for (const [key, id, edge] of [['a', 'audioA', 1000], ['b', 'videoB', 200]]) {
    const media = $(id), callbacks = new Map();
    Object.assign(media, {
      paused: false, seeking: false, readyState: 4, videoWidth: 1920, videoHeight: 1080, currentTime: edge - context.getDelays()[key], playbackRate: 1,
      buffered: { length: 1, start: () => 0, end: () => edge + 10 }, callbacks,
      requestVideoFrameCallback(fn) { callbacks.set(++next, fn); return next; },
      cancelVideoFrameCallback(id) { callbacks.delete(id); }
    });
    context.channels[key] = { media, edge: () => edge, loadRevision: 1, room: { id: key },
      playout: { started: true, target: media.currentTime, at: now, delay: context.getDelays()[key] } };
  }
  vm.runInContext(fs.readFileSync('browser-extension/ui/auto-sync.js', 'utf8'), context);
  const result = (at, delta = 806, worker = workers.at(-1)) => worker.onmessage({ data: { type: 'result', at, result: { status: 'match', mediaDelta: delta } } });
  const tick = (milliseconds = 0) => {
    now += milliseconds;
    const actions = {}, delay = context.getDelays();
    for (const key of ['a', 'b']) {
      const c = context.channels[key], m = c.media;
      if (!m.paused && !m.seeking) m.currentTime += milliseconds / 1000 * m.playbackRate;
      const ranges = Array.from({ length: m.buffered.length }, (_, i) => [m.buffered.start(i), m.buffered.end(i)]);
      const action = actions[key] = Sync.playoutStep(c.playout, { now, current: m.currentTime, ranges,
        edge: c.edge(now), delay: delay[key], ready: m.readyState, seeking: m.seeking });
      if (action.seek !== null && !m.seeking) m.currentTime = action.seek;
      m.paused = action.wait; m.playbackRate = action.rate;
    }
    return actions;
  };
  return { $, context, workers, timers, applied, result, tick, now: () => now,
    advance: milliseconds => { now += milliseconds; for (const fn of [...timers.values()]) fn(); } };
}

test('stable matches align the real playback clocks once, release resources, and support undo', () => {
  const t = setup(); t.$('autoSyncStart').fire('click');
  t.result(10); t.result(12);
  assert.deepEqual(t.applied, []);
  t.result(14);
  assert.deepEqual(t.applied, [-6]);
  assert.equal(t.workers[0].terminated, true);
  assert.equal(t.timers.size, 0);
  for (const c of Object.values(t.context.channels)) assert.equal(c.media.callbacks.size, 0);
  assert.equal(t.$('autoSyncUndo').hidden, false);
  t.result(16); assert.deepEqual(t.applied, [-6]);
  t.tick();
  assert.equal(t.context.channels.a.media.currentTime - t.context.channels.b.media.currentTime, 806);
  assert.equal(t.context.channels.a.playout.manualShift, 0);
  assert.equal(t.context.channels.b.playout.manualShift, 0);
  t.$('autoSyncUndo').fire('click');
  assert.deepEqual(t.applied, [-6, 5]);
  t.tick();
  assert.equal(t.context.channels.a.media.currentTime, 992);
  assert.equal(t.context.channels.b.media.currentTime, 197);
  assert.equal(t.$('autoSyncUndo').hidden, true);
});

test('cancellation and source changes cannot apply an already queued worker result', () => {
  for (const cancel of [
    t => t.$('autoSyncCancel').fire('click'),
    t => t.context.autoSync.invalidate(),
    t => { t.context.generation++; },
    t => { t.context.channels.a.loadRevision++; },
    t => { t.context.channels.a.media.videoHeight = 720; },
    t => { t.$('autoSyncMode').value = 'dual'; t.$('autoSyncMode').fire('change'); },
    t => { t.context.channels.a.media.seeking = true; },
    t => { t.context.channels.a.recovering = true; },
    t => { t.context.channels.b.refreshing = true; },
    t => { t.context.vocal = { active: true }; },
    t => { t.context.vocal = { loading: true }; },
    t => { t.context.paused = true; },
    t => { t.context.replay = { active: true }; },
    t => { t.context.document.hidden = true; },
    t => { t.$('base').value = '8'; }
  ]) {
    const t = setup(); t.$('autoSyncStart').fire('click'); t.result(10); t.result(12);
    cancel(t); t.result(14);
    assert.deepEqual(t.applied, []);
    assert.equal(t.workers[0].terminated, true);
  }
});

test('a manual edit invalidates undo rather than overwriting newer settings', () => {
  const t = setup(); t.$('autoSyncStart').fire('click'); t.result(10); t.result(12); t.result(14);
  t.context.updateOffset(9);
  t.$('autoSyncUndo').fire('click');
  assert.deepEqual(t.applied, [-6, 9]);
});

test('waits for buffered targets and rejects unsupported offsets without clamping', () => {
  const t = setup(); t.context.channels.b.media.buffered = { length: 0 };
  t.$('autoSyncStart').fire('click'); t.result(10); t.result(12); t.result(14);
  assert.deepEqual(t.applied, []);
  assert.match(t.$('autoSyncStatus').textContent, /等待足够/);
  t.context.channels.b.media.buffered = { length: 1, start: () => 0, end: () => 210 };
  t.result(16); assert.deepEqual(t.applied, [-6]);
  const outside = setup(); outside.$('autoSyncStart').fire('click');
  outside.result(10, 900); outside.result(12, 900); outside.result(14, 900);
  assert.deepEqual(outside.applied, []);
  assert.equal(outside.workers[0].terminated, true);
});

function match(t, delta = 806) {
  t.$('autoSyncStart').fire('click');
  for (const at of [10, 12, 14]) t.result(at, delta);
}

test('bursty download edges do not move the matched timeline when crossing zero in either direction', () => {
  for (const [offset, mediaDelta, expected] of [[5, 806, -1], [-5, 794, 1]]) {
    const t = setup(); t.context.offset = offset;
    for (const [key, position, edge] of [['a', 1027, 1040], ['b', 227, 230]]) {
      const c = t.context.channels[key]; c.media.currentTime = position;
      c.media.buffered = { length: 1, start: () => 0, end: () => edge + 60 };
      c.edge = () => edge + Math.floor((t.now() - 10000) / (key === 'a' ? 2000 : 7000));
      Object.assign(c.playout, { target: position, delay: t.context.getDelays()[key] });
    }
    match(t, mediaDelta); assert.deepEqual(t.applied, [expected]);
    t.tick();
    for (let i = 0; i < 50; i++) t.tick(100);
    assert.ok(Math.abs(t.context.channels.a.media.currentTime - t.context.channels.b.media.currentTime - mediaDelta) < .001);
  }
});

test('automatic anchoring replaces pending manual and settling clocks on both routes', () => {
  const t = setup();
  Object.assign(t.context.channels.a.playout, { target: 991.7, manualShift: .2, settleUntil: 13000 });
  Object.assign(t.context.channels.b.playout, { target: 197.7, settleUntil: 13000 });
  match(t, 790); assert.deepEqual(t.applied, [10]);
  // B has no offset step. It must still follow the captured reference, not its
  // stale target, while A must not receive the queued step a second time.
  t.tick(80);
  assert.ok(Math.abs(t.context.channels.a.media.currentTime - 987.08) < .001);
  assert.ok(Math.abs(t.context.channels.b.media.currentTime - 197.08) < .001);
  for (let i = 0; i < 40; i++) t.tick(100);
  assert.ok(Math.abs(t.context.channels.a.media.currentTime - t.context.channels.b.media.currentTime - 790) < .001);
});

test('buffer checks use the actual relative targets, including holes and forward seeks', () => {
  const t = setup(), a = t.context.channels.a;
  a.media.currentTime = 997; a.playout.target = 997;
  a.media.buffered = { length: 1, start: () => 0, end: () => 1000 };
  match(t); assert.deepEqual(t.applied, []);
  // edge - requestedDelay would be 997 and playable, but the actual A target
  // is 1002 after removing its previous five-second offset.
  assert.match(t.$('autoSyncStatus').textContent, /等待足够/);
  a.media.buffered = { length: 2, start: i => [0, 1003][i], end: i => [1000, 1020][i] };
  t.result(16); assert.deepEqual(t.applied, []);
  a.media.buffered = { length: 1, start: () => 0, end: () => 1020 };
  t.result(18); assert.deepEqual(t.applied, [-1]); t.tick();
  assert.equal(a.media.currentTime, 1002);
  assert.equal(a.media.currentTime - t.context.channels.b.media.currentTime, 806);

  const cached = setup();
  cached.context.channels.a.edge = () => 1040;
  cached.context.channels.b.edge = () => 230;
  match(cached); assert.deepEqual(cached.applied, [-6]); cached.tick();
  assert.equal(cached.context.channels.a.media.currentTime - cached.context.channels.b.media.currentTime, 806);
});

test('immediate undo restores the prior timeline before a seek and during seek decoding', () => {
  for (const decoding of [false, true]) {
    const t = setup(); match(t);
    if (decoding) {
      t.tick();
      for (const c of Object.values(t.context.channels)) { c.media.seeking = true; c.media.currentTime -= .12; }
      t.tick(100);
    }
    t.$('autoSyncUndo').fire('click');
    assert.deepEqual(t.applied, [-6, 5]);
    if (decoding) {
      const actions = t.tick();
      assert.equal(actions.a.seek, null); assert.equal(actions.b.seek, null);
      for (const c of Object.values(t.context.channels)) c.media.seeking = false;
    }
    t.tick(50);
    const elapsed = (t.now() - 10000) / 1000;
    assert.ok(Math.abs(t.context.channels.a.media.currentTime - 992 - elapsed) < .001);
    assert.ok(Math.abs(t.context.channels.b.media.currentTime - 197 - elapsed) < .001);
    for (let i = 0; i < 40; i++) t.tick(100);
    assert.ok(Math.abs(t.context.channels.a.media.currentTime - t.context.channels.b.media.currentTime - 795) < .001);
  }
});

test('undo leaves playback unchanged when its prior timeline is no longer buffered', () => {
  const t = setup(); match(t); t.tick();
  t.context.channels.a.media.buffered = { length: 1, start: () => 995, end: () => 1010 };
  t.$('autoSyncUndo').fire('click');
  assert.deepEqual(t.applied, [-6]);
  assert.match(t.$('autoSyncStatus').textContent, /撤销所需画面不在缓冲区/);
  assert.equal(t.context.channels.a.media.currentTime, 997);
});

test('AI audio processing must be off before visual alignment starts', () => {
  for (const state of [{ active: true }, { loading: true }]) {
    const t = setup(); t.context.vocal = state;
    t.$('autoSyncStart').fire('click');
    assert.equal(t.workers.length, 0); assert.deepEqual(t.applied, []);
    assert.match(t.$('autoSyncStatus').textContent, /关闭 AI 音频处理/);
  }
});

test('undo cannot change the raw video clocks after AI starts loading', () => {
  const t = setup(); match(t); t.tick();
  const targets = Object.values(t.context.channels).map(c => c.playout.target);
  t.context.vocal = { loading: true };
  t.$('autoSyncUndo').fire('click');
  assert.deepEqual(t.applied, [-6]);
  assert.deepEqual(Object.values(t.context.channels).map(c => c.playout.target), targets);
  assert.equal(t.$('autoSyncUndo').hidden, true);
  assert.match(t.$('autoSyncStatus').textContent, /AI 音频状态已改变/);
});

test('no playback, missing frames and worker failures stop cleanly', () => {
  const idle = setup(); idle.context.running = false; idle.$('autoSyncStart').fire('click');
  assert.equal(idle.workers.length, 0);
  const stalled = setup(); stalled.$('autoSyncStart').fire('click'); stalled.advance(4000);
  assert.equal(stalled.workers[0].terminated, true);
  assert.deepEqual(stalled.applied, []);
  const failed = setup(); failed.$('autoSyncStart').fire('click'); failed.workers[0].onerror({ preventDefault() {} });
  assert.equal(failed.workers[0].terminated, true);
  assert.deepEqual(failed.applied, []);
});

test('capture backpressure skips pending frames, and seeks invalidate a session', () => {
  const t = setup(); t.$('autoSyncStart').fire('click');
  const media = t.context.channels.a.media;
  const frame = media.callbacks.values().next().value;
  frame(10000, { expectedDisplayTime: 10000, mediaTime: 10 });
  frame(10250, { expectedDisplayTime: 10250, mediaTime: 10.25 });
  assert.equal(t.workers[0].sent.filter(message => message.key).length, 1);
  t.workers[0].onmessage({ data: { type: 'ready', key: 'a' } });
  frame(10500, { expectedDisplayTime: 10500, mediaTime: 10.5 });
  assert.equal(t.workers[0].sent.filter(message => message.key).length, 2);
  media.fire('seeking');
  assert.equal(t.workers[0].terminated, true);
});

test('region coordinates remain inside the source and can be edited using the keyboard', () => {
  const t = setup(); t.$('autoSyncRegion').fire('click');
  assert.equal(t.$('autoSyncDialog').open, true);
  t.$('syncRegionAw').value = '200'; t.$('syncRegionAw').fire('change');
  assert.equal(Number(t.$('syncRegionAw').value), 100);
  assert.equal(Number(t.$('syncRegionAx').value), 0);
  t.$('syncRegionAh').value = '-20'; t.$('syncRegionAh').fire('change');
  assert.ok(Math.abs(Number(t.$('syncRegionAh').value) / 100 * 1080 - 8) < .001);
  t.$('syncRegionSave').fire('click');
  assert.equal(t.$('autoSyncDialog').open, false);
});

function change(t, id, value) { t.$(id).value = String(value); t.$(id).fire('change'); }
function frame(t, key, seconds = 10) {
  const callback = t.context.channels[key].media.callbacks.values().next().value;
  callback(seconds * 1000, { expectedDisplayTime: seconds * 1000, mediaTime: seconds });
}

test('single-region mode sends the A crop and the full B frame with their aspect ratios', () => {
  const t = setup();
  assert.equal(t.$('autoSyncMode').value, 'single');
  t.$('autoSyncRegion').fire('click');
  assert.equal(t.$('syncRegionBFields').hidden, true);
  assert.equal(t.$('syncRegionBw').disabled, true);
  change(t, 'syncRegionAw', 10); change(t, 'syncRegionAh', 2);
  t.$('syncRegionSave').fire('click'); t.$('autoSyncStart').fire('click');
  assert.equal(t.workers[0].sent[0].type, 'configure');
  assert.equal(t.workers[0].sent[0].mode, 'single');
  frame(t, 'a'); frame(t, 'b');
  const frames = t.workers[0].sent.filter(message => message.key);
  assert.deepEqual(frames.map(({width,height}) => [width,height]), [[192,22],[1920,1080]]);
  for (const message of frames) assert.equal(message.rgba.length, message.width * message.height * 4);
});

test('dual mode edits and samples both regions, while cancelling mode edits preserves the original mode', () => {
  const t = setup(); t.$('autoSyncRegion').fire('click');
  change(t, 'syncRegionMode', 'dual');
  assert.equal(t.$('syncRegionBFields').hidden, false);
  assert.equal(t.$('syncRegionBw').disabled, false);
  t.$('syncRegionCancel').fire('click');
  assert.equal(t.$('autoSyncMode').value, 'single');
  t.$('autoSyncRegion').fire('click'); change(t, 'syncRegionMode', 'dual');
  change(t, 'syncRegionBw', 10); change(t, 'syncRegionBh', 2);
  t.$('syncRegionSave').fire('click'); t.$('autoSyncStart').fire('click'); frame(t, 'b');
  assert.equal(t.workers[0].sent[0].mode, 'dual');
  const message = t.workers[0].sent.find(message => message.key === 'b');
  assert.equal(message.width, 192); assert.equal(message.height, 22);
});

test('dragging and numeric edits use the same source-pixel minimum and accept a two-percent timer strip', () => {
  const t = setup(); Object.assign(t.context.channels.a.media, {videoWidth:852,videoHeight:480});
  t.$('autoSyncRegion').fire('click');
  change(t, 'syncRegionAh', 2);
  assert.ok(Number(t.$('syncRegionAh').value) < 3);
  assert.match(t.$('syncRegionSizeA').textContent, /× 10 像素/);
  change(t, 'syncRegionAw', .001); change(t, 'syncRegionAh', .001);
  const expected = [t.$('syncRegionAw').value, t.$('syncRegionAh').value];
  assert.match(t.$('syncRegionSizeA').textContent, /12 × 8 像素/);
  const surface = t.$('syncSurfaceA');
  surface.fire('pointerdown', {button:0,pointerId:1,clientX:100,clientY:30});
  surface.fire('pointermove', {pointerId:1,clientX:101,clientY:31});
  surface.fire('pointerup', {pointerId:1});
  assert.deepEqual([t.$('syncRegionAw').value,t.$('syncRegionAh').value], expected);
  change(t, 'syncRegionAx', 100); change(t, 'syncRegionAy', 100);
  assert.ok(Number(t.$('syncRegionAx').value) + Number(t.$('syncRegionAw').value) <= 100.0001);
  assert.ok(Number(t.$('syncRegionAy').value) + Number(t.$('syncRegionAh').value) <= 100.0001);
});

test('single mode ignores B edits and cancelled drags restore the prior selection', () => {
  const t = setup(); t.$('autoSyncRegion').fire('click');
  const beforeB = t.$('syncRegionBw').value;
  change(t, 'syncRegionBw', 2);
  change(t, 'syncRegionMode', 'dual');
  assert.equal(t.$('syncRegionBw').value, beforeB);
  const beforeA = t.$('syncRegionAw').value, surface = t.$('syncSurfaceA');
  surface.fire('pointerdown', {button:0,pointerId:2,clientX:10,clientY:10});
  surface.fire('pointermove', {pointerId:2,clientX:100,clientY:25});
  surface.fire('pointercancel', {pointerId:2});
  assert.equal(t.$('syncRegionAw').value, beforeA);
});

test('stale source snapshots cannot be saved until refreshed', () => {
  const t = setup(); t.$('autoSyncRegion').fire('click');
  t.context.channels.a.media.videoHeight = 720;
  t.$('syncRegionSave').fire('click');
  assert.equal(t.$('autoSyncDialog').open, true);
  assert.match(t.$('syncRegionNotice').textContent, /分辨率已改变/);
  t.$('syncRefreshPreview').fire('click'); t.$('syncRegionSave').fire('click');
  assert.equal(t.$('autoSyncDialog').open, false);
});

test('zoom and focus preserve source coordinates, including a scrolled canvas drag', () => {
  const t = setup(); t.$('autoSyncRegion').fire('click');
  const fields = () => ['x', 'y', 'w', 'h'].map(f => t.$('syncRegionA' + f).value);
  const before = fields();
  t.$('syncRegionExpandA').fire('click');
  assert.equal(t.$('autoSyncDialog').attributes['data-region-focus'], 'a');
  change(t, 'syncRegionZoomA', 4);
  assert.equal(t.$('syncSurfaceA').style.width, '400%');
  assert.deepEqual(fields(), before);
  const surface = t.$('syncSurfaceA');
  surface.getBoundingClientRect = () => ({left:-320,top:-180,width:1920,height:1080});
  surface.fire('pointerdown', {button:0,pointerId:1,clientX:320,clientY:90});
  surface.fire('pointermove', {pointerId:1,clientX:510,clientY:139});
  surface.fire('pointerup', {pointerId:1});
  assert.match(t.$('syncRegionSizeA').textContent, /190 × 49 像素/);
  assert.ok(Math.abs(Number(t.$('syncRegionAx').value) * 19.2 - 640) < .01);
  assert.ok(Math.abs(Number(t.$('syncRegionAy').value) * 10.8 - 270) < .01);
  t.$('syncRegionExpandA').fire('click');
  assert.equal(t.$('autoSyncDialog').attributes['data-region-focus'], '');
  assert.match(t.$('syncRegionSizeA').textContent, /190 × 49 像素/);
});

test('existing selections move without resizing and handles respect source bounds', () => {
  const t = setup(); t.$('autoSyncRegion').fire('click');
  const surface = t.$('syncSurfaceA'), box = t.$('syncSelectionA');
  const size = [t.$('syncRegionAw').value, t.$('syncRegionAh').value];
  surface.fire('pointerdown', {button:0,pointerId:2,clientX:100,clientY:100,target:box});
  surface.fire('pointermove', {pointerId:2,clientX:110,clientY:105});
  surface.fire('pointerup', {pointerId:2});
  assert.deepEqual([t.$('syncRegionAw').value,t.$('syncRegionAh').value], size);
  assert.ok(Math.abs(Number(t.$('syncRegionAx').value) * 19.2 - 232) < .01);
  const position = [t.$('syncRegionAx').value,t.$('syncRegionAy').value];
  surface.fire('pointerdown', {button:0,pointerId:3,clientX:400,clientY:220,target:{dataset:{handle:'se'}}});
  surface.fire('pointermove', {pointerId:3,clientX:0,clientY:0});
  surface.fire('pointerup', {pointerId:3});
  assert.match(t.$('syncRegionSizeA').textContent, /12 × 8 像素/);
  assert.deepEqual([t.$('syncRegionAx').value,t.$('syncRegionAy').value],position);
});

test('keyboard nudges use source pixels at any zoom and disabled B remains unchanged', () => {
  const t = setup(); t.$('autoSyncRegion').fire('click');
  change(t, 'syncRegionZoomA', 4);
  const surface = t.$('syncSurfaceA');
  surface.fire('keydown', {key:'ArrowRight'});
  surface.fire('keydown', {key:'ArrowDown',shiftKey:true});
  assert.ok(Math.abs(Number(t.$('syncRegionAx').value) * 19.2 - 193) < .01);
  assert.ok(Math.abs(Number(t.$('syncRegionAy').value) * 10.8 - 118) < .01);
  const before = t.$('syncRegionBx').value;
  t.$('syncSurfaceB').fire('keydown', {key:'ArrowRight'});
  t.$('syncRegionExpandB').fire('click');
  assert.equal(t.$('syncRegionBx').value, before);
  assert.equal(t.$('autoSyncDialog').attributes['data-region-focus'], '');
  assert.equal(t.$('syncRegionZoomB').disabled, true);
});

test('resizing left and top by fractional source pixels preserves opposite edges', () => {
  const t = setup(); t.$('autoSyncRegion').fire('click');
  const surface = t.$('syncSurfaceA');
  surface.fire('pointerdown', {button:0,pointerId:4,clientX:48,clientY:27,target:{dataset:{handle:'nw'}}});
  surface.fire('pointermove', {pointerId:4,clientX:48.125,clientY:27.125});
  surface.fire('pointerup', {pointerId:4});
  const read = field => Number(t.$('syncRegionA' + field).value) / 100;
  assert.ok(Math.abs((read('x') + read('w')) * 1920 - 1728) < .01);
  assert.ok(Math.abs((read('y') + read('h')) * 1080 - 972) < .01);
});

for (const geometryEvent of ['located', 'registered']) test(`${geometryEvent} regions cannot reuse earlier stable matches`, () => {
  const t = setup(); t.$('autoSyncStart').fire('click'); t.result(10); t.result(12);
  const worker = t.workers[0];
  worker.onmessage({data:{type:'result',at:14,result:{status:'location-ambiguous'}}});
  assert.deepEqual(t.applied, []); assert.match(t.$('autoSyncStatus').textContent, /多个相似区域/);
  t.result(16); t.result(18);
  worker.onmessage({data:{type:geometryEvent,region:{x:.4,y:0,w:.1,h:.03},score:.95}});
  t.result(20); assert.deepEqual(t.applied, []);
  t.result(22); t.result(24); assert.deepEqual(t.applied, [-6]);
});


test('strong edge differences explain a refusal without applying or carrying over a pending match', () => {
  const t = setup(); t.$('autoSyncStart').fire('click'); t.result(10); t.result(12);
  const refusal = { status: 'unmatched', score: .99, diagnostic: {
    refinedBestContext: .98,
    refinedBestFixedStructure: { consistent: false, detail: { consistent: false, boundaryEdges: ['top'] } }
  } };
  t.workers[0].onmessage({ data: { type: 'result', at: 14, result: refusal } });
  assert.match(t.$('autoSyncStatus').textContent, /选区边缘.*完整字形/);
  t.result(16);
  assert.deepEqual(t.applied, []); assert.equal(t.context.offset, 5);
  refusal.diagnostic.refinedBestContext = .7;
  t.workers[0].onmessage({ data: { type: 'result', at: 18, result: refusal } });
  assert.doesNotMatch(t.$('autoSyncStatus').textContent, /选区边缘/);
  assert.deepEqual(t.applied, []);
});
