const { test } = require('node:test');
const assert = require('node:assert/strict');
const Inset = require('../browser-extension/ui/visual-sync-inset.js');
const V = require('../browser-extension/ui/visual-sync-core.js');

test('capture accepts a 1920-pixel edge and bounds oversized or malformed input', () => {
  const full = Inset.gray(new Uint8ClampedArray(1920 * 1080 * 4), 1920, 1080);
  assert.equal(full.width, 1920); assert.equal(full.height, 1080);
  assert.equal(full.values.length, 1920 * 1080);
  assert.equal(Inset.gray(new Uint8ClampedArray(2 * 1920 * 4), 2, 1920).height, 1920);
  for (const [width, height] of [[1921, 2], [2, 1921], [1, 2]]) {
    assert.throws(() => Inset.gray(new Uint8ClampedArray(width * height * 4), width, height), /frame size/);
  }
  assert.throws(() => Inset.gray(new Uint8ClampedArray(4), 1920, 1080), /frame size/);
});

const digits = ['1111110', '0110000', '1101101', '1111001', '0110011', '1011011', '1011111', '1110000', '1111111', '1111011'];
function clock(seconds, minute = 1, exposure = false) {
  const width = 128, height = 32, rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = 18 + (x * 7 + y * 3) % 5, i = (y * width + x) * 4;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = v; rgba[i + 3] = 255;
  }
  function rectangle(x, y, w, h) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      const p = (j * width + i) * 4;
      rgba[p] = rgba[p + 1] = rgba[p + 2] = 225;
    }
  }
  const value = `${String(minute).padStart(2, '0')}${String(((Math.floor(seconds) % 60) + 60) % 60).padStart(2, '0')}`;
  [...value].forEach((n, index) => {
    const x = 22 + index * 20 + (index > 1 ? 6 : 0), y = 6;
    const segments = [[x + 2, y, 10, 3], [x + 12, y + 2, 3, 9], [x + 12, y + 11, 3, 9],
      [x + 2, y + 19, 10, 3], [x, y + 11, 3, 9], [x, y + 2, 3, 9], [x + 2, y + 9, 10, 3]];
    [...digits[Number(n)]].forEach((enabled, i) => { if (enabled === '1') rectangle(...segments[i]); });
  });
  rectangle(62, 12, 3, 3); rectangle(62, 20, 3, 3);
  if (exposure) for (let i = 0; i < rgba.length; i += 4) rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i] * .78 + 17;
  return Inset.gray(rgba, width, height);
}
function frames({ lag = 8, duration = 40, minuteB = 1, still = false, repeat = false } = {}) {
  const a = [], b = [];
  for (let i = 0; i <= duration * 4; i++) {
    const at = i / 4, ta = still ? 0 : repeat ? (at - lag + 100) % 2 : at - lag, tb = still ? 0 : repeat ? at % 2 : at;
    a.push({ at, mediaTime: 1000 + at, feature: Inset.fingerprint(clock(ta, 1, true)) });
    b.push({ at, mediaTime: 200 + at, feature: Inset.fingerprint(clock(tb, minuteB)) });
  }
  return { a, b };
}

