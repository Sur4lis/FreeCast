(()=>{
  const overlay=$('superChatOverlay'),player=$('player'),key='freecast-sc-position-v1';let saved=null,drag=null,lastMove=0,editing=false;
  try{const p=JSON.parse(localStorage.getItem(key));if(p&&Number.isFinite(p.x)&&Number.isFinite(p.y))saved={x:clamp(p.x,0,1),y:clamp(p.y,0,1)};}catch{}
  function place(){
    const box=editing?preview:overlay,maxX=Math.max(0,player.clientWidth-box.offsetWidth-8),maxY=Math.max(0,player.clientHeight-box.offsetHeight-8);
    overlay.style.left=(saved?clamp(saved.x*player.clientWidth,8,maxX):10)+'px';overlay.style.top=(saved?clamp(saved.y*player.clientHeight,8,maxY):12)+'px';window.danmakuLayout?.maskSC();
  }
  function edit(value){editing=value;overlay.classList.toggle('sc-position-editing',value);$('scPositionButton').textContent=value?'完成定位':'调整 SC 位置';if(value){$('danmakuSettings').hidden=true;overlay.hidden=false;}else window.superChats?.tick();place();}
  const preview=document.createElement('div');preview.className='sc-position-preview';preview.textContent='拖动定位 · 双击或 Esc 完成';preview.hidden=true;
  // Kept outside the message overlay so incoming/expired cards cannot destroy an active drag handle.
  overlay.before(preview);preview.addEventListener('pointerdown',begin);
  function begin(event){if(event.button!==0||!editing&&event.target.closest('a,button'))return;const r=event.currentTarget.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:r.left-player.getBoundingClientRect().left,top:r.top-player.getBoundingClientRect().top};event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();}
  overlay.addEventListener('pointerdown',begin);
  function move(event){if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>3)lastMove=performance.now();saved={x:clamp((drag.left+dx)/player.clientWidth,0,1),y:clamp((drag.top+dy)/player.clientHeight,0,1)};place();positionPreview();}
  function end(){if(!drag)return;drag=null;localStorage.setItem(key,JSON.stringify(saved));}
  for(const target of [overlay,preview]){target.addEventListener('pointermove',move);target.addEventListener('pointerup',end);target.addEventListener('pointercancel',end);target.addEventListener('lostpointercapture',end);}
  function positionPreview(){preview.hidden=!editing;preview.style.left=overlay.style.left;preview.style.top=overlay.style.top;}
  const originalPlace=place;
  $('scPositionButton').addEventListener('click',()=>{edit(!editing);positionPreview();});
  preview.addEventListener('dblclick',()=>{edit(false);positionPreview();});
  $('scPositionReset').addEventListener('click',()=>{saved=null;localStorage.removeItem(key);place();positionPreview();});
  document.addEventListener('keydown',event=>{if(editing&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();edit(false);positionPreview();}},true);
  new ResizeObserver(()=>{originalPlace();positionPreview();}).observe(player);new ResizeObserver(place).observe(overlay);
  window.scPosition={moved:()=>performance.now()-lastMove<250,place,editing:()=>editing};place();
})();
