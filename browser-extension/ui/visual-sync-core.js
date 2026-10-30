(function (root) {
  'use strict';
  // Tile-normalized luminance keeps small overlays and exposure changes local.
  // This module is shared by the CPU worker and the deterministic Node tests.
  const WIDTH = 32, HEIGHT = 18, TILE_W = 8, TILE_H = 6, TILES = 12, PIXELS = 48;
  const HISTORY_SECONDS = 90, MAX_FRAMES = 380, MAX_LAG = 60, STEP = .25;
  const MIN_PAIRS = 24, WINDOW = 8;

  function fingerprint(rgba) {
    if (rgba.length !== WIDTH * HEIGHT * 4) throw Error('Unexpected frame size');
    const values = new Float32Array(WIDTH * HEIGHT), valid = new Uint8Array(TILES);
    for (let tile = 0; tile < TILES; tile++) {
      const left = (tile % 4) * TILE_W, top = Math.floor(tile / 4) * TILE_H;
      let sum = 0, square = 0;
      for (let i = 0; i < PIXELS; i++) {
        const source = ((top + Math.floor(i / TILE_W)) * WIDTH + left + i % TILE_W) * 4;
        const value = .2126 * rgba[source] + .7152 * rgba[source + 1] + .0722 * rgba[source + 2];
        values[tile * PIXELS + i] = value; sum += value; square += value * value;
      }
      const mean = sum / PIXELS, energy = Math.max(0, square - sum * mean);
      // Black frames and flat title cards cannot establish a time correspondence.
      if (energy < PIXELS * 36) continue;
      valid[tile] = 1;
      for (let i = 0; i < PIXELS; i++) values[tile * PIXELS + i] = (values[tile * PIXELS + i] - mean) / Math.sqrt(energy);
    }
    return { values, valid };
  }

  function similarity(a, b) {
    const scores = [];
    for (let tile = 0; tile < TILES; tile++) {
      if (!a.valid[tile] || !b.valid[tile]) continue;
      let dot = 0;
      for (let i = tile * PIXELS; i < (tile + 1) * PIXELS; i++) dot += a.values[i] * b.values[i];
      scores.push(dot);
    }
    if (scores.length < 9) return -1;
    // At least three quarters of the region must agree; ignore up to three
    // obstructed tiles, rather than letting a webcam dominate the whole frame.
    scores.sort((x, y) => y - x);
    return scores.slice(0, 9).reduce((sum, value) => sum + value, 0) / 9;
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function nearest(frames, at) {
    let low = 0, high = frames.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (frames[mid].at < at) low = mid + 1; else high = mid;
    }
    const before = frames[low - 1], after = frames[low];
    const frame = !after || before && at - before.at <= after.at - at ? before : after;
    return frame && Math.abs(frame.at - at) <= .18 ? frame : null;
  }

  function candidate(a, b, lag) {
    const end = Math.min(a.at(-1).at, b.at(-1).at + lag);
    const start = Math.max(a[0].at, b[0].at + lag);
    if (end - start < WINDOW) return null;
    const pairs = [], used = new Set();
    // Every candidate is judged on the same length of recent overlapping video.
    for (const frame of a) {
      if (frame.at < end - WINDOW || frame.at > end) continue;
      const other = nearest(b, frame.at - lag);
      if (!other || used.has(other)) continue;
      used.add(other);
      pairs.push({ a: frame, b: other, score: similarity(frame.feature, other.feature) });
    }
    if (pairs.length < MIN_PAIRS || pairs.at(-1).a.at - pairs[0].a.at < WINDOW - .6) return null;
    return { lag, pairs, score: pairs.reduce((sum, pair) => sum + pair.score, 0) / pairs.length };
  }

  function changing(pairs, key) {
    let count = 0, previous = pairs[0][key];
    for (const pair of pairs) {
      const frame = pair[key];
      if (frame.at - previous.at < .9) continue;
      if (similarity(previous.feature, frame.feature) < .97) count++;
      previous = frame;
    }
    return count >= 4;
  }

  function estimate(a, b) {
    if (a.length < MIN_PAIRS || b.length < MIN_PAIRS) return { status: 'collecting' };
    const candidates = [];
    // Keep a margin outside the supported range so a valid 60-second match
    // still has competing candidates on both sides of its correlation peak.
    for (let index = -(MAX_LAG + 1.25) / STEP; index <= (MAX_LAG + 1.25) / STEP; index++) {
      const item = candidate(a, b, index * STEP);
      if (item) candidates.push(item);
    }
    candidates.sort((x, y) => y.score - x.score);
    const best = candidates[0];
    if (!best) return { status: 'collecting' };
    if (best.score < .88) return { status: 'unmatched' };
    if (!changing(best.pairs, 'a') || !changing(best.pairs, 'b')) return { status: 'static' };
    const alternative = candidates.find(item => Math.abs(item.lag - best.lag) > 1);
    // Require enough history on BOTH sides of the peak. A peak at the edge of
    // the observed window is not yet evidence that another lag is worse.
    const lower = candidates.some(item => item.lag < best.lag - 1);
    const upper = candidates.some(item => item.lag > best.lag + 1);
    const margin = best.score - (alternative?.score ?? best.score);
    if (!lower || !upper || margin < .04) return { status: 'ambiguous' };
    const reliable = best.pairs.filter(pair => pair.score >= .8);
    if (reliable.length < MIN_PAIRS || reliable.length / best.pairs.length < .85) return { status: 'unmatched' };
    const mediaDeltas = reliable.map(pair => pair.a.mediaTime - pair.b.mediaTime);
    const mediaDelta = median(mediaDeltas);
    if (median(mediaDeltas.map(value => Math.abs(value - mediaDelta))) > .2) return { status: 'ambiguous' };
    return {
      status: 'match', lag: median(reliable.map(pair => pair.a.at - pair.b.at)),
      mediaDelta, score: best.score, margin, pairs: reliable.length
    };
  }

  class History {
    constructor() { this.frames = []; }
    add(frame) {
      if (!Number.isFinite(frame.at) || !Number.isFinite(frame.mediaTime)) return;
      const last = this.frames.at(-1);
      if (last && (frame.at <= last.at || frame.mediaTime <= last.mediaTime)) return;
      this.frames.push(frame);
      while (this.frames.length > MAX_FRAMES || frame.at - this.frames[0].at > HISTORY_SECONDS) this.frames.shift();
    }
  }

  class Stability {
    constructor() { this.reset(); }
    reset() { this.matches = []; }
    observe(result, now) {
      if (result.status !== 'match') { this.reset(); return false; }
      if (this.matches.length && (now - this.matches.at(-1).at > 5 || Math.abs(result.mediaDelta - this.matches[0].delta) > .3)) this.reset();
      this.matches.push({ delta: result.mediaDelta, at: now });
      if (this.matches.length > 3) this.matches.shift();
      return this.matches.length === 3 && now - this.matches[0].at >= 3.5;
    }
  }

  // Matching establishes mediaA = mediaB + mediaDelta for the SAME scene.
  // The existing player seeks to edge - delay, so offset = edgeA-edgeB-mediaDelta.
  // Subtracting media.currentTime across independent streams would be incorrect.
  function targetOffset(edgeA, edgeB, mediaDelta) {
    if (![edgeA, edgeB, mediaDelta].every(Number.isFinite)) return null;
    const value = Math.round((edgeA - edgeB - mediaDelta) * 10) / 10;
    return Math.abs(value) <= MAX_LAG ? value : null;
  }

  const api = { WIDTH, HEIGHT, HISTORY_SECONDS, MAX_FRAMES, fingerprint, similarity, estimate, History, Stability, targetOffset };
  if (typeof module !== 'undefined') module.exports = api; else root.VisualSync = api;
})(globalThis);
