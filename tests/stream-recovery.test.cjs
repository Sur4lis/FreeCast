const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
  let now=0,serial=0,ranges=[];const timers=new Map(),engines=[],requests=[],notices=[];
  class Hls{static Events={ERROR:'error'};constructor(config){this.config=config;this.listeners={};engines.push(this);}on(event,fn){this.listeners[event]=fn;}loadSource(){}attachMedia(){}destroy(){this.destroyed=true;}fail(){this.listeners.error('error',{fatal:true,details:'networkError'});}}
  const media={id:'videoB',currentTime:0,readyState:0,paused:true,seeking:false,pause(){this.paused=true;},removeAttribute(){},load(){ranges=[];this.currentTime=0;this.readyState=0;},buffered:{get length(){return ranges.length;},start:i=>ranges[i][0],end:i=>ranges[i][1]}};
  const room=()=>({id:6,inputId:6,requestedQuality:10000,sources:[{url:'https://stream.example/live.m3u8',type:'hls',quality:10000}]});
  const scope={window:{live:{resolveRoom:async()=>{requests.push(now);return room();}}},paused:false,performance:{now:()=>now},Hls,URL,location:{href:'https://example.com/ui/index.html'},queue:{clear(){}},queueB:{clear(){}},updateQualityState(){},queueMicrotask,notice:text=>notices.push(text),
    setTimeout:(fn,ms)=>{timers.set(++serial,{fn,at:now+ms});return serial;},clearTimeout:id=>timers.delete(id)};
  const source=fs.readFileSync('browser-extension/ui/app.js','utf8');vm.runInNewContext(source.slice(source.indexOf('class Channel {'),source.indexOf('function clearChat()'))+'\nglobalThis.Channel=Channel;',scope);
  const channel=new scope.Channel(media,room(),'B 画面',1);
  return{scope,channel,media,engines,requests,notices,timers,room,setNow:value=>now=value,setRanges:value=>ranges=value,
    async next(){const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0]||[];assert.ok(timer,'expected a scheduled recovery');timers.delete(id);now=timer.at;await timer.fn();},
    progress(){ranges=[[0,20]];media.readyState=4;media.paused=false;media.currentTime=10;channel.playout.started=true;channel.sample(now);now+=200;media.currentTime+=.2;channel.sample(now);}};
}
test('separate stream interruptions can renew URLs more than once without manual reconnect',async()=>{
  const f=fixture();f.progress();f.engines.at(-1).fail();await f.next();assert.equal(f.requests.length,1);f.progress();
  f.engines.at(-1).fail();await f.next();assert.equal(f.requests.length,2);assert.equal(f.channel.index,0);assert.ok(f.channel.engine);assert.equal(f.channel.error,'');f.channel.stop();
});
test('temporary room API failures keep retrying with backoff and preserve the source',async()=>{
  const f=fixture();let n=0;f.scope.window.live.resolveRoom=async()=>{n++;if(n<3)throw Error('temporary network failure');return f.room();};
  f.engines[0].fail();await f.next();assert.equal(n,1);assert.ok(f.timers.size);await f.next();assert.equal(n,2);assert.ok(f.timers.size);await f.next();
  assert.equal(n,3);assert.ok(f.channel.engine);assert.equal(f.channel.room.id,6);assert.equal(f.channel.error,'');f.channel.stop();
});
test('late decoder errors from a destroyed engine cannot disrupt the replacement',async()=>{
  const f=fixture(),old=f.engines[0];f.channel.load();old.fail();assert.equal(f.timers.size,0);f.channel.stop();
});
test('an in-flight URL refresh cannot overlap or restart playback after stop',async()=>{
  const f=fixture();let resolve,n=0;f.scope.window.live.resolveRoom=()=>{n++;return new Promise(r=>resolve=r);};
  f.engines[0].fail();const pending=f.next();await Promise.resolve();f.channel.fallback();assert.equal(n,1);assert.equal(f.timers.size,0);
  f.channel.stop();resolve(f.room());await pending;assert.equal(f.channel.engine,null);assert.equal(f.timers.size,0);
});
test('paused playback and a full forward buffer do not look like disconnected streams',()=>{
  const f=fixture();f.progress();f.scope.paused=true;f.setNow(45000);f.channel.sample(45000);assert.equal(f.timers.size,0);
  f.scope.paused=false;f.setRanges([[0,90]]);f.media.currentTime=10;f.channel.sample(45000);f.setNow(75000);f.channel.sample(75000);assert.equal(f.timers.size,0);f.channel.stop();
});
test('genuinely exhausted live buffers trigger recovery',()=>{
  const f=fixture();f.progress();f.media.currentTime=20;f.media.readyState=2;f.setNow(25000);f.channel.sample(25000);assert.equal(f.timers.size,1);f.channel.stop();
});
test('recovery is announced only after media advances, and risk blocks do not loop',async()=>{
  const f=fixture();f.engines[0].fail();await f.next();assert.ok(!f.notices.some(s=>s.includes('已恢复')));f.progress();assert.equal(f.channel.recoveries,1);assert.ok(f.notices.some(s=>s.includes('已恢复')));
  f.scope.window.live.resolveRoom=async()=>{throw Error('B 站接口 HTTP 412');};f.engines.at(-1).fail();await f.next();assert.equal(f.timers.size,0);assert.match(f.channel.error,/412/);f.channel.stop();
});
