const {test}=require('node:test'),assert=require('node:assert/strict');
const real='https://live.bilibili.com/80397',short='https://live.bilibili.com/510';
const options={expectedUid:123,emote:{type:'image',allowed:true,id:'dress_123',url:'https://i0.hdslb.com/emote.png',room:80397,pageRoom:510}};

function fixture(destination=short){
  const storage={},tabs=new Map(),rules=new Map(),executions=[];let next=1;
  const browser={
    storage:{session:{get:async key=>({[key]:storage[key]}),set:async values=>Object.assign(storage,values)}},
    tabs:{
      create:async values=>{const tab={id:next++,status:'complete',...values};tabs.set(tab.id,tab);return {...tab};},
      get:async id=>{assert.ok(tabs.has(id));return {...tabs.get(id)};},
      update:async(id,values)=>Object.assign(tabs.get(id),values.url?{url:destination,status:'complete'}:values),
      remove:async id=>tabs.delete(id)
    },
    declarativeNetRequest:{updateSessionRules:async({removeRuleIds=[],addRules=[]})=>{removeRuleIds.forEach(id=>rules.delete(id));addRules.forEach(rule=>rules.set(rule.id,rule));}},
    scripting:{executeScript:async args=>{executions.push(args);return[{result:{ok:true,submitted:true,emoticon:'dress_123'}}];}}
  };
  return {browser,storage,tabs,rules,executions};
}

test('verified Bili redirect sends once, reuses the short-ID tab and removes it on player close',async()=>{
  const {createPlatformSender}=await import('../browser-extension/platform-sender.mjs');
  const f=fixture(),sender=createPlatformSender(f.browser);
  assert.equal((await sender.send('80397','大笑',88,options)).submitted,true);
  assert.equal(f.executions.length,1);assert.deepEqual(f.executions[0].args[0].roomUrls,[real,short]);
  assert.equal(f.executions[0].args[0].emote.room,80397);
  delete f.storage['freecast-send-tabs-v1'][0].roomUrls;
  f.storage['freecast-last-platform-send']=0;
  assert.equal((await sender.send('80397','大笑',88,options)).submitted,true);
  assert.equal(f.tabs.size,1);assert.equal(f.executions.length,2);assert.equal([...f.tabs.values()][0].muted,true);
  await sender.cleanup(88);assert.equal(f.tabs.size,0);assert.equal(f.rules.size,0);
});

test('wrong room, prefix collision and another origin never run a send or get closed as our room',async()=>{
  const {createPlatformSender}=await import('../browser-extension/platform-sender.mjs');
  for(const destination of ['https://live.bilibili.com/803970','https://live.bilibili.com/511','https://passport.bilibili.com/login','https://live.bilibili.com.evil.test/510']){
    const f=fixture(destination),sender=createPlatformSender(f.browser);
    const result=await sender.send('80397','大笑',88,options);
    assert.equal(result.sent,false);assert.equal(result.needsPage,true);assert.equal(f.executions.length,0);
    await sender.cleanup(88);assert.equal(f.tabs.size,1);assert.equal(f.rules.size,0);
  }
});

test('room wait ignores complete blank pages and pending navigations before a committed room',async()=>{
  const {waitForRoomTab}=await import('../browser-extension/platform-sender.mjs');
  const steps=[
    {status:'complete'},
    {status:'complete',url:'about:blank',pendingUrl:real},
    {status:'loading',url:real,pendingUrl:short},
    {status:'complete',url:short,pendingUrl:short},
    {status:'complete',url:short+'/?from=test'}
  ];
  let reads=0;const browser={tabs:{get:async()=>steps[Math.min(reads++,steps.length-1)]}};
  assert.equal((await waitForRoomTab(browser,1,[real,short],{timeout:1000,interval:1})).url,short+'/?from=test');
  assert.equal(reads,5);
  browser.tabs.get=async()=>({status:'complete',url:'about:blank',pendingUrl:real});
  assert.equal(await waitForRoomTab(browser,1,[real,short],{timeout:5,interval:1}),null);
});
