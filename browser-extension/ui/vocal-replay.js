// Retain already-filtered audio. Replay does not run inference at the selected speed.
for(const vocal of Object.values(window.vocal.pipes)){
  let blocks=[],serial=0,origin=null;const nodes=new Set(),scheduled=new Set();
  function stopNodes(){for(const n of nodes){try{n.stop();}catch{}n.onended?.();}nodes.clear();scheduled.clear();origin=null;}
  const bytes=()=>blocks.reduce((n,b)=>n+b.buffer.length*b.buffer.numberOfChannels*4,0);
  Object.assign(vocal,{
    rememberReplay(buffer,start){
      const seconds=window.replay?.seconds();if(!seconds)return;
      // A feed seek can reprocess the same timestamps. Keep one generation of audio there.
      if(blocks.length&&start<blocks.at(-1).end-this.overlap/this.rate-.1){blocks=blocks.filter(b=>b.end<=start);stopNodes();}
      blocks.push({buffer,start,end:start+buffer.duration,id:++serial});
      this.pruneReplay();
    },
    pruneReplay(){
      const seconds=window.replay?.seconds()||0;if(!seconds){this.clearReplay();return;}
      const last=blocks.at(-1);if(last)blocks=blocks.filter(b=>b.end>last.start-seconds-15).slice(-70);
      let size=bytes();while(blocks.length&&size>128*1024*1024){const b=blocks.shift();size-=b.buffer.length*b.buffer.numberOfChannels*4;}
    },
    replayBytes(){return bytes();},
    replayRanges(){
      const result=[];for(const b of blocks){const last=result.at(-1);if(last&&b.start<=last[1]+.05)last[1]=Math.max(last[1],b.end);else result.push([b.start,b.end]);}return result;
    },
    clearReplay(){stopNodes();blocks=[];if(this.replayGain)this.replayGain.gain.value=0;},
    seekReplay(){stopNodes();this.applyMix();},
    endReplay(){stopNodes();this.applyMix();},
    replayTick(rate,hold){
      if(!this.active||!this.ctx)return;
      if(hold){stopNodes();return;}
      if(!this.replayGain){this.replayGain=this.ctx.createGain();this.replayGain.connect(this.output);this.applyMix();}
      const now=this.ctx.currentTime,position=this.media().currentTime;
      if(origin&&Math.abs(origin.media+(now-origin.time)*rate-position)>.2)stopNodes();
      if(!origin)origin={media:position,time:now};
      const fade=this.overlap/this.rate;
      for(const b of blocks){
        if(scheduled.has(b.id)||b.end<=position||b.start>position+rate)continue;
        const when=origin.time+(b.start-origin.media)/rate,start=Math.max(now+.005,when),offset=(start-when)*rate;
        if(offset>=b.buffer.duration)continue;
        const node=this.ctx.createBufferSource(),gain=this.ctx.createGain(),end=when+b.buffer.duration/rate;
        node.buffer=b.buffer;node.playbackRate.value=rate;node.connect(gain);gain.connect(this.replayGain);
        gain.gain.setValueAtTime(Math.max(0,Math.min(1,offset/fade,(b.buffer.duration-offset)/fade)),start);
        if(start<when+fade/rate)gain.gain.linearRampToValueAtTime(1,when+fade/rate);
        if(start<end-fade/rate)gain.gain.setValueAtTime(1,end-fade/rate);
        gain.gain.linearRampToValueAtTime(0,end);
        nodes.add(node);scheduled.add(b.id);node.onended=()=>{nodes.delete(node);node.disconnect();gain.disconnect();node.buffer=null;node.onended=null;};node.start(start,offset);
      }
    }
  });
  const detach=vocal.detachMirror.bind(vocal);vocal.detachMirror=function(key=this.sourceKey){if(key===this.sourceKey)this.clearReplay();detach(key);};
  const disable=vocal.disable.bind(vocal);vocal.disable=function(){if(window.replay?.active)window.replay.live();this.clearReplay();disable();};
  const fail=vocal.fail.bind(vocal);vocal.fail=function(error){if(window.replay?.active)window.replay.live();this.clearReplay();fail(error);};
}
