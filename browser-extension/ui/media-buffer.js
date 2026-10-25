(()=>{
  const MAX_PENDING_BYTES=32*1024*1024,MAX_PENDING_SEGMENTS=512;
  function policy(seconds,delay=0,mobile=false,smooth=false){
    const retain=Math.max(mobile||smooth?30:90,seconds)+Math.max(0,delay)+20;
    return {retain,forward:Math.max(30,seconds+Math.max(0,delay)+10),bytes:(mobile||smooth?32:64)*1024*1024};
  }
  function pending(mse){
    let bytes=0,count=0;
    for(const list of Object.values(mse?._pendingSegments||{}))for(const part of list||[]){bytes+=part.data?.byteLength||0;count++;}
    return {bytes,count};
  }
  function attach(channel){
    const mse=channel.engine?._player_engine?._mse_controller;if(!mse)return;
    const append=mse.appendMediaSegment;let recovering=false;
    mse.appendMediaSegment=function(segment){
      if(recovering||channel.closed)return;
      const size=pending(this);
      if(size.bytes+(segment.data?.byteLength||0)>MAX_PENDING_BYTES||size.count>=MAX_PENDING_SEGMENTS){
        recovering=true;
        channel.bufferRecovery=setTimeout(()=>{channel.bufferRecovery=null;if(!channel.closed&&channel.engine?._player_engine?._mse_controller===mse){channel.load();notice('播放缓存异常，已清理并重新连接当前线路');}},0);
        return;
      }
      return append.call(this,segment);
    };
  }
  function configure(channel){
    const key=channel.media.id==='videoB'?'b':'a',hold=typeof paused!=='undefined'&&paused&&!window.replay?.active?Math.min(90,Math.max(0,(performance.now()-pauseStarted)/1000)):0;
    const delay=getDelays()[key]+hold,p=policy(window.replay?.seconds()||0,delay,Boolean(window.mobileNative),window.playbackPerformance?.smooth());
    if(channel.engine instanceof Hls)Object.assign(channel.engine.config,{backBufferLength:p.retain,maxBufferLength:p.forward,maxMaxBufferLength:p.forward,maxBufferSize:p.bytes});
    else {const config=channel.engine?._player_engine?._mse_controller?._config;if(config){config.autoCleanupMaxBackwardDuration=p.retain;config.autoCleanupMinBackwardDuration=p.retain-10;}}
    return p;
  }
  function trim(channel,force=false){
    if(!channel.engine||channel.closed)return;
    const now=performance.now();if(!force&&now-(channel.lastBufferTrim||0)<2000)return;channel.lastBufferTrim=now;
    const {retain}=configure(channel),media=channel.media,ranges=media.buffered;if(!ranges.length)return;
    const end=ranges.end(ranges.length-1),cutoff=end-retain;if(cutoff<=0||ranges.start(0)>=cutoff-1)return;
    if(media.currentTime<cutoff+5&&!media.seeking&&media.readyState>=2){
      const key=media.id==='videoB'?'b':'a',target=Sync.targetTime(Array.from({length:ranges.length},(_,i)=>[ranges.start(i),ranges.end(i)]),end,getDelays()[key]);
      if(target!==null){media.currentTime=Math.max(cutoff+5,target);channel.playout={};}
    }
    const until=Math.min(cutoff,media.currentTime-5);if(until<=ranges.start(0)+1)return;
    if(channel.engine instanceof Hls){channel.engine.trigger(Hls.Events.BUFFER_FLUSHING,{startOffset:0,endOffset:until});return;}
    const mse=channel.engine?._player_engine?._mse_controller;
    for(const [type,sb] of Object.entries(mse?._sourceBuffers||{})){
      const queue=mse._pendingRemoveRanges?.[type];if(!sb||!queue||queue.length||!sb.buffered.length||sb.buffered.start(0)>=until-1)continue;
      queue.push({start:0,end:until});
    }
    mse?._doRemoveRanges?.();
  }
  window.mediaBuffers={policy,pending,attach,configure,trim};
})();
