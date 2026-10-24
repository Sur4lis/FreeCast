(()=>{
  const keys=['a','b'],slider=$('replayPosition'),select=$('replayCache'),history={a:new ReplayCore.History(),b:new ReplayCore.History()};
  let seconds=0;try{const saved=Number(localStorage.getItem('freecast-replay-seconds'));if([0,60,180,300].includes(saved))seconds=saved;}catch{}
  let dragging=false,lastUI=0,anchor={},cursors={},startedAt=performance.now();
  const ranges=media=>Array.from({length:media.buffered.length},(_,i)=>[media.buffered.start(i),media.buffered.end(i)]);
  const clock=value=>`${Math.floor(Math.max(0,value)/60)}:${String(Math.floor(Math.max(0,value)%60)).padStart(2,'0')}`;
  const replay=window.replay={active:false,rate:1,seconds:()=>seconds,history,
    bufferSeconds:()=>seconds?seconds+90:150,
    setSeconds(n){if(![0,60,180,300].includes(n))return;if(this.active)this.live();const was=seconds;seconds=n;if(!was)startedAt=performance.now();localStorage.setItem('freecast-replay-seconds',String(n));for(const c of Object.values(channels)){this.configure(c);window.mediaBuffers?.trim(c,true);}if(!n){for(const h of Object.values(history))h.clear();window.vocal?.clearReplay();}else if(n<was){window.vocal?.pruneReplay?.();}this.render(true);},
    targets(now=performance.now()){
      const d=getDelays();return Object.fromEntries(keys.map(k=>{
        const pipe=window.vocal?.pipes?.[k],clock=pipe?.active?Sync.playoutTarget(pipe.feedPlayout,now,d[k]-pipe.delay):Sync.playoutTarget(channels[k]?.playout,now,d[k]);
        const target=clock===null?(channels[k]?.edge?.(now)==null?null:channels[k].edge(now)-d[k]):clock-(pipe?.active?pipe.delay:0);
        return [k,target===null?null:target+pauseLag];
      }));
    },
    available(){
      if(!seconds||!running||keys.some(k=>!channels[k]))return [];
      const target=this.targets(),limit=Math.min(seconds,(performance.now()-startedAt)/1000);
      if(keys.some(k=>target[k]===null))return [];
      let both=ReplayCore.intersect(...keys.map(k=>ReplayCore.lagRanges(ranges(channels[k].media),target[k],limit)));
      for(const p of Object.values(window.vocal?.pipes||{}).filter(p=>p.active))both=ReplayCore.intersect(both,ReplayCore.lagRanges(p.replayRanges(),target[p.sourceKey],limit));
      return both;
    },
    remember(message,at){history[message.source==='b'?'b':'a'].add(message,at,seconds);},
    currentLag(){const target=this.targets();return target.b===null?0:Math.max(0,target.b-channels.b.media.currentTime);},
    remove(source,ids){history[source].remove(ids);},
    clearSource(key,resetPlayback=true){history[key].clear();if(resetPlayback&&this.active)this.live();},
    reset(){this.active=false;this.rate=1;anchor={};cursors={};startedAt=performance.now();for(const h of Object.values(history))h.clear();window.vocal?.clearReplay();this.render(true);},
    configure(channel){
      if(window.mediaBuffers){window.mediaBuffers.configure(channel);return;}
      const retain=this.bufferSeconds();
      if(channel.engine instanceof Hls){Object.assign(channel.engine.config,{backBufferLength:retain,maxBufferLength:retain,maxMaxBufferLength:retain,maxBufferSize:Math.max(160,retain*2)*1000000});}
      else {const config=channel.engine?._player_engine?._mse_controller?._config;if(config){config.autoCleanupMaxBackwardDuration=retain;config.autoCleanupMinBackwardDuration=retain-10;}}
    },
    seek(lag){
      const value=ReplayCore.nearest(lag,this.available());if(value===null){notice('两路回看缓存尚未就绪');return false;}
      if(lag<.25){this.live();return true;}
      const target=this.targets();this.active=true;pauseLag=0;anchor={};
      for(const k of keys){const media=channels[k].media;anchor[k]=target[k]-value;media.currentTime=anchor[k];media.playbackRate=this.rate;}
      window.vocal?.seekReplay();this.restoreChat();this.render(true);return true;
    },
    capturePause(){
      if(!seconds||this.active||keys.some(k=>!channels[k])||!this.available().length)return;
      this.active=true;anchor=Object.fromEntries(keys.map(k=>[k,channels[k].media.currentTime]));cursors={...anchor};window.vocal?.seekReplay();this.render(true);
    },
    restoreChat(){window.chatRules?.reset();
      $('chatList').replaceChildren();$('danmaku').replaceChildren();window.superChats?.clear();
      const adjustment=Number($('chatOffset').value)||0,rows=[];
      for(const k of keys){cursors[k]=channels[k].media.currentTime;if(mix['chat'+k.toUpperCase()])rows.push(...history[k].at(cursors[k],adjustment,mix.scMaxDuration));}
      rows.sort((a,b)=>(a.at-cursors[a.source||'a'])-(b.at-cursors[b.source||'a']));
      for(const m of [...rows.filter(m=>m.type!=='superchat').slice(-178),...rows.filter(m=>m.type==='superchat').slice(-2)])showMessage(m,true);window.superChats?.tick();
    },
    showChat(){
      const adjustment=Number($('chatOffset').value)||0;
      for(const k of keys){const media=channels[k].media;if(media.paused||media.seeking)continue;const time=media.currentTime,from=cursors[k]??time;cursors[k]=time;
        if(time<from-.2){this.restoreChat();return;}
        if(mix['chat'+k.toUpperCase()]){const messages=history[k].since(from,time,adjustment);messages.filter(m=>m.type==='superchat').forEach(m=>showMessage(m));messages.filter(m=>m.type!=='superchat').slice(-12).forEach(m=>showMessage(m));}
      }
    },
    live(){
      this.active=false;this.rate=1;pauseLag=0;paused=false;$('pause').textContent='暂停';$('player').classList.remove('paused');
      window.vocal?.endReplay();
      const target=this.targets();
      for(const k of keys){const c=channels[k];if(!c)continue;c.media.playbackRate=1;const point=target[k];if(point!==null&&ranges(c.media).some(([a,b])=>point>=a+.05&&point<=b-.05))c.media.currentTime=point;}
      if(running&&keys.every(k=>channels[k])){this.restoreChat();const adjustment=Number($('chatOffset').value)||0;for(const k of keys)(k==='a'?queue:queueB).take(channels[k].media.currentTime,adjustment);}
      this.render(true);
    },
    step(){
      if(!this.active)return false;
      const allowed=this.available(),target=this.targets(),b=channels.b.media,lag=target.b-b.currentTime;
      const inside=allowed.some(([lo,hi])=>lag>=lo-.4&&lag<=hi+.4);
      if(!inside){if(!allowed.length){this.live();notice('回看缓存已失效，已返回直播');return false;}const next=ReplayCore.nearest(lag,allowed);if(!paused&&lag<.5){this.live();return false;}this.seek(next);notice('较早缓存已清理，已移到可回看的位置');}
      if(paused){for(const k of keys)channels[k].media.pause();window.vocal?.replayTick(this.rate,true);this.render();return true;}
      const a=channels.a.media;
      const waiting=keys.some(k=>{const c=channels[k];return c.error||c.media.readyState<3||c.media.seeking;});
      if(waiting){a.pause();b.pause();window.vocal?.replayTick(this.rate,true);$('playStatus').textContent='回看缓冲中…';this.render();return true;}
      const expected=anchor.a+b.currentTime-anchor.b,difference=expected-a.currentTime;
      if(Math.abs(difference)>.4)a.currentTime=expected;
      a.playbackRate=this.rate*clamp(1+difference*.08,.97,1.03);b.playbackRate=this.rate;
      for(const media of [a,b])if(media.paused)media.play().catch(()=>notice('请点击继续播放',true));
      window.vocal?.replayTick(this.rate,false);this.showChat();window.superChats?.tick();
      if(lag<=.3){this.live();return false;}
      $('playStatus').textContent=`回看 · ${this.rate}× · 落后 ${clock(lag)}`;this.render();return true;
    },
    render(force=false){
      const now=performance.now();if(!force&&now-lastUI<250)return;lastUI=now;
      const allowed=this.available(),max=allowed.length?Math.max(...allowed.map(x=>x[1])):0,target=this.targets(),lag=this.active&&target.b!==null?Math.max(0,target.b-(channels.b?.media.currentTime||0)):0;
      select.value=String(seconds);slider.disabled=max<.5;slider.min=String(-max);slider.max='0';
      if(!dragging)slider.value=String(-Math.min(max,lag));
      slider.setAttribute('aria-valuetext',lag?`回看 ${clock(lag)} 前`:'直播位置');
      $('replayRange').textContent=seconds?`可回看 ${clock(max)}`:'回看已关闭';
      if(!dragging)$('replayTime').textContent=this.active?`−${clock(lag)}`:'直播';
      $('replaySpeed').disabled=!this.active;$('replaySpeed').value=String(this.rate);$('returnLive').disabled=!running||(!this.active&&!paused&&pauseLag===0);
      $('replaySpeed').title=window.vocal?.active?'AI 处理声音在倍速回看时会随速度变调':'仅在回看时调整速度，追上后恢复正常直播';
      $('replayBack').disabled=max<.5;
      $('replayControls').classList.toggle('replaying',this.active);
      for(const k of keys)if(target[k]!==null)history[k].prune(target[k]-seconds-90);
    }
  };
  select.addEventListener('change',()=>replay.setSeconds(Number(select.value)));
  slider.addEventListener('input',()=>{dragging=true;$('replayTime').textContent='−'+clock(-Number(slider.value));});
  slider.addEventListener('change',()=>{dragging=false;replay.seek(-Number(slider.value));});slider.addEventListener('pointercancel',()=>{dragging=false;replay.render(true);});
  $('replayBack').addEventListener('click',()=>{const target=replay.targets();replay.seek((replay.active&&target.b!==null?target.b-channels.b.media.currentTime:0)+10);});
  $('returnLive').addEventListener('click',()=>replay.live());
  $('replaySpeed').addEventListener('change',()=>{if(!replay.active)return;replay.rate=Number($('replaySpeed').value);window.vocal?.seekReplay();replay.render(true);});
  replay.render(true);
})();
