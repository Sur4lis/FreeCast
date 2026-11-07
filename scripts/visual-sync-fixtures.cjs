'use strict';

// Generated seven-segment clock controls. Both regions contain the minute
// digits: seconds repeating in different minutes must not become a match.
const DIGITS = ['1111110', '0110000', '1101101', '1111001', '0110011',
  '1011011', '1011111', '1110000', '1111111', '1111011'];

function clock(seconds, minute) {
  const width = 232, height = 64;
  const values = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const pixel = (y * width + x) * 4, shade = 18 + (x * 7 + y * 3) % 5;
    values[pixel] = values[pixel + 1] = values[pixel + 2] = shade;
    values[pixel + 3] = 255;
  }
  const rectangle = (x, y, w, h) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      const pixel = (j * width + i) * 4;
      values[pixel] = values[pixel + 1] = values[pixel + 2] = 225;
    }
  };
  const value = `${String(minute).padStart(2, '0')}${String(((Math.floor(seconds) % 60) + 60) % 60).padStart(2, '0')}`;
  [...value].forEach((digit, index) => {
    const x = 54 + index * 20 + (index > 1 ? 6 : 0), y = 22;
    const segments = [[x + 2, y, 10, 3], [x + 12, y + 2, 3, 9], [x + 12, y + 11, 3, 9],
      [x + 2, y + 19, 10, 3], [x, y + 11, 3, 9], [x, y + 2, 3, 9], [x + 2, y + 9, 10, 3]];
    [...DIGITS[+digit]].forEach((enabled, segment) => {
      if (enabled === '1') rectangle(...segments[segment]);
    });
  });
  rectangle(94, 28, 3, 3);
  rectangle(94, 36, 3, 3);
  return { values, width, height };
}

exports.samples = spec => {
  const [x, y, width, height] = spec.roi;
  return {
    width, height, count: spec.duration * 4,
    close() {},
    read(index) {
      const source = clock((spec.start || 0) + index / 4, spec.minute ?? 1);
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let row = 0; row < height; row++) {
        const begin = ((y + row) * source.width + x) * 4;
        rgba.set(source.values.subarray(begin, begin + width * 4), row * width * 4);
      }
      return rgba;
    },
  };
};
