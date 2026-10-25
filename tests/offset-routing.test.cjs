const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Sync=require('../browser-extension/ui/sync.js');
function fixture(){
  const elements={},source=fs.readFileSync('browser-extension/ui/app.js','utf8');
  const scope={Sync,delays:Sync.delays,clamp:Sync.clamp,offset:0,window:{},channels:{a:{playout:{started:true}},b:{playout:{started:true}}},$:(id)=>elements[id]||=( {} ),save(){}};
  vm.createContext(scope);vm.runInContext(source.slice(source.indexOf('function updateOffset('),source.indexOf('class Channel')),scope);
  return scope;
}
test('crossing zero distributes fractional steps to the correct A/B routes',()=>{
  const f=fixture();f.offset=.1;f.updateOffset(-.1);
  assert.equal(f.offset,-.1);assert.equal(f.channels.a.playout.manualShift,-.1);assert.equal(f.channels.b.playout.manualShift,.1);
});
test('AI processing receives manual steps only on its audio feed',()=>{
  const f=fixture(),feedPlayout={started:true};f.window.vocal={pipes:{a:{active:true,feedPlayout}}};f.updateOffset(.1);
  assert.equal(feedPlayout.manualShift,.1);assert.equal(f.channels.a.playout.manualShift,undefined);
  f.window.vocal.pipes.a.active=false;f.updateOffset(.2);
  assert.equal(feedPlayout.manualShift,.1);assert.equal(f.channels.a.playout.manualShift,.1);
});
test('replay offset edits seek the current replay without queuing a second live adjustment',()=>{
  const f=fixture(),seeks=[];f.window.replay={active:true,currentLag:()=>12.5,seek:value=>seeks.push(value)};f.updateOffset(.1);
  assert.deepEqual(seeks,[12.5]);assert.equal(f.channels.a.playout.manualShift,undefined);
});
test('offset updates with no step do not reapply the previous adjustment',()=>{
  const f=fixture();f.updateOffset(.1);f.updateOffset();f.updateOffset();
  assert.equal(f.channels.a.playout.manualShift,.1);assert.equal(f.channels.b.playout.manualShift,0);
});
