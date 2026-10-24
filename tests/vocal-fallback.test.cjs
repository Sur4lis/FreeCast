const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture({sourceEnabled=true,muted=false}={}){
 const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,{value:id==='volume'?'80':'50',events:{},addEventListener(name,fn){this.events[name]=fn;}});return elements.get(id);};
 const c={$,running:true,paused:false,demo:false,generation:1,time:0,performance:{now:()=>c.time},Sync:require('../browser-extension/ui/sync.js'),getDelays:()=>({a:10,b:10}),clamp:(x,a,b)=>Math.min(b,Math.max(a,x)),channels:{a:{edge:()=>c.time/1000+20},b:{edge:()=>c.time/1000+20}},window:{live:{vocalRelease:()=>c.releases++,vocalInit:async()=>({realtime:true,delay:7})}},mix:{audioA:true,audioB:sourceEnabled,muted},releases:0,save(){},updateOffset(){},AudioMirror:class{},document:{createElement:()=>({addEventListener(){},pause(){}})}};
 vm.createContext(c);vm.runInContext(fs.readFileSync('browser-extension/ui/vocal.js','utf8')+'\nvocalTemplate.ensureFeed=function(key){this.feeds[key]={pause(){}};};',c);
 vm.runInContext(fs.readFileSync('browser-extension/ui/dual-vocal.js','utf8')+'\nglobalThis.controller=vocal;',c);const v=c.controller;
 const node=()=>({gain:{value:0,cancelScheduledValues(){},setTargetAtTime(value){this.value=value;}}});
 v.ctx={currentTime:10,resume:async()=>{c.resumed=(c.resumed||0)+1;}};v.graphReady=true;v.armed=true;
 for(const p of Object.values(v.pipes)){p.ctx=v.ctx;p.output=node();p.direct=node();p.wet=node();p.dry=node();p.active=true;p.mode=p.sourceKey==='a'?'vocals':'instrumental';p.reset();}
 c.applyMix=()=>v.applyMix();v.applyMix();return{v,c,$};
}
test('AI failure restores raw source audio, keeps volume and leaves the other pipe running',()=>{
 const {v,c,$}=fixture();v.pipes.b.fail(Error('处理超时'));
 assert.equal(c.mix.audioB,true);assert.equal(v.pipes.b.active,false);assert.equal(v.pipes.b.direct.gain.value,1);assert.equal(v.pipes.b.output.gain.value,.4);assert.equal(v.pipes.b.wet.gain.value,0);assert.equal(v.pipes.a.active,true);assert.equal(v.pipes.a.direct.gain.value,0);assert.equal(c.releases,0);
 assert.match($('aiStateB').textContent,/切回原声.*含原解说.*处理超时/);assert.match($('filterStatus').textContent,/B 路已切回原声/);
 v.pipes.a.fail(Error('shared worker stopped'));assert.equal(v.pipes.a.direct.gain.value,1);assert.equal(c.releases,1);assert.doesNotMatch($('filterStatus').textContent,/自动开启/);
 v.disable();assert.equal(v.pipes.b.error,'');assert.doesNotMatch($('filterStatus').textContent,/切回原声/);
});
for(const config of [{sourceEnabled:false},{muted:true}])test('AI failure preserves an intentional mute '+JSON.stringify(config),()=>{
 const {v,c}=fixture(config);const before={...c.mix};v.pipes.b.fail(Error('processing timeout'));assert.deepEqual(c.mix,before);assert.equal(v.pipes.b.output.gain.value,0);assert.equal(v.pipes.b.direct.gain.value,1);
});

function ticking(f){
 const p=f.v.pipes.b;p.mirrors.b={closed:false};p.feed.pause=()=>{p.feed.paused=true;};p.feed.play=async()=>{p.feed.paused=false;};
 Object.assign(p.feed,{paused:false,seeking:false,readyState:4,currentTime:0,buffered:{length:1,start:()=>0,end:()=>1000}});
 p.media=()=>({currentTime:0,seeking:false,paused:false,pause(){}});p.lastHealthyAt=0;return p;
}
test('a broken mirror or a silent processing stall restores original audio and exposes recovery controls',()=>{
 for(const closed of [true,false]){const f=fixture(),p=ticking(f);p.mirror.closed=closed;f.c.time=40000;p.tick();
  assert.equal(p.active,false);assert.equal(p.direct.gain.value,1);assert.equal(f.$('aiRetryB').hidden,false);assert.equal(f.$('aiRawB').hidden,false);assert.equal(f.c.resumed,1);
 }
});
test('healthy AI output during a long replay does not trigger the stall watchdog',()=>{
 const f=fixture(),p=ticking(f);f.c.window.replay={active:true};p.firstSound=0;
 for(let i=1;i<=120;i++){f.c.time=i*3000;p.ctx.currentTime=i*3;p.timeline=[{when:i*3-1,end:i*3+5,mediaStart:10}];p.tick();assert.equal(p.active,true);}
 assert.equal(p.lastHealthyAt,360000);
});
test('building a large manual delay is allowed before the silent-output watchdog expires',()=>{
 const f=fixture(),p=ticking(f);f.c.getDelays=()=>({a:70,b:70});f.c.time=60000;p.feed.buffered.end=()=>10;p.tick();assert.equal(p.active,true);
});
test('retry keeps user mute; original-audio recovery clears failure and disables processing for that route',async()=>{
 const f=fixture({sourceEnabled:false}),p=f.v.pipes.b;p.fail(Error('timeout'));p.mirrors.b={closed:false};
 f.$('aiRetryB').events.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(p.active,true);assert.equal(f.c.mix.audioB,false);assert.equal(p.output.gain.value,0);
 p.fail(Error('again'));await f.$('aiRawB').events.click();assert.equal(p.active,false);assert.equal(p.mode,'off');assert.equal(p.error,'');assert.equal(f.$('aiRetryB').hidden,true);
});
