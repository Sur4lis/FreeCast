(()=>{
  const menu=document.createElement('div');menu.id='superChatActions';menu.className='sc-action-menu';menu.hidden=true;menu.setAttribute('role','dialog');menu.setAttribute('aria-label','SC 操作');
  const copy=document.createElement('button'),dismiss=document.createElement('button');copy.type=dismiss.type='button';copy.textContent='复制内容';copy.id='copySuperChat';dismiss.textContent='关闭 SC';dismiss.id='dismissSuperChat';menu.append(copy,dismiss);document.body.append(menu);
  let anchor=null,message=null,watch;
  function close(){menu.hidden=true;anchor=null;message=null;clearInterval(watch);watch=null;}
  function position(){if(menu.hidden)return;if(!anchor?.isConnected){close();return;}const r=anchor.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(r.left,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min(r.bottom+5,innerHeight-menu.offsetHeight-8))+'px';}
  function open(target,m){close();anchor=target;message=m;(document.fullscreenElement||document.body).append(menu);copy.textContent='复制内容';copy.disabled=!m.text;menu.hidden=false;position();copy.focus();watch=setInterval(position,250);window.playerUI?.wake();}
  copy.onclick=async()=>{const current=message;if(!current)return;try{await navigator.clipboard.writeText(String(current.text||''));if(current===message)copy.textContent='已复制';}catch{notice('复制失败，请重试',true);}};
  dismiss.onclick=()=>{const current=message;close();if(current)window.superChats.dismiss(current);};
  function attach(el,m){
    if(!window.mobileNative)return;el.classList.add('sc-swipe-close');let drag=null,suppressUntil=0;
    const restore=()=>{el.style.transform='';el.style.opacity='';};
    el.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse'||!event.isPrimary||window.scPosition?.editing())return;drag={id:event.pointerId,x:event.clientX,y:event.clientY,dx:0,dy:0};el.setPointerCapture(event.pointerId);});
    el.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;drag.dx=event.clientX-drag.x;drag.dy=event.clientY-drag.y;if(drag.dx<-10&&Math.abs(drag.dx)>Math.abs(drag.dy)*1.4){el.style.transform=`translateX(${Math.max(-el.offsetWidth,drag.dx)}px)`;el.style.opacity=String(Math.max(.35,1+drag.dx/el.offsetWidth));}});
    el.addEventListener('pointerup',event=>{if(!drag||drag.id!==event.pointerId)return;const last=drag;drag=null;restore();if(Math.abs(last.dx)+Math.abs(last.dy)>12)suppressUntil=performance.now()+600;if(last.dx<=-48&&Math.abs(last.dx)>Math.abs(last.dy)*1.4){event.preventDefault();event.stopPropagation();window.superChats.dismiss(m);}});
    for(const type of ['pointercancel','lostpointercapture'])el.addEventListener(type,()=>{if(drag&&Math.abs(drag.dx)+Math.abs(drag.dy)>12)suppressUntil=performance.now()+600;drag=null;restore();});
    el.addEventListener('click',event=>{if(performance.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
  }
  document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!menu.contains(event.target)&&!anchor?.contains(event.target))close();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!menu.hidden){event.preventDefault();event.stopImmediatePropagation();const previous=anchor;close();previous?.focus();}},true);
  document.addEventListener('scroll',position,true);window.addEventListener('resize',position);window.addEventListener('pagehide',close);document.addEventListener('visibilitychange',()=>{if(document.hidden)close();});document.addEventListener('fullscreenchange',close);
  window.superChatActions={attach,open,close};
})();
