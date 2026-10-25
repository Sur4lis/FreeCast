const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
async function harness(runMs){
 const policy={...await import('../browser-extension/ai/performance.mjs'),...await import('../browser-extension/ai/stems.mjs'),...await import('../browser-extension/ai/gpu-device.mjs')};let clock=0,runs=0,cost=runMs;const replies=[];
 class Tensor{constructor(type,data){this.data=data;}dispose(){}}
 const session={inputNames:['in'],outputNames:['out'],async run(){runs++;clock+=cost;return{out:new Tensor('float32',new Float32Array(16))}},async release(){}};
 const scope={...policy,ort:{env:{wasm:{},webgpu:{}},Tensor,InferenceSession:{create:async()=>session}},Spectral:class{encode(){return new Float32Array(16)}decode(){return[new Float32Array(2),new Float32Array(2)]}},LENGTH:2,TRIM:0,CORE:2,F:2,T:2,suppressResidual:()=>{},performance:{now:()=>clock},URL,Float32Array,Uint8Array,ArrayBuffer,navigator:{gpu:{requestAdapter:async()=>({info:{vendor:'test-gpu',architecture:'test'}})}},crypto:{subtle:{digest:async()=>new Uint8Array(32).buffer}},fetch:async()=>({json:async()=>({file:'model.onnx',sha256:'00'.repeat(32)}),arrayBuffer:async()=>new ArrayBuffer(1)}),self:{postMessage:m=>replies.push(m)}};
 const source=fs.readFileSync('browser-extension/ai/worker.mjs','utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',"'https://local.test/ai/worker.mjs'");vm.runInNewContext(source,scope);
 return{send:async data=>{await scope.self.onmessage({data});return replies.at(-1)},runs:()=>runs,setCost:n=>cost=n};
}
test('auto benchmarks slow double inference and falls back to full-model single inference',async()=>{
 const h=await harness(2700),info=await h.send({id:1,type:'init'});assert.equal(info.realtime,true);assert.equal(info.passes,1);assert.equal(info.blockMs,2700);assert.ok(h.runs()>=12);const before=h.runs();const result=await h.send({id:2,type:'process',left:new Float32Array(2),right:new Float32Array(2)});assert.equal(h.runs()-before,1);assert.equal(result.passes,1);assert.equal(result.left.length,2);
});
test('a fast GPU retains enhancement; sustained runtime slowdown switches future blocks',async()=>{
 const h=await harness(400),info=await h.send({id:1,type:'init'});assert.equal(info.passes,2);h.setCost(2700);const input={type:'process',left:new Float32Array(2),right:new Float32Array(2)};const first=await h.send({id:2,...input});assert.equal(first.nextProfile,undefined);const second=await h.send({id:3,...input});assert.equal(second.nextProfile,'兼容推理');const third=await h.send({id:4,...input});assert.equal(third.passes,1);
});
test('compatibility mode is selectable and genuinely non-real-time hardware is rejected',async()=>{
 const h=await harness(800),info=await h.send({id:1,type:'init',performanceMode:'compatible'});assert.equal(info.passes,1);const slow=await harness(6000),failure=await slow.send({id:1,type:'init'});assert.match(failure.error,/GPU 实测仍跟不上直播/);
});

test('dual-source benchmark accounts for both streams before accepting enhanced inference',async()=>{
 const h=await harness(1400),info=await h.send({id:1,type:'init',streams:2});assert.equal(info.realtime,true);assert.equal(info.passes,1);assert.equal(info.blockMs,2800);
 const overloaded=await harness(2700),failure=await overloaded.send({id:1,type:'init',streams:2});assert.match(failure.error,/GPU 实测仍跟不上直播/);
});
