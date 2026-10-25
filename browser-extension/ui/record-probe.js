import './record-quality.js';

export async function* supportedPlans(data){
  if(!self.VideoEncoder||!self.AudioEncoder)throw Error('请使用支持 MP4 录制的新版 Chrome / Edge');
  if(!(await AudioEncoder.isConfigSupported({codec:'mp4a.40.2',sampleRate:data.sampleRate,numberOfChannels:2,bitrate:192000})).supported)throw Error('浏览器不支持 AAC 编码，请更新 Chrome / Edge');
  for(const plan of recordQuality.candidates(data))for(const hardwareAcceleration of ['prefer-hardware','no-preference']){
    for(const bitrateMode of ['quantizer','variable']){
      for(const profile of ['6400','4d00','4200']){
        const config={codec:'avc1.'+profile+recordQuality.level(plan.width,plan.height,plan.fps),width:plan.width,height:plan.height,framerate:plan.fps,latencyMode:'quality',hardwareAcceleration,bitrateMode,...(bitrateMode==='variable'?{bitrate:plan.bitrate}:{})};
        try{const result=await VideoEncoder.isConfigSupported(config);if(result.supported&&result.config.bitrateMode===bitrateMode)yield {...plan,rateControl:bitrateMode,hardwareAcceleration,encoderConfig:config};}catch{}
      }
    }
  }
}

async function measure(plan,getFrame){
  let error,count=0,encoder,timer;
  try{
    encoder=new VideoEncoder({output:()=>count++,error:e=>{error=e;}});encoder.configure(plan.encoderConfig);
    const run=async()=>{
      // Flush warm-up separately so startup latency doesn't distort sustained throughput.
      let started;
      for(let i=0;i<36;i++){
        if(error)throw error;
        const frame=await getFrame(plan);let sample;try{sample=new VideoFrame(frame,{timestamp:Math.round(i*1e6/plan.fps),duration:Math.round(1e6/plan.fps)});}finally{frame.close();}
        try{encoder.encode(sample,{keyFrame:i===0||i===6,...(plan.rateControl==='quantizer'?{avc:{quantizer:plan.quantizer}}:{})});}finally{sample.close();}
        if(i===5){await encoder.flush();started=performance.now();count=0;}
        else if(i>5&&(i-5)%6===0)await encoder.flush();
      }
      await encoder.flush();if(error)throw error;if(count!==30)throw Error('编码器丢帧');
      return 30000/Math.max(1,performance.now()-started);
    };
    return await Promise.race([run(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('编码性能检测超时')),4500);})]);
  }finally{clearTimeout(timer);if(encoder&&encoder.state!=='closed')encoder.close();}
}

export async function probeRecording(data,getFrame,onProgress){
  const started=performance.now(),slow=new Set();let lastError,available=false;
  for await(const plan of supportedPlans(data)){
    available=true;const key=[plan.width,plan.height,plan.fps,plan.hardwareAcceleration,plan.rateControl].join(':');if(slow.has(key))continue;onProgress(plan);
    try{const capacity=await measure(plan,getFrame);if(capacity>=plan.fps*1.15)return {...plan,capacity:Math.round(capacity),adjusted:plan.width!==data.width||plan.height!==data.height||plan.fps!==data.fps};slow.add(key);}catch(e){lastError=e;}
    if(performance.now()-started>20000)break;
  }
  if(!available)throw Error('设备不支持保存当前画面，请选择性能模式或更新 Chrome / Edge');
  throw Error('当前设备未通过录制性能检测，请选择性能模式或关闭高负载功能后重试'+(lastError?'：'+lastError.message:''));
}
