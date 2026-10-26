const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('fullscreen AI protection requires sustained contention and resets on exit, pause or background',async()=>{
  const {renderingOverloaded}=await import('../browser-extension/ai/performance.mjs');
  const classes=new Set(),listeners={},elements=new Map();let next=0,pending=new Map(),clock=0,total=0,dropped=0;
  const element=id=>{if(!elements.has(id))elements.set(id,{id,style:{},add(){},append(){},before(){},setAttribute(){},addEventListener(){},querySelector:()=>media});return elements.get(id);};
  const media={getVideoPlaybackQuality:()=>({totalVideoFrames:total,droppedVideoFrames:dropped})};
  const context={renderingOverloaded,console,navigator:{hardwareConcurrency:8,deviceMemory:16},localStorage:{getItem(){return null;}},channels:{},viewMode:'full',paused:false,Option:class{},Event:class{},$:element,
    document:{hidden:false,documentElement:{classList:{toggle(k,on){if(on)classes.add(k);else classes.delete(k);},add:k=>classes.add(k),remove:k=>classes.delete(k)}},createElement:element,addEventListener:(t,fn)=>listeners[t]=fn},
    requestAnimationFrame:fn=>{pending.set(++next,fn);return next;},cancelAnimationFrame:id=>pending.delete(id),dispatchEvent(){},addEventListener(){},vocal:{active:true}};
  context.window=context;
  let source=fs.readFileSync('browser-extension/ui/playback-performance.js','utf8');source=source.replace(/^  if\(window.live.vocalInit\)import[^\n]+/m,'  overloaded=renderingOverloaded;');vm.runInNewContext(source,context);
  const api=context.playbackPerformance;
  function step(ms,drop=0){clock+=ms;total+=6;dropped+=drop;const callbacks=[...pending.values()];pending.clear();for(const cb of callbacks)cb(clock);}
  api.refresh();for(let i=0;i<63;i++)step(100);assert.equal(api.aiScheduling().renderPressure,false,'one bad sample does not downgrade');
  for(let i=0;i<64;i++)step(100);assert.equal(api.aiScheduling().renderPressure,true);assert.ok(classes.has('ai-render-protection'));
  context.viewMode='theater';api.refresh();assert.equal(api.aiScheduling().renderPriority,false);assert.equal(api.rendering().protected,false);assert.equal(pending.size,0);
  context.viewMode='full';api.refresh();for(let i=0;i<800;i++)step(16,2);assert.equal(api.rendering().protected,true,'decoder drops also activate protection');
  context.paused=true;api.refresh();assert.equal(api.rendering().protected,false);assert.equal(pending.size,0);
  context.paused=false;api.refresh();context.document.hidden=true;listeners.visibilitychange();assert.equal(pending.size,0);assert.equal(api.aiScheduling().renderPriority,false);
  context.document.hidden=false;listeners.visibilitychange();assert.ok(pending.size);context.vocal.active=false;api.refresh();assert.equal(pending.size,0);
});
