import { Output, Mp4OutputFormat, StreamTarget, VideoSampleSource, AudioSampleSource, VideoSample, AudioSample, Quality } from '../vendor/mediabunny-1.61.3.min.mjs';
import './record-quality.js';

let output, video, audio, writer, failed=false, finishing=false, canceling=false, samples=0, videoTail=Promise.resolve(), audioTail=Promise.resolve();
function fail(error){if(failed)return;failed=true;postMessage({type:'error',message:String(error.message||error)});}
async function init(data){
  if(!self.VideoEncoder||!self.AudioEncoder)throw Error('请使用支持 MP4 录制的新版 Chrome / Edge');
  let config,plan;
  search:for(const option of recordQuality.candidates(data)){
    const level=recordQuality.level(option.width,option.height,option.fps);
    for(const hardwareAcceleration of ['prefer-hardware','no-preference'])for(const bitrateMode of ['quantizer','variable'])for(const profile of ['6400','4d00','4200']){
      const candidate={codec:'avc1.'+profile+level,width:option.width,height:option.height,framerate:option.fps,latencyMode:'quality',hardwareAcceleration,bitrateMode,...(bitrateMode==='variable'?{bitrate:option.bitrate}:{})};
      try{const result=await VideoEncoder.isConfigSupported(candidate);if(result.supported&&result.config.bitrateMode===bitrateMode){config=candidate;plan=option;break search;}}catch{}
    }
  }
  if(!config)throw Error('设备不支持保存当前画面，请选择性能模式或更新 Chrome / Edge');
  if(!(await AudioEncoder.isConfigSupported({codec:'mp4a.40.2',sampleRate:data.sampleRate,numberOfChannels:2,bitrate:192000})).supported)throw Error('浏览器不支持 AAC 编码，请更新 Chrome / Edge');
  writer=await data.file.createWritable();
  // The muxer seeks only while writing headers/indexes. Media is streamed to disk, not retained in RAM.
  const writable=new WritableStream({write:chunk=>writer.write(chunk),close:()=>canceling?writer.abort():writer.close(),abort:reason=>writer.abort(reason)});
  output=new Output({format:new Mp4OutputFormat({fastStart:false}),target:new StreamTarget(writable,{chunked:true,chunkSize:1024*1024})});
  const quality=new Quality(config.bitrateMode==='quantizer'?{quantizer:plan.quantizer,bitrate:plan.bitrate,bitrateMode:'variable'}:{bitrate:plan.bitrate,bitrateMode:'variable'});
  video=new VideoSampleSource({codec:'avc',fullCodecString:config.codec,quality,hardwareAcceleration:config.hardwareAcceleration,latencyMode:'quality',keyFrameInterval:2});
  audio=new AudioSampleSource({codec:'aac',fullCodecString:'mp4a.40.2',quality:new Quality({bitrate:192000})});
  output.addVideoTrack(video,{frameRate:plan.fps});output.addAudioTrack(audio);
  await output.start();postMessage({type:'ready',config:{...plan,rateControl:config.bitrateMode,hardwareAcceleration:config.hardwareAcceleration}});
}
async function finish(){
  if(finishing)return;finishing=true;
  await Promise.all([videoTail,audioTail]);
  if(failed||!samples){canceling=true;await output?.cancel().catch(()=>{});await writer?.abort().catch(()=>{});}
  else if(output){try{await output.finalize();}catch(e){fail(e);canceling=true;await output.cancel().catch(()=>{});await writer?.abort().catch(()=>{});}}
  postMessage({type:'done'});
}
self.onmessage=event=>{
  const data=event.data;
  if(data.type==='init'){void init(data).catch(fail);return;}
  if(data.type==='finish'){void finish().catch(e=>{fail(e);postMessage({type:'done'});});return;}
  if(data.type==='video'){
    if(failed||finishing){data.frame.close();postMessage({type:'videoDone'});return;}
    videoTail=videoTail.then(async()=>{const sample=new VideoSample(data.frame);try{await video.add(sample);samples++;}finally{sample.close();data.frame.close();}}).catch(fail).finally(()=>postMessage({type:'videoDone'}));
  }else if(data.type==='audio'){
    if(failed||finishing){postMessage({type:'audioDone'});return;}
    audioTail=audioTail.then(async()=>{const sample=new AudioSample({data:data.samples,format:'f32-planar',numberOfChannels:2,sampleRate:data.sampleRate,timestamp:data.time});try{await audio.add(sample);samples++;}finally{sample.close();}}).catch(fail).finally(()=>postMessage({type:'audioDone'}));
  }
};