test('clock-only changes establish either lag sign and independent media-clock origins', () => {
  for (const lag of [8, -8]) {
    const { a, b } = frames({ lag });
    const result = Inset.estimate(a, b);
    assert.equal(result.status, 'match', JSON.stringify(result));
    assert.ok(Math.abs(result.mediaDelta - (800 + lag)) <= .25, JSON.stringify(result));
    assert.equal(V.targetOffset(1040, 240, result.mediaDelta), -lag);
  }
});
test('static clocks and repeating second digits cannot establish a unique correspondence', () => {
  for (const options of [{ still: true }, { repeat: true }]) {
    const { a, b } = frames(options);
    assert.notEqual(Inset.estimate(a, b).status, 'match');
  }
});
test('asynchronous 30 fps presentation sampled near 3.75 fps preserves stable clock alignment', () => {
  const stability = new V.Stability(); let stable = false;
  for (const duration of [20, 22, 24]) {
    const a = [], b = [];
    for (let i = 0; i * 8 / 30 <= duration; i++) {
      const ta = i * 8 / 30, tb = i * 8 / 30 + 3 / 30;
      a.push({ at: ta, mediaTime: 1000 + ta, feature: Inset.fingerprint(clock(ta - 8, 1, true)) });
      b.push({ at: tb, mediaTime: 200 + tb, feature: Inset.fingerprint(clock(tb)) });
    }
    const result = Inset.estimate(a, b);
    assert.equal(result.status, 'match', JSON.stringify(result));
    assert.ok(Math.abs(result.mediaDelta - 808) <= .25);
    stable = stability.observe(result, duration);
  }
  assert.equal(stable, true);
});
test('one common subpixel crop translation is tolerated without accepting different minutes', () => {
  for (const minuteB of [1, 4, 7]) {
    const a = [], b = [];
    for (let i = 0; i <= 160; i++) {
      const at = i / 4, image = clock(at, minuteB);
      const shifted = { width: image.width, height: image.height,
        values: Inset.sample(image, { x: .4, y: -.25, w: image.width, h: image.height }, image.width, image.height) };
      a.push({ at, mediaTime: 1000 + at, feature: Inset.fingerprint(clock(at - 8)) });
      b.push({ at, mediaTime: 200 + at, feature: Inset.fingerprint(shifted) });
    }
    const result = Inset.estimate(a, b);
    if (minuteB === 1) { assert.equal(result.status, 'match', JSON.stringify(result)); assert.equal(result.mediaDelta, 808); }
    else assert.notEqual(result.status, 'match', JSON.stringify({ minuteB, result }));
  }
});
test('different fixed minute digits are rejected even when the moving second digits match', () => {
  for (const minuteB of [4, 5, 7]) for (const duration of [20, 24, 40]) {
    const { a, b } = frames({ minuteB, duration });
    assert.notEqual(Inset.estimate(a, b).status, 'match', JSON.stringify({ minuteB, duration }));
  }
});
function narrowClockBar(seconds, minute) {
  const width = 512, height = 128, values = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) values[y * width + x] = .1 + .06 * Math.sin(x * .09) * Math.cos(y * .15);
  const patch = Inset.sample(clock(seconds, minute), { x: 0, y: 0, w: 128, h: 32 }, 80, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 80; x++) values[(y + 90) * width + x + 200] = patch[y * 80 + x];
  // Include the actual UI's 256-pixel capture cap before fingerprinting. The
  // complete clock occupies only 40x16 source samples inside this scoreboard.
  return Inset.fingerprint({ width: 256, height: 64,
    values: Inset.sample({ width, height, values }, { x: 0, y: 0, w: width, h: height }, 256, 64) });
}
test('a narrow clock inside a wide captured bar retains its fixed minute strokes', () => {
  for (const minuteB of [1, 4, 7]) {
    const a = [], b = [];
    for (let i = 0; i <= 160; i++) {
      const at = i / 4;
      a.push({ at, mediaTime: 1000 + at, feature: narrowClockBar(at - 8, 1) });
      b.push({ at, mediaTime: 200 + at, feature: narrowClockBar(at, minuteB) });
    }
    const result = Inset.estimate(a, b);
    if (minuteB === 1) { assert.equal(result.status, 'match', JSON.stringify(result)); assert.equal(result.mediaDelta, 808); }
    else assert.notEqual(result.status, 'match', JSON.stringify({ minuteB, result }));
  }
});
test('a short overlap or lone matching frame cannot be applied', () => {
  const short = frames({ duration: 6 });
  assert.equal(Inset.estimate(short.a, short.b).status, 'collecting');
  const mismatch = frames({ minuteB: 5 }); mismatch.b.at(-1).feature = mismatch.a.at(-1).feature;
  assert.notEqual(Inset.estimate(mismatch.a, mismatch.b).status, 'match');
});

