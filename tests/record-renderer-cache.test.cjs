const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const pending=new Map(),context={window:{},fetch:async url=>({ok:true,blob:async()=>url}),createImageBitmap:async url=>new Promise(resolve=>pending.set(url,resolve))};
 const source=fs.readFileSync('browser-extension/ui/record-renderer.js','utf8').replace('window.recordRenderer={','globalThis.loadImage=image;window.recordRenderer={');vm.runInNewContext(source,context);
 const settle=()=>new Promise(resolve=>setImmediate(resolve));
 return {context,pending,settle,bitmap:()=>({closed:0,close(){this.closed++;}})};
}
test('an emote finishing after recording cleanup must release its bitmap',async()=>{
 const f=fixture();f.context.loadImage('emote');await f.settle();f.context.window.recordRenderer.clear();
 const bitmap=f.bitmap();f.pending.get('emote')(bitmap);await f.settle();assert.equal(bitmap.closed,1);
});
test('a pending emote evicted by the cache limit must release its bitmap',async()=>{
 const f=fixture();for(let i=0;i<101;i++)f.context.loadImage('emote'+i);await f.settle();
 const bitmap=f.bitmap();f.pending.get('emote0')(bitmap);await f.settle();assert.equal(bitmap.closed,1);
});
test('active recording reuses loaded emotes and closes each bitmap on cleanup',async()=>{
 const f=fixture();f.context.loadImage('emote');await f.settle();const bitmap=f.bitmap();f.pending.get('emote')(bitmap);await f.settle();
 assert.equal(f.context.loadImage('emote'),bitmap);assert.equal(bitmap.closed,0);
 f.context.window.recordRenderer.clear();f.context.window.recordRenderer.clear();assert.equal(bitmap.closed,1);
});
