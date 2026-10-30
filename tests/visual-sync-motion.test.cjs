const { test } = require('node:test');
const assert = require('node:assert/strict');
const Inset = require('../browser-extension/ui/visual-sync-inset.js');
const V = require('../browser-extension/ui/visual-sync-core.js');

// A fixed geometric header above continuous motion, with no text or clock.
// The changing phase rate avoids a short repeating animation as a time cue.
function motionScene(time, variant = 0) {
  const width = 190, height = 49, values = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    values[y * width + x] = y < 22
      ? .08 + (((x + 7) % 23 < 4 && y > 3 && y < 19) ? .8 : 0)
      : .3 + .15 * Math.sin(x * .16 + y * .2 + time * (.71 + variant * .23) + .013 * time * time)
        + .13 * Math.cos(x * .07 - y * .31 + time * (1.13 + variant * .51) + .021 * time * time);
  }
  return { width, height, values };
}

function resize(image, width, height) {
  return { width, height, values: Inset.sample(image,
    { x: 0, y: 0, w: image.width, h: image.height }, width, height) };
}

function histories({ lag = 8, originA = 1000, originB = 200, variantB = 0, still = false } = {}) {
  const a = [], b = [];
  for (let i = 0; i <= 160; i++) {
    const at = i / 4;
    a.push({ at, mediaTime: originA + at,
      feature: Inset.fingerprint(motionScene(still ? 0 : at - lag)) });
    // The official crop is larger, then captured under the dual-mode 256 px cap.
    const official = resize(motionScene(still ? 0 : at, variantB), 320, 82);
    const captured = resize(official, 256, Math.round(82 * 256 / 320));
    b.push({ at, mediaTime: originB + at, feature: Inset.fingerprint(captured) });
  }
  return { a, b };
}

for (const lag of [8, -8]) {
  test(`non-clock motion aligns lag ${lag} across independent media origins`, () => {
    for (const [originA, originB] of [[1000, 200], [41.375, 600.125]]) {
      const { a, b } = histories({ lag, originA, originB });
      const result = Inset.estimate(a, b), details = JSON.stringify({ lag, originA, originB, result });
      assert.equal(result.status, 'match', details);
      assert.ok(Math.abs(result.lag - lag) <= .25, details);
      assert.ok(Math.abs(result.mediaDelta - (originA - originB + lag)) <= .25, details);
      assert.equal(V.targetOffset(a.at(-1).mediaTime, b.at(-1).mediaTime, result.mediaDelta), -lag, details);
    }
  });
}

test('a shared static header cannot align different moving pictures', () => {
  const original = motionScene(12), different = motionScene(12, 3), headerPixels = 190 * 22;
  assert.deepEqual(original.values.slice(0, headerPixels), different.values.slice(0, headerPixels));
  assert.notDeepEqual(original.values.slice(headerPixels), different.values.slice(headerPixels));
  const { a, b } = histories({ variantB: 3 });
  const result = Inset.estimate(a, b);
  assert.notEqual(result.status, 'match', JSON.stringify(result));
  assert.equal(result.mediaDelta, undefined);
});

test('an entirely frozen non-clock scene provides no temporal alignment', () => {
  const { a, b } = histories({ still: true });
  const result = Inset.estimate(a, b);
  assert.equal(result.status, 'static', JSON.stringify(result));
  assert.equal(result.mediaDelta, undefined);
});
