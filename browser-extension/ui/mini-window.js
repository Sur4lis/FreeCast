(()=>{
  const panel=$('miniPanel'),slot=$('miniSlot'),header=panel.querySelector('.mini-heading');
  const full=()=>({enabled:false,x:0,y:0,w:1,h:1}),crops={a:full(),b:full()};
  let saved,legacy={},drag,editing=false,clean=false,draft=null,editSource,editHome,lastKey;
  const key=()=>slot.querySelector('video')?.id==='audioA'?'a':'b';
  function validCrop(s){return s&&['x','y','w','h'].every(k=>Number.isFinite(s[k]))&&s.w>=1/8192&&s.h>=1/8192&&s.x>=0&&s.y>=0&&s.x+s.w<=1.000001&&s.y+s.h<=1.000001;}
  try{saved=JSON.parse(localStorage.getItem('mini-window-v1'));const stored=JSON.parse(localStorage.getItem('freecast-mini-crop-v2'));legacy=JSON.parse(localStorage.getItem('freecast-mini-crop-v1'))||{};for(const k of ['a','b'])if(validCrop(stored?.[k])){crops[k]={...stored[k],enabled:stored[k].enabled===true};delete legacy[k];}}catch{}
  const rect=()=>{const r=panel.getBoundingClientRect();return{left:r.left,top:r.top,width:r.width,height:r.height};};
  const video=()=>slot.querySelector('video');
  const dimensions=v=>({w:v?.videoWidth||16,h:v?.videoHeight||9});
  const ratio=()=>{const d=dimensions(video()),s=!editing&&crops[key()].enabled?crops[key()]:full();return d.w*s.w/(d.h*s.h);};
  const edges=()=>{const style=getComputedStyle(panel);return{x:parseFloat(style.borderLeftWidth)+parseFloat(style.borderRightWidth),y:parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth)};};
  const furniture=()=>edges().y+[header,panel.querySelector('.mini-timeline'),$('miniTools')].reduce((n,el)=>n+el.offsetHeight,0);
  function apply(r){const w=clamp(r.width,1,innerWidth-16),h=clamp(r.height,1,innerHeight-16);Object.assign(panel.style,{left:clamp(r.left,8,Math.max(8,innerWidth-w-8))+'px',top:clamp(r.top,8,Math.max(8,innerHeight-h-8))+'px',width:w+'px',height:h+'px',right:'auto',bottom:'auto'});refresh();}
  function sized(r,width=r.width){const border=edges().x,chrome=furniture(),aspect=ratio(),maxWidth=Math.max(1,Math.min(innerWidth-16-border,(innerHeight-16-chrome)*aspect));const minWidth=Math.min(maxWidth,Math.max(clean?64:300,24*aspect));const contentWidth=clamp(width-border,minWidth,maxWidth);return {...r,width:contentWidth+border,height:contentWidth/aspect+chrome};}
  function persist(){if(panel.classList.contains('enlarged')){saved=rect();localStorage.setItem('mini-window-v1',JSON.stringify(saved));}localStorage.setItem('freecast-mini-crop-v2',JSON.stringify(crops));}
  function clearVideo(v){if(v.dataset.cropped){v.removeAttribute('style');delete v.dataset.cropped;}}
  function migrate(v,k){const old=legacy[k];if(!old||!v.videoWidth)return;delete legacy[k];if(old.enabled){const d=dimensions(v),w=saved?.width||slot.clientWidth||320,h=Math.max(1,(saved?.height||slot.clientHeight+76)-76),scale=Math.max(w/d.w,h/d.h)*clamp(Number(old.scale)||1,1,8),cw=clamp(w/(d.w*scale),.0001,1),ch=clamp(h/(d.h*scale),.0001,1);crops[k]={enabled:true,x:(1-cw)*clamp(Number(old.x)||0,0,1),y:(1-ch)*clamp(Number(old.y)||0,0,1),w:cw,h:ch};localStorage.setItem('freecast-mini-crop-v2',JSON.stringify(crops));}}
  const editor=document.createElement('div');editor.id='miniCropEditor';editor.hidden=true;editor.tabIndex=-1;editor.setAttribute('aria-label','在画面上拖动框选保留区域');
  const selection=document.createElement('div');selection.id='miniCropSelection';selection.tabIndex=0;selection.setAttribute('role','button');selection.setAttribute('aria-label','裁剪选区，可拖动或用方向键移动，Enter 完成，Esc 取消');editor.append(selection);slot.append(editor);
  for(const dir of ['n','s','e','w','ne','nw','se','sw']){const h=document.createElement('span');h.dataset.cropHandle=dir;h.className='crop-handle '+dir;h.setAttribute('aria-hidden','true');selection.append(h);}
  function paintSelection(){selection.hidden=!draft;if(draft)Object.assign(selection.style,{left:draft.x*100+'%',top:draft.y*100+'%',width:draft.w*100+'%',height:draft.h*100+'%'});}
  function refresh(){
    const k=key();if(editing&&k!==editSource)cancelEditing(false);
    for(const v of [$('audioA'),$('videoB')]){if(v.parentElement!==slot){clearVideo(v);continue;}migrate(v,k);const s=crops[k];if(editing||!s.enabled){clearVideo(v);continue;}
      const d=dimensions(v),w=slot.clientWidth,h=slot.clientHeight,scale=Math.min(w/(d.w*s.w),h/(d.h*s.h)),vw=d.w*scale,vh=d.h*scale;
      v.dataset.cropped='true';Object.assign(v.style,{position:'absolute',inset:'auto',width:vw+'px',height:vh+'px',left:((w-vw*s.w)/2-vw*s.x)+'px',top:((h-vh*s.h)/2-vh*s.y)+'px',maxWidth:'none',maxHeight:'none',minWidth:vw+'px',minHeight:vh+'px',objectFit:'fill',clipPath:`inset(${s.y*100}% ${Math.max(0,1-s.x-s.w)*100}% ${Math.max(0,1-s.y-s.h)*100}% ${s.x*100}%)`});
    }
    slot.style.setProperty('--mini-aspect',String(ratio()));
    if(editing){const d=dimensions(video()),scale=Math.min(slot.clientWidth/d.w,slot.clientHeight/d.h),w=d.w*scale,h=d.h*scale;Object.assign(editor.style,{left:(slot.clientWidth-w)/2+'px',top:(slot.clientHeight-h)/2+'px',width:w+'px',height:h+'px'});paintSelection();}
    if(lastKey&&lastKey!==k&&panel.classList.contains('enlarged')&&!editing){lastKey=k;apply(sized(rect()));}lastKey=k;
  }
  function editFlag(value){editing=value;panel.classList.toggle('mini-cropping',value);editor.hidden=!value;$('miniTools').hidden=!value;$('cropMini').setAttribute('aria-pressed',String(value));$('cropMini').textContent=value?'取消':'裁切画面';if(!value){drag=null;panel.classList.remove('moving');}}
  function cleanFlag(value){clean=value;panel.classList.toggle('mini-clean',value);$('restoreMiniUI').hidden=!value;$('cleanMini').setAttribute('aria-pressed',String(value));}
  function cancelEditing(restore=true){if(!editing)return;const home=editHome;editFlag(false);draft=null;editHome=null;if(restore&&home){setMiniZoom(home.enlarged);cleanFlag(home.clean);if(home.enlarged)apply(sized(home.rect));}refresh();}
  function beginEditing(){
    if(editing){cancelEditing();return;}
    editHome={rect:rect(),enlarged:panel.classList.contains('enlarged'),clean};editSource=key();draft=crops[editSource].enabled?{...crops[editSource]}:null;
    if(!panel.classList.contains('enlarged'))setMiniZoom(true);cleanFlag(false);editFlag(true);
    const r=sized({left:8,top:8,width:Math.min(1200,innerWidth*.88)},Math.min(1200,innerWidth*.88));r.left=(innerWidth-r.width)/2;r.top=(innerHeight-r.height)/2;apply(r);editor.focus();window.playerUI?.wake();
  }
  function finishEditing(){if(!editing)return;const home=editHome,s=draft||full();crops[editSource]={...s,enabled:s.w<.999999||s.h<.999999};editFlag(false);draft=null;editHome=null;cleanFlag(true);const width=home?.enlarged?home.rect.width:Math.max(280,home?.rect.width||320);apply(sized(home?.rect||rect(),width));persist();}
  function setClean(value){if(editing){if(value)finishEditing();else cancelEditing();return;}if(value&&!panel.classList.contains('enlarged'))setMiniZoom(true);const r=rect();cleanFlag(value);if(panel.classList.contains('enlarged'))apply(sized(r));persist();refresh();}
  window.miniWindow={
    zoom(enabled){if(editing)cancelEditing(false);if(enabled){const valid=saved&&['left','top','width','height'].every(k=>Number.isFinite(saved[k]));apply(sized(valid?saved:rect()));}else{cleanFlag(false);panel.removeAttribute('style');refresh();}},
    fit(){if(panel.classList.contains('enlarged'))apply(sized(rect()));},refresh,setClean,
    crop(v){if(editing||v?.parentElement!==slot)return null;const s=crops[v.id==='audioA'?'a':'b'];return s.enabled?{...s}:null;}
  };
  for(const dir of ['n','s','e','w','ne','nw','se','sw']){const h=document.createElement('div');h.className='mini-resize '+dir;h.dataset.resize=dir;h.setAttribute('aria-hidden','true');panel.append(h);}
  function point(event){const r=editor.getBoundingClientRect();return{x:clamp((event.clientX-r.left)/Math.max(1,r.width),0,1),y:clamp((event.clientY-r.top)/Math.max(1,r.height),0,1)};}
  panel.addEventListener('pointerdown',event=>{
    if(!panel.classList.contains('enlarged')||event.button!==0)return;
    if(editing&&editor.contains(event.target)){
      event.preventDefault();getSelection()?.removeAllRanges();const p=point(event),handle=event.target.closest('[data-crop-handle]'),move=!handle&&draft&&selection.contains(event.target);drag={id:event.pointerId,kind:'crop',start:p,dir:handle?.dataset.cropHandle||'',move,crop:draft?{...draft}:null};if(!move&&!handle)draft={x:p.x,y:p.y,w:0,h:0};panel.setPointerCapture(event.pointerId);panel.classList.add('moving');paintSelection();return;
    }
    const handle=event.target.closest('[data-resize]'),move=(clean||header.contains(event.target))&&!event.target.closest('button,input');if(!handle&&!move)return;
    event.preventDefault();getSelection()?.removeAllRanges();drag={id:event.pointerId,kind:'window',x:event.clientX,y:event.clientY,rect:rect(),dir:handle?.dataset.resize||''};panel.setPointerCapture(event.pointerId);panel.classList.add('moving');
  });
  panel.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    if(drag.kind==='crop'){
      const p=point(event),start=drag.start,d=drag.dir,s=drag.crop,dims=dimensions(video()),minW=Math.min(1,8/dims.w),minH=Math.min(1,8/dims.h);
      if(drag.move){draft={...s,x:clamp(s.x+p.x-start.x,0,1-s.w),y:clamp(s.y+p.y-start.y,0,1-s.h)};}
      else if(d){let left=s.x,right=s.x+s.w,top=s.y,bottom=s.y+s.h;if(d.includes('w'))left=clamp(p.x,0,right-minW);if(d.includes('e'))right=clamp(p.x,left+minW,1);if(d.includes('n'))top=clamp(p.y,0,bottom-minH);if(d.includes('s'))bottom=clamp(p.y,top+minH,1);draft={x:left,y:top,w:right-left,h:bottom-top};}
      else{draft={x:Math.min(start.x,p.x),y:Math.min(start.y,p.y),w:Math.abs(p.x-start.x),h:Math.abs(p.y-start.y)};}paintSelection();return;
    }
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y,r={...drag.rect},d=drag.dir;
    if(!d){r.left+=dx;r.top+=dy;apply(r);return;}
    const aspect=ratio(),horizontal=d.includes('e')?dx:d.includes('w')?-dx:0,vertical=d.includes('s')?dy:d.includes('n')?-dy:0;
    const delta=d==='n'||d==='s'?vertical*aspect:d==='e'||d==='w'?horizontal:Math.abs(horizontal)>Math.abs(vertical*aspect)?horizontal:vertical*aspect;
    const next=sized(r,r.width+delta);if(d.includes('w'))next.left=r.left+r.width-next.width;if(d.includes('n'))next.top=r.top+r.height-next.height;apply(next);
  });
  function end(event){if(!drag||event&&event.pointerId!==drag.id)return;if(drag.kind==='crop'){const d=dimensions(video());if(draft&&(draft.w<8/d.w||draft.h<8/d.h))draft=drag.crop;paintSelection();}const id=drag.id;drag=null;panel.classList.remove('moving');if(panel.hasPointerCapture(id))panel.releasePointerCapture(id);if(!editing)persist();else if(draft)selection.focus({preventScroll:true});}
  for(const type of ['pointerup','pointercancel','lostpointercapture'])panel.addEventListener(type,end);
  $('cropMini').addEventListener('click',beginEditing);$('miniCropReset').addEventListener('click',()=>{draft=null;paintSelection();});$('miniCropDone').addEventListener('click',finishEditing);$('cleanMini').addEventListener('click',()=>setClean(true));$('restoreMiniUI').addEventListener('click',()=>setClean(false));
  panel.addEventListener('dblclick',event=>{if(editing){event.preventDefault();event.stopImmediatePropagation();return;}if(clean&&!event.target.closest('button,input')){event.preventDefault();event.stopImmediatePropagation();setClean(false);}},true);
  panel.addEventListener('keydown',event=>{if(!editing||event.isComposing)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancelEditing();return;}if(event.target!==selection)return;if(event.key==='Enter'){event.preventDefault();event.stopPropagation();finishEditing();}if(draft&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();event.stopPropagation();const d=dimensions(video()),step=event.shiftKey?10:1;draft.x=clamp(draft.x+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0)/d.w,0,1-draft.w);draft.y=clamp(draft.y+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0)/d.h,0,1-draft.h);paintSelection();}},true);
  for(const v of [$('audioA'),$('videoB')])for(const type of ['loadedmetadata','resize'])v.addEventListener(type,()=>{refresh();window.miniWindow.fit();});
  new ResizeObserver(refresh).observe(slot);new MutationObserver(refresh).observe(slot,{childList:true});window.addEventListener('resize',()=>window.miniWindow.fit());
  panel.addEventListener('dragstart',event=>event.preventDefault());panel.addEventListener('selectstart',event=>{if(!event.target.closest('input,textarea'))event.preventDefault();});
  header.title='拖动标题栏移动，拖动边框缩放；裁剪后保留选中范围';refresh();
})();
