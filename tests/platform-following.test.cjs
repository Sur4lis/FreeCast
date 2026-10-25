const {test}=require('node:test'),assert=require('node:assert/strict');
const row=(id,live=1)=>({room_id:id,nickname:'斗鱼 '+id,show_status:live,avatar_small:'https://apic.douyucdn.cn/avatar/'+id+'.jpg',room_name:'标题',owner_uid:100+id});
const huya=(id,live=true)=>({roomId:id,uid:100+id,nick:'虎牙 '+id,isLive:live,avatar180:'https://huyaimg.msstatic.com/avatar/'+id+'.jpg'});
const response=payload=>({ok:true,status:200,json:async()=>payload});
async function api(options={}) {return (await import('../browser-extension/live-following.mjs')).createFollowingApi(options);}
test('platform feeds normalize only live follows, safe images and public favorite fields',async()=>{
  const {parseFollowingItems}=await import('../browser-extension/live-following.mjs');
  const items=parseFollowingItems('douyu',[row(1),row(1),row(2,0),{...row(3),avatar_small:'https://evil.example/a',token:'private'},row(-1),{...row(4),nickname:''}]);
  assert.deepEqual(items.map(x=>x.roomId),['1','3']);assert.equal(items[0].id,'https://www.douyu.com/1');
  assert.equal(items[1].avatar,'');assert.equal('token' in items[1],false);assert.equal(items[0].external,true);
  const list=parseFollowingItems('huya',[{...huya(5),privateHost:'alias'},huya(6,false),{...huya(7),avatar180:'https://msstatic.com.evil.example/a'}, {...huya(8),avatar180:'//huyaimg.msstatic.com/a.png'}]);
  assert.deepEqual(list.map(x=>x.roomId),['5','7','8']);assert.deepEqual(list[0].aliases,['https://www.huya.com/alias']);
  assert.equal(list[1].avatar,'');assert.equal(list[2].avatar,'https://huyaimg.msstatic.com/a.png');
  assert.deepEqual(parseFollowingItems('huya',[{...huya(0),privateHost:'../../bad'}]),[]);
});
test('Douyu reads subsequent pages even if the first page only contains offline follows',async()=>{
  const urls=[];const read=await api({request:async(url,options)=>{urls.push(url);assert.equal(options.credentials,'include');assert.equal(options.redirect,'error');return response({error:0,data:JSON.stringify({nowPage:urls.length,pageCount:2,list:urls.length===1?[row(1,0)]:[row(2)]})});}});
  const result=await read('douyu');assert.equal(urls.length,2);assert.equal(new URL(urls[1]).searchParams.get('page'),'2');
  assert.deepEqual(result.items.map(x=>x.roomId),['2']);assert.equal(result.truncated,false);
});
test('Huya uses the logged-in UID and paginates its official 30-item list',async()=>{
  const calls=[];const read=await api({huyaUid:async()=>'9007199254740993',request:async url=>{calls.push(new URL(url));return response({statusCode:200,data:{list:calls.length===1?Array.from({length:30},(_,i)=>huya(i+1,false)):[huya(31)]}});}});
  const result=await read('huya');assert.equal(calls.length,2);assert.equal(calls[0].hostname,'open.huya.com');
  assert.equal(calls[0].searchParams.get('do'),'getSubscribeList');assert.equal(calls[0].searchParams.get('appId'),'huya_h5_10');
  assert.deepEqual(JSON.parse(calls[1].searchParams.get('data')),{page:2,pageSize:30,uid:'9007199254740993'});
  assert.deepEqual(result.items.map(x=>x.roomId),['31']);assert.equal(JSON.stringify(result).includes('9007199254740993'),false);
});
test('repeated pages and the read limit return explicit partial results',async()=>{
  let n=0;let read=await api({request:async()=>{n++;return response({error:0,data:{list:[row(1)],pageCount:100}});}});
  let result=await read('douyu');assert.equal(n,2);assert.equal(result.items.length,1);assert.equal(result.truncated,true);
  n=0;read=await api({request:async()=>response({error:0,data:{list:[row(++n)],pageCount:100}})});
  result=await read('douyu');assert.equal(n,10);assert.equal(result.truncated,true);
});
test('empty follows are distinguished from malformed payloads and recommendations',async()=>{
  for(const data of [null,{recommendList:[row(1)]},{list:'wrong'}]){
    const read=await api({request:async()=>response({error:0,data})});await assert.rejects(read('douyu'),/格式发生变化/);
  }
  const read=await api({request:async()=>response({error:0,data:{list:[]}})});assert.equal((await read('douyu')).total,0);
});
test('login expiry, risk control and HTTP errors never become empty success lists',async()=>{
  const read=await api({request:async()=>response({code:-1,error:-1,msg:'用户未登陆或token已过期'})});await assert.rejects(read('douyu'),/请先在斗鱼官网登录/);
  const noLogin=await api({request:async()=>{throw Error('must not fetch');}});await assert.rejects(noLogin('huya'),/请先在虎牙官网登录/);
  const expired=await api({huyaUid:async()=>'9',request:async()=>response({statusCode:401,statusMsg:'未登录2！',data:[]})});await assert.rejects(expired('huya'),/请先在虎牙官网登录/);
  for(const status of [403,412,429]){const fetch=await api({request:async()=>({ok:false,status})});await assert.rejects(fetch('douyu'),e=>e.message.includes('完成验证')&&e.message.includes(status));}
  const invalid=await api({request:async()=>({ok:true,status:200,json:async()=>{throw Error('html');}})});await assert.rejects(invalid('douyu'),/返回异常/);
});
test('backend routes only supported platforms and keeps the Bilibili default',async()=>{
  const {createBackend}=await import('../browser-extension/backend.mjs');const calls=[];
  const backend=createBackend({cookie:async()=>'',request:async url=>{calls.push(url);return url.includes('douyu.com')?response({error:0,data:{list:[row(1)]}}):response({code:0,data:{items:[]}});}});
  assert.equal((await backend.liveFollowing('douyu')).items[0].platform,'douyu');await backend.liveFollowing();assert.match(calls[1],/api\.bilibili\.com/);
  for(const platform of ['douyin','constructor','__proto__'])await assert.rejects(backend.liveFollowing(platform),/暂不支持/);
  assert.equal(calls.length,2);
});
