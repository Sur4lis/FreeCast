const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

function stopFixture(){
  const recording=deferred(),elements=new Map(),request={cancelled:false};
  const context={Promise,generation:3,running:true,paused:false,demo:false,pauseLag:2,connecting:request,oscillator:null,audioContext:null,chatStates:{a:'已连接',b:'已连接'},oldStops:0,newStops:0};
  context.channels={a:{stop:()=>context.oldStops++},b:{stop:()=>context.oldStops++}};
  context.$=id=>{if(!elements.has(id))elements.set(id,{classList:{remove(){}},hidden:false,disabled:false,textContent:''});return elements.get(id);};
  context.window={localRecording:{stop:()=>recording.promise},vocal:{disable(){},reset(){}},replay:{reset(){}},live:{stopChat:async()=>{}}};
  context.cancelConnection=()=>{if(context.connecting)context.connecting.cancelled=true;context.connecting=null;};
  for(const name of ['clearChat','updateOffset','applyMix','connectionUI'])context[name]=()=>{};
  const source=fs.readFileSync('browser-extension/ui/app.js','utf8');
  vm.runInNewContext(source.slice(source.indexOf('async function stop('),source.indexOf('async function connect(')),context);
  return {context,recording,request};
}
test('stop invalidates playback and pending connections while the MP4 is still finishing',async()=>{
  const {context:c,recording,request}=stopFixture();const done=c.stop();
  try{assert.equal(c.running,false);assert.equal(c.generation,4);assert.equal(request.cancelled,true);assert.equal(c.oldStops,2);assert.equal(Object.keys(c.channels).length,0);}
  finally{recording.resolve();await done;}
});
test('an earlier stop cannot tear down a new stream after its recording finishes',async()=>{
  const {context:c,recording}=stopFixture();const done=c.stop();
  c.running=true;c.channels={a:{stop:()=>c.newStops++},b:{stop:()=>c.newStops++}};c.connecting={cancelled:false};
  recording.resolve();await done;
  assert.equal(c.newStops,0);assert.equal(c.running,true);assert.equal(c.connecting.cancelled,false);
});
test('switching sources keeps its connection request alive while stopping the old playback',async()=>{
  const {context:c,recording,request}=stopFixture();const done=c.stop({preserveConnection:request});
  try{assert.equal(c.connecting,request);assert.equal(request.cancelled,false);assert.equal(c.running,false);}
  finally{recording.resolve();await done;}
});

for(const phase of ['graph','resume'])test('canceling AI during '+phase+' does not start a late model initialization',async()=>{
  const gate=deferred();let initCalls=0;
  const audio={resume:()=>phase==='resume'?gate.promise:Promise.resolve()},context={generation:7,running:true,window:{live:{vocalInit:async()=>{initCalls++;return {realtime:true};}}},$:()=>({value:'auto'})};
  context.vocal={graph:()=>phase==='graph'?gate.promise:Promise.resolve(),controls(){},selectedCount:()=>1};
  vm.runInNewContext(fs.readFileSync('browser-extension/ui/vocal.js','utf8')+'\nglobalThis.template=vocalTemplate;',context);
  const pipe=Object.assign(Object.create(context.template),{mode:'instrumental',ctx:audio,mirrors:{b:{closed:false}},feeds:{b:{pause(){}}},reset(){}});
  const enabling=pipe.enable();await Promise.resolve();pipe.disable();gate.resolve();await enabling;
  assert.equal(initCalls,0);assert.equal(pipe.active,false);assert.equal(pipe.loading,false);
});
