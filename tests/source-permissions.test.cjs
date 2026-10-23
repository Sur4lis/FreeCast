const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture({gesture=true,granted=true}={}){
 const calls=[],scope={window:{addEventListener(){}},URL,navigator:{userActivation:{isActive:gesture}},chrome:{runtime:{getManifest:()=>({host_permissions:['https://*.bilibili.com/*','https://*.bilivideo.com/*']})},permissions:{request:async access=>{calls.push({op:'request',access});return granted;},contains:async access=>{calls.push({op:'contains',access});return granted;}}}};
 vm.runInNewContext(fs.readFileSync('browser-extension/ui/bridge.js','utf8'),scope);return{api:scope.window.live,calls};
}
test('a Bilibili-only click requests declared access immediately without all-site permissions',async()=>{
 const {api,calls}=fixture();const task=api.ensureSources(['84074','https://live.bilibili.com/6']);
 assert.equal(calls.length,1);assert.equal(calls[0].op,'request');assert.ok(calls[0].access.origins.includes('https://*.bilibili.com/*'));assert.ok(!calls[0].access.origins.includes('https://*/*'));await task;
});
test('automatic reconnect only checks permission and never opens a permission prompt',async()=>{
 const {api,calls}=fixture({gesture:false});await api.ensureSources(['6']);assert.equal(calls[0].op,'contains');
 const denied=fixture({gesture:false,granted:false});await assert.rejects(denied.api.ensureSources(['6']),/网站访问未授权/);assert.ok(denied.calls.every(c=>c.op==='contains'));
});
test('a declined grant stays an explicit permission failure',async()=>{
 const {api}=fixture({granted:false});await assert.rejects(api.ensureSources(['6']),/允许访问 bilibili.com/);
});
test('mixed-platform links retain optional platform access and invalid input requests nothing',async()=>{
 const {api,calls}=fixture();await api.ensureSources(['6','https://www.douyu.com/6657']);assert.deepEqual(Array.from(calls[0].access.origins),['https://*/*','http://*/*']);
 calls.length=0;await api.ensureSources(['','bad url','file:///private']);assert.equal(calls.length,0);
});
