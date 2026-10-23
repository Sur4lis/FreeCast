const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function harness(){
 const timers=new Map(),intervals=new Map(),sockets=[],events=[];let serial=0,calls=0,now=0;
 class Socket{constructor(url){this.url=url;this.readyState=0;sockets.push(this);}send(bytes){this.sent??=[];this.sent.push(bytes);}close(){if(this.readyState===3)return;this.readyState=3;this.onclose?.({code:1000});}open(){this.readyState=1;this.onopen();}}
 const scope={window:{},TextEncoder,TextDecoder,Uint8Array,DataView,Blob,DecompressionStream,URL,WebSocket:Socket,Date:{now:()=>now},setTimeout:(fn,ms)=>{timers.set(++serial,{fn,ms});return serial},clearTimeout:id=>timers.delete(id),setInterval:(fn,ms)=>{intervals.set(++serial,{fn,ms});return serial},clearInterval:id=>intervals.delete(id)};
 vm.runInNewContext(fs.readFileSync('browser-extension/ui/chat.js','utf8'),scope);const {BrowserChat,ChatProtocol}=scope.window;
 const chat=new BrowserChat(6,async()=>{calls++;return{hosts:['one.chat.bilibili.com:2245','two.chat.bilibili.com'],token:'token-'+calls,room:7734200,uid:1,buvid:'device'}},e=>events.push(e));
 const message=async(ws,op,body)=>{ws.onmessage({data:ChatProtocol.packet(op,body)});await new Promise(setImmediate)};
 return{chat,timers,intervals,sockets,events,message,calls:()=>calls,setNow:n=>now=n};
}
test('auth failure preserves reason, rotates WSS host and refreshes token',async()=>{
 const h=harness();await h.chat.start();let ws=h.sockets[0];assert.ok(ws.url.includes(':2245'));ws.open();const auth=JSON.parse(new TextDecoder().decode(ws.sent[0].slice(16)));assert.equal(auth.roomid,7734200);
 await h.message(ws,8,{code:-101});assert.match(h.events.at(-1).text,/鉴权失败.*-101.*2 秒后重试/);assert.equal(h.timers.size,1);await [...h.timers.values()][0].fn();ws=h.sockets[1];assert.equal(ws.url,'wss://two.chat.bilibili.com/sub');assert.equal(h.calls(),2);ws.open();await h.message(ws,8,{code:0});assert.equal(h.events.at(-1).text,'弹幕已连接');h.chat.stop();assert.equal(h.timers.size,0);assert.equal(h.intervals.size,0);
});
test('stale callbacks after stop cannot emit messages or schedule reconnects',async()=>{
 const h=harness();await h.chat.start();const ws=h.sockets[0];ws.open();h.chat.stop();const count=h.events.length;await h.message(ws,5,{cmd:'DANMU_MSG',info:[[],'late',[1,'user']]});assert.equal(h.events.length,count);assert.equal(h.timers.size,0);
});
test('dead heartbeat reconnects rather than reporting connected indefinitely',async()=>{
 const h=harness();await h.chat.start();const ws=h.sockets[0];ws.open();await h.message(ws,8,{code:0});h.setNow(71000);[...h.intervals.values()][0].fn();assert.match(h.events.at(-1).text,/心跳超时/);h.chat.stop();
});
for(const error of [Object.assign(Error('permission denied'),{code:'BILIBILI_PERMISSION'}),Error('No host permissions for cookies at url: "svghttps://live.bilibili.com/"'),Error('B 站网站访问权限不足')])test('permission failure waits for explicit authorization: '+error.message,async()=>{
 const h=harness(),success=h.chat.config;h.chat.config=async()=>{throw error;};await h.chat.start();
 assert.equal(h.timers.size,0);assert.equal(h.sockets.length,0);assert.match(h.events.at(-1).text,/重连弹幕.*允许访问/);assert.doesNotMatch(h.events.at(-1).text,/svghttps|秒后重试/);
 h.chat.config=success;await h.chat.start();assert.equal(h.sockets.length,1);const ws=h.sockets[0];ws.open();await h.message(ws,8,{code:0});assert.equal(h.events.at(-1).text,'弹幕已连接');h.chat.stop();
});
test('HTTP 412 does not keep hitting a risk-blocked API; ordinary network errors still retry',async()=>{
 const h=harness();h.chat.config=async()=>{throw Error('HTTP 412');};await h.chat.start();assert.equal(h.timers.size,0);assert.match(h.events.at(-1).text,/412.*暂停自动重试/);
 h.chat.config=async()=>{throw Error('network unavailable');};await h.chat.start();assert.equal(h.timers.size,1);assert.match(h.events.at(-1).text,/network unavailable.*2 秒后重试/);h.chat.stop();
});
