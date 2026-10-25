const {test}=require('node:test'),assert=require('node:assert/strict');
async function api(request){
  const {createBackend}=await import('../browser-extension/backend.mjs');
  return createBackend({request,cookie:async()=>''});
}
function page(data){return{ok:true,json:async()=>({code:0,data})};}
test('live-up parsing keeps valid rooms, removes duplicates and unsafe avatars',async()=>{
  const {parseLiveUpItems}=await import('../browser-extension/backend.mjs');
  const items=parseLiveUpItems({items:[
    {room_id:101,uid:9,uname:'主播',face:'https://i0.hdslb.com/bfs/face/a.jpg',title:'标题',live_status:1},
    {room_id:101,uid:9,uname:'重复',live_status:1},
    {room_id:102,uid:10,uname:'未开播',live_status:0},
    {room_id:0,uid:11,uname:'无效房间'},
    {room_id:103,uname:'坏头像',face:'https://evil.example/a.png',live_status:1},
    {room_id:104,uname:'',live_status:1}
  ]});
  assert.deepEqual(items.map(item=>item.id),[101,103]);
  assert.deepEqual(items[0],{id:101,inputId:101,name:'主播',avatar:'https://i0.hdslb.com/bfs/face/a.jpg',title:'标题',roomId:101,anchorId:9,platform:'bilibili'});
  assert.equal(items[1].avatar,'');
  assert.equal(items[1].anchorId,undefined);
});
test('live-up parsing reads nested list shapes without trusting arbitrary payloads',async()=>{
  const {parseLiveUpItems}=await import('../browser-extension/backend.mjs');
  const items=parseLiveUpItems({result:{cards:[{roomId:7,name:'嵌套主播',live_status:1}]}});
  assert.deepEqual(items.map(item=>item.id),[7]);
  assert.equal(items[0].name,'嵌套主播');
});
test('live-up parsing reads room ids from the real link-only payload',async()=>{
  const {parseLiveUpItems}=await import('../browser-extension/backend.mjs');
  const items=parseLiveUpItems({count:2,items:[
    {link:'https://live.bilibili.com/7734200',is_reserve_recall:false,mid:'50329118',uname:'哔哩哔哩英雄联盟赛事',face:'https://i2.hdslb.com/bfs/face/544c89e68f2b1f12ffcbb8b3c062a3328e8692d9.jpg'},
    {link:'https://live.bilibili.com/22677760/',mid:'482959881',uname:'清华大学学生算法协会',face:'https://i0.hdslb.com/bfs/face/95f37a3466e9994b2a4e1050fca9173b9d0319ad.jpg'},
    {link:'https://evil.example/123',mid:'1',uname:'坏链接'},
    {link:'https://live.bilibili.com/h5/123',mid:'2',uname:'非房间路径'},
    {link:'https://live.bilibili.com/7734200',mid:'50329118',uname:'重复'}
  ]});
  assert.deepEqual(items.map(item=>item.id),[7734200,22677760]);
  assert.deepEqual(items[0],{id:7734200,inputId:7734200,name:'哔哩哔哩英雄联盟赛事',avatar:'https://i2.hdslb.com/bfs/face/544c89e68f2b1f12ffcbb8b3c062a3328e8692d9.jpg',title:'',roomId:7734200,anchorId:50329118,platform:'bilibili'});
  assert.equal(items[1].anchorId,482959881);
});
test('live-following follows the offset until the feed stops or repeats a page',async()=>{
  const calls=[],pages=[
    page({has_more:1,offset:2,items:[{room_id:1,uname:'A',live_status:1},{room_id:2,uname:'B',live_status:1}]}),
    page({has_more:1,offset:3,items:[{room_id:2,uname:'B',live_status:1},{room_id:3,uname:'C',live_status:1}]}),
    page({has_more:0,items:[{room_id:4,uname:'D',live_status:1}]})
  ];
  const backend=await api(async url=>{calls.push(url);return pages[Math.min(calls.length-1,pages.length-1)];});
  const result=await backend.liveFollowing();
  assert.deepEqual(result.items.map(item=>item.id),[1,2,3,4]);
  assert.equal(result.total,4);
  assert.equal(calls.length,3);
  assert.match(calls[0],/web_location=333\.1007/);
  assert.match(calls[0],/x-bili-locale-json=/);
  assert.match(calls[1],/&offset=2$/);
  assert.match(calls[2],/&offset=3$/);
});
test('live-following stops when a page repeats the same offset and adds nothing',async()=>{
  let calls=0;
  const backend=await api(async()=>{calls++;return page({has_more:1,offset:2,items:[{room_id:1,uname:'A',live_status:1}]});});
  const result=await backend.liveFollowing();
  assert.deepEqual(result.items.map(item=>item.id),[1]);
  assert.equal(calls,2);
});
test('anonymous access produces a login hint instead of the raw API code',async()=>{
  const backend=await api(async()=>({ok:true,json:async()=>({code:-101,message:'账号未登录'})}));
  await assert.rejects(backend.liveFollowing(),/请先在 B 站官网登录/);
});
test('verification failures produce an actionable message',async()=>{
  const backend=await api(async()=>({ok:true,json:async()=>({code:-352,message:'风控校验失败'})}));
  await assert.rejects(backend.liveFollowing(),/完成验证/);
});
test('HTTP risk-control failures preserve the code and give a retry hint',async()=>{
  for(const status of [412,429]){
    const backend=await api(async()=>({ok:false,status}));
    await assert.rejects(backend.liveFollowing(),error=>error.message.includes(String(status))&&error.message.includes('稍后重试'));
  }
});
test('string false and missing offsets never cause extra feed requests',async()=>{
  for(const data of [{has_more:'0',offset:2},{has_more:1,offset:null},{has_more:1,offset:-1}]){
    let calls=0;
    const backend=await api(async()=>{calls++;return page({...data,items:[{room_id:calls,uname:'主播'}]});});
    const result=await backend.liveFollowing();
    assert.equal(calls,1);assert.equal(result.truncated,false);
  }
});
test('the bounded page limit reports partial results instead of claiming completeness',async()=>{
  let calls=0;
  const backend=await api(async()=>{calls++;return page({has_more:1,offset:calls,items:[{room_id:calls,uname:'主播'}]});});
  const result=await backend.liveFollowing();
  assert.equal(calls,5);assert.equal(result.total,5);assert.equal(result.truncated,true);
});
test('Bilibili profiles preserve canonical and short IDs for favorite matching',async()=>{
  const backend=await api(async url=>page(url.includes('/Room/get_info')?{room_id:7734200,short_id:6,uid:50329118,title:'比赛直播'}:{info:{uname:'赛事',face:'https://i0.hdslb.com/face.jpg'}}));
  const profile=await backend.getProfile('https://live.bilibili.com/6');
  assert.equal(profile.id,7734200);assert.equal(profile.roomId,7734200);assert.equal(profile.shortId,6);
  assert.equal(profile.inputId,6);assert.equal(profile.anchorId,50329118);assert.equal(profile.platform,'bilibili');
});
