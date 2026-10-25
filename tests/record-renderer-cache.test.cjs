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

test('floating mini geometry follows movement and resizing relative to the video area',()=>{
 const f=fixture(),geometry=f.context.window.recordRenderer.geometry,main={left:100,top:50,width:960,height:540};
 const a=geometry(main,{left:200,top:120,width:240,height:135},1920,1080,true);
 assert.deepEqual([a.x,a.y,a.w,a.h],[200,140,480,270]);
 const b=geometry(main,{left:450,top:250,width:320,height:180},1920,1080,true);
 assert.deepEqual([b.x,b.y,b.w,b.h],[700,400,640,360]);
 const outside=geometry(main,{left:1200,top:800,width:240,height:135},1920,1080,true);assert.ok(outside.x>1920,'off-screen floating windows stay off-screen');
 const sidebar=geometry(main,{left:1200,top:800,width:240,height:135},1920,1080,false);assert.ok(sidebar.x+sidebar.w<=1920&&sidebar.y+sidebar.h<=1080,'docked windows retain an inset');
});
