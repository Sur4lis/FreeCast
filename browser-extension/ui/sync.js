(function (root) {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  function delays(offset, base = 3) { return { a: base + Math.max(0, offset), b: base + Math.max(0, -offset) }; }
  function targetTime(ranges, edge, delay) {
    const target = edge - delay;
    for (const [start, end] of ranges) if (target >= start + 0.05 && target <= end - 0.05) return target;
    return null;
  }
  function correction(current, target) {
    const difference = target - current;
    if (Math.abs(difference) > 0.8) return { seek: target, rate: 1 };
    return { seek: null, rate: Math.abs(difference) < 0.12 ? 1 : clamp(1 + difference * 0.08, 0.97, 1.03) };
  }
  class ChatQueue {
    constructor() { this.items = []; }
    push(message, at) { this.items.push({ ...message, at }); if (this.items.length > 2000) this.items.shift(); }
    take(aTime, adjustment = 0) {
      const ready = [], pending = [];
      for (const item of this.items) (item.at + adjustment <= aTime ? ready : pending).push(item);
      this.items = pending; return ready;
    }
    clear() { this.items = []; }
  }
  function playoutTarget(state, now, delay = state?.delay) {
    return state?.started ? state.target + (now-state.at)/1000 - (delay-state.delay) : null;
  }
  function shiftPlayout(state, seconds) {
    if (!state?.started || !Number.isFinite(seconds)) return;
    state.manualShift = (state.manualShift || 0) + seconds;
    if (Math.abs(state.manualShift) < .000001) state.manualShift = 0;
  }
  // Once started, follow a monotonic playout clock, not bursty download edges.
  function playoutStep(state, { now, current, ranges, edge, delay, ready, seeking = false }) {
    const contains = time => ranges.some(([a,b]) => time >= a + .03 && time <= b - .03);
    if (state.delay !== delay) {
      if (state.started) { state.target -= delay - state.delay; state.adjusting = true; }
      state.delay = delay; state.driftAt = null;
    }
    if (!state.started) {
      const target = edge == null ? null : targetTime(ranges, edge, delay);
      if (target === null) return { wait: true, seek: null, rate: 1 };
      state.started = true; state.at = now; state.target = target;
      return { wait: false, seek: Math.abs(current-target) > .18 ? target : null, rate: 1 };
    }
    let target = state.target + (now-state.at)/1000;
    if (state.manualShift) {
      if (seeking) return {wait:false,seek:null,rate:1};
      // A manual step is relative to the frame the user is watching, not clock drift.
      if (!(state.settleUntil > now)) { state.target = target = current - state.manualShift; state.at = now; }
      state.settleUntil = now + 3000;
      state.manualShift = 0; state.adjusting = true;
    }
    if (state.adjusting) {
      if (seeking) return {wait:false,seek:null,rate:1};
      if (contains(target)) {
        state.adjusting = false;
        const tolerance=state.settleUntil>now?.002:.08;
        state.settleUntil=now+3000;
        return {wait:false,seek:Math.abs(current-target)>tolerance?target:null,rate:1};
      }
      // Build the requested delay if the older media has not arrived yet.
      return {wait:true,seek:null,rate:1};
    }
    if (ranges.length && target < ranges[0][0] + .03) {
      const available = edge == null ? null : targetTime(ranges, edge, delay);
      if (available !== null) { state.at=now; state.target=target=available; state.driftAt=null; }
    }
    const delta = target-current;
    // An absent estimated target is not a reason to pause buffered playback.
    if (ready < 3) { state.driftAt = null; return { wait:false,seek:null,rate:1 }; }
    // Decode time after a seek must not become an extra permanent delay.
    if (state.settleUntil > now) {
      if (Math.abs(delta) > .002) return {wait:false,seek:null,rate:clamp(1+delta*2,.9,1.1)};
      state.settleUntil = 0;
    }
    if (Math.abs(delta) > 1.5 && contains(target)) {
      state.driftAt ??= now;
      if (now-state.driftAt > 2000) { state.driftAt=null; return {wait:false,seek:target,rate:1}; }
    } else state.driftAt = null;
    return {wait:false,seek:null,rate:Math.abs(delta)<.08?1:clamp(1+delta*.04,.98,1.02)};
  }
  const api = { clamp, delays, targetTime, correction, ChatQueue, shiftPlayout, playoutStep, playoutTarget };
  if (typeof module !== 'undefined') module.exports = api;
  else root.Sync = api;
})(globalThis);
