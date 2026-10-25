import {Output, Mp4OutputFormat, StreamTarget, VideoSampleSource, AudioSampleSource, VideoSample, AudioSample, Quality} from '../vendor/mediabunny-1.61.3.min.mjs';
import {RecordingFiles, mergeRecording, acquireRecordingLock} from './record-files.js';
import {supportedPlans, probeRecording} from './record-probe.js';

let output,video,audio,writer,files,releaseLock,failed=false,finishing=false,canceling=false,samples=0,videoTail=Promise.resolve(),audioTail=Promise.resolve(),chatTimer,statsTimer,initializing;
let frameId=0;const frameRequests=new Map();
const progress=data=>postMessage({type:'progress',...data});
function fail(error){if(failed)return;failed=true;postMessage({type:'error',message:String(error.message||error)});}
function getFrame(plan){return new Promise((resolve,reject)=>{const id=++frameId,timer=setTimeout(()=>{frameRequests.delete(id);reject(Error('画面采集超时'));},3000);frameRequests.set(id,{resolve,reject,timer});postMessage({type:'probeFrame',id,width:plan.width,height:plan.height,fps:plan.fps});});}
async function init(data){
  let plan=data.plan;
  if(!plan)for await(const supported of supportedPlans(data)){plan=supported;break;}
  if(!plan)throw Error('设备不支持保存当前画面，请选择性能模式或更新 Chrome / Edge');
  if(data.dir){
    releaseLock=await acquireRecordingLock(data.dir.name);
    files=new RecordingFiles(data.dir,{fragmentsPerSegment:data.fragmentsPerSegment||15,onProgress:progress});await files.open(plan);
    const writable=new WritableStream({write:chunk=>files.accept(chunk),close:()=>canceling?files.abort():files.finish(),abort:()=>files.abort()});
    output=new Output({format:new Mp4OutputFormat({fastStart:'fragmented',minimumFragmentDuration:2}),target:new StreamTarget(writable)});
    chatTimer=setInterval(()=>{void files.flushChat().catch(fail);},5000);
    statsTimer=setInterval(()=>progress({bytes:files.bytes+files.currentBytes,segments:files.segments}),1000);
  }else{
    // Single-file output is also used by the codec quality regression harness.
    writer=await data.file.createWritable();
    output=new Output({format:new Mp4OutputFormat({fastStart:false}),target:new StreamTarget(new WritableStream({write:chunk=>writer.write(chunk),close:()=>canceling?writer.abort():writer.close(),abort:reason=>writer.abort(reason)}),{chunked:true,chunkSize:1024*1024})});
  }
  const quality=new Quality(plan.rateControl==='quantizer'?{quantizer:plan.quantizer,bitrate:plan.bitrate,bitrateMode:'variable'}:{bitrate:plan.bitrate,bitrateMode:'variable'});
  video=new VideoSampleSource({codec:'avc',fullCodecString:plan.encoderConfig.codec,quality,hardwareAcceleration:plan.hardwareAcceleration,latencyMode:'quality',keyFrameInterval:2});
  audio=new AudioSampleSource({codec:'aac',fullCodecString:'mp4a.40.2',quality:new Quality({bitrate:192000})});
  output.addVideoTrack(video,{frameRate:plan.fps});output.addAudioTrack(audio);await output.start();postMessage({type:'ready',config:plan});
}
async function finish(){
  if(finishing)return;finishing=true;clearInterval(chatTimer);clearInterval(statsTimer);
  try{
    await initializing?.catch(()=>{});await Promise.all([videoTail,audioTail]);
    if(failed||!samples){canceling=true;await output?.cancel().catch(()=>{});await writer?.abort().catch(()=>{});await files?.abort();}
    else if(output)await output.finalize();
    if(files?.segments){progress({step:'merge',current:0,total:files.segments});const result=await mergeRecording(files.dir,progress);postMessage({type:'saved',...result});}
  }catch(e){fail(e);canceling=true;await output?.cancel().catch(()=>{});await writer?.abort().catch(()=>{});await files?.abort().catch(()=>{});}
  finally{releaseLock?.();postMessage({type:'done'});}
}
async function recover(dir){
  let release;try{release=await acquireRecordingLock(dir.name);const result=await mergeRecording(dir,progress);postMessage({type:'saved',...result});}catch(e){fail(e);}finally{release?.();postMessage({type:'done'});}
}
self.onmessage=event=>{
  const data=event.data;
  if(data.type==='probe'){void probeRecording(data,getFrame,plan=>progress({step:'probe',width:plan.width,height:plan.height,fps:plan.fps})).then(config=>postMessage({type:'prepared',config})).catch(fail);return;}
  if(data.type==='probeFrame'){const request=frameRequests.get(data.id);if(!request){data.frame?.close();return;}frameRequests.delete(data.id);clearTimeout(request.timer);if(data.frame)request.resolve(data.frame);else request.reject(Error(data.message||'画面采集失败'));return;}
  if(data.type==='recover'){void recover(data.dir);return;}
  if(data.type==='init'){initializing=init(data);void initializing.catch(fail);return;}
  if(data.type==='finish'){void finish();return;}
  if(data.type==='chat'){try{files?.addChat(data.value);if(files?.chatBytes>256*1024)void files.flushChat().catch(fail);}catch(e){fail(e);}return;}
  if(data.type==='video'){
    if(failed||finishing){data.frame.close();postMessage({type:'videoDone',accepted:false});return;}
    let accepted=false;
    videoTail=videoTail.then(async()=>{const sample=new VideoSample(data.frame);try{await video.add(sample);samples++;accepted=true;}finally{sample.close();data.frame.close();}}).catch(fail).finally(()=>postMessage({type:'videoDone',accepted}));
  }else if(data.type==='audio'){
    if(failed||finishing){postMessage({type:'audioDone'});return;}
    audioTail=audioTail.then(async()=>{const sample=new AudioSample({data:data.samples,format:'f32-planar',numberOfChannels:2,sampleRate:data.sampleRate,timestamp:data.time});try{await audio.add(sample);samples++;}finally{sample.close();}}).catch(fail).finally(()=>postMessage({type:'audioDone'}));
  }
};
