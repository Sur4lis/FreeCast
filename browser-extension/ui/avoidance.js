(()=>{
  const player=$('player'),overlay=$('danmaku');let regions=[],editing=false,drag;
  try{const v=JSON.parse(localStorage.getItem('freecast-avoidance')||'[]');if(Array.isArray(v))regions=v.filter(r=>['x','y','w','h'].every(k=>Number.isFinite(r[k]))).slice(0,8).map(r=>({x:clamp(r.x,0,.98),y:clamp(r.y,0,.98),w:clamp(r.w,.02,1-r.x),h:clamp(r.h,.02,1-r.y)}));}catch{}
  const editor=document.createElement('div');editor.id='avoidanceEditor';editor.hidden=true;player.append(editor);
  const actions=document.createElement('div');actions.className='avoidance-actions';
  const hint=document.createElement('span');hint.textContent='拖出避让区 · 拖动移动 · 右下角缩放';
  const clear=document.createElement('button');clear.textContent='清空';const done=document.createElement('button');done.textContent='完成';actions.append(hint,clear,done);editor.append(actions);
  function persist(){localStorage.setItem('freecast-avoidance',JSON.stringify(regions));window.danmakuLayout?.maskSC();}
  function render(){editor.querySelectorAll('.avoidance-region').forEach(e=>e.remove());regions.forEach((r,i)=>{const el=document.createElement('div');el.className='avoidance-region';el.dataset.index=i;Object.assign(el.style,{left:r.x*100+'%',top:r.y*100+'%',width:r.w*100+'%',height:r.h*100+'%'});const remove=document.createElement('button');remove.textContent='×';remove.title='删除避让区';remove.addEventListener('pointerdown',e=>e.stopPropagation());remove.onclick=()=>{regions.splice(i,1);render();persist();};const resize=document.createElement('span');resize.className='avoidance-resize';el.append(remove,resize);editor.append(el);});}
  function layout(){const r=overlay.getBoundingClientRect(),p=player.getBoundingClientRect();Object.assign(editor.style,{left:r.left-p.left+'px',top:r.top-p.top+'px',width:r.width+'px',height:r.height+'px'});}
  function setEditing(value){editing=value;editor.hidden=!value;player.classList.toggle('editing-avoidance',value);if(value){$('danmakuSettings').hidden=true;layout();render();}window.playerUI?.wake();}
  const point=e=>{const r=editor.getBoundingClientRect();return{x:clamp((e.clientX-r.left)/r.width,0,1),y:clamp((e.clientY-r.top)/r.height,0,1)};};
  editor.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button,.avoidance-actions'))return;const p=point(e),box=e.target.closest('.avoidance-region');if(!box&&regions.length>=8){notice('最多设置 8 个避让区');return;}const i=box?+box.dataset.index:regions.push({x:p.x,y:p.y,w:.02,h:.02})-1;drag={i,start:p,initial:{...regions[i]},mode:box?(e.target.classList.contains('avoidance-resize')?'resize':'move'):'new',pointer:e.pointerId};editor.setPointerCapture(e.pointerId);e.preventDefault();render();});
  editor.addEventListener('pointermove',e=>{if(!drag)return;const p=point(e),d=drag,r=regions[d.i],dx=p.x-d.start.x,dy=p.y-d.start.y;
    if(d.mode==='move'){r.x=clamp(d.initial.x+dx,0,1-r.w);r.y=clamp(d.initial.y+dy,0,1-r.h);}
    else if(d.mode==='resize'){r.w=clamp(d.initial.w+dx,.02,1-r.x);r.h=clamp(d.initial.h+dy,.02,1-r.y);}
    else{r.x=Math.min(p.x,d.start.x);r.y=Math.min(p.y,d.start.y);r.w=Math.max(.005,Math.abs(dx));r.h=Math.max(.005,Math.abs(dy));}render();window.danmakuLayout.maskSC();});
  function finish(){if(!drag)return;const r=regions[drag.i];if(r.w<.02||r.h<.02)regions.splice(drag.i,1);drag=null;render();persist();}
  editor.addEventListener('pointerup',finish);editor.addEventListener('pointercancel',finish);clear.onclick=()=>{regions=[];render();persist();};done.onclick=()=>setEditing(false);
  $('avoidanceButton').onclick=()=>setEditing(!editing);document.addEventListener('keydown',e=>{if(editing&&e.key==='Escape'){e.preventDefault();setEditing(false);}},true);
  new ResizeObserver(()=>{if(editing)layout();window.danmakuLayout?.maskSC();}).observe(overlay);
  // Split into disjoint visible rectangles. Overlapping holes remain hidden.
  function visible(width,height,holes){const xs=[...new Set([0,width,...holes.flatMap(r=>[clamp(r.x,0,width),clamp(r.x+r.w,0,width)])])].sort((a,b)=>a-b),out=[];
    for(let i=0;i<xs.length-1;i++){const x=xs[i],right=xs[i+1];if(right<=x)continue;const cut=holes.filter(r=>r.x<right&&r.x+r.w>x).map(r=>[clamp(r.y,0,height),clamp(r.y+r.h,0,height)]).sort((a,b)=>a[0]-b[0]);let y=0;for(const [a,b] of cut){if(a>y)out.push({x,y,w:right-x,h:a-y});y=Math.max(y,b);}if(y<height)out.push({x,y,w:right-x,h:height-y});}return out;}
  window.chatAvoidance={regions:()=>regions.map(r=>({...r})),rects:(w,h)=>regions.map(r=>({x:r.x*w,y:r.y*h,w:r.w*w,h:r.h*h})),visible,setEditing};persist();
})();
