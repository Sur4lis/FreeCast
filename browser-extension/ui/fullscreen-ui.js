(()=>{
  const form=$('sendChatForm'),home=document.createComment('chat composer'),player=$('player'),controls=document.querySelector('.player-bottom'),controlsHome=$('playerControlsHome'),input=$('chatText');form.before(home);
  const placeholder=input.placeholder;
  const sidebar=document.querySelector('.chat-panel'),sidebarKey='freecast-theater-chat-collapsed-v1';
  sidebar.id='chatPanel';
  let collapsed=false;try{collapsed=localStorage.getItem(sidebarKey)==='true';}catch{}
  const sidebarToggle=document.createElement('button');sidebarToggle.id='toggleChatSidebar';sidebarToggle.type='button';
  sidebarToggle.setAttribute('aria-controls','chatPanel');
  sidebarToggle.innerHTML='<svg viewBox="0 0 16 24" fill="none" aria-hidden="true"><path d="m5 5 6 7-6 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  player.append(sidebarToggle);
  let timer,lastView=null;
  function sidebarState(){
    document.body.classList.toggle('chat-sidebar-collapsed',collapsed);
    sidebarToggle.hidden=viewMode!=='theater';
    sidebarToggle.setAttribute('aria-expanded',String(!collapsed));
    sidebarToggle.title=collapsed?'展开右侧弹幕列表':'收起右侧弹幕列表';
    sidebarToggle.setAttribute('aria-label',sidebarToggle.title);
  }
  sidebarToggle.addEventListener('click',()=>{collapsed=!collapsed;try{localStorage.setItem(sidebarKey,String(collapsed));}catch{}viewChanged();window.miniWindow?.refresh();wake();});
  function layout(){$('sendTarget').title=$('sendTarget').selectedOptions[0]?.textContent||'发送弹幕的直播间';}
  function focusComposer(){renderSendTargets();wake();input.focus();}
  function wake(){
    document.body.classList.remove('full-ui-idle');clearTimeout(timer);if(viewMode==='normal')return;
    timer=setTimeout(()=>{
      const focused=document.activeElement;
      if(player.classList.contains('editing-avoidance')||!$('danmakuSettings').hidden||!$('emotePicker').hidden||document.querySelector('dialog[open]')||(player.contains(focused)&&focused?.matches('input,select,textarea'))||sidebarToggle.matches(':hover,:focus-visible')||document.querySelector('.player-bottom:hover')||(viewMode==='full'&&document.querySelector('#miniPanel.moving'))){wake();return;}
      document.body.classList.add('full-ui-idle');
    },3000);
  }
  function viewChanged(){
    sidebarState();
    const full=viewMode==='full'||viewMode==='theater'&&collapsed,viewKey=viewMode+':'+collapsed;
    if(viewKey===lastView)return;lastView=viewKey;
    window.presentation?.refresh();
    const focused=form.contains(document.activeElement)?document.activeElement:null;
    window.emotePicker?.close();
    if(full)controls.querySelector('.player-actions').before(form);else home.after(form);
    (viewMode==='normal'?controlsHome:player).append(controls);
    input.placeholder=full?'输入弹幕，回车发送':placeholder;
    layout();wake();focused?.focus({preventScroll:true});
  }
  new MutationObserver(viewChanged).observe(document.body,{attributes:true,attributeFilter:['class']});
  new MutationObserver(layout).observe($('sendTarget'),{childList:true,subtree:true,characterData:true});
  $('sendTarget').addEventListener('change',layout);
  const activity=event=>{if(viewMode!=='full'&&!player.contains(event.target))return;wake();};
  document.addEventListener('pointermove',activity,{passive:true});document.addEventListener('pointerdown',activity,{passive:true});document.addEventListener('focusin',activity);document.addEventListener('focusout',activity);document.addEventListener('keydown',activity);
  document.addEventListener('keydown',event=>{
    if(!(viewMode==='full'||viewMode==='theater'&&collapsed)||event.isComposing||event.keyCode===229)return;
    if(event.key==='Escape'&&form.contains(document.activeElement)){event.preventDefault();event.stopImmediatePropagation();document.activeElement.blur();wake();return;}
    if(event.key==='Enter'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.target.closest('input,select,textarea,button,[role="button"],dialog')){event.preventDefault();focusComposer();}
  },true);
  $('retryChat').addEventListener('click',async()=>{
    if(!running){$('chatStatus').textContent='请先连接直播';return;}
    const token=generation,rooms=['a','b'].filter(k=>mix['chat'+k.toUpperCase()]&&channels[k]?.room).map(k=>channels[k].room.id);
    $('retryChat').disabled=true;try{await window.live.ensureSources(rooms);if(token!==generation||!running)return;await Promise.all(['a','b'].map(refreshChat));}catch(error){if(token===generation&&running)notice(error.message,true);}finally{$('retryChat').disabled=false;}
  });
  window.playerUI={wake,layout};viewChanged();
})();
