const { test } = require('node:test');
const assert = require('node:assert/strict');
const Inset = require('../browser-extension/ui/visual-sync-inset.js');

const digits = ['1111110', '0110000', '1101101', '1111001', '0110011', '1011011', '1011111', '1110000', '1111111', '1111011'];
function clock(seconds, minute, divider, missingDivider = false) {
  const width = 192, height = 64, values = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) values[y * width + x] = .07 + ((x * 7 + y * 3) % 5) / 255;
  const rectangle = (x, y, w, h, ink = .88) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) values[j * width + i] = ink;
  };
  const value = `${String(minute).padStart(2, '0')}${String(((Math.floor(seconds) % 60) + 60) % 60).padStart(2, '0')}`;
  [...value].forEach((n, index) => {
    const x = 30 + index * 20 + (index > 1 ? 6 : 0), y = 22;
    const segments = [[x + 2, y, 10, 3], [x + 12, y + 2, 3, 9], [x + 12, y + 11, 3, 9],
      [x + 2, y + 19, 10, 3], [x, y + 11, 3, 9], [x, y + 2, 3, 9], [x + 2, y + 9, 10, 3]];
    [...digits[Number(n)]].forEach((enabled, i) => { if (enabled === '1') rectangle(...segments[i]); });
  });
  rectangle(70, 28, 3, 3); rectangle(70, 36, 3, 3);
  if (!missingDivider) rectangle(140, 2, 1, 56, divider);
  return { width, height, values };
}
function histories({ minuteA = 1, minuteB = 1, still = false, repeat = false, missingDivider = false } = {}) {
  const a = [], b = [];
  for (let i = 0; i <= 160; i++) {
    const at = i / 4, ta = still ? 0 : repeat ? (at - 8 + 100) % 2 : at - 8, tb = still ? 0 : repeat ? at % 2 : at;
    a.push({ at, mediaTime: 1000 + at, feature: Inset.fingerprint(clock(ta, minuteA, .95)) });
    b.push({ at, mediaTime: 200 + at, feature: Inset.fingerprint(clock(tb, minuteB, .65, missingDivider)) });
  }
  return { a, b };
}

test('registered crops tolerate the same thin divider with different contrast without changing the default verifier', () => {
  const { a, b } = histories();
  assert.notEqual(Inset.estimate(a, b).status, 'match', 'Unregistered behavior must remain unchanged');
  const result = Inset.estimate(a, b, { registered: true });
  assert.equal(result.status, 'match', JSON.stringify(result));
  assert.equal(result.mediaDelta, 808);
});

test('registered local contrast verification still rejects missing minute strokes', () => {
  for (const [minuteA, minuteB] of [[1, 0], [0, 1], [1, 4], [1, 7], [1, 8], [1, 3], [8, 3], [3, 8], [0, 8], [8, 0]]) {
    const { a, b } = histories({ minuteA, minuteB });
    const result = Inset.estimate(a, b, { registered: true });
    assert.notEqual(result.status, 'match', JSON.stringify({ minuteA, minuteB, result }));
    assert.equal(result.mediaDelta, undefined);
  }
});

test('registered contrast checks require an actual corresponding edge and temporal evidence', () => {
  for (const options of [{ missingDivider: true }, { still: true }, { repeat: true }]) {
    const { a, b } = histories(options), result = Inset.estimate(a, b, { registered: true });
    assert.notEqual(result.status, 'match', JSON.stringify({ options, result }));
    assert.equal(result.mediaDelta, undefined);
  }
});
