const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
  const data=new Map(),counters={fail:false,writes:0},dir={getDirectoryHandle:async()=>dir,getFileHandle:async name=>({createWritable:async()=>{
    const chunks=[];let aborted=false;return {async write(value){counters.writes++;if(counters.fail)throw Error('QuotaExceeded');chunks.push(Buffer.from(typeof value==='string'?value:value.slice()));},async close(){if(!aborted)data.set(name,Buffer.concat(chunks));},async abort(){aborted=true;chunks.length=0;}};
  }})};
  const context={Uint8Array,DataView,Number,JSON,Date};const source=fs.readFileSync('browser-extension/ui/record-files.js','utf8').replace(/^import[^\n]+\n/,'').replaceAll('export ','')+'\nglobalThis.RecordingFiles=RecordingFiles;';vm.runInNewContext(source,context);
  const recorder=new context.RecordingFiles(dir,{fragmentsPerSegment:1});return {recorder,data,counters};
}
function box(type,payload=Buffer.alloc(0)){const value=Buffer.alloc(8+payload.length);value.writeUInt32BE(value.length);value.write(type,4);payload.copy(value,8);return value;}
const headers=Buffer.concat([box('ftyp',Buffer.from('isom')),box('moov',Buffer.alloc(20))]);
test('fragment boundaries survive arbitrarily split writes and incomplete tails stay uncommitted',async()=>{
  const {recorder:r,data}=setup();await r.open({width:640,height:360,fps:30});const fragment=Buffer.concat([box('moof',Buffer.alloc(30)),box('mdat',Buffer.from('media'))]),bytes=Buffer.concat([headers,fragment]);
  for(let i=0;i<bytes.length;i+=3)await r.accept({position:i,data:bytes.subarray(i,i+3)});
  assert.deepEqual(data.get('video-000001.mp4'),bytes);assert.equal(r.segments,1);
  await r.accept({position:bytes.length,data:fragment.subarray(0,fragment.length-1)});await r.abort();assert.equal(r.segments,1);assert.equal(data.has('video-000002.mp4'),false);
});
test('disk failure cannot erase a previously committed segment',async()=>{
  const {recorder:r,data,counters}=setup();await r.open({width:640,height:360,fps:30});const fragment=Buffer.concat([box('moof'),box('mdat',Buffer.from('media'))]),bytes=Buffer.concat([headers,fragment]);await r.accept({position:0,data:bytes});counters.fail=true;
  await assert.rejects(r.accept({position:bytes.length,data:fragment}),/QuotaExceeded/);await r.abort();assert.deepEqual(data.get('video-000001.mp4'),bytes);assert.equal(data.has('video-000002.mp4'),false);
});
test('chat journals commit independently and keep a bounded pending queue',async()=>{
  const {recorder:r,data}=setup();await r.open({width:640,height:360,fps:30});r.addChat({text:'保留弹幕',t:10});await r.flushChat();assert.match(data.get('chat-000001.jsonl').toString(),/保留弹幕/);assert.equal(r.chatBytes,0);
  assert.throws(()=>r.addChat({text:'x'.repeat(2*1024*1024)}),/写入过慢/);
});
