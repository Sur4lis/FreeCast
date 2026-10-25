const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), vm=require('node:vm');
const source=fs.readFileSync('browser-extension/ui/controls.js','utf8').split('let followingRequest = ')[1].split("window.addEventListener('beforeunload', save);")[0];
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  class Element{
    constructor(){this.children=[];this.listeners={};this.disabled=false;this.textContent='';this.open=false;}
    append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
    replaceChildren(...children){this.children=[];this.append(...children);}
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
    setAttribute(){}
    showModal(){this.open=true;}
    close(){this.open=false;for(const fn of this.listeners.close||[])fn();}
  }
  const elements=new Map(),events={},messages=[],reads=[],profiles=[];
  const $=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const scope={URL,encodeURIComponent,$,favorites:[],saved:0,renderFavorites(){},save(){scope.saved++;},notice(){},document:{createElement:()=>new Element()},
    live:{ensureSources:async()=>{},liveFollowing:()=>{const call=deferred();reads.push(call);return call.promise;},getProfile:()=>{const call=deferred();profiles.push(call);return call.promise;}},
    chrome:{runtime:{onMessage:{addListener:fn=>messages.push(fn)}}},addEventListener:(type,fn)=>events[type]=fn};
  scope.window=scope;vm.createContext(scope);vm.runInContext('let followingRequest = '+source,scope);
  return{scope,$,reads,profiles,messages,events,Element,async open(items=[]){const pending=scope.openFollowing();await turn();reads.at(-1).resolve({items});await pending;}};
}
const item={id:7734200,inputId:7734200,roomId:7734200,anchorId:50329118,platform:'bilibili',name:'赛事',avatar:'',title:''};
test('canonical room and anchor identities match only Bilibili favorites',()=>{
  const f=fixture();
  for(const favorite of [{id:6,inputId:6,roomId:7734200},{id:'https://live.bilibili.com/7734200'},{id:6,anchorId:50329118}]){
    f.scope.favorites=[favorite];assert.ok(f.scope.followingOwned(item));
  }
  for(const favorite of [{id:'https://www.douyu.com/7734200',roomId:7734200},{id:7734200,platform:'huya'}]){
    f.scope.favorites=[favorite];assert.equal(f.scope.followingOwned(item),undefined);
  }
});
test('an old short-ID favorite is enriched, not added a second time',async()=>{
  const f=fixture();f.scope.favorites=[{id:6,inputId:6,name:'已收藏赛事'}];await f.open([item]);
  const pending=f.scope.importFollowingItem({...item},new f.Element());
  f.profiles[0].resolve({id:7734200,shortId:6,anchorId:50329118});await pending;
  assert.equal(f.scope.favorites.length,1);assert.equal(f.scope.favorites[0].roomId,7734200);
  assert.equal(f.scope.favorites[0].inputId,6);assert.equal(f.$('followingList').children[0].children[2].disabled,true);
});
test('an account switch clears the list and discards a pending response',async()=>{
  const f=fixture(),pending=f.scope.openFollowing();await turn();
  f.messages[0]({type:'accountChanged'});f.reads[0].resolve({items:[item]});await pending;
  assert.equal(f.$('followingList').children.length,0);assert.match(f.$('followingStatus').textContent,/账号已变更/);
  assert.equal(f.$('followingRefresh').disabled,false);
});
test('closing and reopening discards old completion without enabling a new pending request',async()=>{
  const f=fixture(),old=f.scope.openFollowing();await turn();
  f.$('followingCancel').listeners.click[0]();const fresh=f.scope.openFollowing();await turn();
  f.reads[0].resolve({items:[item]});await old;
  assert.equal(f.$('followingRefresh').disabled,true);assert.equal(f.$('followingList').children.length,0);
  f.reads[1].resolve({items:[]});await fresh;
  assert.equal(f.$('followingRefresh').disabled,false);assert.match(f.$('followingStatus').textContent,/没有找到/);
});
test('closing while resolving a short room alias never imports a stale selection',async()=>{
  const f=fixture();f.scope.favorites=[{id:6,name:'旧收藏'}];await f.open([item]);
  const pending=f.scope.importFollowingItem({...item},new f.Element());f.$('followingCancel').listeners.click[0]();
  f.profiles[0].resolve({id:item.id,shortId:8});await pending;
  assert.equal(f.scope.favorites.length,1);assert.equal(f.scope.saved,0);
});
test('two pending imports cannot exceed the 100-favorite limit',async()=>{
  const f=fixture();f.scope.favorites=Array.from({length:99},(_,i)=>({id:i+1,name:'已有收藏'}));await f.open([item]);
  const first=f.scope.importFollowingItem({...item},new f.Element()),second=f.scope.importFollowingItem({...item,id:888888,roomId:888888,inputId:888888,anchorId:888},new f.Element());
  f.profiles[0].resolve({id:item.id,shortId:1000});await first;
  f.profiles[1].resolve({id:888888,shortId:1001});await second;
  assert.equal(f.scope.favorites.length,100);assert.match(f.$('followingStatus').textContent,/最多收藏 100/);
});
