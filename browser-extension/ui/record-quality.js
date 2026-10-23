(()=>{
  const presets=Object.freeze({
    source:{hint:'尽量保留直播原始分辨率、帧率与细节，码率自动调整。'},
    performance:{hint:'1080p · 30 帧，自动压缩体积；低分辨率直播不放大。'}
  });
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  function normalize(id){return ['performance','720p','1080p'].includes(id)?'performance':'source';}
  function settings(quality,width,height,fps){
    const source=quality==='source';
    // Spend bits on detail/motion; this bitrate is only the fallback without quantizer support.
    const bitrate=Math.round(clamp(width*height*fps*(source?.26:.13),source?2000000:1200000,source?180000000:8000000));
    return {width,height,fps,quality,quantizer:source?18:24,bitrate,bitrateMode:'variable',latencyMode:'quality'};
  }
  function config(id,video,sourceFps=60){
    const quality=normalize(id),w=video.videoWidth,h=video.videoHeight;
    if(!w||!h)throw Error('画面尚未就绪，请开始播放后再保存');
    const scale=quality==='source'?1:Math.min(1,1080/Math.min(w,h),1920/Math.max(w,h));
    const width=Math.max(2,Math.floor(w*scale/2)*2),height=Math.max(2,Math.floor(h*scale/2)*2);
    return settings(quality,width,height,quality==='source'?clamp(Math.round(sourceFps)||60,1,60):30);
  }
  function candidates(plan){
    if(plan.quality!=='source')return [settings('performance',plan.width,plan.height,plan.fps)];
    const list=[],seen=new Set();
    // Try source pixels first; step down only when the encoder cannot handle them.
    for(const edge of [Math.max(plan.width,plan.height),3840,2560,1920]){
      if(edge>Math.max(plan.width,plan.height))continue;
      const scale=Math.min(1,edge/Math.max(plan.width,plan.height));
      const width=Math.max(2,Math.floor(plan.width*scale/2)*2),height=Math.max(2,Math.floor(plan.height*scale/2)*2);
      for(const fps of [plan.fps,Math.min(30,plan.fps)]){
        const key=[width,height,fps].join(':');if(seen.has(key))continue;seen.add(key);
        list.push(settings('source',width,height,fps));
      }
    }
    return list;
  }
  function level(width,height,fps){
    const blocks=Math.ceil(width/16)*Math.ceil(height/16);
    for(const [hex,frame,second]of [['28',8192,245760],['2a',8704,522240],['33',36864,983040],['34',36864,2073600],['3c',139264,4177920],['3d',139264,8355840],['3e',139264,16711680]])if(blocks<=frame&&blocks*fps<=second)return hex;
    return '3e';
  }
  async function frameRate(video){
    const rate=video.srcObject?.getVideoTracks?.()[0]?.getSettings?.().frameRate;
    if(Number.isFinite(rate)&&rate>0)return clamp(Math.round(rate),1,60);
    if(!video.requestVideoFrameCallback)return 60;
    return new Promise(resolve=>{
      let callback,last,done=false;const intervals=[];
      const finish=()=>{if(done)return;done=true;clearTimeout(timer);if(callback!==undefined)video.cancelVideoFrameCallback?.(callback);intervals.sort((a,b)=>a-b);const median=intervals[Math.floor(intervals.length/2)];resolve(median?clamp(Math.round(1/median),1,60):60);};
      const tick=(_,meta)=>{if(done)return;const delta=meta.mediaTime-last;if(delta>0&&delta<1)intervals.push(delta);last=meta.mediaTime;if(intervals.length>=8)finish();else callback=video.requestVideoFrameCallback(tick);};
      const timer=setTimeout(finish,450);callback=video.requestVideoFrameCallback(tick);
    });
  }
  globalThis.recordQuality={presets,normalize,config,candidates,level,frameRate};
})();
