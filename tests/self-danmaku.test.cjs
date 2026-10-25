const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

function fixture(saved={},mobile=false){
  const storage=new Map(Object.entries(saved)),elements=new Map(),chatListeners=[],recorded=[],remembered=[],canvases=[];
  let document;
  class Element {
    constructor(id=''){this.id=id;this.children=[];this.dataset={};this.style={setProperty(k,v){this[k]=v;}};this.listeners={};this.value='';this.checked=true;this.hidden=false;this.className='';this.textContent='';this.isConnected=true;this.offsetWidth=120;this.offsetHeight=36;this.clientWidth=800;this.clientHeight=450;this.scrollHeight=450;this.scrollTop=0;this.attributes={};this.classList={contains:k=>this.className.split(' ').includes(k),add:k=>this.className+=' '+k,remove:k=>this.className=this.className.split(' ').filter(x=>x!==k).join(' '),toggle:(k,v)=>v?this.classList.add(k):this.classList.remove(k)};}
    get options(){return this.children;}
    get firstChild(){return this.children[0];}
    append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
    replaceChildren(...children){this.children=[];this.append(...children);}
    remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(c=>c!==this);this.isConnected=false;}
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
    dispatch(type){const event={target:this};for(const fn of this.listeners[type]||[])fn(event);for(const fn of document.listeners[type]||[])fn(event);}
    setAttribute(k,v){this.attributes[k]=v;}
    getBoundingClientRect(){return{left:0,top:0,right:this.offsetWidth,bottom:this.offsetHeight,width:this.offsetWidth,height:this.offsetHeight};}
    getAnimations(){return[];}
    querySelector(selector){return this.children.find(el=>selector.startsWith('.')?el.classList.contains(selector.slice(1)):selector==='[value=custom]'&&el.value==='custom')||null;}
    closest(selector){return selector.split(',').includes('#'+this.id)?this:null;}
    focus(){}
  }
  const element=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
  const context=vm.createContext({console,URL,URLSearchParams,performance,TextEncoder,TextDecoder,
    Sync:require('../browser-extension/ui/sync.js'),setInterval(){},setTimeout(){return 1;},clearTimeout(){},
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},
    location:{search:'',pathname:'/'},history:{replaceState(){}},ResizeObserver:class{observe(){}},
    applyMix(){},renderChatStatus(){},saveVocalTuning(){},renderQualities(key){const option=new Element();option.value='10000';element('quality'+key).replaceChildren(option);},
    chrome:{runtime:{onMessage:{addListener(){}}},tabs:{getCurrent:async()=>null}},
    addEventListener(){},ChatContent:{append(el,m){el.textContent+=m.text;}},
    live:{onChat(fn){chatListeners.push(fn);return()=>{};},authStatus:async()=>({loggedIn:true,uid:123,name:'测试用户'})},
    vocal:{settings:()=>({}),disable(){},configure(){},restore(){},controls(){},label:()=>''},
    replay:{active:false,seconds:()=>0,setSeconds(){},remember:(m,edge)=>remembered.push({m,edge})},
    superChats:{tick(){},add(){}},localRecording:{message:m=>recorded.push(m)},
    freecastTheme:{normalize:v=>v||'bluepink',set:v=>document.documentElement.dataset.theme=v},
    chatAvoidance:{rects:()=>[],visible:(w,h)=>[{x:0,y:0,w,h}]},
    NodeFilter:{SHOW_TEXT:4,SHOW_ELEMENT:1},Node:{TEXT_NODE:3,ELEMENT_NODE:1}
  });
  document=context.document={listeners:{},documentElement:{dataset:{theme:'bluepink'}},getElementById:element,
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);},querySelector:s=>s==='.player-bottom'?element('playerBottom'):null,querySelectorAll:()=>[],
    createTreeWalker:()=>({nextNode:()=>null}),createElement(tag){const el=new Element();if(tag==='canvas'){const ops=[],ctx={scale(){},beginPath(){},roundRect(){},fill(){},stroke(){ops.push(this.strokeStyle);}};el.getContext=()=>ctx;el.ops=ops;canvases.push(el);}return el;}
  };
  context.window=context;
  for(const [id,value] of Object.entries({base:'3',volume:'80',sourceVolumeA:'100',sourceVolumeB:'45'}))element(id).value=value;
  for(const key of ['a','b']){const option=new Element();option.value=key;element('sendTarget').append(option);}
  element('sendTarget').value='a';
  for(const value of ['default','voice','custom']){const option=new Element();option.value=value;element('configurationSelect').append(option);}
  element('playerBottom').parentElement=element('player');element('superChatOverlay').hidden=true;
  const run=source=>vm.runInContext(source,context);
  const load=name=>vm.runInContext(fs.readFileSync(path.join(__dirname,'../browser-extension/ui',name),'utf8'),context,{filename:name});
  for(const file of ['app.js','browser.js','chat-rules.js','danmaku-style.js'])load(file);
  if(mobile)run(fs.readFileSync(path.join(__dirname,'../android/web/configurations.js'),'utf8'));else load('configurations.js');
  run('account={loggedIn:true,uid:123,name:"测试用户"}');
  return{context,element,run,load,storage,recorded,remembered,canvases,emit:m=>chatListeners.forEach(fn=>fn(m))};
}

