(()=>{
  const storage='freecast-blocked-users-v1';let blocked=[];
  const platforms={bilibili:'B 站',huya:'虎牙',douyu:'斗鱼',douyin:'抖音'};
  const platform=m=>Object.hasOwn(platforms,m?.platform)?m.platform:'bilibili';
  const validUid=value=>/^[1-9]\d{0,19}$/.test(String(value||''));
  function load(){blocked=[];try{const saved=JSON.parse(localStorage.getItem(storage)||'[]');if(Array.isArray(saved))blocked=saved.filter(x=>x&&typeof x.value==='string'&&x.value.length<=100&&(x.type==='name'||x.type==='uid'&&validUid(x.value))).slice(0,500);}catch{}}
  load();
  const key=m=>validUid(m.uid)?'uid:'+m.uid:'name:'+String(m.user||'');
  const isBlocked=m=>blocked.some(x=>platform(x)===platform(m)&&(x.type==='uid'?validUid(m.uid)&&x.value===String(m.uid):x.value===m.user));
  function tag(el,m){el.dataset.userKey=key(m);el.dataset.userName=m.user||'';el.dataset.userPlatform=platform(m);}
  function purge(){
    for(const q of [queue,queueB])q.items=q.items.filter(m=>!isBlocked(m));
    for(const el of document.querySelectorAll('[data-user-key]'))if(isBlocked({uid:el.dataset.userKey.startsWith('uid:')?el.dataset.userKey.slice(4):'',user:el.dataset.userName,platform:el.dataset.userPlatform}))el.remove();
    window.superChats?.tick();
  }
  function render(){
    const list=$('blockedList');list.replaceChildren();
    if(!blocked.length){const empty=document.createElement('p');empty.textContent='还没有屏蔽用户';list.append(empty);}
    for(const item of blocked){const row=document.createElement('div'),name=document.createElement('span'),remove=document.createElement('button');row.className='blocked-row';name.textContent=platforms[platform(item)]+' · '+(item.type==='uid'?(item.name||'用户')+' · UID '+item.value:item.value+'（按完整昵称）');remove.textContent='解除屏蔽';remove.addEventListener('click',()=>{blocked=blocked.filter(x=>x!==item);persist();});row.append(name,remove);list.append(row);}
    $('manageBlocked').textContent='屏蔽用户管理（'+blocked.length+'）';
  }
  function persist(){localStorage.setItem(storage,JSON.stringify(blocked));purge();render();}
  function open(m){
    $('blockPlatform').value=platform(m);
    $('blockUserInput').value=m?(validUid(m.uid)?String(m.uid):m.user):'';
    $('blockUserInput').dataset.name=m?.user||'';
    $('blockStatus').textContent=m?'确认屏蔽 '+m.user+'？'+(validUid(m.uid)?'按 UID 匹配。':'本条未提供 UID，将按完整昵称匹配。'):'';
    render();if(!$('blockedDialog').open)$('blockedDialog').showModal();$('blockUserInput').focus();
  }
  function decorate(el,label,m){
    tag(el,m);label.classList.add('blockable-user');label.tabIndex=0;label.setAttribute('role','button');label.setAttribute('aria-haspopup','dialog');label.title='查看 '+m.user+' 的操作';
    label.addEventListener('click',event=>{if(el.classList.contains('pinned-superchat')&&window.scPosition?.moved()){event.preventDefault();return;}window.chatUserActions.open(label,m);});label.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();window.chatUserActions.open(label,m);}});
  }
  $('manageBlocked').addEventListener('click',()=>open());
  $('closeBlocked').addEventListener('click',()=>$('blockedDialog').close());
  $('blockUserInput').addEventListener('input',()=>delete $('blockUserInput').dataset.name);
  $('blockUserForm').addEventListener('submit',event=>{
    event.preventDefault();const value=$('blockUserInput').value.trim();if(!value)return;
    const type=validUid(value)?'uid':'name';
    if(blocked.some(x=>x.type===type&&x.value===value&&platform(x)===$('blockPlatform').value)){$('blockStatus').textContent='该用户已在屏蔽列表';return;}
    if(blocked.length>=500){$('blockStatus').textContent='最多保存 500 位，请先解除部分屏蔽';return;}
    blocked.push({type,value,platform:$('blockPlatform').value,name:$('blockUserInput').dataset.name||''});persist();$('blockStatus').textContent='已屏蔽，当前画面、侧栏及待显示消息已清理';$('blockUserInput').value='';delete $('blockUserInput').dataset.name;
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('blockedDialog').open){event.preventDefault();event.stopImmediatePropagation();$('blockedDialog').close();}},true);
  window.addEventListener('storage',event=>{if(event.key===storage||event.key===null){load();purge();render();}});
  window.chatBlocking={isBlocked,tag,decorate,open};render();
})();
