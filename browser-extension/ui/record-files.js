import {Input, BlobSource, MP4, EncodedPacketSink, Output, Mp4OutputFormat, StreamTarget, EncodedVideoPacketSource, EncodedAudioPacketSource} from '../vendor/mediabunny-1.61.3.min.mjs';

export const journalName='.freecast-recording.json', partsName='.freecast-parts';
const format='FreeCast recording 3', videoName=/^video-\d{6}\.mp4$/, chatName=/^chat-\d{6}\.jsonl$/;
const number=n=>String(n).padStart(6,'0');
async function writeFile(dir,name,data){const handle=await dir.getFileHandle(name,{create:true}),stream=await handle.createWritable();try{await stream.write(data);await stream.close();}catch(e){await stream.abort().catch(()=>{});throw e;}}
export async function readJournal(dir){const file=await(await dir.getFileHandle(journalName)).getFile();if(file.size>65536)throw Error('录像记录无效');const value=JSON.parse(await file.text());if(value.format!==format||!value.config||!['width','height','fps'].every(key=>Number.isFinite(value.config[key])&&value.config[key]>0)||!Number.isFinite(Date.parse(value.created)))throw Error('录像记录不兼容');return value;}
async function entries(dir,pattern){const found=[];for await(const [name,handle]of dir.entries())if(handle.kind==='file'&&pattern.test(name)){const file=await handle.getFile();if(file.size)found.push({name,handle,file});}return found.sort((a,b)=>a.name.localeCompare(b.name));}

// Parse only top-level boxes. Large mdat payloads pass straight to disk.
export class RecordingFiles {
  constructor(dir,{fragmentsPerSegment=15,onProgress=()=>{}}={}){
    this.dir=dir;this.limit=fragmentsPerSegment;this.onProgress=onProgress;this.headers=[];this.headerBytes=0;this.head=new Uint8Array(16);this.used=0;this.need=8;this.position=0;this.segments=0;this.bytes=0;this.currentBytes=0;this.fragments=0;this.chat=[];this.chatBytes=0;this.chatNumber=0;this.chatTail=Promise.resolve();
  }
  async open(config){this.parts=await this.dir.getDirectoryHandle(partsName,{create:true});await writeFile(this.dir,journalName,JSON.stringify({format,created:new Date().toISOString(),config,state:'recording'}));}
  async startSegment(){
    if(this.writer)return;
    if(this.headers.length!==2)throw Error('录像头信息缺失');
    const file=await this.parts.getFileHandle('video-'+number(this.segments+1)+'.mp4',{create:true});this.writer=await file.createWritable();this.currentBytes=0;this.fragments=0;this.buffer=new Uint8Array(1024*1024);this.bufferUsed=0;
    for(const header of this.headers)await this.write(header);
  }
  async flush(){if(this.bufferUsed){await this.writer.write(this.buffer.subarray(0,this.bufferUsed));this.bufferUsed=0;}}
  async write(data){let at=0;while(at<data.length){const take=Math.min(this.buffer.length-this.bufferUsed,data.length-at);this.buffer.set(data.subarray(at,at+take),this.bufferUsed);this.bufferUsed+=take;at+=take;if(this.bufferUsed===this.buffer.length)await this.flush();}this.currentBytes+=data.byteLength;}
  async commit(){if(!this.writer)return;const writer=this.writer;try{await this.flush();await writer.close();}catch(e){await writer.abort().catch(()=>{});throw e;}finally{this.writer=null;this.buffer=null;}this.segments++;this.bytes+=this.currentBytes;this.currentBytes=0;this.onProgress({segments:this.segments,bytes:this.bytes});}
  async boxStart(){
    const view=new DataView(this.head.buffer),short=view.getUint32(0),size=short===1?Number(view.getBigUint64(8)):short;
    this.type=String.fromCharCode(...this.head.subarray(4,8));
    if(!Number.isSafeInteger(size)||size<this.need)throw Error('录像数据块无效');
    this.remaining=size-this.need;this.collect=this.type==='ftyp'||this.type==='moov';
    if(this.collect){if(size>2*1024*1024)throw Error('录像头信息过大');this.box=new Uint8Array(size);this.box.set(this.head.subarray(0,this.need));this.boxOffset=this.need;}
    else if(this.type==='moof'){await this.startSegment();this.fragments++;await this.write(this.head.subarray(0,this.need));}
    else if(this.type==='mdat'){if(!this.writer)throw Error('录像片段顺序无效');await this.write(this.head.subarray(0,this.need));}
  }
  async boxEnd(){
    if(this.collect){this.headers.push(this.box);this.headerBytes+=this.box.length;this.box=null;}
    if(this.type==='mdat'&&this.fragments>=this.limit)await this.commit();
    this.remaining=null;this.used=0;this.need=8;
  }
  async accept({data,position}){
    if(position!==this.position)throw Error('录像数据顺序异常');
    this.position+=data.byteLength;let at=0;
    while(at<data.length){
      if(this.remaining==null){
        const take=Math.min(this.need-this.used,data.length-at);this.head.set(data.subarray(at,at+take),this.used);this.used+=take;at+=take;
        if(this.used<this.need)continue;
        if(this.need===8&&new DataView(this.head.buffer).getUint32(0)===1){this.need=16;continue;}
        await this.boxStart();if(!this.remaining)await this.boxEnd();
      }else{
        const take=Math.min(this.remaining,data.length-at),slice=data.subarray(at,at+take);
        if(this.collect){this.box.set(slice,this.boxOffset);this.boxOffset+=take;}
        else if(this.type==='moof'||this.type==='mdat')await this.write(slice);
        at+=take;this.remaining-=take;if(!this.remaining)await this.boxEnd();
      }
    }
  }
  async finish(){if(this.remaining!=null||this.used)throw Error('录像片段不完整');await this.commit();await this.flushChat();await this.chatTail;}
  async abort(){const writer=this.writer;this.writer=null;this.buffer=null;await writer?.abort().catch(()=>{});await this.flushChat().catch(()=>{});await this.chatTail.catch(()=>{});}
  addChat(value){const line=JSON.stringify(value)+'\n';this.chatBytes+=line.length;if(this.chatBytes>2*1024*1024)throw Error('弹幕写入过慢，请检查磁盘');this.chat.push(line);}
  flushChat(){
    if(!this.chat.length)return this.chatTail;
    const text=this.chat.join(''),length=text.length,name='chat-'+number(++this.chatNumber)+'.jsonl';this.chat=[];
    this.chatTail=this.chatTail.then(()=>writeFile(this.parts,name,text)).finally(()=>{this.chatBytes-=length;});return this.chatTail;
  }
}