test('own comments match the logged-in UID across both Bili sources, never text or another platform',()=>{
  const f=fixture(),own=f.context.chatSender.isOwn;
  for(const source of ['a','b'])assert.equal(own({uid:'123',source,text:'相同内容'}),true);
  assert.equal(own({platform:'bilibili',uid:123}),true);
  for(const m of [{uid:'456',text:'相同内容'},{user:'测试用户'},...['huya','douyu','douyin'].map(platform=>({platform,uid:'123'}))])assert.equal(own(m),false);
  for(const account of [{loggedIn:false,uid:123},{loggedIn:true,uid:0},{loggedIn:true},{loggedIn:true,uid:NaN}]){
    f.context.nextAccount=account;f.run('account=nextAccount');assert.equal(own({uid:'123'}),false);
  }
});

test('receive-time ownership survives playback delay, replay and account changes, including image emotes',()=>{
  const f=fixture();f.run("running=true;mix.chatB=true;channels={a:{edge:()=>10},b:{edge:()=>20}};");
  f.emit({type:'message',source:'a',uid:'123',text:'自己的文字',color:'#66ccff'});
  f.emit({type:'message',source:'b',uid:'123',text:'自己的表情',color:'#ff99cc',emoticon:{unique:'image-1',url:'https://i0.hdslb.com/example.png'}});
  f.emit({type:'message',source:'b',uid:'456',text:'自己的文字'});
  assert.deepEqual(f.remembered.map(x=>x.m.isSelf),[true,true,false]);
  assert.deepEqual(f.remembered.map(x=>x.m.color),['#66ccff','#ff99cc',undefined]);
  f.run('account={loggedIn:true,uid:456};globalThis.pending=[...queue.take(100),...queueB.take(100)];');
  // Use the real rendering entry point, with a layout sink in place of animation.
  f.context.danmakuLayout={layout(){},speed(){},add:bullet=>{f.element('danmaku').append(bullet);return true;}};
  for(const m of f.context.pending)f.context.showMessage(m);
  assert.deepEqual(f.element('danmaku').children.map(e=>e.className),['bullet is-self','bullet is-self','bullet']);
  assert.deepEqual(f.element('danmaku').children.map(e=>e.style['--danmaku-native-color']),['#66ccff','#ff99cc',undefined]);
  const before=f.element('danmaku').children.length;f.context.showMessage(f.remembered[0].m,true);
  assert.equal(f.element('danmaku').children.length,before);
  assert.equal(f.recorded[0].isSelf,true);
});

test('spam merging keeps own messages separate from identical comments by other users',()=>{
  const f=fixture({'freecast-chat-rules':JSON.stringify({merge:true})});
  f.context.danmakuLayout={layout(){},speed(){},add:bullet=>{f.element('danmaku').append(bullet);return true;}};
  const other={type:'message',source:'a',uid:'456',text:'+1'},self={...other,uid:'123'};
  f.context.showMessage(other);f.context.showMessage(self);f.context.showMessage(other);f.context.showMessage(self);
  assert.equal(f.element('chatList').children.length,2);
  assert.deepEqual(f.element('danmaku').children.map(e=>e.className),['bullet','bullet is-self']);
  for(const row of f.element('chatList').children)assert.equal(row.querySelector('.repeat-count').textContent,'×2');
});

