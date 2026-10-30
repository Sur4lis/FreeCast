(function (root) {
  'use strict';
  // Spatial registration only. A successful registration is NOT a time match:
  // the complete common rectangle still has to pass the temporal verifier.
  const MIN_COVERAGE = .65;
  const clamp = (x, low, high) => Math.max(low, Math.min(high, x));

  function pixel(image, x, y) {
    x = clamp(x, 0, image.width - 1); y = clamp(y, 0, image.height - 1);
    const ix = Math.floor(x), iy = Math.floor(y), dx = x - ix, dy = y - iy;
    const j = iy * image.width + ix, right = ix + 1 < image.width ? 1 : 0;
    const down = iy + 1 < image.height ? image.width : 0;
    return (image.values[j] * (1 - dx) + image.values[j + right] * dx) * (1 - dy)
      + (image.values[j + down] * (1 - dx) + image.values[j + down + right] * dx) * dy;
  }
  function average(frames) {
    const images = frames.map(frame => frame.image || frame);
    if (images.length < 3 || images.length > 16) return null;
    const { width, height } = images[0], length = width * height;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8 || width > 256 || height > 256 ||
        images.some(image => image.width !== width || image.height !== height || image.values.length !== length)) return null;
    const values = new Float32Array(length), variance = new Float32Array(length);
    for (const image of images) for (let i = 0; i < length; i++) {
      const value = image.values[i];
      if (!Number.isFinite(value)) return null;
      values[i] += value / images.length; variance[i] += value * value / images.length;
    }
    const stable = new Float32Array(length);
    for (let i = 0; i < length; i++) stable[i] = .2 + .8 / (1 + Math.max(0, variance[i] - values[i] ** 2) / .0025);
    return { width, height, values, stable: { width, height, values: stable } };
  }
  function smooth(image, width) {
    const height = Math.max(8, Math.min(64, Math.round(image.height * width / image.width)));
    const values = new Float32Array(width * height), weights = new Float32Array(width * height);
    const dx = image.width / width, dy = image.height / height;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let sum = 0, weight = 0;
      // An area approximation prevents thin score glyphs disappearing at a
      // coarse-grid phase. Dense refinement uses the original captured pixels.
      for (const fy of [.25, .75]) for (const fx of [.25, .75]) {
        sum += pixel(image, (x + fx) * dx - .5, (y + fy) * dy - .5);
        weight += pixel(image.stable, (x + fx) * dx - .5, (y + fy) * dy - .5);
      }
      values[y * width + x] = sum / 4; weights[y * width + x] = weight / 4;
    }
    return { width, height, values, stable: { width, height, values: weights } };
  }
  function intersection(transform, aspect) {
    const { x, y, scale } = transform, sy = scale * aspect;
    const left = Math.max(0, -x / scale), top = Math.max(0, -y / sy);
    const right = Math.min(1, (1 - x) / scale), bottom = Math.min(1, (1 - y) / sy);
    if (right <= left || bottom <= top) return null;
    const a = { x: left, y: top, w: right - left, h: bottom - top };
    const b = { x: x + left * scale, y: y + top * sy, w: a.w * scale, h: a.h * sy };
    const coverage = Math.min(a.w * a.h, b.w * b.h);
    return coverage >= MIN_COVERAGE ? { a, b, coverage } : null;
  }
  function score(a, b, transform, aspect, dense = false) {
    const common = intersection(transform, aspect);
    if (!common) return -1;
    let n = 0, sa = 0, sb = 0, aa = 0, bb = 0, ab = 0;
    const sx = transform.scale, sy = sx * aspect;
    const stride = dense ? 1 : 2;
    for (let y = 1; y < a.height - 1; y += stride) for (let x = 1; x < a.width - 1; x += stride) {
      const ax = (x + .5) / a.width, ay = (y + .5) / a.height;
      const bx = transform.x + ax * sx, by = transform.y + ay * sy;
      if (bx < 1 / b.width || by < 1 / b.height || bx > 1 - 1 / b.width || by > 1 - 1 / b.height) continue;
      const j = y * a.width + x, av = a.values[j], bv = pixel(b, bx * b.width - .5, by * b.height - .5);
      const w = Math.min(a.stable.values[j], pixel(b.stable, bx * b.width - .5, by * b.height - .5));
      n += w; sa += w * av; sb += w * bv; aa += w * av * av; bb += w * bv * bv; ab += w * av * bv;
    }
    const va = aa - sa * sa / n, vb = bb - sb * sb / n;
    return n >= 24 && va / n > .000625 && vb / n > .000625 ? (ab - sa * sb / n) / Math.sqrt(va * vb) : -1;
  }
  function distance(a, b, aspect) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.x + a.scale - b.x - b.scale),
      Math.abs(a.y - b.y), Math.abs(a.y + a.scale * aspect - b.y - b.scale * aspect));
  }
  function refine(a, b, seed, aspect, steps, dense = false) {
    let best = { ...seed, score: score(a, b, seed, aspect, dense) };
    for (const step of steps) for (let iteration = 0; iteration < 5; iteration++) {
      let next = best;
      for (const ds of [-step, 0, step]) for (const dx of [-step, 0, step]) for (const dy of [-step, 0, step]) {
        const scale = best.scale + ds;
        // Scale around the center so fitting size does not accidentally pull
        // translation toward an unrelated local glyph.
        const item = { x: best.x + dx - ds / 2, y: best.y + dy - ds * aspect / 2, scale };
        if (scale < .65 || scale > 1.55 || Math.abs(item.x) > .4 || Math.abs(item.y) > .4) continue;
        const value = score(a, b, item, aspect, dense);
        if (value > next.score + 1e-8) next = { ...item, score: value };
      }
      if (next === best) break;
      best = next;
    }
    return best;
  }
  function register(aFrames, bFrames) {
    const a = average(aFrames), b = average(bFrames);
    if (!a || !b) return { status: 'registering' };
    // One physical pixel scale, despite independently shaped crop rectangles.
    const aspect = a.height * b.width / (a.width * b.height);
    if (aspect < .55 || aspect > 1.8) return { status: 'registering', reason: 'aspect' };
    const ca = smooth(a, 64), cb = smooth(b, 64), candidates = [];
    function keep(item) {
      const same = candidates.findIndex(other => distance(item, other, aspect) < .06);
      if (same >= 0) {
        if (candidates[same].score >= item.score) return;
        candidates.splice(same, 1);
      }
      candidates.push(item); candidates.sort((x, y) => y.score - x.score);
      if (candidates.length > 12) candidates.pop();
    }
    for (let si = 0; si <= 12; si++) for (let yi = -6; yi <= 6; yi++) for (let xi = -12; xi <= 12; xi++) {
      const item = { scale: .7 + si * .05, x: xi * .025, y: yi * .05 };
      const value = score(ca, cb, item, aspect);
      if (value > .65 && (candidates.length < 12 || value > candidates.at(-1).score)) keep({ ...item, score: value });
    }
    if (!candidates.length) return { status: 'registering', reason: 'no-common-structure' };
    const refined = candidates.map(item => refine(ca, cb, item, aspect, [.025, .0125, .00625], true));
    refined.sort((x, y) => y.score - x.score);
    const distinct = [];
    for (const item of refined) if (!distinct.some(other => distance(item, other, aspect) < .025)) distinct.push(item);
    // Refine competing fits as well as the winner; repeated scoreboard motifs
    // must not look unique just because one fit landed nearer a coarse sample.
    const dense = distinct.slice(0, 5).map(item => refine(a, b, item, aspect, [.005, .0025, .00125, .000625, .0003125], true));
    dense.sort((x, y) => y.score - x.score);
    const best = dense[0], alternative = dense.find(item => distance(item, best, aspect) > .04);
    const margin = best.score - (alternative?.score ?? 0);
    if (best.score < .9) return { status: 'registering', reason: 'weak-structure', score: best.score };
    if (margin < .035) return { status: 'registration-ambiguous', score: best.score, margin };
    const common = intersection(best, aspect);
    return { status: 'registered', ...common, score: best.score, margin,
      transform: { x: best.x, y: best.y, scale: best.scale, aspect } };
  }
  function sameGeometry(a, b, tolerance = .01) {
    if (!a || !b || !a.transform || !b.transform || Math.abs(a.transform.aspect - b.transform.aspect) > 1e-6) return false;
    return distance(a.transform, b.transform, a.transform.aspect) <= tolerance;
  }
  const api = { MIN_COVERAGE, register, sameGeometry };
  if (typeof module !== 'undefined') module.exports = api; else root.VisualSyncOverlap = api;
})(globalThis);
