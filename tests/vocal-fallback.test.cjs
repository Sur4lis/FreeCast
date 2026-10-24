const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture({sourceEnabled=true,muted=false}={}){
 const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,{value:id==='volume'?'80':'50',addEventListener(){}});return elements.get(id);};
 const c={$,window:{live:{vocalRelease:()=>c.releases++}},mix:{audioA:true,audioB:sourceEnabled,muted},releases:0,save(){},updateOffset(){},AudioMirror:class{},document:{createElement:()=>({addEventListener(){},pause(){}})}};
 vm.createContext(c);vm.runInContext(fs.readFileSync('browser-extension/ui/vocal.js','utf8')+'\nvocalTemplate.ensureFeed=function(key){this.feeds[key]={pause(){}};};',c);
 vm.runInContext(fs.readFileSync('browser-extension/ui/dual-vocal.js','utf8')+'\nglobalThis.controller=vocal;',c);const v=c.controller;
 const node=()=>({gain:{value:0,cancelScheduledValues(){},setTargetAtTime(value){this.value=value;}}});
 v.ctx={currentTime:10};v.graphReady=true;v.armed=true;
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