test('retired saved colors are discarded while other appearance settings survive reload and presets',()=>{
  for(const color of [undefined,'#ff99cc','red','url(https://example.test)','#66D9EF']){
    const f=fixture({'dual-live-settings-v1':JSON.stringify({mix:{selfDanmakuColor:color,danmakuSize:24}})});
    assert.equal(f.context.configurations.capture().mix.selfDanmakuColor,undefined);
    assert.equal(f.context.configurations.capture().mix.danmakuSize,24);
    f.context.configurations.apply({mix:{selfDanmakuColor:color,danmakuSize:28}});
    assert.equal(JSON.parse(f.storage.get('dual-live-settings-v1')).mix.selfDanmakuColor,undefined);
    assert.equal(JSON.parse(f.storage.get('freecast-configurations-v1')).custom.mix.selfDanmakuColor,undefined);
    const reloaded=fixture(Object.fromEntries(f.storage));
    assert.equal(reloaded.context.configurations.capture().mix.selfDanmakuColor,undefined);
    assert.equal(reloaded.context.configurations.capture().mix.danmakuSize,28);
    reloaded.element('resetDanmakuStyle').dispatch('click');
    assert.equal(reloaded.context.configurations.capture().mix.danmakuSize,20);
  }
});

test('recorded overlay keeps own sky-blue borders and refreshes merged message textures',()=>{
  const f=fixture();f.context.danmakuLayout={layout(){},speed(){},add:bullet=>{f.element('danmaku').append(bullet);return true;}};
  f.context.showMessage({uid:'123',text:'自己的弹幕'});f.context.showMessage({uid:'456',text:'其他弹幕'});
  let color='#66ccff';
  f.context.getComputedStyle=el=>({color,backgroundColor:'transparent',borderRadius:'2px',borderTopWidth:el.classList.contains('is-self')?'1px':'0px',borderTopColor:'#66d9ef'});
  f.load('record-renderer.js');
  const drawContext={fillRect(){},save(){},restore(){},scale(){},translate(){},beginPath(){},rect(){},clip(){},drawImage(){}};
  const canvas={width:800,height:450,getContext:()=>drawContext};
  f.context.recordRenderer.draw(canvas,false);assert.equal(f.canvases.length,2);assert.deepEqual(f.canvases.map(c=>c.ops),[['#66d9ef'],[]]);
  f.context.recordRenderer.draw(canvas,false);assert.equal(f.canvases.length,2);
  f.element('danmaku').children[0].textContent+=' ×2';
  f.context.recordRenderer.draw(canvas,false);assert.deepEqual(f.canvases.slice(2).map(c=>c.ops),[['#66d9ef']]);
  const before=f.canvases.length;color='#ff99cc';f.context.recordRenderer.draw(canvas,false);
  assert.equal(f.canvases.length,before+2,'source color edits refresh both recorded textures immediately');
});

