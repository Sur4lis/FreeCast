// One incoming block advances STEP samples. Benchmark against that rate, not an arbitrary GPU model name.
export const BLOCK_INTERVAL_MS=232926/44100*1000;
export const REALTIME_BUDGET_MS=BLOCK_INTERVAL_MS*.85;
export function benchmarkTime(samples){
  const sorted=samples.filter(Number.isFinite).filter(v=>v>0).sort((a,b)=>a-b);
  return sorted.length>=3?sorted[Math.floor(sorted.length/2)]:Infinity;
}
export function assess(samples){const ms=benchmarkTime(samples);return{ms,realtime:Number.isFinite(ms)&&ms<=REALTIME_BUDGET_MS,delay:Math.max(8,Math.min(14,Math.ceil(6.5+ms/1000)))};}
