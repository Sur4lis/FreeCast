(function (root) {
  'use strict';
  const FW = 96, FH = 24, N = FW * FH, STEP = .25, WINDOW = 8, MIN_PAIRS = 24;
  const SW = 192, SH = 48, SN = SW * SH;
  const min = Math.min, max = Math.max, floor = Math.floor, sqrt = Math.sqrt;
  const median = values => { const v = [...values].sort((a, b) => a - b); return (v[(v.length - 1) >> 1] + v[v.length >> 1]) / 2; };

  function gray(rgba, width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width > 1920 || height > 1920 || rgba.length !== width * height * 4) throw Error('Unexpected inset frame size');
    const values = new Float32Array(width * height);
    for (let i = 0; i < values.length; i++) values[i] = (.2126 * rgba[i * 4] + .7152 * rgba[i * 4 + 1] + .0722 * rgba[i * 4 + 2]) / 255;
    return { values, width, height };
  }
  function pixel(image, x, y) {
    x = max(0, min(image.width - 1, x)); y = max(0, min(image.height - 1, y));
    const ix = floor(x), iy = floor(y), dx = x - ix, dy = y - iy, j = iy * image.width + ix;
    const right = ix + 1 < image.width ? 1 : 0, down = iy + 1 < image.height ? image.width : 0;
    return (image.values[j] * (1 - dx) + image.values[j + right] * dx) * (1 - dy)
      + (image.values[j + down] * (1 - dx) + image.values[j + down + right] * dx) * dy;
  }
  function sample(image, rect, width, height) {
    const values = new Float32Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) values[y * width + x] = pixel(image,
      rect.x + (x + .5) * rect.w / width - .5, rect.y + (y + .5) * rect.h / height - .5);
    return values;
  }
  function normalize(values) {
    let sum = 0, square = 0;
    for (const v of values) { sum += v; square += v * v; }
    const mean = sum / values.length, variance = Math.max(0, square / values.length - mean * mean), std = Math.sqrt(variance);
    if (std < .025) return null;
    for (let i = 0; i < values.length; i++) values[i] = (values[i] - mean) / std;
    return values;
  }
  function integral(image) {
    const width = image.width + 1, height = image.height + 1, values = new Float64Array(width * height);
    for (let y = 1; y < height; y++) {
      let row = 0;
      for (let x = 1; x < width; x++) { row += image.values[(y - 1) * image.width + x - 1]; values[y * width + x] = values[(y - 1) * width + x] + row; }
    }
    return { width, height, values };
  }
  function areaValue(summed, x, y, w, h) {
    return (pixel(summed, x + w, y + h) - pixel(summed, x, y + h) - pixel(summed, x + w, y) + pixel(summed, x, y)) / (w * h);
  }
  function areaTemplate(image, width, height) {
    const summed = integral(image), values = new Float32Array(width * height), w = image.width / width, h = image.height / height;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) values[y * width + x] = areaValue(summed, x * w, y * h, w, h);
    return normalize(values) && { values, width, height };
  }
  function areaGrid(w, h, target, stride) {
    const offsets = new Int32Array(target.values.length * 4), inverse = new Float64Array(target.values.length);
    for (let y = 0, i = 0; y < target.height; y++) for (let x = 0; x < target.width; x++, i++) {
      const x1 = Math.round(x * w / target.width), x2 = Math.round((x + 1) * w / target.width);
      const y1 = Math.round(y * h / target.height), y2 = Math.round((y + 1) * h / target.height);
      offsets[i * 4] = y1 * stride + x1; offsets[i * 4 + 1] = y1 * stride + x2;
      offsets[i * 4 + 2] = y2 * stride + x1; offsets[i * 4 + 3] = y2 * stride + x2;
      inverse[i] = 1 / ((x2 - x1) * (y2 - y1));
    }
    return { offsets, inverse };
  }
  function areaScore(summed, rect, target, grid) {
    const base = rect.y * summed.width + rect.x, values = summed.values, offsets = grid.offsets;
    let sum = 0, square = 0, dot = 0;
    for (let i = 0; i < target.values.length; i++) {
      const j = i * 4;
      const v = (values[base + offsets[j + 3]] - values[base + offsets[j + 2]] - values[base + offsets[j + 1]] + values[base + offsets[j]]) * grid.inverse[i];
      sum += v; square += v * v; dot += v * target.values[i];
    }
    const energy = square - sum * sum / target.values.length;
    return energy > target.values.length * .0001 ? dot / sqrt(energy * target.values.length) : -1;
  }
  function fingerprint(image, rect = { x: 0, y: 0, w: image.width, h: image.height }) {
    let summed;
    function filtered(width, height) {
      if (rect.w <= width || rect.h <= height) return normalize(sample(image, rect, width, height));
      // Area filtering prevents a fractional crop shift from erasing an entire
      // thin score glyph when a wide scoreboard is reduced to this fingerprint.
      summed ||= integral(image);
      const w = rect.w / width, h = rect.h / height, values = new Float32Array(width * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) values[y * width + x] = areaValue(summed, rect.x + x * w, rect.y + y * h, w, h);
      return normalize(values);
    }
    return { values: filtered(FW, FH), width: FW, height: FH,
      structure: filtered(SW, SH), sourceWidth: rect.w, sourceHeight: rect.h };
  }
  function nearest(frames, at) {
    let lo = 0, hi = frames.length;
    while (lo < hi) { const m = (lo + hi) >>> 1; if (frames[m].at < at) lo = m + 1; else hi = m; }
    const a = frames[lo - 1], b = frames[lo];
    const frame = !b || a && at - a.at <= b.at - at ? a : b;
    return frame && Math.abs(frame.at - at) <= .18 ? frame : null;
  }
  function activity(frames) {
    const chosen = frames.filter((f, i) => i % 4 === 0 && f.feature.values);
    if (chosen.length < 8) return null;
    const sum = new Float64Array(N), square = new Float64Array(N);
    for (const frame of chosen) for (let i = 0; i < N; i++) { const v = frame.feature.values[i]; sum[i] += v; square[i] += v * v; }
    const variance = Array.from(sum, (s, i) => ({ i, variance: Math.max(0, square[i] / chosen.length - (s / chosen.length) ** 2) }));
    variance.sort((a, b) => b.variance - a.variance);
    const threshold = Math.max(.02, variance[0].variance * .12);
    const indices = variance.filter(v => v.variance >= threshold).slice(0, 128).map(v => v.i);
    if (indices.length < 6) return null;
    // Include the static context around changing digits. Matching only the ones
    // digit would otherwise accept a different minute or a different scoreboard.
    let left = FW, top = FH, right = 0, bottom = 0;
    for (const i of indices) { left = Math.min(left, i % FW); right = Math.max(right, i % FW); top = Math.min(top, Math.floor(i / FW)); bottom = Math.max(bottom, Math.floor(i / FW)); }
    left = Math.max(0, left - 16); right = Math.min(FW - 1, right + 16);
    top = Math.max(0, top - 8); bottom = Math.min(FH - 1, bottom + 8);
    const context = [];
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) context.push(y * FW + x);
    return { indices, context };
  }
  function contextScore(a, b, indices) {
    let sa = 0, sb = 0, aa = 0, bb = 0, ab = 0;
    for (const i of indices) { const x = a[i], y = b[i]; sa += x; sb += y; aa += x * x; bb += y * y; ab += x * y; }
    const n = indices.length, va = aa - sa * sa / n, vb = bb - sb * sb / n;
    return va > .01 && vb > .01 ? (ab - sa * sb / n) / Math.sqrt(va * vb) : -1;
  }
  function staticDifference(pairs, verifyDetail = true, registered = false) {
    if (!verifyDetail) return { consistent: true, deferred: true };
    // Fixed text is decided at its own resolution after global registration.
    // Per-pixel neighbor matching in the small temporal descriptor can both
    // erase a minute stroke and reject the same resampled glyph.
    const detail = detailedStructure(pairs, registered);
    return { consistent: detail.consistent, detail };
  }
  function detailedStructure(pairs, registered = false) {
    const a = new Float32Array(SN), b = new Float32Array(SN);
    const firstA = pairs[0].a.feature, firstB = pairs[0].b.feature;
    if (pairs.some(p => !p.a.feature.structure || !p.b.feature.structure)) return { consistent: false, reason: 'missing-structure' };
    const rx = max(1, Math.ceil(SW / min(firstA.sourceWidth, firstB.sourceWidth) * .5));
    const ry = max(1, Math.ceil(SH / min(firstA.sourceHeight, firstB.sourceHeight) * .5));
    if (rx > 4 || ry > 4) return { consistent: false, reason: 'insufficient-resolution' };
    for (const pair of pairs) for (let i = 0; i < SN; i++) { a[i] += pair.a.feature.structure[i] / pairs.length; b[i] += pair.b.feature.structure[i] / pairs.length; }
    const ia = integral({ values: a, width: SW, height: SH }), ib = integral({ values: b, width: SW, height: SH });
    const smoothA = new Float32Array(SN), smoothB = new Float32Array(SN);
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
      const left = max(0, x - rx), top = max(0, y - ry), w = min(SW, x + rx + 1) - left, h = min(SH, y + ry + 1) - top;
      smoothA[y * SW + x] = areaValue(ia, left, top, w, h); smoothB[y * SW + x] = areaValue(ib, left, top, w, h);
    }
    // A non-square source pixel or a canvas crop can introduce a common
    // subpixel translation. Fit ONE translation for the entire selected image,
    // bounded to half a captured source pixel; never move each glyph separately.
    const limitX = SW / min(firstA.sourceWidth, firstB.sourceWidth) * .5;
    const limitY = SH / min(firstA.sourceHeight, firstB.sourceHeight) * .5;
    const translated = (x, y, dx, dy) => {
      const xx = x + dx, yy = y + dy, ix = floor(xx), iy = floor(yy), fx = xx - ix, fy = yy - iy, j = iy * SW + ix;
      return (smoothB[j] * (1 - fx) + smoothB[j + 1] * fx) * (1 - fy)
        + (smoothB[j + SW] * (1 - fx) + smoothB[j + SW + 1] * fx) * fy;
    };
    function registration(dx, dy) {
      let error = 0;
      for (let y = ry + 1; y < SH - ry - 1; y += 2) for (let x = rx + 1; x < SW - rx - 1; x += 2) error += (smoothA[y * SW + x] - translated(x, y, dx, dy)) ** 2;
      return error;
    }
    let shift = { x: 0, y: 0, error: registration(0, 0) };
    for (const fraction of [1, .25, .125]) {
      const origin = fraction === 1 ? { x: 0, y: 0 } : shift;
      const offsets = fraction === 1 ? [-1, -.5, 0, .5, 1] : [-1, 0, 1];
      for (const dx of offsets) for (const dy of offsets) {
        const x = origin.x + dx * limitX * fraction, y = origin.y + dy * limitY * fraction;
        if (Math.abs(x) > limitX || Math.abs(y) > limitY) continue;
        const error = registration(x, y); if (error < shift.error - 1e-9) shift = { x, y, error };
      }
    }
    const residual = new Uint8Array(SN); let count = 0;
    // Compare local ink mass at a higher resolution. Averaging at half a source
    // pixel cancels opposite codec/edge residuals, but cannot erase a missing
    // minute stroke by independently shifting every pixel onto its neighbor.
    for (let y = ry + 1; y < SH - ry - 1; y++) for (let x = rx + 1; x < SW - rx - 1; x++) {
      const va = smoothA[y * SW + x], vb = translated(x, y, shift.x, shift.y);
      if (Math.abs(va - vb) > .5) { residual[y * SW + x] = 1; count++; }
    }
    const originalPixels = count;
    if (registered && count && count <= SN * .1) {
      // After cropping an overlap, a thin divider can land on different sample
      // phases and retain its shape but lose ink mass in one stream. Explain
      // only a bounded number of residuals by positive local contrast changes.
      // Both neighborhoods use the SAME coordinates and the ONE global shift;
      // no per-pixel, per-character or neighboring-position search is allowed.
      for (let i = 0; i < SN; i++) if (residual[i]) {
        const cx = i % SW, cy = floor(i / SW);
        let n = 0, sa = 0, sb = 0, aa = 0, bb = 0, ab = 0;
        for (let y = max(ry + 1, cy - 3); y <= min(SH - ry - 2, cy + 3); y++) {
          for (let x = max(rx + 1, cx - 3); x <= min(SW - rx - 2, cx + 3); x++) {
            const va = smoothA[y * SW + x], vb = translated(x, y, shift.x, shift.y);
            n++; sa += va; sb += vb; aa += va * va; bb += vb * vb; ab += va * vb;
          }
        }
        const va = aa - sa * sa / n, vb = bb - sb * sb / n;
        // A missing minute stroke has no corresponding local edge and cannot
        // pass this correlation/energy test, even beside an unchanged digit.
        if (va / n <= .0064 || vb / n <= .0064) continue;
        const gain = sqrt(vb / va), correlation = (ab - sa * sb / n) / sqrt(va * vb);
        if (gain >= .5 && gain <= 2 && correlation >= .95) { residual[i] = 0; count--; }
      }
    }
    const contrast = registered ? { originalPixels, contrastAdjustedPixels: originalPixels - count } : {};
    const translation = { x: shift.x, y: shift.y };
    // Describe unexplained pixels before component traversal consumes the mask.
    // This is diagnostic only: a border stroke remains mandatory evidence.
    let left = SW, top = SH, right = -1, bottom = -1;
    for (let i = 0; i < SN; i++) if (residual[i]) {
      const x = i % SW, y = floor(i / SW);
      left = min(left, x); right = max(right, x); top = min(top, y); bottom = max(bottom, y);
    }
    const boundaryEdges = [];
    if (count) {
      if (right < rx + 1 + Math.ceil(limitX)) boundaryEdges.push('left');
      if (left >= SW - rx - 1 - Math.ceil(limitX)) boundaryEdges.push('right');
      if (bottom < ry + 1 + Math.ceil(limitY)) boundaryEdges.push('top');
      if (top >= SH - ry - 1 - Math.ceil(limitY)) boundaryEdges.push('bottom');
    }
    const residualBounds = count ? { x: left / SW, y: top / SH, w: (right - left + 1) / SW, h: (bottom - top + 1) / SH } : null;
    const location = { residualBounds, boundaryEdges };
    if (count >= 12) return { consistent: false, pixels: count, component: null, translation, ...contrast, ...location };
    let largest = 0;
    for (let i = 0; i < SN; i++) if (residual[i]) {
      const stack = [i]; residual[i] = 0; let size = 0;
      while (stack.length) {
        const j = stack.pop(); if (++size >= 4) return { consistent: false, pixels: count, component: size, translation, ...contrast, ...location };
        for (const k of [j - SW, j + SW, j - 1, j + 1]) if (k >= 0 && k < SN && residual[k]) { residual[k] = 0; stack.push(k); }
      }
      largest = max(largest, size);
    }
    return { consistent: true, pixels: count, component: largest, translation, ...contrast, ...location };
  }
  function candidate(a, b, lag, mask, trimBoundaries = false) {
    const end = Math.min(a.at(-1).at, b.at(-1).at + lag), start = Math.max(a[0].at, b[0].at + lag);
    if (end - start < WINDOW) return null;
    let pairs = []; const used = new Set();
    for (const frame of a) {
      if (frame.at < end - WINDOW || frame.at > end || !frame.feature.values) continue;
      const other = nearest(b, frame.at - lag);
      if (!other?.feature.values || used.has(other)) continue;
      used.add(other); pairs.push({ a: frame, b: other });
    }
    if (pairs.length < MIN_PAIRS || pairs.at(-1).a.at - pairs[0].a.at < WINDOW - .6) return null;
    const samplePairs = pairs.length;
    if (trimBoundaries) {
      const consistent = pairs.filter(p => contextScore(p.a.feature.values, p.b.feature.values, mask.context) >= .90);
      if (pairs.length - consistent.length > Math.floor(pairs.length * .15) || consistent.length < MIN_PAIRS || consistent.at(-1).a.at - consistent[0].a.at < WINDOW - .6) return null;
      pairs = consistent;
    }
    let covariance = 0, energyA = 0, energyB = 0;
    for (const i of mask.indices) {
      let sa = 0, sb = 0, aa = 0, bb = 0, ab = 0;
      for (const p of pairs) { const x = p.a.feature.values[i], y = p.b.feature.values[i]; sa += x; sb += y; aa += x * x; bb += y * y; ab += x * y; }
      covariance += ab - sa * sb / pairs.length;
      energyA += aa - sa * sa / pairs.length; energyB += bb - sb * sb / pairs.length;
    }
    const count = pairs.length * mask.indices.length;
    if (energyA / count < .02 || energyB / count < .02) return { lag, pairs, score: -1, static: true };
    return { lag, pairs, samplePairs, rejectedBoundaryPairs: samplePairs - pairs.length, score: covariance / Math.sqrt(energyA * energyB) };
  }
  function changing(pairs, key, indices) {
    let previous = pairs[0][key], changes = 0;
    for (const pair of pairs) {
      const frame = pair[key]; if (frame.at - previous.at < .9) continue;
      let difference = 0;
      for (const i of indices) difference += (frame.feature.values[i] - previous.feature.values[i]) ** 2;
      if (difference / indices.length > .04) changes++;
      previous = frame;
    }
    return changes >= 4;
  }
  function estimate(a, b, { registered = false } = {}) {
    if (a.length < MIN_PAIRS || b.length < MIN_PAIRS || a.at(-1).at - a[0].at < WINDOW || b.at(-1).at - b[0].at < WINDOW) return { status: 'collecting' };
    const mask = activity(a);
    if (!mask) return { status: 'static' };
    const candidates = [];
    for (let i = -245; i <= 245; i++) { const c = candidate(a, b, i * STEP, mask); if (c) candidates.push(c); }
    candidates.sort((x, y) => y.score - x.score);
    const strongest = candidates[0];
    if (!strongest) return { status: 'collecting' };
    if (strongest.static) return { status: 'static' };
    if (strongest.score < .5) return { status: 'unmatched', score: strongest.score };
    const seeds = [];
    for (const c of candidates) {
      if (c.score < max(.5, strongest.score - .2) || seeds.some(s => Math.abs(s.lag - c.lag) < .5)) continue;
      const scores = c.pairs.map(p => contextScore(p.a.feature.values, p.b.feature.values, mask.context));
      // High-resolution fixed text is checked after fine timing/transition
      // trimming; a coarse quarter-second pairing is not yet a correspondence.
      c.contextScore = median(scores); c.fixedStructure = staticDifference(c.pairs, false);
      if (c.contextScore < .90 || !c.fixedStructure.consistent) continue;
      seeds.push(c);
      if (seeds.length > 24) return { status: 'ambiguous' };
    }
    // rVFC streams do not share a sampling phase. Refine the quarter-second
    // search and omit at most 15% disagreeing transition frames, while keeping
    // 24 pairs and the full time span. No score/uniqueness threshold is relaxed.
    const refined = new Map();
    for (const seed of seeds) for (let step = -4; step <= 4; step++) {
      const lag = seed.lag + step / 16;
      if (Math.abs(lag) > 61.25 || refined.has(lag)) continue;
      const c = candidate(a, b, lag, mask, true); if (c) refined.set(lag, c);
    }
    const ranked = [...refined.values()].sort((x, y) => y.score - x.score);
    // Ten seconds apart can have identical ones-digit motion. Check the fixed
    // digits before ranking alternative peaks, not only after picking a lag.
    const plausible = ranked.filter(c => {
      if (c.score < .5) return false;
      const scores = c.pairs.map(p => contextScore(p.a.feature.values, p.b.feature.values, mask.context));
      c.contextScore = median(scores);
      c.fixedStructure = staticDifference(c.pairs, true, registered);
      return c.contextScore >= .94 && scores.filter(s => s >= .90).length / scores.length >= .85 && c.fixedStructure.consistent;
    });
    const best = plausible[0];
    if (!best || best.score < .90) return { status: 'unmatched', score: strongest.score,
      reason: !seeds.length ? 'fixed-structure-or-context' : !ranked.length ? 'transition-pairs' : 'verified-structure',
      diagnostic: { seeds: seeds.length, refined: ranked.length, contextScore: strongest.contextScore, fixedStructure: strongest.fixedStructure,
        refinedBestContext: ranked[0]?.contextScore, refinedBestFixedStructure: ranked[0]?.fixedStructure } };
    if (!changing(best.pairs, 'a', mask.indices) || !changing(best.pairs, 'b', mask.indices)) return { status: 'static' };
    const alternative = plausible.find(c => Math.abs(c.lag - best.lag) > 1);
    const margin = best.score - (alternative?.score ?? .5);
    if (!candidates.some(c => c.lag < best.lag - 1) || !candidates.some(c => c.lag > best.lag + 1) || margin < .06) return { status: 'ambiguous', score: best.score, margin };
    const deltas = best.pairs.map(p => p.a.mediaTime - p.b.mediaTime), mediaDelta = median(deltas);
    if (median(deltas.map(d => Math.abs(d - mediaDelta))) > .2) return { status: 'ambiguous' };
    return { status: 'match', lag: median(best.pairs.map(p => p.a.at - p.b.at)), mediaDelta, score: best.score,
      margin, pairs: best.pairs.length, contextScore: best.contextScore, activePixels: mask.indices.length };
  }

  function overlap(a, b) {
    const area = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return area / (a.w * a.h + b.w * b.h - area);
  }
  function template(image, width, height) {
    const values = normalize(sample(image, { x: 0, y: 0, w: image.width, h: image.height }, width, height));
    return values && { values, width, height };
  }
  function spatialMask(images) {
    if (images.length < 3) return null;
    const frames = images.map(image => fingerprint(image).values);
    if (frames.some(frame => !frame)) return null;
    const mask = new Uint8Array(N); mask.fill(1);
    for (let i = 0; i < N; i++) {
      const mean = (frames[0][i] + frames[1][i] + frames[2][i]) / 3;
      const variance = frames.reduce((sum, frame) => sum + (frame[i] - mean) ** 2, 0) / 3;
      if (variance < .02) continue;
      const x = i % FW, y = floor(i / FW);
      for (let yy = max(0, y - 2); yy <= min(FH - 1, y + 2); yy++) for (let xx = max(0, x - 2); xx <= min(FW - 1, x + 2); xx++) mask[yy * FW + xx] = 0;
    }
    return mask.reduce((sum, v) => sum + v, 0) >= 128 ? mask : null;
  }
  function maskedTemplate(image, mask) {
    const area = image.width > FW && image.height > FH;
    const base = area ? areaTemplate(image, FW, FH) : template(image, FW, FH);
    if (!base) return null;
    if (!mask) return { ...base, area };
    const values = base.values;
    let sum = 0, square = 0, count = 0;
    for (let i = 0; i < N; i++) if (mask[i]) { sum += values[i]; square += values[i] ** 2; count++; }
    const mean = sum / count, std = sqrt(max(0, square / count - mean * mean));
    if (std < .025) return { ...base, area };
    for (let i = 0; i < N; i++) values[i] = (values[i] - mean) / std;
    return { values, width: FW, height: FH, mask, count, area };
  }
  function spatialScore(image, rect, target) {
    let sum = 0, square = 0, dot = 0;
    for (let y = 0, i = 0; y < target.height; y++) for (let x = 0; x < target.width; x++, i++) {
      if (target.mask && !target.mask[i]) continue;
      const v = target.area ? areaValue(target.summed, rect.x + x * rect.w / target.width, rect.y + y * rect.h / target.height, rect.w / target.width, rect.h / target.height)
        : pixel(image, rect.x + (x + .5) * rect.w / target.width - .5, rect.y + (y + .5) * rect.h / target.height - .5);
      sum += v; square += v * v; dot += v * target.values[i];
    }
    const count = target.count || target.values.length, energy = square - sum * sum / count;
    return energy > count * .000625 ? dot / Math.sqrt(energy * count) : -1;
  }
  function locate(a, b, stablePixels = null) {
    const aspect = a.width / a.height;
    if (aspect < .2 || aspect > 40) return { status: 'locating' };
    const factor = Math.max(1, b.width / 480, b.height / 320);
    const bw = Math.round(b.width / factor), bh = Math.round(b.height / factor);
    const search = { width: bw, height: bh, values: sample(b, { x: 0, y: 0, w: b.width, h: b.height }, bw, bh) };
    const coarse = areaTemplate(a, 12, Math.max(3, Math.min(12, Math.round(12 / aspect)))), summed = integral(search);
    const fineHeight = Math.max(6, Math.min(32, Math.round(32 / aspect)));
    const fineArea = a.width > 32 && a.height > fineHeight;
    const fine = fineArea ? areaTemplate(a, 32, fineHeight) : template(a, 32, fineHeight);
    if (!coarse || !fine) return { status: 'locating' };
    // Average thin glyphs over each sample footprint on both sides. Point
    // samples can alias a small restreamed bar and trap refinement beside it.
    if (fineArea) { fine.area = true; fine.summed = integral(b); }
    const shortlist = [];
    function keep(item) {
      const same = shortlist.findIndex(c => overlap(c, item) > .6);
      if (same >= 0) { if (shortlist[same].score >= item.score) return; shortlist.splice(same, 1); }
      shortlist.push(item); shortlist.sort((x, y) => y.score - x.score); if (shortlist.length > 32) shortlist.pop();
    }
    for (let w = Math.max(12, aspect * 4); w <= Math.min(bw, bh * aspect); w *= 1.17) {
      const h = w / aspect, sx = Math.max(1, Math.floor(w / 24)), sy = Math.max(1, Math.floor(h / 8)), grid = areaGrid(w, h, coarse, summed.width);
      for (let y = 0; y <= bh - h; y += sy) for (let x = 0; x <= bw - w; x += sx) {
        const rect = { x, y, w, h }, score = areaScore(summed, rect, coarse, grid);
        if (score > .60 && (shortlist.length < 32 || score > shortlist.at(-1).score)) keep({ ...rect, score, sx, sy });
      }
    }
    const refined = [];
    for (const item of shortlist) {
      let best = { ...item, score: -1 };
      for (const scale of [.94, 1, 1.06]) for (const dx of [-.5, 0, .5]) for (const dy of [-.5, 0, .5]) {
        const rect = { x: (item.x + dx * item.sx) * factor, y: (item.y + dy * item.sy) * factor, w: item.w * factor * scale, h: item.h * factor * scale };
        if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > b.width || rect.y + rect.h > b.height) continue;
        const score = spatialScore(b, rect, fine); if (score > best.score) best = { ...rect, score };
      }
      // Refine all competing positions equally; refining only the winner can
      // hide a second identical copy whose coarse grid happened to be offset.
      for (const step of [2, 1, .5]) {
        for (let iteration = 0; iteration < 4; iteration++) {
          let next = best;
          for (const dw of [-step, 0, step]) for (const dx of [-step, 0, step]) for (const dy of [-step, 0, step]) {
            const rect = { x: best.x + dx, y: best.y + dy, w: best.w + dw, h: (best.w + dw) / aspect };
            if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > b.width || rect.y + rect.h > b.height) continue;
            const score = spatialScore(b, rect, fine); if (score > next.score) next = { ...rect, score };
          }
          if (next === best) break;
          best = next;
        }
      }
      refined.push(best);
    }
    refined.sort((x, y) => y.score - x.score);
    let best = refined[0];
    if (!best) return { status: 'locating' };
    // Recheck other positions at the winning scale. This prevents grid/scale
    // quantization from making two identical copies look falsely unique.
    for (const item of refined) {
      if (overlap(item, best) > .3) continue;
      const baseX = item.x + (item.w - best.w) / 2, baseY = item.y + (item.h - best.h) / 2;
      for (const dx of [-2, -1, 0, 1, 2]) for (const dy of [-2, -1, 0, 1, 2]) {
        const rect = { x: baseX + dx, y: baseY + dy, w: best.w, h: best.h };
        if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > b.width || rect.y + rect.h > b.height) continue;
        const score = spatialScore(b, rect, fine); if (score > item.score) Object.assign(item, rect, { score });
      }
    }
    refined.sort((x, y) => y.score - x.score); best = refined[0];
    const competitor = refined.find(item => overlap(item, best) < .3), margin = best.score - (competitor?.score ?? 0);
    if (best.score < .84) return { status: 'locating', score: best.score };
    if (margin < .05) return { status: 'location-ambiguous', score: best.score, margin };
    // The coarse template determines uniqueness. A denser template then fixes
    // subpixel geometry; a two-source-pixel error can remove a thin clock stroke.
    const dense = maskedTemplate(a, stablePixels);
    if (!dense) return { status: 'locating' };
    if (dense.area) dense.summed = integral(b);
    let geometry = { ...best, score: spatialScore(b, best, dense) };
    for (const step of [2, 1, .5, .25]) {
      // A 480-pixel coarse grid maps to several source pixels at 1080p. One
      // move per step can stop short of the optimum, so converge with a hard cap.
      for (let iteration = 0; iteration < 4; iteration++) {
        let next = geometry;
        for (const dw of [-step, 0, step]) for (const dx of [-step, 0, step]) for (const dy of [-step, 0, step]) {
          // Keep one scale: a small static landmark cannot reliably constrain
          // independent width and height while the surrounding motion differs.
          const rect = { x: geometry.x + dx, y: geometry.y + dy, w: geometry.w + dw, h: (geometry.w + dw) / aspect };
          if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > b.width || rect.y + rect.h > b.height || overlap(rect, best) < .85) continue;
          const score = spatialScore(b, rect, dense); if (score > next.score) next = { ...rect, score };
        }
        if (next === geometry) break;
        geometry = next;
      }
    }
    if (geometry.score < .90) geometry = best;
    return { status: 'located', region: { x: geometry.x / b.width, y: geometry.y / b.height, w: geometry.w / b.width, h: geometry.h / b.height }, score: best.score, margin };
  }
  class Locator {
    constructor() { this.proposals = []; this.images = []; this.region = null; }
    observe(a, b, at) {
      if (this.proposals.length && at - this.proposals.at(-1).at > 5) this.proposals = [];
      this.images.push(a); if (this.images.length > 3) this.images.shift();
      // Geometry uses static surroundings across observations, so the unknown
      // stream delay cannot pull the crop toward a different changing digit.
      const result = locate(a, b, spatialMask(this.images));
      if (result.status !== 'located') {
        // An uncertain frame is not a conflicting position. Keep recent
        // evidence, but never count it; actual spatial ambiguity invalidates it.
        if (result.status === 'location-ambiguous') this.proposals = [];
        return result;
      }
      if (this.proposals.length && overlap(result.region, this.proposals[0].region) < .75) this.proposals = [];
      this.proposals.push({ ...result, at }); if (this.proposals.length > 3) this.proposals.shift();
      if (this.proposals.length < 3 || at - this.proposals[0].at < 3.5) return { status: 'locating', score: result.score };
      this.region = result.region;
      return { ...result, region: this.region };
    }
  }
  const api = { FW, FH, gray, sample, fingerprint, estimate, locate, overlap, Locator };
  if (typeof module !== 'undefined') module.exports = api; else root.VisualSyncInset = api;
})(globalThis);
