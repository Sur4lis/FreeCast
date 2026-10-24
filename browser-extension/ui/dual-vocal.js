const vocal = window.vocal = {
  pipes:{},ctx:null,feeds:{},mirrors:{},transports:{},outputs:{},directs:{},mediaSources:{},feedSources:{},sourceKey:'b',armed:false,
  get active(){return Object.values(this.pipes).some(p=>p.active);},
  get loading(){return Object.values(this.pipes).some(p=>p.loading);},
  get ready(){return Object.values(this.pipes).filter(p=>p.active).every(p=>p.ready);},
  get delay(){return Math.max(0,...Object.values(this.pipes).filter(p=>p.active).map(p=>p.delay));},
  get stem(){return this.pipes[this.sourceKey].stem;},set stem(v){this.pipes[this.sourceKey].stem=v;},
  selectedCount(){return Math.max(1,Object.values(this.pipes).filter(p=>p.mode!=='off').length);},
  releaseIfIdle(){if(!this.active&&!this.loading)window.live.vocalRelease();},
  label(){return Object.values(this.pipes).filter(p=>p.mode!=='off').map(p=>p.label()).join(' · ')||'原声';},
  visual(){return $('videoB');},
  controls(){
    $('filterPerformance').disabled=this.active||this.loading;
    for(const key of ['a','b']){const p=this.pipes[key],upper=key.toUpperCase();
      $('aiMode'+upper).value=p.mode;$('aiStrength'+upper).value=p.strength;$('aiStrategy'+upper).value=p.strategy;
      $('aiStrategy'+upper).disabled=p.mode!=='instrumental';$('aiStrength'+upper).disabled=p.mode==='off';
      $('aiState'+upper).textContent=p.error?'AI 已停止，已切回原声（含原解说）：'+p.error:p.loading?'加载中…':p.active?(p.ready?'处理中':'准备音频')+(p.lastMs?' · '+Math.round(p.lastMs)+' ms':''):p.mode==='off'?'原声':this.armed?'连接后开启':'待开启';
    }
    $('filterEnable').checked=this.armed;$('filterEnable').disabled=false;
    const failed=Object.entries(this.pipes).filter(([,p])=>p.error).map(([key])=>key.toUpperCase()).join('、');
    $('filterStatus').textContent=(this.loading?'正在准备本地 AI…':this.active?this.label()+' · 音画补偿 '+this.delay+' 秒':failed?'':this.label()+(this.armed?' · 连接后自动开启':' · 已关闭'))+(failed?(this.active||this.loading?' · ':'')+failed+' 路已切回原声':'');
  },
  async graph(){
    if(this.graphReady)return;if(this.graphPending)return this.graphPending;
    this.graphPending=(async()=>{
      this.ctx ||= new AudioContext({sampleRate:44100,latencyHint:'playback'});
      await this.ctx.audioWorklet.addModule('vocal-capture.js');
      for(const key of ['a','b']){const p=this.pipes[key];p.ctx=this.ctx;
        const source=this.mediaSources[key] ||= this.ctx.createMediaElementSource(p.media());
        const input=this.feedSources[key] ||= this.ctx.createMediaElementSource(p.feed);
        const output=this.outputs[key] ||= this.ctx.createGain(),direct=this.directs[key] ||= this.ctx.createGain();
        source.disconnect();direct.disconnect();output.disconnect();source.connect(direct);direct.connect(output);output.connect(this.ctx.destination);
        p.output=output;p.direct=direct;p.wet=this.ctx.createGain();p.dry=this.ctx.createGain();p.wet.connect(output);p.dry.connect(output);
        p.capture=new AudioWorkletNode(this.ctx,'vocal-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2});
        input.connect(p.capture);p.capture.connect(this.ctx.destination);p.capture.port.onmessage=e=>p.accept(e.data);
        p.feed.addEventListener('seeking',()=>{if(p.active){p.reset('seeking:'+(p.seekReason||'decoder'));p.seekReason=null;}});
        p.feed.addEventListener('pause',()=>{if(p.active&&(paused||!running))p.reset('pause');});
        p.feed.addEventListener('playing',()=>{if(p.active){p.anchor();p.capture.port.postMessage({enabled:true,epoch:p.epoch});}});
      }
      this.graphReady=true;this.applyMix();
      this.ctx.addEventListener('statechange',()=>{if((this.active||window.localRecording?.active)&&!paused&&this.ctx.state==='suspended')this.ctx.resume().catch(()=>{});});
    })();try{await this.graphPending;}finally{this.graphPending=null;}
  },
  applyMix(){
    if(!this.graphReady)return;
    const now=this.ctx.currentTime;
    for(const key of ['a','b']){const p=this.pipes[key],upper=key.toUpperCase();p.media().muted=false;p.media().volume=1;
      p.output.gain.setTargetAtTime(mix.muted||!mix['audio'+upper]?0:Number($('volume').value)/100*Number($('sourceVolume'+upper).value)/100,now,.015);
      const strength=p.strength/100,replaying=p.active&&window.replay?.active;
      p.direct.gain.value=p.active?(replaying?1-strength:0):1;
      for(const [node,value] of [[p.wet,p.active&&!replaying?strength:0],[p.dry,p.active&&!replaying?1-strength:0],[p.replayGain,replaying?strength:0]])if(node){node.gain.cancelScheduledValues(now);node.gain.setTargetAtTime(value,now,.02);}
    }
  },
  async enable(){
    if(window.replay?.active){notice('请回到直播后开启 AI');return;}
    this.armed=true;if(!Object.values(this.pipes).some(p=>p.mode!=='off')){this.pipes.b.mode='instrumental';this.pipes.b.stem='instrumental';}
    await Promise.all(Object.values(this.pipes).map(p=>p.mode==='off'?p.disable():p.enable()));this.controls();
  },
  disable(){this.armed=false;for(const p of Object.values(this.pipes))p.disable();window.live.vocalRelease();this.controls();applyMix();updateOffset();},
  configure(){
    this.sourceKey=$('filterSource').value==='a'?'a':'b';const p=this.pipes[this.sourceKey];
    p.stem=$('filterStem').value==='vocals'?'vocals':'instrumental';p.mode=p.stem;p.strength=Number($('filterStrength').value);p.strategy=$('filterMode').value;
    this.controls();this.applyMix();
  },
  settings(){return Object.fromEntries(Object.entries(this.pipes).map(([key,p])=>[key,{mode:p.mode,strength:p.strength,strategy:p.strategy}]));},
  restore(routes){for(const key of ['a','b']){const p=this.pipes[key],r=routes?.[key]||{};p.mode=['off','vocals','instrumental'].includes(r.mode)?r.mode:'off';p.stem=p.mode==='vocals'?'vocals':'instrumental';p.strength=clamp(Number.isFinite(+r.strength)?+r.strength:100,0,100);p.strategy=r.strategy==='strong'?'strong':'game';}this.controls();},
  bufferPadding(){return Math.max(0,...Object.values(this.pipes).filter(p=>p.active).map(p=>p.bufferPadding()));},
  reset(){for(const p of Object.values(this.pipes))p.reset();},pause(){for(const p of Object.values(this.pipes))p.pause();},tick(){for(const p of Object.values(this.pipes))p.tick();},
  attachFLV(engine,key){this.pipes[key].attachFLV(engine,key);},attachHLS(engine,key){this.pipes[key].attachHLS(engine,key);},detachMirror(key){this.pipes[key].detachMirror(key);},
  clearReplay(){for(const p of Object.values(this.pipes))p.clearReplay?.();},pruneReplay(){for(const p of Object.values(this.pipes))p.pruneReplay?.();},seekReplay(){for(const p of Object.values(this.pipes))p.seekReplay?.();},endReplay(){for(const p of Object.values(this.pipes))p.endReplay?.();},replayTick(rate,hold){for(const p of Object.values(this.pipes))p.replayTick?.(rate,hold);}
};
for(const key of ['a','b']){
  const p=vocal.pipes[key]=Object.assign(Object.create(vocalTemplate),{sourceKey:key,mode:key==='b'?'instrumental':'off',strength:100,strategy:'game',nodes:new Set(),timeline:[],anchors:[],raw:[[],[]],resets:[],feeds:vocal.feeds,mirrors:vocal.mirrors,transports:vocal.transports});p.ensureFeed(key);
  for(const id of ['aiMode','aiStrength','aiStrategy'])$(id+key.toUpperCase()).addEventListener(id==='aiStrength'?'input':'change',()=>{
    const mode=$('aiMode'+key.toUpperCase()).value,changed=mode!==p.mode||$('aiStrategy'+key.toUpperCase()).value!==p.strategy;
    if(changed){if(window.replay?.active)window.replay.live();p.disable();}p.mode=mode;p.stem=mode==='vocals'?'vocals':'instrumental';p.strength=Number($('aiStrength'+key.toUpperCase()).value);p.strategy=$('aiStrategy'+key.toUpperCase()).value;
    if(vocal.armed&&running&&changed&&mode!=='off')void p.enable();if(mode==='off')vocal.releaseIfIdle();vocal.controls();vocal.applyMix();updateOffset();window.configurations?.changed();
  });
}
$('filterEnable').addEventListener('change',()=>window.configurations.setAIEnabled($('filterEnable').checked));
function saveVocalTuning(){}
$('filterPerformance').addEventListener('change',()=>{if(!vocal.active&&!vocal.loading)window.live.vocalRelease();});
vocal.controls();
