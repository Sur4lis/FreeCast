const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const scope={window:{},TextEncoder,TextDecoder,Uint8Array,DataView,Blob,DecompressionStream,URL};
for(const name of ['chat','platform-chat-protocol'])vm.runInNewContext(fs.readFileSync('browser-extension/ui/'+name+'.js','utf8'),scope);
const {ChatProtocol:B,PlatformChatProtocol:P}=scope.window;

test('replay history retains platform and source colors without applying the current display preference',()=>{
  const {History}=require('../browser-extension/ui/replay-core.js'),h=new History();
  h.add({source:'a',platform:'huya',text:'彩色回放',color:'#ff99cc'},10,60);
  h.add({source:'b',platform:'douyin',text:'彩色回放',color:'#66ccff'},11,60);
  const replayed=h.at(12,0,60);assert.deepEqual(replayed.map(m=>[m.source,m.platform,m.color]),[['a','huya','#ff99cc'],['b','douyin','#66ccff']]);
  assert.deepEqual(h.since(10,12).map(m=>m.color),['#66ccff']);
});

test('Bilibili extracts message RGB without confusing font size, timestamps or emotes',()=>{
  for(const value of [0,0x66ccff,0xffffff,-1,0x1000000,NaN,null,undefined,'#123456']){
    const info=[[0,1,25,value,1700000000],'颜色',[77,'观众']];
    const m=B.normalize({cmd:'DANMU_MSG',info});
    assert.equal(m.color,typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=0xffffff?'#'+value.toString(16).padStart(6,'0'):undefined);
    assert.equal(m.text,'颜色');assert.equal(m.uid,'77');
  }
});

test('Douyu maps palette indices and rejects missing or unrecognized colors',()=>{
  const expected=['#ff0000','#1e87f0','#7ac84b','#ff7f00','#9b39f4','#ff69b4'];
  for(const col of [1,2,3,4,5,6,0,7,-1,'__proto__',undefined,'red']){
    const fields={type:'chatmsg',nn:'观众',uid:'77',txt:'颜色',...(col!==undefined?{col}:{})};
    const item=new P.DouyuDecoder().read(P.douyuPacket(fields))[0],m=P.douyuMessage(item);
    assert.equal(m.color,expected[Number(col)-1]);assert.equal(m.platform,'douyu');assert.equal(m.text,'颜色');
  }
});

test('Huya uses bullet font color first, content color as fallback, and ignores default -1',()=>{
  for(const [bullet,content,expected] of [[0x66ccff,0xff99cc,'#66ccff'],[-1,0xff99cc,'#ff99cc'],[undefined,0xff99cc,'#ff99cc'],[0,0xffffff,'#000000'],[-1,-1,undefined],[0x1000000,-1,undefined]]){
    const w=new P.TarsWriter().head(0,10).int(0,77).string(2,'观众').head(0,11).string(3,'颜色');
    if(content!==undefined)w.head(5,10).int(0,content).head(0,11);
    if(bullet!==undefined)w.head(6,10).int(0,bullet).head(0,11);
    const packet=new P.TarsWriter().int(0,7).data(1,new P.TarsWriter().int(1,1400).data(2,w.finish()).finish()).finish();
    const m=P.huyaDecode(packet).messages[0];assert.equal(m.color,expected);assert.equal(m.uid,'77');assert.equal(m.platform,'huya');
  }
});

test('Douyin reads full-screen text color from field 6 without accepting CSS or links',async()=>{
  for(const [value,expected]of [['#Ff99Cc','#ff99cc'],['#000000','#000000'],['',undefined],['red',undefined],['#fff;display:none',undefined],['url(https://example.test)',undefined]]){
    const chat=P.pbPacket([[2,P.pbPacket([[1,77],[3,'观众']])],[3,'颜色'],[6,value]]);
    const response=P.pbPacket([[1,P.pbPacket([[1,'WebcastChatMessage'],[2,chat],[3,123]])]]);
    const m=(await P.douyinDecode(P.pbPacket([[8,response]]))).messages[0];
    assert.equal(m.color,expected);assert.equal(m.platform,'douyin');assert.equal(m.id,'123');
  }
});
