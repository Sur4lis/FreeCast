const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('browser-extension/ui/browser.js','utf8').split('let sending=false;')[0];
function fixture(){
  const calls=[],timers=new Map(),events={},elements=new Map();let id=0;
  const scope={window:{live:{authStatus:()=>new Promise((resolve,reject)=>calls.push({resolve,reject})),ensureSources:async()=>{}},mobileNative:{},addEventListener:(name,fn)=>events[name]=fn},chrome:{runtime:{onMessage:{addListener(){}}}},document:{addEventListener(){}},$:name=>{if(!elements.has(name))elements.set(name,{addEventListener(){}});return elements.get(name);},renderSendTargets(){},setTimeout(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),notice(){}};
  vm.createContext(scope);vm.runInContext(source+'\nglobalThis.state=()=>({account,checkingAccount,accountRevision});',scope);
  const turn=()=>new Promise(r=>setImmediate(r));
  return{scope,calls,elements,events,timers,turn,async next(){const entry=timers.entries().next().value;if(!entry)return false;timers.delete(entry[0]);entry[1].fn();await turn();return true;}};
}
for(const failure of [false,true])test('login return invalidates an older '+(failure?'failed':'logged-out')+' request',async()=>{
  const f=fixture();void f.scope.refreshAccount();f.events['freecast-account-changed']();
  if(failure)f.calls[0].reject(Error('old request'));else f.calls[0].resolve({loggedIn:false});
  await f.turn();assert.match(f.elements.get('loginButton').textContent,/正在更新/);
  await f.next();assert.equal(f.calls.length,2);
  f.calls[1].resolve({loggedIn:true,uid:42,name:'本地账户'});await f.turn();
  assert.equal(f.scope.state().account.uid,42);assert.match(f.elements.get('loginButton').textContent,/已登录/);assert.equal(f.timers.size,0);
});
test('temporary login verification failure retries a bounded number of times',async()=>{
  const f=fixture();f.events['freecast-account-changed']();await f.next();
  for(let n=0;n<4;n++){f.calls[n].reject(Error('HTTP 412'));await f.turn();await f.next();}
  assert.equal(f.calls.length,4);assert.equal(f.timers.size,0);assert.equal(f.scope.state().account.loggedIn,false);
  assert.match(f.elements.get('loginButton').textContent,/验证失败/);assert.match(f.elements.get('loginButton').title,/412/);
});
test('refresh requested during a pending check is not silently discarded',async()=>{
  const f=fixture();void f.scope.refreshAccount();void f.scope.refreshAccount();
  f.calls[0].resolve({loggedIn:false});await f.turn();await f.next();assert.equal(f.calls.length,2);
  f.calls[1].resolve({loggedIn:true,uid:7,name:'新登录'});await f.turn();assert.equal(f.scope.state().account.uid,7);
});
