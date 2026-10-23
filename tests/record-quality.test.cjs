const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={setTimeout,clearTimeout};vm.runInNewContext(fs.readFileSync('browser-extension/ui/record-quality.js','utf8'),context);const q=context.recordQuality;
test('old preferences migrate into two modes without keeping a fake 720p/60fps label',()=>{
  assert.deepEqual(Object.keys(q.presets),['source','performance']);
  for(const old of ['720p','1080p','performance'])assert.equal(q.normalize(old),'performance');
  for(const old of [undefined,'source','1080p60','bad'])assert.equal(q.normalize(old),'source');
});
test('native pixels and frame rate survive while performance caps only high-resolution sources',()=>{
  const source=q.config('source',{videoWidth:2560,videoHeight:1440},25),performance=q.config('performance',{videoWidth:2560,videoHeight:1440},60);
  assert.deepEqual([source.width,source.height,source.fps],[2560,1440,25]);
  assert.deepEqual([performance.width,performance.height,performance.fps],[1920,1080,30]);
  const low=q.config('performance',{videoWidth:1280,videoHeight:720});assert.deepEqual([low.width,low.height],[1280,720]);
  const portrait=q.config('performance',{videoWidth:2160,videoHeight:3840});assert.deepEqual([portrait.width,portrait.height],[1080,1920]);
  const native8k=q.config('source',{videoWidth:7680,videoHeight:4320});assert.equal(native8k.width,7680);
  assert.throws(()=>q.config('source',{videoWidth:0,videoHeight:0}),/尚未就绪/);
});
test('encoder fallback keeps the largest supported frame and even dimensions',()=>{
  const list=q.candidates(q.config('source',{videoWidth:3840,videoHeight:2160},60));
  assert.deepEqual(Array.from(list,x=>[x.width,x.height,x.fps]),[[3840,2160,60],[3840,2160,30],[2560,1440,60],[2560,1440,30],[1920,1080,60],[1920,1080,30]]);
  assert.equal(q.level(1920,1080,60),'2a');assert.equal(q.level(3840,2160,60),'34');assert.equal(q.level(7680,4320,60),'3d');
});
test('source rate comes from tracks or presented frame timestamps, with bounded wait',async()=>{
  assert.equal(await q.frameRate({srcObject:{getVideoTracks:()=>[{getSettings:()=>({frameRate:29.97})}]}}),30);
  let time=0,callback;const video={requestVideoFrameCallback(fn){callback=setTimeout(()=>fn(0,{mediaTime:(time+=.04)}),1);return callback;},cancelVideoFrameCallback:clearTimeout};
  assert.equal(await q.frameRate(video),25);
  assert.equal(await q.frameRate({requestVideoFrameCallback:()=>1,cancelVideoFrameCallback(){}}),60);
});
