const {test}=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../browser-extension/ai/gpu-device.mjs');
const hardware=()=>({info:{vendor:'test',architecture:'gpu',isFallbackAdapter:false}});
test('a failed high-performance hint falls back to the browser default adapter',async()=>{
 const {requestHardwareGPU}=await load(),adapter=hardware(),calls=[];
 const result=await requestHardwareGPU({requestAdapter:async options=>{calls.push(options);return options?null:adapter;}});
 assert.equal(result.adapter,adapter);assert.equal(result.diagnostics.preference,'default');assert.equal(calls.length,2);assert.equal(calls[1],undefined);
});
test('an unavailable or rejected request does not prevent trying the low-power adapter',async()=>{
 const {requestHardwareGPU}=await load(),adapter=hardware();
 const result=await requestHardwareGPU({requestAdapter:async options=>{if(options?.powerPreference==='high-performance')throw Error('driver rejected hint');return options?.powerPreference==='low-power'?adapter:null;}});
 assert.equal(result.adapter,adapter);assert.deepEqual(result.diagnostics.attempts.map(a=>a.status),['error','unavailable','hardware']);
});
test('software adapters are skipped, including the older adapter-level flag',async()=>{
 const {requestHardwareGPU}=await load(),adapter=hardware();
 for(const software of [{info:{isFallbackAdapter:true}},{isFallbackAdapter:true}]){
  const result=await requestHardwareGPU({requestAdapter:async options=>options?software:adapter});
  assert.equal(result.adapter,adapter);assert.equal(result.diagnostics.attempts[0].status,'software');
 }
});
test('missing GPU metadata is not treated as missing hardware',async()=>{
 const {requestHardwareGPU}=await load(),adapter={get info(){throw Error('restricted info');}};
 assert.equal((await requestHardwareGPU({requestAdapter:async()=>adapter})).adapter,adapter);
});
test('API availability and actual device availability produce distinct actionable errors',async()=>{
 const {requestHardwareGPU}=await load();
 await assert.rejects(requestHardwareGPU(undefined,'Edg/156'),e=>e.code==='WEBGPU_UNAVAILABLE'&&e.message.includes('edge://gpu'));
 await assert.rejects(requestHardwareGPU({requestAdapter:async()=>null},'Chrome/139'),e=>e.code==='WEBGPU_NO_ADAPTER'&&e.gpu.attempts.length===3&&e.message.includes('已开启图形加速')&&e.message.includes('chrome://gpu'));
 await assert.rejects(requestHardwareGPU({requestAdapter:async()=>({isFallbackAdapter:true})}),e=>e.code==='WEBGPU_SOFTWARE_ONLY');
});
test('a stalled adapter request is bounded and the next preference is still tried',async()=>{
 const {requestHardwareGPU}=await load(),adapter=hardware();
 const result=await requestHardwareGPU({requestAdapter:options=>options?new Promise(()=>{}):Promise.resolve(adapter)},'',15);
 assert.equal(result.adapter,adapter);assert.match(result.diagnostics.attempts[0].message,/超时/);
});

test('QQ browser detection stays capability-based and does not blame the acceleration switch',async()=>{
 const {requestHardwareGPU}=await load(),ua='Chrome/123.0.6312.122 Safari/537.36 QQBrowser/21.1.8717.400',adapter=hardware();
 assert.equal((await requestHardwareGPU({requestAdapter:async()=>adapter},ua)).adapter,adapter);
 await assert.rejects(requestHardwareGPU({requestAdapter:async()=>null},ua),error=>error.code==='WEBGPU_NO_ADAPTER'&&error.message.includes('QQ 浏览器')&&error.message.includes('并不等同')&&error.gpu.attempts.length===3);
 await assert.rejects(requestHardwareGPU(undefined,ua),error=>error.code==='WEBGPU_UNAVAILABLE'&&error.message.includes('QQ 浏览器'));
});