for(const mobile of fs.existsSync(path.join(__dirname,'../android/web/configurations.js'))?[false,true]:[false])test(`${mobile?'Android':'PC'} source colors survive reload, preset switching and invalid imported colors`,()=>{
  const f=fixture({},mobile),overlay=f.element('danmaku');
  assert.equal(overlay.dataset.sourceColors,'false');assert.equal(overlay.dataset.platformColors,'false');
  f.run('mix.chatB=true;danmakuStyle.sourceColors()');
  assert.equal(overlay.dataset.sourceColors,'true');
  assert.equal(overlay.style['--danmaku-color-a'],'#66ccff');
  assert.equal(overlay.style['--danmaku-color-b'],'#ff99cc');
  f.run('mix.videoA=false;danmakuStyle.sourceColors()');assert.equal(overlay.dataset.sourceColors,'false');
  f.run('mix.videoA=true;mix.videoB=false;danmakuStyle.sourceColors()');assert.equal(overlay.dataset.sourceColors,'false');
  f.run('mix.videoB=true;danmakuStyle.sourceColors()');assert.equal(overlay.dataset.sourceColors,'true');
  f.run('mix.chatA=false;danmakuStyle.sourceColors()');assert.equal(overlay.dataset.sourceColors,'false');
  f.run('mix.chatA=true;danmakuStyle.sourceColors()');
  f.element('danmakuPlatformColors').checked=true;f.element('danmakuPlatformColors').dispatch('change');
  assert.equal(overlay.dataset.platformColors,'true');
  for(const [id,value] of [['danmakuColorA','#1188EE'],['danmakuColorB','#EE2288']]){f.element(id).value=value;f.element(id).dispatch('input');}
  f.element('danmakuSourceColors').checked=false;f.element('danmakuSourceColors').dispatch('change');
  assert.equal(overlay.dataset.sourceColors,'false');assert.equal(f.element('danmakuColorA').disabled,true);
  const saved=f.context.configurations.capture(),reloaded=fixture(Object.fromEntries(f.storage),mobile);
  assert.equal(reloaded.context.configurations.capture().mix.danmakuColorA,'#1188ee');
  assert.equal(reloaded.context.configurations.capture().mix.danmakuColorB,'#ee2288');
  assert.equal(reloaded.context.configurations.capture().mix.danmakuSourceColors,false);
  assert.equal(reloaded.context.configurations.capture().mix.danmakuPlatformColors,true);
  reloaded.element('resetDanmakuStyle').dispatch('click');
  assert.equal(reloaded.element('danmaku').dataset.sourceColors,'true');
  assert.equal(reloaded.element('danmaku').dataset.platformColors,'false');
  assert.equal(reloaded.element('danmakuColorA').value,'#66ccff');assert.equal(reloaded.element('danmakuColorB').value,'#ff99cc');
  reloaded.context.configurations.apply(saved);assert.equal(reloaded.element('danmakuColorB').value,'#ee2288');
  for(const bad of ['red','url(https://example.test)','#abc','#123456;display:none',null,17]){
    reloaded.context.configurations.apply({mix:{danmakuColorA:bad,danmakuColorB:bad}});
    assert.equal(reloaded.element('danmakuColorA').value,'#66ccff');assert.equal(reloaded.element('danmakuColorB').value,'#ff99cc');
  }
});

test('v1.21 merging preserves source boundaries, stable emote IDs and borders when a merged bullet reappears',()=>{
  const f=fixture({'freecast-chat-rules':JSON.stringify({merge:true})});
  f.context.danmakuLayout={layout(){},speed(){},add:bullet=>{f.element('danmaku').append(bullet);return true;}};
  const own={source:'a',uid:'123',text:' 大笑 ',receivedAt:1000,emoticon:{unique:'laugh',url:'https://img/laugh?old'}};
  for(const m of [own,{...own,source:'b'},{...own,uid:'456'}])f.context.showMessage(m);
  f.element('danmaku').children[0].remove();
  f.context.showMessage({...own,text:'大笑',receivedAt:7000,emoticon:{unique:'laugh',url:'https://img/laugh?new'}});
  assert.equal(f.element('chatList').children.length,3);
  assert.equal(f.element('chatList').children[0].querySelector('.repeat-count').textContent,'×2');
  const returned=f.element('danmaku').children.at(-1);
  assert.equal(returned.className,'bullet is-self');assert.equal(returned.dataset.source,'a');
  assert.equal(returned.querySelector('.repeat-count').textContent,'×2');
  assert.equal(f.element('chatList').children[1].querySelector('.repeat-count'),null);
  assert.equal(f.element('chatList').children[2].querySelector('.repeat-count'),null);
});

test('adding ownership detection does not re-enable +1 sending in v1.21',async()=>{
  const f=fixture();let sent=0;f.context.live.sendChat=async()=>{sent++;return{sent:true};};
  f.run("running=true;channels={a:{room:{id:1,name:'test'}}};");
  f.element('chatText').value='保留草稿';
  assert.equal(await f.context.chatSender.repeat({source:'a',uid:'123',text:'+1'},f.run('channels.a.room')),'+1 暂停使用');
  assert.equal(sent,0);assert.equal(f.element('chatText').value,'保留草稿');
});
