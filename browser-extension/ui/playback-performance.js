(()=>{
  const storageKey='freecast-render-mode-v1',root=document.documentElement;
  const limited=(Number(navigator.hardwareConcurrency)>0&&navigator.hardwareConcurrency<=2)||(Number(navigator.deviceMemory)>0&&navigator.deviceMemory<=4);
  let mode='auto';try{const saved=localStorage.getItem(storageKey);if(['auto','smooth','full'].includes(saved))mode=saved;}catch{}
  const select=document.createElement('select');select.id='renderMode';select.setAttribute('aria-label','显示性能');
  for(const [value,text] of [['auto','自动'],['smooth','流畅'],['full','完整']])select.add(new Option(text,value));
  const label=document.createElement('label');label.textContent='显示 ';label.title='流畅模式减少装饰、模糊与播放缓存开销，保留画质、弹幕和已选择的回看时长。';label.append(select);
  $('stop').before(label);
  const smooth=()=>mode==='smooth'||mode==='auto'&&limited;
  function apply(){select.value=mode;root.classList.toggle('smooth-playback',smooth());window.dispatchEvent(new Event('freecast-render-mode-change'));for(const channel of Object.values(channels))window.mediaBuffers?.trim(channel,true);}
  select.addEventListener('change',()=>{mode=select.value;try{localStorage.setItem(storageKey,mode);}catch{}apply();});
  let frame=0,lastFrame=0,windowStart=0,frames=0,slow=0,stallMs=0,strikes=0,protectedRender=false,quality=null,lastSample=null,overloaded;
  if(window.live.vocalInit)import('../ai/performance.mjs').then(module=>{overloaded=module.renderingOverloaded;}).catch(()=>{});
  const eligible=()=>viewMode==='full'&&window.vocal?.active&&!paused&&!document.hidden;
  function videoQuality(){const media=$('mainSlot').querySelector('video'),q=media?.getVideoPlaybackQuality?.();return q?{media,total:q.totalVideoFrames,dropped:q.droppedVideoFrames}:null;}
  function reset(){cancelAnimationFrame(frame);frame=0;lastFrame=windowStart=frames=slow=stallMs=strikes=0;quality=null;protectedRender=false;root.classList.remove('ai-render-protection');}
  function monitor(now){
    frame=0;if(!eligible()){reset();return;}
    if(!windowStart){windowStart=now;quality=videoQuality();}
    if(lastFrame){frames++;if(now-lastFrame>50){slow++;stallMs+=now-lastFrame-50;}}lastFrame=now;
    // A window spans a full audio block so periodic GPU bursts cannot fall between samples.
    if(now-windowStart>=6000){
      const q=videoQuality(),same=q&&quality&&q.media===quality.media;
      const sample={frames,slow,stallMs,elapsedMs:now-windowStart,total:same?Math.max(0,q.total-quality.total):0,dropped:same?Math.max(0,q.dropped-quality.dropped):0};
      lastSample=sample;strikes=overloaded?.(sample)?strikes+1:0;
      if(strikes>=2){protectedRender=true;root.classList.add('ai-render-protection');}
      quality=q;windowStart=now;frames=slow=stallMs=0;
    }
    frame=requestAnimationFrame(monitor);
  }
  function refresh(){if(!eligible())reset();else if(!frame)frame=requestAnimationFrame(monitor);}
  document.addEventListener('visibilitychange',refresh);
  window.addEventListener('pagehide',reset);
  window.playbackPerformance={smooth,mode:()=>mode,refresh,aiScheduling:()=>({renderPriority:eligible(),renderPressure:eligible()&&protectedRender}),rendering:()=>({protected:protectedRender,sample:lastSample})};apply();
})();
