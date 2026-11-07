const { test } = require('node:test');
const assert = require('node:assert/strict');
const V = require('../browser-extension/ui/visual-sync-core.js');
const Sync = require('../browser-extension/ui/sync.js');

// Procedural moving texture: independently timed frames, not stored matcher
// outputs. Exposure and an opaque corner overlay simulate a restream encoding.
function pixels(time, seed = 1, altered = false) {
  const rgba = new Uint8ClampedArray(V.WIDTH * V.HEIGHT * 4);
  for (let y = 0; y < V.HEIGHT; y++) for (let x = 0; x < V.WIDTH; x++) {
    let value = 120 + 35 * Math.sin(x * 1.1 + time * 2.3 + seed * 19)
      + 40 * Math.cos(y * 1.3 - time * 1.7 + seed * 7)
      + 30 * Math.sin(x * .7 + y * .9 + time * time * .09 + seed * 13);
    if (altered) value = x < 8 && y < 6 ? (x % 2) * 200 : value * .75 + 25;
    const i = (y * V.WIDTH + x) * 4;
    rgba[i] = rgba[i + 1] = rgba[i + 2] = value; rgba[i + 3] = 255;
  }
  return rgba;
}

function streams({ duration = 40, behindA = 6.25, behindB = 0, offset = 0, drop = false, seedB = 1 } = {}) {
  const a = [], b = [], delays = Sync.delays(offset, 3);
  for (let i = 0; i <= duration * 4; i++) {
    const at = i / 4;
    a.push({ at, mediaTime: 1000 + at - delays.a, feature: V.fingerprint(pixels(at - delays.a - behindA, 1, true)) });
    if (!drop || i % 11 !== 0) b.push({ at, mediaTime: 200 + at - delays.b, feature: V.fingerprint(pixels(at - delays.b - behindB, seedB)) });
  }
  return { a, b };
}

test('finds the same scene despite exposure changes, a webcam-sized overlay and dropped frames', () => {
  const { a, b } = streams({ drop: true });
  const result = V.estimate(a, b);
  assert.equal(result.status, 'match');
  assert.ok(Math.abs(result.lag - 6.25) <= .25);
  assert.ok(Math.abs(result.mediaDelta - 806.25) <= .25);
  assert.ok(result.pairs >= 24);
});

test('both lag signs and existing manual offsets produce the correct absolute player offset', () => {
  for (const [behindA, behindB, offset] of [[6.25, 0, 0], [0, 4.5, 0], [5, 0, 9], [0, 8, -12]]) {
    const { a, b } = streams({ behindA, behindB, offset });
    const result = V.estimate(a, b);
    assert.equal(result.status, 'match', JSON.stringify({ behindA, behindB, offset, result }));
    const value = V.targetOffset(1040, 240, result.mediaDelta);
    assert.ok(Math.abs(value - (behindB - behindA)) <= .3);
    const delay = Sync.delays(value, 3);
    // After the existing edge-based player applies the result, both screens
    // represent the same event, even though their media clocks have different origins.
    const eventA = 1040 - delay.a - 1000 - behindA;
    const eventB = 240 - delay.b - 200 - behindB;
    assert.ok(Math.abs(eventA - eventB) <= .3);
  }
});

test('handles asynchronous non-grid frame presentation times', () => {
  const a = [], b = [];
  for (let i = 0; i < 180; i++) {
    const ta = i * .251, tb = i * .249 + .07;
    a.push({ at: ta, mediaTime: 500 + ta, feature: V.fingerprint(pixels(ta - 3.13)) });
    b.push({ at: tb, mediaTime: 100 + tb, feature: V.fingerprint(pixels(tb)) });
  }
  const result = V.estimate(a, b);
  assert.equal(result.status, 'match');
  assert.ok(Math.abs(result.lag - 3.13) <= .25);
});

test('the supported 60-second boundary has enough neighboring candidates for validation', () => {
  for (const [behindA, behindB] of [[60, 0], [0, 60]]) {
    const { a, b } = streams({ duration: 80, behindA, behindB });
    const result = V.estimate(a, b);
    assert.equal(result.status, 'match');
    assert.equal(V.targetOffset(1080, 280, result.mediaDelta), behindB - behindA);
  }
});

test('refuses static textured frames, black frames, unrelated video and repeating scenes', () => {
  const make = generator => Array.from({ length: 160 }, (_, i) => ({ at: i / 4, mediaTime: i / 4, feature: V.fingerprint(generator(i / 4)) }));
  for (const rgba of [pixels(0), new Uint8ClampedArray(V.WIDTH * V.HEIGHT * 4)]) {
    const still = make(() => rgba);
    assert.notEqual(V.estimate(still, still).status, 'match');
  }
  const unrelated = streams({ seedB: 9 });
  assert.notEqual(V.estimate(unrelated.a, unrelated.b).status, 'match');
  const repeating = make(time => pixels(time % 2));
  assert.notEqual(V.estimate(repeating, repeating).status, 'match');
});

test('does not infer a lag from insufficient overlap or a lone similar frame', () => {
  const short = streams({ duration: 5 });
  assert.equal(V.estimate(short.a, short.b).status, 'collecting');
  const unrelated = streams({ seedB: 9 });
  unrelated.b.at(-1).feature = unrelated.a.at(-1).feature;
  assert.notEqual(V.estimate(unrelated.a, unrelated.b).status, 'match');
});

test('history is bounded and rejects duplicate or backward media timestamps', () => {
  const history = new V.History(), feature = V.fingerprint(pixels(0));
  for (let i = 0; i < 1000; i++) history.add({ at: i / 4, mediaTime: i / 4, feature });
  assert.ok(history.frames.length <= V.MAX_FRAMES);
  assert.ok(history.frames.at(-1).at - history.frames[0].at <= V.HISTORY_SECONDS);
  const count = history.frames.length;
  history.add({ at: 250, mediaTime: 1, feature });
  history.add({ at: NaN, mediaTime: 251, feature });
  assert.equal(history.frames.length, count);
});

test('requires repeated consistent estimates, and forgets failures, jumps and stale results', () => {
  const stability = new V.Stability(), match = delta => ({ status: 'match', mediaDelta: delta });
  assert.equal(stability.observe(match(8), 0), false);
  assert.equal(stability.observe(match(8.1), 2), false);
  assert.equal(stability.observe(match(8), 4), true);
  assert.equal(stability.observe({ status: 'ambiguous' }, 6), false);
  assert.equal(stability.observe(match(8), 8), false);
  assert.equal(stability.observe(match(10), 10), false);
  assert.equal(stability.observe(match(10), 12), false);
  assert.equal(stability.observe(match(10), 20), false);
});

test('unsupported offsets and invalid live edges are refused instead of silently clamped', () => {
  assert.equal(V.targetOffset(800, 0, 806), -6);
  assert.equal(V.targetOffset(800, 0, 700), null);
  assert.equal(V.targetOffset(null, 0, 0), null);
  assert.equal(V.targetOffset(800, Infinity, 0), null);
  assert.throws(() => V.fingerprint(new Uint8Array(4)), /frame size/);
});
