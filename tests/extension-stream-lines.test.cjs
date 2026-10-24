const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const pending=[],notices=[],elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{dataset:{},options:[],value:'',classList:{remove(){}},add(option){this.options.push(option);},replaceChildren(){this.options=[];},addEventListener(){}});return elements.get(id);};
 const channel=()=>({room:{id:'https://www.douyu.com/6657',requestedQuality:10000,lines:[{value:'one'},{value:'two'}],sources:[{type:'flv',url:'https://example.com/live.flv'}]},load(){this.loaded=true;}});
 const context={running:true,connecting:null,generation:1,channels:{a:channel()},mix:{videoA:true,videoB:false,main:'a'},$:element,URL,
  Option:function(text,value){this.text=text;this.value=value;},clearTimeout,notice:(...args)=>notices.push(args),
  window:{live:{resolveRoom:(...args)=>new Promise((resolve,reject)=>pending.push({args,resolve,reject}))}}
 };
 vm.runInNewContext(fs.readFileSync('browser-extension/ui/stream-lines.js','utf8'),context);
 return {context,pending,notices,element,channel,change:context.window.streamLines.change};
}
test('a failed line request from the previous room must not show an error over a new stream',async()=>{
 const f=fixture(),done=f.change('a','two');f.context.channels.a=f.channel();f.context.generation++;
 f.context.window.streamLines.refresh();assert.equal(f.element('lineA').disabled,false);
 f.pending[0].reject(Error('old room unavailable'));await done;
 assert.deepEqual(f.notices,[]);assert.equal(f.element('lineA').disabled,false);
});
test('an older line request must not clear the loading state of a newer request',async()=>{
 const f=fixture(),old=f.change('a','two'),next=f.change('a','one');
 f.pending[0].resolve(f.channel().room);await old;
 assert.equal(f.element('lineA').disabled,true);assert.ok(f.element('lineA').dataset.loading);
 f.pending[1].resolve(f.channel().room);await next;
 assert.equal(f.element('lineA').disabled,false);assert.equal(f.context.channels.a.loaded,true);assert.equal(f.notices.length,1);
});
test('current line failures remain visible and reenable the selector',async()=>{
 const f=fixture(),done=f.change('a','two');f.pending[0].reject(Error('线路失效'));await done;
 assert.equal(f.element('lineA').disabled,false);assert.match(f.notices[0][0],/线路失效/);assert.equal(f.notices[0][1],true);
});
