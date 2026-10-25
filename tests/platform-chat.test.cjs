const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),zlib=require('node:zlib'),crypto=require('node:crypto');
const scope={window:{},TextEncoder,TextDecoder,Uint8Array,DataView,Blob,DecompressionStream,URL};
vm.runInNewContext(fs.readFileSync('browser-extension/ui/platform-chat-protocol.js','utf8'),scope);
const P=scope.window.PlatformChatProtocol;
test('Douyu handles escaped UTF-8, concatenated and fragmented messages',()=>{
  const a=P.douyuPacket({type:'chatmsg',uid:'9007199254740999',nn:'甲/@',txt:'你好/@=😀',cid:'one'}),b=P.douyuPacket({type:'mrkl'}),d=new P.DouyuDecoder();
  assert.equal(d.read(a.slice(0,9)).length,0);const result=d.read(Buffer.concat([a.slice(9),b]));assert.equal(result.length,2);assert.equal(result[0].txt,'你好/@=😀');assert.equal(result[0].nn,'甲/@');assert.equal(result[0].uid,'9007199254740999');assert.equal(result[1].type,'mrkl');assert.equal(d.pending.length,0);
  const broken=a.slice();new DataView(broken.buffer).setUint32(4,5,true);assert.throws(()=>d.read(broken));
});
test('Huya registration round-trips exact IDs; nested message extracts sender and content',()=>{
  const cfg={uid:'9007199254740999',tid:'123',sid:'456'},join=P.tars(P.huyaJoin(cfg)),user=P.tars(join[1]);assert.equal(join[0],1);assert.equal(user[0],cfg.uid);assert.equal(Number(user[4]),123);assert.equal(Number(user[5]),456);
  const w=new P.TarsWriter();w.head(0,10).int(0,cfg.uid).string(2,'中文用户').head(0,11).int(1,123).string(3,'安全 <img> 😀');const packet=new P.TarsWriter().int(0,7).data(1,new P.TarsWriter().int(1,1400).data(2,w.finish()).finish()).finish();const m=P.huyaDecode(packet).messages[0];assert.equal(m.uid,cfg.uid);assert.equal(m.user,'中文用户');assert.equal(m.text,'安全 <img> 😀');assert.equal(m.platform,'huya');assert.throws(()=>P.tars(packet.slice(0,-1)));
});
test('Douyin gzip protobuf keeps 64-bit IDs, ignores gifts and acknowledges correct log ID',async()=>{
  const chat=P.pbPacket([[2,P.pbPacket([[1,9007199254740999999n],[3,'观众']])],[3,'文字🙂']]);const item=P.pbPacket([[1,'WebcastChatMessage'],[2,chat],[3,9007199254740999998n]]),gift=P.pbPacket([[1,'WebcastGiftMessage'],[2,new Uint8Array([255])]]);
  const response=P.pbPacket([[1,item],[1,gift],[5,'ack-state'],[9,1]]),frame=P.pbPacket([[2,9007199254740999997n],[7,'msg'],[8,zlib.gzipSync(response)]]),decoded=await P.douyinDecode(frame);
  assert.equal(decoded.messages.length,1);assert.equal(decoded.messages[0].uid,'9007199254740999999');assert.equal(decoded.messages[0].id,'9007199254740999998');assert.equal(decoded.messages[0].text,'文字🙂');const ack=P.pb(decoded.ack);assert.equal(ack[2][0],9007199254740999997n);assert.equal(new TextDecoder().decode(ack[7][0]),'ack');assert.equal(new TextDecoder().decode(ack[8][0]),'ack-state');
  assert.equal((await P.douyinDecode(P.pbPacket([[7,'hb']]))).messages.length,0);assert.throws(()=>P.pb(Uint8Array.of(10,255)));
});
test('binary readers reject oversized payloads and excessive nested data',async()=>{
  const big=new Uint8Array(8*1024*1024+1);assert.throws(()=>P.pb(big));assert.throws(()=>P.tars(big));assert.throws(()=>new P.DouyuDecoder().read(big));const compressed=P.pbPacket([[8,zlib.gzipSync(big)]]);await assert.rejects(P.douyinDecode(compressed));
});
test('Douyin user homepage identifiers are preserved only when they match the secure ID format',async()=>{
  for(const id of ['MS4wLjABAAAAAAAAabcdefgh12345678','javascript:alert(1)','12345']){
    const chat=P.pbPacket([[2,P.pbPacket([[1,99],[3,'观众'],[46,id]])],[3,'你好']]);
    const response=P.pbPacket([[1,P.pbPacket([[1,'WebcastChatMessage'],[2,chat]])]]),decoded=await P.douyinDecode(P.pbPacket([[8,response]]));
    assert.equal(decoded.messages[0].secUid,id.startsWith('MS4wLjAB')?id:undefined);
  }
});
test('Webcast signature matches upstream vectors; MD5 byte support preserves existing text behavior',async()=>{
  const {webcastSign}=await import('../browser-extension/webcast-sign.mjs'),{md5}=await import('../browser-extension/wbi.mjs');assert.equal(webcastSign('704f436b2558b0d7a1c7e758527dd8f1',[1,true,63,63]),'6pt0VC0aRZDP7n07');assert.equal(webcastSign('704f436b2558b0d7a1c7e758527dd8f1',[0,false,0,6]),'fD+evFuzasjOC8Uu');assert.throws(()=>webcastSign('invalid'));
  for(const value of ['中文',new Uint8Array([0,128,255,42])])assert.equal(md5(value),crypto.createHash('md5').update(value).digest('hex'));
});
test('platform configuration resolves canonical rooms, signs Douyin locally and preserves browser cookies',async()=>{
  const {createPlatformApi}=await import('../browser-extension/platforms.mjs');const calls=[];
  const a=createPlatformApi({request:async(url,options)=>{calls.push({url,options});return{ok:true,text:async()=> 'var TT_PROFILE_INFO={"lp":"90071992547409999"};var TT_ROOM_DATA={"channel":123,"liveChannel":456};',json:async()=>({room:{room_id:777}})}}});
  const huya=await a.chatConfig('https://www.huya.com/alias');assert.equal(huya.uid,'90071992547409999');assert.equal(huya.tid,'123');assert.equal(huya.sid,'456');assert.equal((await a.chatConfig('https://www.douyu.com/123')).room,'777');assert.ok(calls.every(c=>c.options.credentials==='include'));
  const data={roomInfo:{web_rid:'123',room:{id_str:'7689085077556726547',status:2},anchor:{nickname:'主播'}},recommend:{room:{id_str:'111',status:2},anchor:{nickname:'错误主播'},web_rid:'111'}};
  const dy=createPlatformApi({request:async()=>({ok:true,text:async()=>'<script>self.__pace_f.push([1,'+JSON.stringify('a:'+JSON.stringify(data))+'])</script>'})});
  const config=await dy.chatConfig('https://live.douyin.com/123'),u=new URL(config.urls[0]);assert.equal(config.room,'7689085077556726547');assert.equal(u.searchParams.get('room_id'),config.room);assert.equal(u.searchParams.get('signature').length,16);assert.equal(u.searchParams.get('identity'),'audience');assert.equal(u.searchParams.has('cookie'),false);
  data.roomInfo.room.status=4;await assert.rejects(dy.chatConfig('https://live.douyin.com/123'),/未开播/);
  await assert.rejects(a.chatConfig('https://example.com/live'),/暂不支持/);
});
function harness(platform){const timers=new Map(),intervals=new Map(),sockets=[],events=[];let id=0,now=0,calls=0;
  class Socket{constructor(url){this.url=url;this.readyState=0;this.sent=[];sockets.push(this);}send(b){this.sent.push(b);}close(){if(this.readyState===3)return;this.readyState=3;this.onclose?.({code:1000});}open(){this.readyState=1;this.onopen();}}
  const ctx={...scope,window:{...scope.window},WebSocket:Socket,Date:{now:()=>now},setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id},clearTimeout:i=>timers.delete(i),setInterval:(fn,ms)=>{intervals.set(++id,{fn,ms});return id},clearInterval:i=>intervals.delete(i)};
  vm.runInNewContext(fs.readFileSync('browser-extension/ui/platform-chat.js','utf8'),ctx);
  const chat=new ctx.window.PlatformChat('room',async()=>{calls++;return{platform,room:'42',urls:['wss://danmuproxy.douyu.com:8506/','wss://danmuproxy.douyu.com:8503/']}},e=>events.push(e));
  const message=async(ws,fields)=>{ws.onmessage({data:P.douyuPacket(fields)});await new Promise(setImmediate);};return{chat,events,sockets,timers,intervals,message,setNow:n=>now=n,calls:()=>calls};
}
test('connection waits for login, joins correct room, deduplicates, refreshes config, ignores stale sockets',async()=>{
  const h=harness('douyu');await h.chat.start();let ws=h.sockets[0];ws.open();assert.equal(h.events.filter(x=>x.text==='弹幕已连接').length,0);await h.message(ws,{type:'loginres'});assert.equal(new P.DouyuDecoder().read(ws.sent[2])[0].rid,'42');
  await h.message(ws,{type:'chatmsg',rid:42,uid:123,nn:'观众',txt:'消息',cid:'1'});await h.message(ws,{type:'chatmsg',rid:42,uid:123,nn:'观众',txt:'消息',cid:'1'});await h.message(ws,{type:'chatmsg',rid:43,txt:'其他房间',cid:'2'});assert.equal(h.events.filter(x=>x.type==='message').length,1);
  ws.close();assert.equal(h.intervals.size,0);assert.match(h.events.at(-1).text,/重试/);await [...h.timers.values()].find(t=>t.ms===2000).fn();assert.equal(h.calls(),2);const count=h.events.length;await h.message(ws,{type:'chatmsg',txt:'旧房间',cid:'3'});assert.equal(h.events.length,count);ws=h.sockets[1];assert.ok(ws.url.includes('8503'));ws.open();await h.message(ws,{type:'loginres'});h.setNow(76000);[...h.intervals.values()][0].fn();assert.match(h.events.at(-1).text,/心跳超时/);h.chat.stop();assert.equal(h.timers.size,0);assert.equal(h.intervals.size,0);
});
test('stop during configuration prevents late socket creation; endpoints cannot redirect to unrelated sites',async()=>{
  const h=harness('douyu');let resolve;h.chat.config=()=>new Promise(r=>resolve=r);const start=h.chat.start();h.chat.stop();resolve({platform:'douyu',urls:['wss://evil.test/']});await start;assert.equal(h.sockets.length,0);
  const x=harness('douyu');x.chat.config=async()=>({platform:'douyu',urls:['wss://danmuproxy.douyu.com.evil.test:8506/']});await x.chat.start();assert.equal(x.sockets.length,0);assert.match(x.events.at(-1).text,/线路无效/);x.chat.stop();
});
