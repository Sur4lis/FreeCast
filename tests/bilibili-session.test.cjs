const {test}=require('node:test'),assert=require('node:assert/strict');
async function fixture(){
 const {createBilibiliSession}=await import('../browser-extension/bilibili-session.mjs');
 const state={granted:true,jar:new Map(),reads:[],writes:[],requests:0,failRead:false};
 const api=createBilibiliSession({permissions:{contains:async request=>{assert.deepEqual(request,{permissions:['cookies'],origins:['https://live.bilibili.com/*']});return state.granted;}},cookies:{
  get:async data=>{state.reads.push(data);if(state.failRead)throw Error('No host permissions for cookies at url: "https://live.bilibili.com/"');return state.jar.has(data.name)?{value:state.jar.get(data.name)}:null;},
  set:async data=>{state.writes.push(data);state.jar.set(data.name,data.value);return data;}
 },request:async()=>{state.requests++;return{ok:true,json:async()=>({code:0,data:{b_3:'official-device-123456'}})};}});
 return {api,state};
}
test('withheld host access does not read cookies or pretend the account is logged out',async()=>{
 const {api,state}=await fixture();state.granted=false;
 await assert.rejects(api.cookie('DedeUserID'),error=>error.code==='BILIBILI_PERMISSION'&&/权限.*重连弹幕/.test(error.message));
 await assert.rejects(api.ensureDevice(),/网站访问权限不足/);assert.equal(state.reads.length,0);assert.equal(state.requests,0);
});
test('permission revocation between the check and cookie API produces an actionable error',async()=>{
 const {api,state}=await fixture();state.failRead=true;await assert.rejects(api.cookie('bili_jct'),error=>error.code==='BILIBILI_PERMISSION'&&!error.message.includes('No host permissions'));
});
test('an authorized browser with no login cookie remains anonymous without a permission error',async()=>{
 const {api}=await fixture();assert.equal(await api.cookie('DedeUserID'),'');
});
test('device initialization uses the official ID once and preserves existing login cookies',async()=>{
 const {api,state}=await fixture();state.jar.set('SESSDATA','private-login');state.jar.set('bili_jct','private-csrf');
 await Promise.all([api.ensureDevice(),api.ensureDevice()]);assert.equal(state.requests,1);assert.equal(state.writes.length,1);assert.equal(state.writes[0].name,'buvid3');assert.equal(state.writes[0].domain,'.bilibili.com');assert.equal(state.writes[0].value,'official-device-123456');
 assert.equal(state.jar.get('SESSDATA'),'private-login');assert.equal(state.jar.get('bili_jct'),'private-csrf');await api.ensureDevice();assert.equal(state.requests,1);
});
test('permission can be granted after a failed initialization and retried normally',async()=>{
 const {api,state}=await fixture();state.granted=false;await assert.rejects(api.ensureDevice(),/权限/);state.granted=true;await api.ensureDevice();assert.equal(await api.cookie('buvid3'),'official-device-123456');
});
