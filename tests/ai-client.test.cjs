const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function client({fakeTimers=false,constructorError=false}={}){
 const workers=[],events={},live={},timers=new Map();let timerId=0;
 class Worker{constructor(){this.terminated=false;workers.push(this);}postMessage(data){this.sent=data;}terminate(){this.terminated=true;}reply(data){this.onmessage({data:{id:this.sent.id,...data}});}}
 const WorkerType=constructorError?class{constructor(){throw Error('worker blocked');}}:Worker;
 vm.runInNewContext(fs.readFileSync('browser-extension/ui/ai-client.js','utf8'),{Worker:WorkerType,Event,URL,location:{href:'https://local.invalid/ui/index.html'},setTimeout:fakeTimers?(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;}:setTimeout,clearTimeout:fakeTimers?id=>timers.delete(id):clearTimeout,window:{live,addEventListener:(name,fn)=>events[name]=fn,dispatchEvent:event=>events[event.type]?.(event)}});
 return{live,workers,events,timers};
}
test('a canceled initialization cannot terminate its replacement worker',async()=>{
 const{live,workers}=client(),first=live.vocalInit().catch(e=>e.message);
 live.vocalRelease();const second=live.vocalInit();
 assert.match(await first,/关闭/);assert.equal(workers[0].terminated,true);assert.equal(workers[1].terminated,false);
 workers[0].onerror({preventDefault(){},message:'late error'});assert.equal(workers[1].terminated,false);
 workers[1].reply({realtime:true,provider:'test'});assert.equal((await second).provider,'test');live.vocalRelease();
});
test('shared initialization, inference failure and page cleanup resolve pending requests',async()=>{
 const{live,workers,events}=client(),first=live.vocalInit(),shared=live.vocalInit();assert.equal(workers.length,1);
 workers[0].reply({realtime:true});assert.equal((await first).realtime,true);assert.equal((await shared).realtime,true);
 const inference=live.vocalProcess({left:new Float32Array(1),right:new Float32Array(1)}).catch(e=>e.message);
 await new Promise(resolve=>setImmediate(resolve));workers[0].reply({error:'test failure'});assert.equal(await inference,'test failure');
 const pending=live.vocalProcess({left:new Float32Array(1),right:new Float32Array(1)}).catch(e=>e.message);await new Promise(resolve=>setImmediate(resolve));events.pagehide();assert.match(await pending,/关闭/);assert.equal(workers[0].terminated,true);
});

test('GPU detection details remain available after initialization fails and the worker is released',async()=>{
 const{live,workers}=client(),init=live.vocalInit().catch(e=>e.message);
 workers[0].reply({error:'设备不可用',code:'WEBGPU_NO_ADAPTER',gpu:{attempts:[{preference:'default',status:'unavailable'}]}});
 assert.equal(await init,'设备不可用');assert.equal(workers[0].terminated,true);assert.equal(live.vocalDiagnostics().code,'WEBGPU_NO_ADAPTER');assert.equal(live.vocalDiagnostics().state,'error');
 const next=live.vocalInit();assert.equal(live.vocalDiagnostics().state,'checking');workers[1].reply({realtime:true,device:'test GPU',gpu:{preference:'default'}});await next;
 assert.equal(live.vocalDiagnostics().state,'ready');live.vocalRelease();assert.equal(live.vocalDiagnostics().state,'stopped');
});

test('dual-source requests share a serialized model and cancel old queued work',async()=>{
 const {live,workers}=client(),init=live.vocalInit();workers[0].reply({realtime:true});await init;
 const a=live.vocalProcess({left:new Float32Array(1),right:new Float32Array(1),stem:'vocals'}),b=live.vocalProcess({left:new Float32Array(1),right:new Float32Array(1),stem:'instrumental'});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(workers[0].sent.stem,'vocals');workers[0].reply({source:'a'});assert.equal((await a).source,'a');await new Promise(resolve=>setImmediate(resolve));assert.equal(workers[0].sent.stem,'instrumental');workers[0].reply({source:'b'});assert.equal((await b).source,'b');live.vocalRelease();
});

test('a stalled shared worker cannot accumulate more than two audio blocks',async()=>{
 const {live,workers}=client(),init=live.vocalInit();workers[0].reply({realtime:true});await init;
 const data={left:new Float32Array(1),right:new Float32Array(1)},a=live.vocalProcess(data).catch(e=>e.message),b=live.vocalProcess(data).catch(e=>e.message);
 await assert.rejects(live.vocalProcess(data),/停止积压/);await new Promise(resolve=>setImmediate(resolve));live.vocalRelease();assert.match(await a,/关闭/);assert.match(await b,/取消/);
 const next=live.vocalInit();workers[1].reply({realtime:true});await next;const task=live.vocalProcess(data);await new Promise(resolve=>setImmediate(resolve));workers[1].reply({ready:true});assert.equal((await task).ready,true);live.vocalRelease();
});
test('a timed-out engine is terminated and leaves an actionable diagnostic',async()=>{
 const{live,workers,timers}=client({fakeTimers:true});const init=live.vocalInit().catch(e=>e.message);
 assert.equal([...timers.values()][0].delay,180000);[...timers.values()][0].fn();
 assert.match(await init,/AI 初始化超时/);assert.equal(workers[0].terminated,true);assert.equal(live.vocalDiagnostics().code,'AI_TIMEOUT');assert.equal(live.vocalDiagnostics().state,'error');
 const retry=live.vocalInit();workers[1].reply({realtime:true});await retry;live.vocalRelease();assert.equal(timers.size,0);
});
test('worker startup failures do not leave AI diagnostics stuck in checking',async()=>{
 const blocked=client({constructorError:true});await assert.rejects(blocked.live.vocalInit(),/worker blocked/);assert.equal(blocked.live.vocalDiagnostics().code,'WORKER_UNAVAILABLE');
 const{live,workers}=client(),init=live.vocalInit().catch(e=>e.message);workers[0].onerror({preventDefault(){},message:'worker crashed'});assert.equal(await init,'worker crashed');assert.equal(live.vocalDiagnostics().state,'error');assert.equal(live.vocalDiagnostics().code,'WORKER_ERROR');
});
