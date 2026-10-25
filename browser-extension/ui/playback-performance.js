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
  window.playbackPerformance={smooth,mode:()=>mode};apply();
})();
