const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const ui = path.resolve(__dirname, '../browser-extension/ui');
const modules = {
  'visual-sync-core.js': 'VisualSync',
  'visual-sync-inset.js': 'VisualSyncInset',
  'visual-sync-overlap.js': 'VisualSyncOverlap'
};
const digits = ['1111110', '0110000', '1101101', '1111001', '0110011', '1011011', '1011111', '1110000', '1111111', '1111011'];

// Complete seven-segment minute glyphs touch the top of a small source image.
// In this font, the entire difference between 1 and 7 is the top stroke.
// Dropping another interpolation border must not turn that stroke into noise.
function clock(time, minute, { thick = 1, top = 0, marker = false, markerTop = 0,
  background, alpha = 1, strokeWidth = 10 } = {}) {
  const width = 124, height = 32, rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const value = background
      ? 60 + background.amplitude * (Math.sin(x * background.frequency) + .25 * Math.sin(y * .8))
      : 18 + (x * 7 + y * 3) % 5;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = value; rgba[i + 3] = 255;
  }
  function rect(x, y, w, h) {
    assert.ok(x >= 0 && y >= 0 && x + w <= width && y + h <= height, 'The fixture must not clip a glyph');
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const i = (yy * width + xx) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = alpha * 225 + (1 - alpha) * rgba[i];
    }
  }
  const seconds = ((Math.floor(time) % 60) + 60) % 60;
  const text = `${String(minute).padStart(2, '0')}${String(seconds).padStart(2, '0')}`;
  [...text].forEach((digit, i) => {
    const x = 12 + i * 20 + (i > 1 ? 6 : 0), y = top;
    const segments = [[x + 2, y, strokeWidth, thick], [x + strokeWidth + 2, y + 2, thick, 9], [x + strokeWidth + 2, y + 11, thick, 9],
      [x + 2, y + 19, strokeWidth, thick], [x, y + 11, thick, 9], [x, y + 2, thick, 9], [x + 2, y + 9, strokeWidth, thick]];
    [...digits[Number(digit)]].forEach((enabled, j) => { if (enabled === '1') rect(...segments[j]); });
  });
  rect(52, top + 6, 2, 2); rect(52, top + 14, 2, 2);
  if (marker) rect(103, markerTop, 15, 1);
  return { width, height, rgba };
}

function run(spec) {
  const messages = [], context = vm.createContext({ console, performance });
  context.self = context;
  context.postMessage = message => { if (message.type !== 'ready') messages.push(message); };
  context.importScripts = (...names) => {
    for (const name of names) {
      assert.ok(Object.hasOwn(modules, name), `Unexpected worker dependency: ${name}`);
      context[modules[name]] = require(path.join(ui, name));
    }
  };
  vm.runInContext(fs.readFileSync(path.join(ui, 'visual-sync-worker.js'), 'utf8'), context);
  context.onmessage({ data: { type: 'configure', mode: 'dual' } });
  const stability = new context.VisualSync.Stability();
  let processed = 0, stable = null;
  // A is eight seconds behind B, while their media timestamps have unrelated
  // origins. Matching corresponding scenes must therefore produce delta 808.
  for (let i = 0; i <= 160; i++) {
    const at = i / 4;
    for (const key of ['a', 'b']) {
      const image = clock(at - (key === 'a' ? 8 : 0), spec[key].minute, { ...spec.options, ...spec[key] });
      context.onmessage({ data: { key, at, mediaTime: (key === 'a' ? 1000 : 200) + at, ...image } });
    }
    for (; processed < messages.length; processed++) {
      const message = messages[processed];
      assert.notEqual(message.type, 'error', message.message);
      if (message.type === 'registered' || message.type === 'located') stability.reset();
      if (message.type === 'result' && stability.observe(message.result, message.at) && !stable) stable = message.result;
    }
  }
  return { stable, registrations: messages.filter(message => message.type === 'registered') };
}

const cases = [
  { name: 'same thin minutes at the top retain the true delay', match: true, a: { minute: 1 }, b: { minute: 1 } },
  { name: 'complete top-edge 01 and 07 minutes remain distinct', fullRegion: true, a: { minute: 1 }, b: { minute: 7 } },
  { name: 'complete top-edge 07 and 01 minutes remain distinct', fullRegion: true, a: { minute: 7 }, b: { minute: 1 } },
  { name: 'thicker top-edge minute strokes remain distinct', a: { minute: 1 }, b: { minute: 7 }, options: { thick: 3 } },
  { name: 'top-edge 00 and 08 minutes remain distinct', a: { minute: 0 }, b: { minute: 8 } },
  { name: 'top-edge 03 and 08 minutes remain distinct', a: { minute: 3 }, b: { minute: 8 } },
  { name: 'interior thin minute strokes remain distinct', a: { minute: 1 }, b: { minute: 7 }, options: { top: 5 } },
  { name: 'a static top-edge identity marker is not discarded', fullRegion: true, a: { minute: 1 }, b: { minute: 1, marker: true } },
  { name: 'an interior identity marker is not discarded', a: { minute: 1 }, b: { minute: 1, marker: true, markerTop: 8 } }
];
// A translucent horizontal stroke can look like a brightness change within
// each textured row. It still carries the minute identity and must be retained.
for (const [alpha, strokeWidth] of [[.3, 10], [.4, 10], [.4, 14]]) {
  for (const [a, b] of [[1, 7], [7, 1], [1, 1]]) cases.push({
    name: `textured translucent minutes ${a}/${b}, alpha ${alpha}, stroke width ${strokeWidth}`,
    match: a === b, fullRegion: a !== b, a: { minute: a }, b: { minute: b },
    options: { alpha, strokeWidth, background: { amplitude: 12, frequency: .4 } }
  });
}
for (const spec of cases) test(`worker boundary: ${spec.name}`, () => {
  const result = run(spec);
  if (spec.match) {
    assert.ok(result.stable, 'An intact boundary is not itself a reason to reject the correct match');
    assert.equal(result.stable.mediaDelta, 808);
  } else {
    assert.equal(result.stable, null, JSON.stringify(result));
    assert.ok(result.registrations.length, 'Exercise the registered verifier, not only the initial exact-crop path');
    if (spec.fullRegion) for (const registration of result.registrations) {
      assert.equal(registration.coverage, 1, 'The distinguishing stroke must remain inside the common region');
      for (const region of Object.values(registration.regions)) {
        assert.deepEqual([region.x, region.y, region.w, region.h], [0, 0, 1, 1]);
      }
    }
  }
});
