// The menu lives outside the clipped scrolling layer. Only the selected lane is held.
(()=>{
  const overlay=$('danmaku'),player=$('player'),menu=document.createElement('div');
  menu.id='danmakuActions';menu.className='chat-action-menu';menu.hidden=true;menu.setAttribute('role','group');menu.setAttribute('aria-label','弹幕操作');
  const make=(id,text)=>{const b=document.createElement('button');b.type='button';b.id=id;b.textContent=text;menu.append(b);return b;};
  const copy=make('copyDanmaku','复制'),reply=make('replyDanmaku','回复'),repeat=make('repeatDanmaku','+1');
  const status=document.createElement('span');status.className='chat-action-status';status.setAttribute('role','status');menu.append(status);player.append(menu);
  let selected=null,timer,watch;
  function close(){clearTimeout(timer);cancelAnimationFrame(watch);for(const el of overlay.children)el.classList.remove('danmaku-held','danmaku-selected');selected=null;menu.hidden=true;}
  function position(){
    if(!selected)return;
    const {el}=selected,r=el.getBoundingClientRect(),o=overlay.getBoundingClientRect(),p=player.getBoundingClientRect();
    if(!el.isConnected||!mix.showChat||mix.danmakuTransparency===100||player.classList.contains('editing-avoidance')||!o.width||r.right<=o.left||r.left>=o.right){close();return;}
    const x=Math.max(8,Math.min(Math.max(r.left,o.left)-p.left,p.width-menu.offsetWidth-8));
    let y=r.bottom-p.top+2;if(y+menu.offsetHeight>p.height-8)y=r.top-p.top-menu.offsetHeight-2;
    menu.style.left=x+'px';menu.style.top=Math.max(8,y)+'px';
    watch=requestAnimationFrame(position);
  }
  function open(el,message,room){
    clearTimeout(timer);if(selected?.el===el)return;close();
    if(mix.danmakuTransparency===100||!mix.showChat)return;
    selected={el,message,room,lane:Number(el.dataset.lane)};
    for(const other of overlay.children)if(other.dataset.lane===el.dataset.lane)other.classList.add('danmaku-held');
    el.classList.add('danmaku-selected');menu.hidden=false;status.textContent='';
    const connected=Boolean(room&&channels[message.source==='b'?'b':'a']?.room===room);
    reply.disabled=!connected;repeat.disabled=!connected||Boolean(message.emoticon);copy.disabled=!message.text;
    repeat.title=message.emoticon?'图片表情请从表情面板选择发送':'向 '+(message.source==='b'?'B':'A')+' 直播间发送一次相同内容';
    reply.title='在 '+(message.source==='b'?'B':'A')+' 直播间回复 '+message.user;
    position();window.playerUI?.wake();
  }
  const leave=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(menu.matches(':hover')||menu.contains(document.activeElement)||selected?.el.matches(':hover'))return;close();},220);};
  function attach(el,message){
    const room=channels[message.source==='b'?'b':'a']?.room;
    el.tabIndex=0;el.setAttribute('role','button');el.setAttribute('aria-label',message.user+'：'+message.text+'，弹幕操作');
    el.addEventListener('pointerenter',()=>open(el,message,room));el.addEventListener('pointerleave',leave);
    el.addEventListener('focus',()=>open(el,message,room));el.addEventListener('blur',leave);
    el.addEventListener('click',e=>{e.stopPropagation();open(el,message,room);});
    el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();open(el,message,room);copy.focus();}});
  }
  menu.addEventListener('pointerenter',()=>clearTimeout(timer));menu.addEventListener('pointerleave',leave);menu.addEventListener('focusout',leave);
  menu.addEventListener('click',e=>e.stopPropagation());menu.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();});
  copy.onclick=async()=>{const current=selected;if(!current)return;try{await navigator.clipboard.writeText(String(current.message.text));if(selected===current)status.textContent='已复制';}catch{if(selected===current)status.textContent='复制失败，请重试';}};
  reply.onclick=()=>{const current=selected;if(!current)return;close();window.chatSender.reply(current.message,current.room);};
  repeat.onclick=async()=>{const current=selected;if(!current||repeat.disabled)return;repeat.disabled=true;status.textContent='正在发送…';const result=await window.chatSender.repeat(current.message,current.room);if(selected===current){status.textContent=result;repeat.disabled=false;}};
  document.addEventListener('pointerdown',e=>{if(selected&&!menu.contains(e.target)&&e.target!==selected.el&&!selected.el.contains(e.target))close();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&selected){e.preventDefault();e.stopImmediatePropagation();selected.el.blur();close();}},true);
  window.addEventListener('blur',close);document.addEventListener('visibilitychange',()=>{if(document.hidden)close();});
  window.danmakuActions={attach,close,heldLane:()=>selected?.lane};
})();
