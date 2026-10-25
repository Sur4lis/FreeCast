const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),zlib=require('node:zlib');
const scope={window:{},TextEncoder,TextDecoder,Uint8Array,DataView,Blob,DecompressionStream,URL};vm.runInNewContext(fs.readFileSync('browser-extension/ui/chat.js','utf8'),scope);const{packet,decode,normalize,imageUrl}=scope.window.ChatProtocol;
test('browser danmaku decoder handles concatenated and deflate frames',async()=>{const first=packet(8,{code:0}),msg=packet(5,{cmd:'DANMU_MSG',info:[[],'测试弹幕',[1,'用户名']]}),compressed=zlib.deflateSync(msg);const frame=Buffer.alloc(16+compressed.length);frame.writeUInt32BE(frame.length,0);frame.writeUInt16BE(16,4);frame.writeUInt16BE(2,6);frame.writeUInt32BE(5,8);compressed.copy(frame,16);const result=await decode(Buffer.concat([first,frame]));assert.equal(result.length,2);assert.equal(result[0].body.code,0);assert.equal(result[1].body.info[1],'测试弹幕');});
test('browser danmaku decoder rejects corrupt headers',async()=>{await assert.rejects(decode(new Uint8Array(3)));const data=packet(5,{});new DataView(data.buffer).setUint32(0,999999);await assert.rejects(decode(data));});

test('emoticons support room stickers, inline mappings and safe HTTPS images',()=>{
 const info=[[],'好活[妙]🙂',[1,'观众']];info[0][13]=JSON.stringify({url:'http://i0.hdslb.com/bfs/live/room.png',width:180,height:60});info[0][15]={extra:JSON.stringify({emots:{'[妙]':{url:'//i0.hdslb.com/bfs/live/miao.png',width:20,height:20},'[坏]':{url:'https://example.com/track.png'}}})};
 const message=normalize({cmd:'DANMU_MSG:4:0:2',info},123);assert.equal(message.emoticon.url,'https://i0.hdslb.com/bfs/live/room.png');assert.equal(message.emoticon.ratio,3);assert.equal(message.emotes.length,1);assert.equal(message.emotes[0].token,'[妙]');assert.equal(message.text,'好活[妙]🙂');assert.equal(message.receivedAt,123);
 for(const url of ['javascript:alert(1)','data:image/svg+xml,hi','https://hdslb.com.evil.test/a','https://user:pass@i0.hdslb.com/a','https://evil.test/a'])assert.equal(imageUrl(url),'');
});
test('malformed emote metadata preserves plain text',()=>{
 const info=[[],'<img src=x onerror=alert(1)>',[1,'user']];info[0][13]='{broken';info[0][15]={extra:'['};const message=normalize({cmd:'DANMU_MSG',info});assert.equal(message.emoticon,null);assert.equal(message.emotes.length,0);assert.equal(message.text,info[1]);assert.equal(normalize({cmd:'DANMU_MSG'}),null);
});
test('SC normalization, deletion and duplicate translation handling',()=>{
 const data={id:8,message:'SC 内容',price:30,start_time:100,end_time:160,user_info:{uname:'观众',face:'https://i1.hdslb.com/bfs/face/a.jpg'}};
 const m=normalize({cmd:'SUPER_CHAT_MESSAGE',data},7);assert.equal(m.type,'superchat');assert.equal(m.id,'8');assert.equal(m.duration,60);assert.equal(m.price,30);assert.equal(m.user,'观众');
 assert.equal(normalize({cmd:'SUPER_CHAT_MESSAGE_JPN',data}),null);assert.equal(normalize({cmd:'SUPER_CHAT_MESSAGE',data:{}}),null);
 const deleted=normalize({cmd:'SUPER_CHAT_MESSAGE_DELETE',data:{ids:[8,'9','<bad>']}});assert.equal(deleted.ids.join(','),'8,9');
});
