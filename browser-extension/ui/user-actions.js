(()=>{
  const menu=document.createElement('div'),label=document.createElement('strong'),actions=document.createElement('div'),block=document.createElement('button'),keyword=document.createElement('button'),dismiss=document.createElement('button'),home=document.createElement('a');
  menu.id='chatUserActions';menu.className='chat-user-menu';menu.hidden=true;menu.setAttribute('role','dialog');menu.setAttribute('aria-label','用户操作');
  label.className='chat-user-name';actions.className='chat-user-buttons';block.type=keyword.type=dismiss.type='button';block.id='blockChatUser';block.textContent='屏蔽用户';block.title='屏蔽该用户的弹幕和 SC';keyword.id='blockChatKeyword';keyword.textContent='屏蔽弹幕';keyword.title='将这条弹幕的文字加入屏蔽关键词';dismiss.id='dismissUserSC';dismiss.textContent='关闭 SC';home.textContent='前往主页';home.target='_blank';home.rel='noopener noreferrer';actions.append(block,keyword,home,dismiss);menu.append(label,actions);document.body.append(menu);
  let anchor,message;
  function profile(m){
    const uid=String(m.uid||'');
    if((m.platform||'bilibili')==='bilibili'&&/^[1-9]\d{0,19}$/.test(uid))return 'https://space.bilibili.com/'+uid;
    if(m.platform==='douyin'&&/^MS4wLjAB[A-Za-z0-9_-]{10,200}$/.test(m.secUid||''))return 'https://www.douyin.com/user/'+m.secUid;
    return '';
  }
  function close(focus=false){menu.hidden=true;if(focus&&anchor?.isConnected)anchor.focus();anchor=null;message=null;}
  function position(){if(menu.hidden)return;if(!anchor?.isConnected){close();return;}const r=anchor.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(r.left,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(8,Math.min(r.bottom+6,innerHeight-menu.offsetHeight-8))+'px';}
  function open(target,m){anchor=target;message=m;label.textContent=m.user||'观众';const url=profile(m);if(url){home.href=url;home.removeAttribute('aria-disabled');home.title='';}else{home.removeAttribute('href');home.setAttribute('aria-disabled','true');home.title='这条弹幕未提供可用的用户主页';}home.tabIndex=url?0:-1;
    keyword.disabled=!String(m.text||'').trim()||!window.chatRules;dismiss.hidden=m.type!=='superchat';
    // Native fullscreen only paints descendants of its fullscreen element.
    (document.fullscreenElement||document.body).append(menu);menu.hidden=false;position();block.focus();
  }
  block.onclick=()=>{const m=message;close();window.chatBlocking.open(m);};home.onclick=e=>{if(!home.hasAttribute('href'))e.preventDefault();else close();};
  keyword.onclick=()=>{const m=message;if(!m||keyword.disabled)return;try{window.chatRules.addKeyword(m.text);close();notice('已加入屏蔽关键词');}catch(error){notice(error.message,true);}};
  dismiss.onclick=()=>{const m=message;close();if(m)window.superChats?.dismiss(m);};
  document.addEventListener('pointerdown',e=>{if(!menu.hidden&&!menu.contains(e.target)&&!anchor?.contains(e.target))close();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!menu.hidden){e.preventDefault();e.stopImmediatePropagation();close(true);}},true);
  document.addEventListener('focusin',e=>{if(!menu.hidden&&!menu.contains(e.target)&&e.target!==anchor)close();});
  document.addEventListener('scroll',position,true);window.addEventListener('resize',position);document.addEventListener('fullscreenchange',()=>close());
  window.chatUserActions={open,profile};
})();
