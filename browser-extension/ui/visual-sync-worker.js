'use strict';
importScripts('visual-sync-core.js', 'visual-sync-inset.js', 'visual-sync-overlap.js');
let history = { a: new VisualSync.History(), b: new VisualSync.History() };
let lastEstimate = 0, lastLocate = -Infinity, mode = null, locator = new VisualSyncInset.Locator();
let registration = null, proposals = [], lastRegister = -Infinity;
const latest = { a: null, b: null };

function pixelRect(region, image) {
  return { x: region.x * image.width, y: region.y * image.height, w: region.w * image.width, h: region.h * image.height };
}
function registeredFeature(key, image) {
  const rect = pixelRect(registration[key], image);
  // Both crops must go through the same sampling kernel. Without a shared
  // effective resolution, a narrow common strip can be upsampled on one side
  // and area-filtered on the other, changing the shape of thin clock strokes.
  return VisualSyncInset.fingerprint({ width: registration.width, height: registration.height,
    values: VisualSyncInset.sample(image, rect, registration.width, registration.height) });
}
function registrationImages(frames) {
  const recent = frames.filter(frame => frame.image && frame.at >= frames.at(-1).at - 16);
  if (recent.length < 24 || recent.at(-1).at - recent[0].at < 6) return null;
  return Array.from({ length: 8 }, (_, index) => recent[Math.round(index * (recent.length - 1) / 7)].image);
}
function sameRegistration(a, b) {
  return ['a', 'b'].every(key => {
    const p = a[key], q = b[key], image = latest[key];
    return VisualSyncInset.overlap(p, q) > .97 &&
      Math.abs(p.x - q.x) * image.width <= 1 && Math.abs(p.y - q.y) * image.height <= 1 &&
      Math.abs(p.x + p.w - q.x - q.w) * image.width <= 1 && Math.abs(p.y + p.h - q.y - q.h) * image.height <= 1;
  });
}
function tryRegistration(at) {
  if (registration || at - lastRegister < 6) return;
  const a = registrationImages(history.a.frames), b = registrationImages(history.b.frames);
  if (!a || !b) return;
  lastRegister = at;
  const result = VisualSyncOverlap.register(a, b);
  if (proposals.length && at - proposals.at(-1).at > 14) proposals = [];
  if (result.status !== 'registered') {
    if (result.status === 'registration-ambiguous') proposals = [];
    return result;
  }
  if (proposals.some(proposal => !sameRegistration(proposal, result))) proposals = [];
  proposals.push({ ...result, at });
  if (proposals.length < 3 || at - proposals[0].at < 10) {
    return { status: 'registering' };
  }
  registration = proposals.reduce((best, proposal) => proposal.score > best.score ? proposal : best);
  registration.width = Math.max(2, Math.floor(Math.min(...['a', 'b'].map(key => registration[key].w * latest[key].width))));
  registration.height = Math.max(2, Math.floor(Math.min(...['a', 'b'].map(key => registration[key].h * latest[key].height))));
  for (const key of ['a', 'b']) for (const frame of history[key].frames) {
    frame.feature = registeredFeature(key, frame.image);
    delete frame.image;
  }
  proposals = [];
  // Geometry is not timing evidence. Reset the UI's repeated-match check before
  // allowing estimates made from the newly registered common region to count.
  self.postMessage({ type: 'registered', regions: { a: registration.a, b: registration.b }, coverage: registration.coverage });
}
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'configure') {
      if (!['single', 'dual'].includes(data.mode)) throw Error('Unexpected matching mode');
      mode = data.mode; history = { a: new VisualSync.History(), b: new VisualSync.History() };
      locator = new VisualSyncInset.Locator(); latest.a = latest.b = null; lastEstimate = 0; lastLocate = -Infinity;
      registration = null; proposals = []; lastRegister = -Infinity;
      return;
    }
    const { key, at, mediaTime, rgba } = data;
    if (!history[key]) return;
    if (mode) {
      const image = VisualSyncInset.gray(rgba, data.width, data.height);
      if (mode === 'dual' && (image.width > 256 || image.height > 256)) throw Error('Unexpected dual frame size');
      latest[key] = image;
      if (mode === 'single' && !locator.region) {
        if (latest.a && latest.b && at - lastLocate >= 2) {
          lastLocate = at;
          const result = locator.observe(latest.a, latest.b, at);
          if (result.status === 'located') self.postMessage({ type: 'located', region: result.region, score: result.score });
          else self.postMessage({ type: 'result', at, result });
        }
        if (!locator.region) { self.postMessage({ type: 'ready', key }); return; }
      }
      const rect = mode === 'single' && key === 'b' ? pixelRect(locator.region, image)
        : mode === 'dual' && registration ? pixelRect(registration[key], image) : undefined;
      // Capture dimensions, history duration and frame count all remain bounded.
      // Raw frames are needed only while finding geometry; release them on lock.
      history[key].add({ at, mediaTime, feature: mode === 'dual' && registration ? registeredFeature(key, image) : VisualSyncInset.fingerprint(image, rect),
        ...(mode === 'dual' && !registration ? { image } : {}) });
    } else history[key].add({ at, mediaTime, feature: VisualSync.fingerprint(rgba) });
    if (at - lastEstimate >= 2 && history.a.frames.length && history.b.frames.length) {
      lastEstimate = at;
      let result = mode ? VisualSyncInset.estimate(history.a.frames, history.b.frames, { registered: Boolean(registration) }) : VisualSync.estimate(history.a.frames, history.b.frames);
      // Exact crops keep their existing fast path. Imperfect dual selections
      // first need a common spatial coordinate system, then the same strict
      // temporal and fixed-text verification used for an exact selection.
      if (mode === 'dual' && !registration && result.status !== 'match') {
        const spatial = tryRegistration(at);
        if (registration) result = VisualSyncInset.estimate(history.a.frames, history.b.frames, { registered: true });
        else if (spatial) result = spatial;
      }
      self.postMessage({ type: 'result', at, result });
    }
    self.postMessage({ type: 'ready', key });
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error.message || error) });
  }
};
