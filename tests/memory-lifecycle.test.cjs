const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function mirrorFixture(){
 const objects=[],revoked=[],window={};
 class Events{constructor(){this.events=new Map();}addEventListener(k,v){this.events.set(k,v);}removeEventListener(k){this.events.delete(k);}}
 class MediaSource extends Events{constructor(){super();this.readyState='open';objects.push(this);}addSourceBuffer(){return this.sb=Object.assign(new Events(),{updating:true,buffered:{length:0},appendBuffer(){},abort(){this.updating=false;}});}removeSourceBuffer(sb){assert.equal(sb,this.sb);this.sb=null;}}
 const media={src:'',pause(){},removeAttribute(){this.src='';},load(){}},errors=[];
 vm.runInNewContext(fs.readFileSync('browser-extension/ui/audio-mirror.js','utf8'),{window,MediaSource,Uint8Array,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:url=>revoked.push(url)}});
 return {mirror:new window.AudioMirror(media,e=>errors.push(e.message)),media,objects,revoked,errors};
}
test('disabled AI retains only codec initialization and opens no decoder',()=>{
 const {mirror,objects}=mirrorFixture();const init=new Uint8Array([0,0,0,8,102,116,121,112]);mirror.push(init,'audio/mp4');
 const media=new Uint8Array(1024*1024);for(let i=0;i<20000;i++)mirror.push(media,null);
 assert.equal(objects.length,0);assert.equal(mirror.items.length,0);assert.equal(mirror.bytes,0);assert.equal(mirror.init.data.length,8);
 mirror.resume();assert.equal(objects.length,1);assert.equal(mirror.items.length,1);mirror.flush();mirror.push(media,null);
 const sb=mirror.sb;mirror.suspend();assert.equal(mirror.bytes,0);assert.equal(mirror.mse,null);assert.equal(mirror.sb,null);assert.equal(sb.events.size,0);assert.equal(mirror.items.length,0);
 mirror.resume();assert.equal(mirror.items.length,1);assert.equal(mirror.bytes,8);mirror.close();assert.equal(mirror.init,null);assert.equal(mirror.mse,null);
});
test('blocked audio decoder stops and releases its queue before it exceeds 4 MiB',()=>{
 const {mirror,errors}=mirrorFixture();mirror.push(new Uint8Array(8),'audio/mp4',undefined,true);mirror.resume();mirror.flush();
 const chunk=new Uint8Array(1024*1024);for(let i=0;i<8;i++)mirror.push(chunk,null);
 assert.equal(errors.length,1);assert.equal(mirror.closed,true);assert.equal(mirror.bytes,0);assert.equal(mirror.items.length,0);assert.equal(mirror.mse,null);
});
function bufferFixture(){
 const window={},timers=[];let seconds=300,delay=3;
 class Hls{constructor(){this.config={};this.events=[];}trigger(...args){this.events.push(args);}}Hls.Events={BUFFER_FLUSHING:'flush'};
 const scope={window,Hls,performance:{now:()=>5000},getDelays:()=>({a:delay,b:delay}),Sync:require('../browser-extension/ui/sync.js'),setTimeout:fn=>{timers.push(fn);return 1;},notice(){}};
 window.replay={seconds:()=>seconds};vm.runInNewContext(fs.readFileSync('browser-extension/ui/media-buffer.js','utf8'),scope);
 const buffered={length:1,start:()=>0,end:()=>600},media={id:'videoB',currentTime:597,readyState:4,seeking:false,buffered};
 const mse={_config:{},_sourceBuffers:{video:{buffered},audio:{buffered}},_pendingRemoveRanges:{video:[],audio:[]},_pendingSegments:{audio:[],video:[]},_doRemoveRanges(){this.removes=(this.removes||0)+1;},appendMediaSegment(s){this._pendingSegments[s.type].push(s);}};
 const channel={media,engine:{_player_engine:{_mse_controller:mse}},load(){this.loads=(this.loads||0)+1;}};
 return {api:window.mediaBuffers,channel,mse,Hls,timers,window,setSeconds:v=>seconds=v,setDelay:v=>delay=v};
}
test('turning replay off prunes already buffered video immediately for FLV and HLS',()=>{
 const {api,channel,mse,Hls,setSeconds}=bufferFixture();assert.equal(api.configure(channel).retain,323);
 setSeconds(0);api.trim(channel,true);assert.equal(mse._pendingRemoveRanges.video[0].end,487);assert.equal(mse.removes,1);
 channel.engine=new Hls();api.trim(channel,true);assert.equal(channel.engine.events[0][1].endOffset,487);assert.equal(channel.engine.config.maxBufferSize,64*1024*1024);
});
test('stalled playback cannot pin the complete stream forever',()=>{
 const {api,channel,mse,setSeconds}=bufferFixture();setSeconds(0);channel.media.currentTime=10;api.trim(channel,true);
 assert.equal(channel.media.currentTime,597);assert.equal(mse._pendingRemoveRanges.video[0].end,487);
});

test('Android releases older buffers sooner and still retains the selected replay window',()=>{
 const {api,channel,Hls,window,setSeconds}=bufferFixture();window.mobileNative={};setSeconds(0);channel.engine=new Hls();
 assert.equal(api.configure(channel).retain,53);assert.equal(channel.engine.config.maxBufferSize,32*1024*1024);
 api.trim(channel,true);assert.equal(channel.engine.events[0][1].endOffset,547);
 setSeconds(300);assert.equal(api.configure(channel).retain,323);setSeconds(0);assert.equal(api.configure(channel).retain,53);
});
test('a blocked FLV decoder recovers its current line at the queue limit',()=>{
 const {api,channel,mse,timers}=bufferFixture();api.attach(channel);
 for(let i=0;i<100;i++)mse.appendMediaSegment({type:'video',data:{byteLength:8*1024*1024}});
 assert.equal(api.pending(mse).bytes,32*1024*1024);assert.equal(timers.length,1);timers[0]();assert.equal(channel.loads,1);
});
test('PCM replay has a byte ceiling and shrinking or disabling the cache releases it',()=>{
 let seconds=300;const pipe={overlap:22050,rate:44100,detachMirror(){},disable(){},fail(){}};
 const window={vocal:{pipes:{b:pipe}},replay:{seconds:()=>seconds}};
 vm.runInNewContext(fs.readFileSync('browser-extension/ui/vocal-replay.js','utf8'),{window});
 for(let i=0;i<200;i++)pipe.rememberReplay({duration:6,length:6*44100,numberOfChannels:2},i*5.5);
 assert.ok(pipe.replayBytes()<=128*1024*1024);const before=pipe.replayBytes();seconds=60;pipe.pruneReplay();assert.ok(pipe.replayBytes()<before/3);
 seconds=0;pipe.pruneReplay();assert.equal(pipe.replayBytes(),0);assert.equal(pipe.replayRanges().length,0);
});
