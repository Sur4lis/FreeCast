// Playback presets have an explicit allowlist. Rooms, favorites, account state,
// and platform-scoped blocked users remain in their own stores.
(()=>{
  const key='freecast-configurations-v1',select=$('configurationSelect');
  let applying=false,desiredAI=false,state={selected:'default',custom:null};
  const number=(v,min,max,fallback)=>Number.isFinite(Number(v))?clamp(Number(v),min,max):fallback;
  function builtin(voice=false){return{mix:{...defaultMix},theme:'bluepink',offset:0,base:'3',chat:0,volume:80,sourceVolumeA:100,sourceVolumeB:45,replay:0,ai:{enabled:voice,source:'b',stem:'instrumental',strength:100,mode:'game',performance:'auto'}};}
  function clean(value){
    const p=builtin(),v=value&&typeof value==='object'?value:{};
    for(const k of Object.keys(p.mix)){
      if(typeof p.mix[k]==='boolean'){if(typeof v.mix?.[k]==='boolean')p.mix[k]=v.mix[k];}
    }
    for(const k of ['qualityA','qualityB'])if(Number.isSafeInteger(v.mix?.[k])&&v.mix[k]>=0&&v.mix[k]<=1000000)p.mix[k]=v.mix[k];
    for(const k of ['danmakuColorA','danmakuColorB'])if(/^#[0-9a-f]{6}$/i.test(v.mix?.[k]))p.mix[k]=v.mix[k].toLowerCase();
    for(const [k,min,max] of [['danmakuTransparency',0,100],['danmakuSize',14,48],['danmakuSpeed',.5,2],['danmakuDensity',20,100]])p.mix[k]=number(v.mix?.[k],min,max,p.mix[k]);
    if([25,50,75,100].includes(v.mix?.danmakuArea))p.mix.danmakuArea=v.mix.danmakuArea;
    if([0,10,15,30,60,120,300].includes(v.mix?.scMaxDuration))p.mix.scMaxDuration=v.mix.scMaxDuration;
    p.mix.main=v.mix?.main==='a'?'a':'b';
    p.theme=freecastTheme.normalize(v.theme);
    p.offset=number(v.offset,-60,60,0);p.base=['3','5','8'].includes(v.base)?v.base:'3';p.chat=number(v.chat,-10,30,0);
    for(const k of ['volume','sourceVolumeA','sourceVolumeB'])p[k]=number(v[k],0,100,p[k]);
    if([0,60,180,300].includes(v.replay))p.replay=v.replay;
    p.ai.enabled=v.ai?.enabled===true;p.ai.source=v.ai?.source==='a'?'a':'b';p.ai.stem=v.ai?.stem==='vocals'?'vocals':'instrumental';
    if(v.ai?.routes){p.ai.routes={};for(const k of ['a','b']){const r=v.ai.routes[k]||{};p.ai.routes[k]={mode:['off','vocals','instrumental'].includes(r.mode)?r.mode:'off',strength:number(r.strength,0,100,100),strategy:r.strategy==='strong'?'strong':'game'};}}
    p.ai.strength=number(v.ai?.strength,0,100,100);p.ai.mode=v.ai?.mode==='strong'?'strong':'game';p.ai.performance=v.ai?.performance==='compatible'?'compatible':'auto';return p;
  }
  function capture(){return clean({mix,theme:document.documentElement.dataset.theme,offset,base:$('base').value,chat:$('chatOffset').value,volume:$('volume').value,sourceVolumeA:$('sourceVolumeA').value,sourceVolumeB:$('sourceVolumeB').value,replay:replay.seconds(),ai:{routes:vocal.settings(),enabled:desiredAI,source:vocal.sourceKey,stem:vocal.stem,strength:$('filterStrength').value,mode:$('filterMode').value,performance:$('filterPerformance').value}});}
  function persist(){localStorage.setItem(key,JSON.stringify(state));select.value=state.selected;select.querySelector('[value=custom]').disabled=!state.custom;}
  function changed(){if(applying)return;state.custom=capture();state.selected='custom';persist();}
  function connected(){
    if(!desiredAI||!running||demo||vocal.active||vocal.loading)return;
    $('filterEnable').checked=true;void vocal.enable();
  }
  function arm(){
    vocal.armed=desiredAI;vocal.controls();if(desiredAI){$('filterEnable').checked=true;if(running)connected();else $('filterStatus').textContent=vocal.label()+' · 连接直播后自动开启';}
  }
  function setAIEnabled(value){desiredAI=Boolean(value);if(desiredAI)arm();else vocal.disable();changed();}
  function apply(value,{deferConnect=false}={}){
    const p=clean(value),oldQuality={a:mix.qualityA,b:mix.qualityB},wasConnecting=Boolean(connecting);applying=true;
    try{
      if(wasConnecting)cancelConnection(false);
      if(replay.active)replay.live();vocal.disable();desiredAI=p.ai.enabled;mix={...p.mix};
      freecastTheme.set(p.theme);
      $('base').value=p.base;$('chatOffset').value=p.chat;$('volume').value=p.volume;
      for(const k of ['A','B']){
        $('sourceVolume'+k).value=p['sourceVolume'+k];localStorage.setItem('source-volume-'+k,String(p['sourceVolume'+k]));
        if(!running)renderQualities(k);
        const q=$('quality'+k),wanted=mix['quality'+k];
        if([...q.options].some(o=>Number(o.value)===wanted))q.value=String(wanted);
        else if(running){q.value=String(channels[k.toLowerCase()]?.room?.requestedQuality??q.options[0]?.value);mix['quality'+k]=Number(q.value);}
      }
      $('filterSource').value=p.ai.source;$('filterStem').value=p.ai.stem;$('filterStrength').value=p.ai.strength;$('filterMode').value=p.ai.mode;$('filterPerformance').value=p.ai.performance;
      localStorage.setItem('freecast-ai-performance',p.ai.performance);vocal.configure();vocal.restore(p.ai.routes||{[p.ai.source]:{mode:p.ai.stem,strength:p.ai.strength,strategy:p.ai.mode}});saveVocalTuning();
      vocal.armed=desiredAI;vocal.controls();replay.setSeconds(p.replay);applyMix();updateOffset(p.offset);danmakuStyle.apply();superChats.tick();
      if(!deferConnect&&(wasConnecting||(running&&!demo&&(oldQuality.a!==mix.qualityA||oldQuality.b!==mix.qualityB))))void connect();else if(!deferConnect)arm();
      save();
    }finally{applying=false;}
  }
  try{
    const saved=JSON.parse(localStorage.getItem(key)||'null');
    if(saved&&['default','voice','custom'].includes(saved.selected)){state={selected:saved.selected,custom:saved.custom?clean(saved.custom):null};if(state.selected==='custom'&&!state.custom)state.selected='default';}
    else if(hadSavedPlayerSettings){state.custom=capture();state.selected='custom';}
  }catch{if(hadSavedPlayerSettings){state.custom=capture();state.selected='custom';}}
  window.configurations={changed,connected,setAIEnabled,capture,apply:(p,options)=>{apply(p,options);changed();}};
  apply(state.selected==='custom'?state.custom:builtin(state.selected==='voice'));persist();
  select.addEventListener('change',()=>{if(select.value==='custom'&&!state.custom)return;state.selected=select.value;apply(state.selected==='custom'?state.custom:builtin(state.selected==='voice'));persist();});
  const settings=new Set(['themeSelect','volume','sourceVolumeA','sourceVolumeB','audioToggleA','audioToggleB','videoToggleA','videoToggleB','chatToggleA','chatToggleB','qualityA','qualityB','mainQuality','showChat','showSC','danmakuTransparency','danmakuSize','danmakuSpeed','danmakuDensity','danmakuArea','danmakuSourceColors','danmakuPlatformColors','danmakuColorA','danmakuColorB','scMaxDuration','offset','offsetValue','base','chatOffset','replayCache','filterSource','filterStem','filterStrength','filterMode','filterPerformance']);
  for(const type of ['input','change'])document.addEventListener(type,event=>{if(settings.has(event.target.id))changed();});
  document.addEventListener('click',event=>{if(event.target.closest('[data-step],#mute,#swapView,#reset,#resetDanmakuStyle'))changed();});
  $('offsetValue').addEventListener('keydown',event=>{if(event.key==='Enter')changed();});
})();
