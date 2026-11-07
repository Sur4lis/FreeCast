const {test}=require('node:test'),assert=require('node:assert/strict');
const {migrate}=require('../browser-extension/ui/color-defaults.js');
function storage(values={}){const data=new Map(Object.entries(values));return{data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};}
test('the upgrade changes only color switches across current, custom and saved combinations',()=>{
 const settings={mix:{danmakuSourceColors:true,danmakuPlatformColors:false,danmakuColorA:'#123456',scMaxDuration:120},offset:4.2};
 const s=storage({'dual-live-settings-v1':JSON.stringify(settings),'freecast-configurations-v1':JSON.stringify({selected:'custom',custom:settings}),
  'freecast-combinations-v1':JSON.stringify([{id:7,name:'组合',settings}]),account:'unrelated'});
 assert.equal(migrate(s),true);
 const saved=JSON.parse(s.getItem('dual-live-settings-v1'));
 assert.deepEqual(saved,{...settings,mix:{...settings.mix,danmakuSourceColors:false,danmakuPlatformColors:true}});
 assert.deepEqual(JSON.parse(s.getItem('freecast-configurations-v1')),{selected:'custom',custom:saved});
 assert.deepEqual(JSON.parse(s.getItem('freecast-combinations-v1')),[{id:7,name:'组合',settings:saved}]);
 assert.equal(s.getItem('account'),'unrelated');
});
test('later user color choices are preserved on restart',()=>{
 const s=storage();migrate(s);s.setItem('dual-live-settings-v1',JSON.stringify({mix:{danmakuSourceColors:true,danmakuPlatformColors:false}}));
 const before=[...s.data];assert.equal(migrate(s),false);assert.deepEqual([...s.data],before);
});
test('malformed unrelated saved state does not prevent the color upgrade',()=>{
 const s=storage({'dual-live-settings-v1':'broken','freecast-configurations-v1':'null','freecast-combinations-v1':'[null,{}]'});
 assert.equal(migrate(s),true);assert.equal(s.getItem('dual-live-settings-v1'),'broken');
});
