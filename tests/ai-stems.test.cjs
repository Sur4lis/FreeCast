const {test}=require('node:test'),assert=require('node:assert/strict');
test('vocal extraction preserves complex phase and subtracts the compensated unmasked estimate',async()=>{
  const {selectStem}=await import('../browser-extension/ai/stems.mjs');
  const voice=new Float32Array([.5,-.2,.7,-.1]),bed=new Float32Array([1,2,-3,-4]);
  const mix=Float32Array.from(bed,(v,i)=>v+voice[i]),estimate=Float32Array.from(bed,v=>v/1.022);
  const original=new Float32Array(mix),vocals=selectStem(mix,estimate.slice(),'vocals'),instrumental=selectStem(mix,estimate.slice());
  for(let i=0;i<mix.length;i++){assert.ok(Math.abs(vocals[i]-voice[i])<1e-6);assert.ok(Math.abs(vocals[i]+instrumental[i]-mix[i])<1e-6);}
  assert.deepEqual(mix,original);
  assert.throws(()=>selectStem(mix,new Float32Array(1),'vocals'));
});
