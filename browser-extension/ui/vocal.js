// Each source owns its clock, capture and replay state; the model is shared.
const vocalTemplate = {
  active:false,ready:false,delay:7,epoch:0,inflight:false,ctx:null,nodes:new Set(),timeline:[],anchors:[],raw:[[],[]],samples:0,startTime:null,lastFrame:0,lastInputEnd:null,firstSound:Infinity,
  length:261120,trim:3072,core:254976,step:232926,overlap:22050,rate:44100,compare:false,
  sourceKey:'b',stem:'instrumental',feeds:{},mirrors:{},transports:{},mediaSources:{},feedSources:{},outputs:{},directs:{},enableRevision:0,
  media(key=this.sourceKey){return $(key==='a'?'audioA':'videoB');},
  get feed(){return this.feeds[this.sourceKey];},
  get mirror(){return this.mirrors[this.sourceKey];},
  get transport(){return this.transports[this.sourceKey];},
  label(){return this.sourceKey.toUpperCase()+' 路 · '+(this.stem==='vocals'?'只保留人声':'去人声');},
  controls(){vocal.controls();},
  graph(){return vocal.graph();},
  applyMix(){vocal.applyMix();},
  visual(){return $('videoB');},
  reset(reason="reset"){
    this.resets ||= [];this.resets.push({reason,time:this.ctx?.currentTime||0,feed:this.feed?.currentTime||0});if(this.resets.length>30)this.resets.shift();
    this.epoch++;this.ready=false;this.firstSound=Infinity;this.raw=[[],[]];this.samples=0;this.startTime=null;this.lastInputEnd=null;
    for(const node of this.nodes){try{node.stop();}catch{}node.onended?.();}this.nodes.clear();
    this.timeline=[];this.anchors=[];
    if(this.capture){this.capture.port.postMessage({enabled:this.active&&!this.feed.paused&&this.feed.readyState>=3,epoch:this.epoch});}
  },
  async enable(){
    if(this.active||this.loading||this.mode==='off')return;
    const revision=++this.enableRevision,token=generation;this.loading=true;this.error='';vocal.controls();
    try{
      if(!running||!this.mirror||this.mirror.closed)throw Error('音轨尚未就绪，请连接直播后重试');
      await vocal.graph();await this.ctx.resume();
      if(revision!==this.enableRevision||token!==generation||!running)return;
      const info=await window.live.vocalInit({performanceMode:$('filterPerformance').value,streams:vocal.selectedCount()});
      if(revision!==this.enableRevision)return;
      if(token!==generation||!running)throw Error('直播已切换');
      if(!info.realtime)throw Error('当前设备无法实时处理');
      if(!this.mirror||this.mirror.closed)throw Error('音轨已中断，请重试');
      this.mirror.resume?.();
      this.delay=(info.delay||8)+(vocal.selectedCount()>1?6:0);this.provider=info.provider;this.device=info.device;this.profile=info.profile;
      this.active=true;this.feedStarted=false;this.feedPlayout={};this.lastHealthyAt=performance.now();
      this.reset();applyMix();updateOffset();save();
    }catch(error){if(revision===this.enableRevision)this.fail(error);}
    finally{if(revision===this.enableRevision){this.loading=false;vocal.controls();}}
  },
  disable(){this.enableRevision++;this.loading=false;this.active=false;this.error='';this.feedStarted=false;this.feedPlayout={};this.feed?.pause();this.reset();this.clearReplay?.();this.mirror?.suspend?.();},
  fail(error){this.disable();this.error=String(error.message||error);vocal.releaseIfIdle();this.ctx?.resume?.().catch(()=>{});applyMix();updateOffset();save();vocal.controls();},
  accept(block){
    if(!this.active||block.epoch!==this.epoch||(paused&&!window.replay?.active))return;
    if(this.lastInputEnd!==null){
      const missing=Math.round((block.time-this.lastInputEnd)*this.rate);
      if(missing>0){
        this.lastGap={missing,block:block.time,end:this.lastInputEnd};
        if(missing>this.rate*2){this.fail(Error('音频设备中断超过 2 秒，请重新开启过滤'));return;}
        for(const c of this.raw)c.push(new Float32Array(missing));this.samples+=missing;
      }else if(missing<0){
        const overlap=-missing;if(overlap>=block.left.length)return;
        block={...block,time:this.lastInputEnd,left:block.left.slice(overlap),right:block.right.slice(overlap)};
      }
    }
    this.lastInputEnd=block.time+block.left.length/this.rate;
    if(this.startTime===null)this.startTime=block.time;
    this.raw[0].push(block.left);this.raw[1].push(block.right);this.samples+=block.left.length;
    if(this.samples>this.length*2){this.fail(Error('过滤跟不上播放，已停止积压'));return;}
    this.pump();
  },
  async pump(){
    if(this.inflight||!this.active||this.samples<this.length)return;
    const flat=this.raw.map(chunks=>{const a=new Float32Array(this.samples);let p=0;for(const c of chunks){a.set(c,p);p+=c.length;}return a;});
    const left=flat[0].slice(0,this.length),right=flat[1].slice(0,this.length),time=this.startTime+this.trim/this.rate,epoch=this.epoch;
    this.raw=flat.map(c=>[c.slice(this.step)]);this.samples-=this.step;this.startTime+=this.step/this.rate;this.inflight=true;
    try{
      const anchor=this.anchors.findLast(a=>a.time<=time)||this.anchors[0];
      if(!anchor)throw Error('音频时钟未就绪');
      const mediaStart=anchor.media+(time-anchor.time);
      const result=await window.live.vocalProcess({left,right,mode:this.strategy,stem:this.stem,streams:vocal.selectedCount()});
      if(!this.active||epoch!==this.epoch)return;
      const when=time+this.delay;
      if(when+this.core/this.rate<this.ctx.currentTime+.03)throw Error('处理超过时间预算，无法保持同步');
      const replayBuffer=this.schedule([result.left,result.right],when,this.wet);this.rememberReplay?.(replayBuffer,mediaStart);
      this.schedule([left.slice(this.trim,this.trim+this.core),right.slice(this.trim,this.trim+this.core)],when,this.dry);
      this.firstSound=Math.min(this.firstSound,when);
      this.timeline.push({when,mediaStart,end:when+this.core/this.rate});
      this.profile=result.nextProfile||result.profile||this.profile;
      this.lastMs=result.ms;this.lastHealthyAt=performance.now();vocal.controls();
    }catch(error){if(epoch===this.epoch)this.fail(error);}finally{this.inflight=false;if(this.active)this.pump();}
  },
  schedule(channels,when,destination){
    const buffer=this.ctx.createBuffer(2,channels[0].length,this.rate);channels.forEach((c,i)=>buffer.copyToChannel(c,i));
    const node=this.ctx.createBufferSource(),envelope=this.ctx.createGain();node.buffer=buffer;node.connect(envelope);envelope.connect(destination);
    const fade=this.overlap/this.rate,end=when+buffer.duration;
    envelope.gain.setValueAtTime(0,when);envelope.gain.linearRampToValueAtTime(1,when+fade);envelope.gain.setValueAtTime(1,end-fade);envelope.gain.linearRampToValueAtTime(0,end);
    const start=Math.max(when,this.ctx.currentTime+.012),skip=start-when;
    this.nodes.add(node);node.onended=()=>{this.nodes.delete(node);node.disconnect();envelope.disconnect();node.buffer=null;node.onended=null;};node.start(start,skip);
    return buffer;
  },
  ensureFeed(key=this.sourceKey){if(this.feeds[key])return;const feed=this.feeds[key]=document.createElement('audio');feed.id='filterAudioFeed'+key.toUpperCase();feed.preload='auto';$('mediaParking').append(feed);},
  detachMirror(key=this.sourceKey){this.mirrors[key]?.close();delete this.mirrors[key];if(key===this.sourceKey){this.feedStarted=false;if(this.active)this.reset();}},
  newMirror(key){this.ensureFeed(key);this.detachMirror(key);const mirror=new AudioMirror(this.feeds[key],e=>{if(key!==this.sourceKey)return;if(this.active)this.fail(e);else this.error=e.message;});this.mirrors[key]=mirror;if(this.active||this.loading)mirror.resume();return mirror;},
  attachFLV(engine,key=this.sourceKey){
    this.transports[key]='flv';
    const mirror=this.newMirror(key),mse=engine._player_engine?._mse_controller;
    // Adapter pinned to mpegts.js 1.8.2; fail explicitly if its API changes.
    if(!mse?.appendInitSegment||!mse?.appendMediaSegment){mirror.fail('当前 FLV 引擎不支持音频预处理');return;}
    const init=mse.appendInitSegment,append=mse.appendMediaSegment;
    mse.appendInitSegment=function(segment,deferred){if(segment.type==='audio'&&!deferred)mirror.push(segment.data,segment.container+(segment.codec?';codecs="'+segment.codec+'"':''),undefined,true);return init.call(this,segment,deferred);};
    mse.appendMediaSegment=function(segment){if(segment.type==='audio')mirror.push(segment.data,null,Number.isFinite(segment.timestampOffset)?segment.timestampOffset/1000:undefined);return append.call(this,segment);};
  },
  attachHLS(engine,key=this.sourceKey){this.transports[key]='hls';const mirror=this.newMirror(key);let mime;
    engine.on(Hls.Events.BUFFER_CODECS,(_e,tracks)=>{if(tracks.audio){mime=tracks.audio.container+';codecs="'+(tracks.audio.levelCodec||tracks.audio.codec)+'"';}else if(tracks.audiovideo)mirror.fail('此 HLS 线路未提供独立音轨，请切换 FLV 线路');});
    engine.on(Hls.Events.BUFFER_APPENDING,(_e,data)=>{if(data.type==='audio')mirror.push(data.data,mime,data.offset);});
  },
  pause(){if(window.replay?.active){this.seekReplay();return;}this.feed?.pause();},
  bufferPadding(){return this.transport==='hls'?Math.max(0,6-Number($('base').value)):0;},
  anchor(){if(!this.ctx||(paused&&!window.replay?.active)||this.feed.seeking)return;this.anchors.push({time:this.ctx.currentTime,media:this.feed.currentTime});while(this.anchors.length>250)this.anchors.shift();},
  mediaAt(time){const index=this.anchors.findLastIndex(a=>a.time<=time);if(index<0)return null;const a=this.anchors[index],b=this.anchors[index+1];return b&&b.time>a.time?a.media+(b.media-a.media)*(time-a.time)/(b.time-a.time):a.media+time-a.time;},
  tick(){
    if(!this.active||!this.ctx||!running||demo)return;
    const now=this.ctx.currentTime,video=this.media();
    if(paused&&!window.replay?.active){this.lastHealthyAt=performance.now();this.feed.pause();video.pause();return;}
    if(!this.mirror||this.mirror.closed){this.fail(Error('音频预处理已中断，请重试 AI 或使用原声'));return;}
    const ranges=[];for(let i=0;i<this.feed.buffered.length;i++)ranges.push([this.feed.buffered.start(i),this.feed.buffered.end(i)]);
    const edge=channels[this.sourceKey]?.edge(performance.now());
    const requested=getDelays()[this.sourceKey]-this.delay;
    if(performance.now()-(this.lastHealthyAt||0)>Math.max(30000,(this.delay+Math.max(0,requested)+20)*1000)){this.fail(Error('AI 音轨长时间未输出，请重试 AI 或切换线路'));return;}
    const action=Sync.playoutStep(this.feedPlayout ||= {},{now:performance.now(),current:this.feed.currentTime,ranges,edge,delay:requested,ready:this.feed.readyState,seeking:this.feed.seeking});
    if(action.wait){this.feed.pause();video.pause();return;}
    this.feedRequest=requested;this.feedStarted=true;
    if(action.seek!==null&&!this.feed.seeking){this.seekReason='playout-clock';this.feed.currentTime=action.seek;}
    // Capture stays at the sample rate; only the video uses rate correction.
    this.feed.playbackRate=1;if(this.feed.paused)this.feed.play().catch(e=>{if(e.name!=="AbortError"&&this.active)this.fail(e);});
    this.anchor();this.ready=now>=this.firstSound;
    while(this.timeline.length>1&&this.timeline[1].when<=now)this.timeline.shift();
    const block=this.timeline.find(b=>b.when<=now&&b.end>now);
    if(block)this.lastHealthyAt=performance.now();
    if(window.replay?.active)return;
    if(!block){this.ready=false;video.pause();return;}
    const desired=this.mediaAt(now-this.delay)??(block.mediaStart+now-block.when),diff=desired-video.currentTime;
    this.syncError=diff;
    if(Math.abs(diff)>.45&&!video.seeking){video.currentTime=desired;this.videoSeeks=(this.videoSeeks||0)+1;}
    video.playbackRate=Math.abs(diff)<.025?1:clamp(1+diff*.15,.97,1.03);
    if(video.paused)video.play().catch(()=>{});
  }
};

