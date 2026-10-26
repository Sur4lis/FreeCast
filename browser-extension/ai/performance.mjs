// One incoming block advances STEP samples. Benchmark against that rate, not an arbitrary GPU model name.
export const BLOCK_INTERVAL_MS=232926/44100*1000;
export const REALTIME_BUDGET_MS=BLOCK_INTERVAL_MS*.85;
export function renderPasses(passes,priority=false,pressure=false){return priority&&pressure?1:passes;}
export function renderingOverloaded({frames=0,slow=0,total=0,dropped=0,stallMs=0,elapsedMs=0}={}){
  return frames>=30&&(slow/frames>.12||elapsedMs>=3000&&stallMs/elapsedMs>.04)||total>=30&&dropped/total>.06;
}
export function benchmarkTime(samples){
  const sorted=samples.filter(Number.isFinite).filter(v=>v>0).sort((a,b)=>a-b);
  return sorted.length>=3?sorted[Math.floor(sorted.length/2)]:Infinity;
}
export function assess(samples){const ms=benchmarkTime(samples);return{ms,realtime:Number.isFinite(ms)&&ms<=REALTIME_BUDGET_MS,delay:Math.max(8,Math.min(14,Math.ceil(6.5+ms/1000)))};}
