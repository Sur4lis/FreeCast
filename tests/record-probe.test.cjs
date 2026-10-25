const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(capacity,support=()=>true){
  let now=0,closed=0;const context={setTimeout,clearTimeout,performance:{now:()=>now}};context.self=context;
  context.VideoFrame=class{constructor(frame){this.width=frame.width;}close(){closed++;}};
  context.AudioEncoder={isConfigSupported:async()=>({supported:true})};
  context.VideoEncoder=class{
    static async isConfigSupported(config){return {supported:support(config),config};}
    constructor(handlers){this.handlers=handlers;this.state='unconfigured';this.queue=0;}
    configure(config){this.config=config;this.state='configured';}
    encode(){this.queue++;now+=1000/capacity(this.config);}
    async flush(){while(this.queue){this.queue--;this.handlers.output();}}
    close(){this.state='closed';}
  };
  vm.runInNewContext(fs.readFileSync('browser-extension/ui/record-quality.js','utf8'),context);
  vm.runInNewContext(fs.readFileSync('browser-extension/ui/record-probe.js','utf8').replace(/^import[^\n]+\n/,'').replaceAll('export ',''),context);
  const seen=[],getFrame=async plan=>({width:plan.width,close(){closed++;}});
  return {context,seen,closed:()=>closed,probe:plan=>context.probeRecording({...plan,sampleRate:48000},getFrame,p=>seen.push([p.width,p.fps,p.hardwareAcceleration]))};
}
test('performance probing keeps source detail when measured headroom is sufficient',async()=>{
  const f=setup(()=>100),plan=f.context.recordQuality.config('source',{videoWidth:1920,videoHeight:1080},60),chosen=await f.probe(plan);
  assert.equal(chosen.fps,60);assert.equal(chosen.width,1920);assert.equal(chosen.adjusted,false);assert.equal(chosen.capacity,100);assert.equal(f.closed(),72);
});
test('slow native encoding lowers frame rate before reducing source detail',async()=>{
  const f=setup(()=>45),plan=f.context.recordQuality.config('source',{videoWidth:3840,videoHeight:2160},60);
  const chosen=await f.probe(plan);assert.equal(chosen.width,3840);assert.equal(chosen.height,2160);assert.equal(chosen.fps,30);assert.equal(chosen.adjusted,true);assert.ok(f.seen.some(x=>x[1]===60));
});
test('performance mode never silently drops below its requested 1080p30 profile',async()=>{
  const f=setup(()=>20),plan=f.context.recordQuality.config('performance',{videoWidth:3840,videoHeight:2160},60);
  await assert.rejects(f.probe(plan),/性能检测/);assert.ok(f.seen.every(x=>x[0]===1920&&x[1]===30));
});
test('unsupported preferred acceleration falls back to measured browser encoding',async()=>{
  const f=setup(()=>100,c=>c.hardwareAcceleration==='no-preference'),plan=f.context.recordQuality.config('performance',{videoWidth:1920,videoHeight:1080});
  assert.equal((await f.probe(plan)).hardwareAcceleration,'no-preference');
});

test('a codec advertised as supported but failing configuration tries the bitrate fallback',async()=>{
  const f=setup(()=>100),Encoder=f.context.VideoEncoder;f.context.VideoEncoder=class extends Encoder{configure(config){if(config.bitrateMode==='quantizer')throw Error('Driver rejects quantizer');super.configure(config);}};
  const plan=f.context.recordQuality.config('performance',{videoWidth:1920,videoHeight:1080});assert.equal((await f.probe(plan)).rateControl,'variable');
});
