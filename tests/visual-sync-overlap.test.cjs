const { test } = require('node:test');
const assert = require('node:assert/strict');
const Overlap = require('../browser-extension/ui/visual-sync-overlap.js');

function capture(rect, width, height, time, variant = 0) {
  const values = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const xx = rect.x + (x + .5) * rect.w / width, yy = rect.y + (y + .5) * rect.h / height;
    let value = .35 + .10 * Math.sin(xx * .037 + yy * .091 + variant * 5)
      + .09 * Math.sin(xx * .123 - yy * .044 + variant * 3)
      + .08 * Math.cos(xx * .047 + yy * .139 - variant * 7);
    for (let k = 0; k < 9; k++) {
      const px = 26 + (k * 67 + variant * 29) % 237, py = 14 + (k * 37 + variant * 17) % 91;
      value += .22 * Math.exp(-((xx - px) ** 2 / 27 + (yy - py) ** 2 / 18));
    }
    if (yy > 80) value += .13 * Math.sin(xx * .15 + time * 1.3) * Math.sin(yy * .18 + time * .9);
    values[y * width + x] = value;
  }
  return { width, height, values };
}
const aRect = { x: 40, y: 20, w: 200, h: 80 };
function registration(bRect, width, height, variant = 0) {
  const a = [], b = [];
  for (const time of [0, 2, 4, 6, 8, 10, 12, 14]) {
    a.push(capture(aRect, 200, 80, time));
    b.push(capture(bRect, width, height, time + 8, variant));
  }
  return Overlap.register(a, b);
}
function closePixels(actual, expected, size, limit = 1) {
  assert.ok(Math.abs(actual - expected) * size < limit, `${actual} versus ${expected} (${size} pixels)`);
}

test('joint crop registration recovers an 81-percent intersection despite an unknown time shift', () => {
  const result = registration({ x: 60, y: 28, w: 200, h: 80 }, 220, 88);
  assert.equal(result.status, 'registered', JSON.stringify(result));
  closePixels(result.a.x, .1, 200); closePixels(result.a.y, .1, 80);
  closePixels(result.a.w, .9, 200); closePixels(result.a.h, .9, 80);
  closePixels(result.b.x, 0, 220); closePixels(result.b.y, 0, 88);
  assert.ok(result.coverage > .79 && result.coverage < .83);
  assert.equal(result.mediaDelta, undefined, 'Spatial registration cannot claim a time correspondence');
});

test('different crop size and aspect ratio retain one physical scale and the maximal common area', () => {
  const result = registration({ x: 30, y: 12, w: 220, h: 96 }, 220, 96);
  assert.equal(result.status, 'registered', JSON.stringify(result));
  closePixels(result.a.x, 0, 200); closePixels(result.a.y, 0, 80);
  closePixels(result.a.w, 1, 200); closePixels(result.a.h, 1, 80);
  closePixels(result.b.x, 10 / 220, 220); closePixels(result.b.y, 8 / 96, 96);
  closePixels(result.b.w, 200 / 220, 220); closePixels(result.b.h, 80 / 96, 96);
  assert.ok(result.b.w * result.b.h > .75, 'Do not hide disagreement by choosing only a tiny landmark');
});

test('flat frames, different pictures and insufficient common area cannot establish geometry', () => {
  const flat = { width: 200, height: 80, values: new Float32Array(200 * 80).fill(.2) };
  assert.notEqual(Overlap.register([flat, flat, flat], [flat, flat, flat]).status, 'registered');
  assert.notEqual(registration({ x: 60, y: 28, w: 200, h: 80 }, 220, 88, 5).status, 'registered');
  assert.notEqual(registration({ x: 150, y: 28, w: 200, h: 80 }, 220, 88).status, 'registered');
});

test('multiple competing copies remain ambiguous', () => {
  const image = { width: 240, height: 80, values: new Float32Array(240 * 80) };
  for (let y = 0; y < 80; y++) for (let x = 0; x < 240; x++) {
    image.values[y * 240 + x] = .3 + .15 * Math.sin(x * Math.PI / 24) + .15 * Math.sin(y * .13) * Math.cos(x * Math.PI / 12);
  }
  const result = Overlap.register([image, image, image], [image, image, image]);
  assert.equal(result.status, 'registration-ambiguous', JSON.stringify(result));
});
