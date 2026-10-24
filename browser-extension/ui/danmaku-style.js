// Appearance changes affect the video overlay only; receiving/sending stays unchanged.
(()=>{
  const button=$('danmakuSettingsButton'),panel=$('danmakuSettings'),overlay=$('danmaku');
  function layout(){
    window.danmakuLayout?.layout();
    const controls=document.querySelector('.player-bottom'),bottom=controls.parentElement===$('player')?Math.ceil(controls.getBoundingClientRect().height+12):12;
    const rect=$('player').getBoundingClientRect();
    panel.style.bottom=bottom+'px';panel.style.maxHeight=Math.max(60,rect.bottom-bottom-Math.max(12,rect.top+12))+'px';
  }
  function apply(){
    overlay.style.opacity=String(1-mix.danmakuTransparency/100);
    overlay.style.setProperty('--danmaku-font-size',mix.danmakuSize+'px');
    $('superChatOverlay').style.opacity='1';
    $('danmakuDensity').value=mix.danmakuDensity;$('danmakuDensityValue').value=mix.danmakuDensity+'%';$('danmakuArea').value=String(mix.danmakuArea);
    $('showSC').checked=mix.showSC;$('scMaxDuration').value=String(mix.scMaxDuration);
    $('danmakuTransparency').value=mix.danmakuTransparency;$('danmakuTransparencyValue').value=mix.danmakuTransparency+'%';
    $('danmakuSize').value=mix.danmakuSize;$('danmakuSizeValue').value=mix.danmakuSize+' px';
    $('danmakuSpeed').value=mix.danmakuSpeed;$('danmakuSpeedValue').value=mix.danmakuSpeed.toFixed(1)+'×';
    for(const bullet of overlay.children)window.danmakuLayout?.speed(bullet);
    layout();
  }
  function open(enabled,restoreFocus=false){panel.hidden=!enabled;button.setAttribute('aria-expanded',String(enabled));if(enabled){layout();$('closeDanmakuSettings').focus();}else if(restoreFocus)button.focus();}
  button.addEventListener('click',()=>open(panel.hidden));
  $('closeDanmakuSettings').addEventListener('click',()=>open(false,true));
  for(const [id,min,max] of [['danmakuTransparency',0,100],['danmakuSize',14,48]])$(id).addEventListener('input',event=>{const value=Number(event.target.value);if(!Number.isFinite(value))return;mix[id]=clamp(Math.round(value),min,max);apply();save();});
  $('danmakuSpeed').addEventListener('input',event=>{const value=Number(event.target.value);if(!Number.isFinite(value))return;mix.danmakuSpeed=clamp(Math.round(value*10)/10,.5,2);apply();save();});
  $('danmakuDensity').addEventListener('input',event=>{const n=Number(event.target.value);if(!Number.isFinite(n))return;mix.danmakuDensity=clamp(Math.round(n),20,100);apply();save();});
  $('danmakuArea').addEventListener('change',()=>{mix.danmakuArea=Number($('danmakuArea').value);apply();save();});
  $('resetDanmakuStyle').addEventListener('click',()=>{for(const key of ['danmakuTransparency','danmakuSize','danmakuSpeed','scMaxDuration','danmakuDensity','danmakuArea'])mix[key]=defaultMix[key];apply();window.superChats?.tick();save();});
  $('scMaxDuration').addEventListener('change',()=>{mix.scMaxDuration=Number($('scMaxDuration').value);window.superChats?.tick();save();});
  $('showSC').addEventListener('change',()=>{mix.showSC=$('showSC').checked;window.superChats?.tick();save();});
  document.addEventListener('pointerdown',event=>{if(!panel.hidden&&!panel.contains(event.target)&&!button.contains(event.target))open(false);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden&&!document.querySelector('dialog[open]')){event.preventDefault();event.stopImmediatePropagation();open(false,true);}},true);
  const observer=new ResizeObserver(layout);observer.observe($('player'));observer.observe(document.querySelector('.player-bottom'));observer.observe(overlay);
  window.addEventListener('scroll',layout,{passive:true});window.addEventListener('resize',layout,{passive:true});
  window.danmakuStyle={apply};apply();
})();