function configKey(config){const {description,...rest}=config;return JSON.stringify(rest)+':'+(description?Array.from(new Uint8Array(description.buffer||description,description.byteOffset||0,description.byteLength)).join(','):'');}
async function pipe(track,source,config){const sink=new EncodedPacketSink(track);let first=true,end=-Infinity;for await(const packet of sink.packets()){await source.add(packet,first?{decoderConfig:config}:undefined);first=false;end=Math.max(end,packet.timestamp+packet.duration);}return end;}
export async function mergeRecording(dir,onProgress=()=>{}){
  const journal=await readJournal(dir),parts=await dir.getDirectoryHandle(partsName),videos=await entries(parts,videoName);
  if(!videos.length)throw Error('暂无完整片段可恢复，录制时间可能过短');
  let output,writer,canceling=false,video,audio,reference,previousEnd=-Infinity;
  try{
    for(let i=0;i<videos.length;i++){
      const input=new Input({source:new BlobSource(videos[i].file),formats:[MP4]});
      try{
        const vt=await input.getPrimaryVideoTrack(),at=await input.getPrimaryAudioTrack();if(!vt||!at)throw Error('录像片段缺少画面或声音');
        const vc=await vt.getDecoderConfig(),ac=await at.getDecoderConfig(),signature=configKey(vc)+'|'+configKey(ac);
        const first=await new EncodedPacketSink(vt).getFirstPacket();if(!first||first.type!=='key'||first.timestamp<previousEnd-.1)throw Error('录像片段时间或关键帧异常');
        if(!output){
          reference=signature;writer=await(await dir.getFileHandle('录像.mp4',{create:true})).createWritable();
          output=new Output({format:new Mp4OutputFormat({fastStart:false}),target:new StreamTarget(new WritableStream({write:chunk=>writer.write(chunk),close:()=>canceling?writer.abort():writer.close(),abort:reason=>writer.abort(reason)}),{chunked:true,chunkSize:1024*1024})});
          video=new EncodedVideoPacketSource('avc');audio=new EncodedAudioPacketSource('aac');output.addVideoTrack(video,{frameRate:journal.config.fps});output.addAudioTrack(audio);await output.start();
        }else if(signature!==reference)throw Error('片段的录制参数不同，已保留原片段');
        [previousEnd]=await Promise.all([pipe(vt,video,vc),pipe(at,audio,ac)]);
      }finally{input.dispose();}
      onProgress({step:'merge',current:i+1,total:videos.length});
    }
    await output.finalize();
  }catch(e){canceling=true;await output?.cancel().catch(()=>{});await writer?.abort().catch(()=>{});throw e;}
  const chats=await entries(parts,chatName),chat=await(await dir.getFileHandle('弹幕.jsonl',{create:true})).createWritable();
  try{for(const part of chats){const reader=part.file.stream().getReader();try{for(;;){const {value,done}=await reader.read();if(done)break;await chat.write(value);}}finally{reader.releaseLock();}}await chat.close();}catch(e){await chat.abort().catch(()=>{});throw e;}
  const file=await(await dir.getFileHandle('录像.mp4')).getFile(),verify=new Input({source:new BlobSource(file),formats:[MP4]});
  let duration;try{duration=await verify.computeDuration();if(!(duration>0)||!await verify.getPrimaryVideoTrack()||!await verify.getPrimaryAudioTrack())throw Error('合成文件校验失败，原片段已保留');}finally{verify.dispose();}
  await writeFile(dir,journalName,JSON.stringify({...journal,state:'complete',bytes:file.size,duration}));
  // Remove only files created by this recorder, after both final files are committed.
  for(const {name}of [...videos,...chats])await parts.removeEntry(name).catch(()=>{});
  // An interrupted last transaction may leave an empty file in the parts directory.
  for await(const [name,handle]of parts.entries())if(handle.kind==='file'&&(videoName.test(name)||chatName.test(name)))await parts.removeEntry(name).catch(()=>{});
  await dir.removeEntry(partsName).catch(()=>{});await dir.removeEntry(journalName).catch(()=>{});
  return {bytes:file.size,duration,segments:videos.length};
}

export async function acquireRecordingLock(name){
  if(!navigator.locks)throw Error('浏览器不支持安全录制锁，请更新 Chrome / Edge');
  let release;const hold=new Promise(resolve=>{release=resolve;});
  await new Promise((resolve,reject)=>{navigator.locks.request('freecast-recording:'+name,{ifAvailable:true},async lock=>{if(!lock){reject(Error('该录像仍由另一个页面使用，请先停止录制'));return;}resolve();await hold;}).catch(reject);});
  return release;
}