function official(time, duplicate = false) {
  const width = 320, height = 180, values = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) values[y * width + x] = .3 + .08 * Math.sin(x * .09 + y * .13 + time);
  const source = clock(time), roi = { x: 92, y: 21, w: 96, h: 24 };
  for (const rect of duplicate ? [roi, { ...roi, x: 195, y: 100 }] : [roi]) {
    const resized = Inset.sample(source, { x: 0, y: 0, w: source.width, h: source.height }, rect.w, rect.h);
    for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) values[(y + rect.y) * width + x + rect.x] = resized[y * rect.w + x];
  }
  return { image: { values, width, height }, region: { x: roi.x / width, y: roi.y / height, w: roi.w / width, h: roi.h / height } };
}
test('CPU localization finds an inset at an unknown scale and needs multiple observations', () => {
  const locator = new Inset.Locator(), target = official(12);
  assert.notEqual(locator.observe(clock(12), target.image, 0).status, 'located');
  assert.notEqual(locator.observe(clock(14), official(14).image, 2).status, 'located');
  const result = locator.observe(clock(16), official(16).image, 4);
  assert.equal(result.status, 'located', JSON.stringify(result));
  assert.ok(Inset.overlap(result.region, target.region) > .9, JSON.stringify(result));
});
test('native 1080p localization converges through coarse scale quantization', () => {
  const source = clock(23), a = { width: 204, height: 52,
    values: Inset.sample(source, { x: 0, y: 0, w: source.width, h: source.height }, 204, 52) };
  const b = { width: 1920, height: 1080, values: new Float32Array(1920 * 1080) };
  for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) b.values[y * b.width + x] = .2 + .03 * Math.sin(x * .13 + y * .17);
  // The coarse grid is four times smaller. This non-grid placement/scale needs
  // convergence after restoring source coordinates, not a single local move.
  const expected = { x: 721, y: 27, w: 438, h: 112 };
  const patch = Inset.sample(a, { x: 0, y: 0, w: a.width, h: a.height }, expected.w, expected.h);
  for (let y = 0; y < expected.h; y++) for (let x = 0; x < expected.w; x++) b.values[(y + expected.y) * b.width + x + expected.x] = patch[y * expected.w + x];
  const result = Inset.locate(a, b);
  assert.equal(result.status, 'located', JSON.stringify(result));
  const actual = { x: result.region.x * b.width, y: result.region.y * b.height,
    w: result.region.w * b.width, h: result.region.h * b.height };
  for (const key of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(actual[key] - expected[key]) <= 1, JSON.stringify({ key, expected, actual }));
});
test('thin scoreboard glyphs survive refinement after a small restream downscale', () => {
  const bar = { width: 320, height: 82, values: new Float32Array(320 * 82) };
  for (let y = 0; y < 82; y++) for (let x = 0; x < 320; x++) bar.values[y * 320 + x] = .08 + .02 * Math.sin(x * .08 + y * .13);
  function draw(source, x, y, w, h) {
    const patch = Inset.sample(source, { x: 0, y: 0, w: source.width, h: source.height }, w, h);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) bar.values[(y + yy) * 320 + x + xx] = patch[yy * w + xx];
  }
  draw(clock(19), 130, 45, 58, 30); draw(clock(27), 0, 0, 98, 38); draw(clock(27), 222, 0, 98, 38);
  for (let y = 4; y < 29; y++) for (let x = 146; x < 174; x++) if (x % 9 < 3 || y % 11 < 3) bar.values[y * 320 + x] = .7;
  for (let x = 0; x < 320; x++) bar.values[42 * 320 + x] = .45;
  const a = { width: 190, height: 49, values: Inset.sample(bar, { x: 0, y: 0, w: 320, h: 82 }, 190, 49) };
  const b = { width: 1920, height: 1080, values: new Float32Array(1920 * 1080) };
  for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) b.values[y * b.width + x] = .22 + .02 * Math.sin(x * .017 + y * .019);
  const expected = { x: 800, y: 28, w: 320, h: 82 };
  for (let y = 0; y < 82; y++) for (let x = 0; x < 320; x++) b.values[(y + 28) * b.width + x + 800] = bar.values[y * 320 + x];
  const result = Inset.locate(a, b);
  assert.equal(result.status, 'located', JSON.stringify(result));
  const actual = { x: result.region.x * b.width, y: result.region.y * b.height,
    w: result.region.w * b.width, h: result.region.h * b.height };
  for (const key of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(actual[key] - expected[key]) <= 1, JSON.stringify({ key, expected, actual }));
});
test('duplicate spatial copies remain ambiguous instead of selecting the first one', () => {
  const result = Inset.locate(clock(15), official(15, true).image);
  assert.notEqual(result.status, 'located', JSON.stringify(result));
});
test('uncertain frames preserve recent proposals without counting as confirmations', () => {
  const locator = new Inset.Locator();
  locator.observe(clock(12), official(12).image, 2);
  locator.observe(clock(14), official(14).image, 4);
  const blank = { width: 320, height: 180, values: new Float32Array(320 * 180).fill(.2) };
  assert.equal(locator.observe(clock(16), blank, 6).status, 'locating');
  assert.equal(locator.proposals.length, 2);
  assert.equal(locator.region, null);
  const result = locator.observe(clock(19), official(19).image, 9);
  assert.equal(result.status, 'located', JSON.stringify(result));
  assert.ok(Inset.overlap(result.region, official(19).region) > .9);
});
test('expired evidence and spatial ambiguity still clear localization proposals', () => {
  const stale = new Inset.Locator(), ambiguous = new Inset.Locator();
  for (const locator of [stale, ambiguous]) {
    locator.observe(clock(11), official(11).image, 0);
    locator.observe(clock(13), official(13).image, 2);
  }
  const blank = { width: 320, height: 180, values: new Float32Array(320 * 180).fill(.2) };
  assert.equal(stale.observe(clock(19), blank, 8).status, 'locating');
  assert.equal(stale.proposals.length, 0);
  assert.equal(stale.observe(clock(20), official(20).image, 9).status, 'locating');
  assert.equal(stale.proposals.length, 1);
  const duplicate = ambiguous.observe(clock(15), official(15, true).image, 4);
  assert.equal(duplicate.status, 'location-ambiguous', JSON.stringify(duplicate));
  assert.equal(ambiguous.proposals.length, 0);
  assert.equal(ambiguous.observe(clock(17), official(17).image, 6).status, 'locating');
  assert.equal(ambiguous.proposals.length, 1);
});
