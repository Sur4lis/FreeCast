(()=>{
  const active=new Map(),seen=new Set(),deleted=new Set(),dismissed=new Set(),overlay=$('superChatOverlay');
  const duration=m=>mix.scMaxDuration>0?Math.min(m.duration,mix.scMaxDuration):m.duration;
  const key=m=>(m.source||'a')+':'+m.id;
  function remember(set,id){set.add(id);if(set.size>2000)set.delete(set.values().next().value);}
  function card(message,pinned=false){
    const el=document.createElement('article');el.className='superchat-card'+(pinned?' pinned-superchat':' chat-row');el.dataset.source=message.source||'a';el.dataset.scId=message.id;
    el.dataset.tier=message.price>=1000?'high':message.price>=100?'medium':'normal';
    const colors=SuperChatStyle.resolve(message);
    for(const [name,value] of Object.entries(colors))el.style.setProperty('--sc-'+name.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),value);
    for(const name of ['body','header']){const rgb=[1,3,5].map(i=>parseInt(colors[name].slice(i,i+2),16));el.style.setProperty('--sc-'+name+'-surface',`rgba(${rgb.join(',')},${name==='body'?.86:.93})`);}
    const heading=document.createElement('a');heading.className='superchat-heading';
    window.chatBlocking?.decorate(el,heading,message);
    const img=document.createElement('img');img.src=ChatProtocol.imageUrl(message.avatar)||'assets/avatar.svg';img.alt='';img.className='superchat-avatar';img.referrerPolicy='no-referrer';img.addEventListener('error',()=>{img.src='assets/avatar.svg';},{once:true});heading.append(img);
    const user=document.createElement('span');user.className='superchat-user';user.textContent=message.user;user.title=message.uid?'UID '+message.uid:'';
    window.chatBlocking?.tag(el,message);
    window.chatRules?.tag(el,message);
    const price=document.createElement('strong');price.className='superchat-price';price.textContent=SuperChatStyle.formatPrice(message.price);price.setAttribute('aria-label','金额 '+price.textContent);
    heading.append(user,price);
    const text=document.createElement('button');text.type='button';text.className='superchat-message';text.title=window.mobileNative?'左滑关闭此条 SC；点击查看操作':'点击查看 SC 操作';ChatContent.append(text,message);
    text.addEventListener('click',event=>{event.stopPropagation();if(!window.scPosition?.moved())window.superChatActions?.open(text,message);});
    heading.addEventListener('click',event=>{if(window.scPosition?.moved())event.preventDefault();});el.append(heading,text);
    window.superChatActions?.attach(el,message);
    return el;
  }
  function dismiss(message){
    const id=key(message);remember(dismissed,id);active.delete(id);
    for(const el of document.querySelectorAll('[data-sc-id]'))if(el.dataset.source===(message.source||'a')&&el.dataset.scId===String(message.id))el.remove();
    window.superChatActions?.close();tick();window.danmakuLayout?.maskSC();
  }
  function clear(source){
    for(const [id,m] of active)if(!source||m.source===source)active.delete(id);
    for(const set of [seen,deleted])for(const id of set)if(!source||id.startsWith(source+':'))set.delete(id);
    for(const el of document.querySelectorAll('[data-sc-id]'))if(!source||el.dataset.source===source)el.remove();
    window.danmakuLayout?.maskSC();
  }
  function remove(source,ids){
    const idSet=new Set(ids);for(const id of ids){const k=source+':'+id;remember(deleted,k);active.delete(k);}
    for(const q of [queue,queueB])q.items=q.items.filter(m=>!(m.type==='superchat'&&(m.source||'a')===source&&idSet.has(m.id)));
    for(const el of document.querySelectorAll('[data-sc-id]'))if(el.dataset.source===source&&idSet.has(el.dataset.scId))el.remove();
    window.danmakuLayout?.maskSC();
  }
  function add(message){
    if(window.chatBlocking?.isBlocked(message)||window.chatRules?.blocked(message))return;
    const id=key(message);if(seen.has(id)||deleted.has(id)||dismissed.has(id))return;remember(seen,id);
    const source=message.source||'a',at=Number.isFinite(message.at)?message.at:(channels[source]?.media.currentTime||0);
    const m={...message,source,at};active.set(id,m);if(active.size>100)active.delete(active.keys().next().value);
    const list=$('chatList'),nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<70;
    $('chatEmpty')?.remove();list.append(card(m));while(list.children.length>180)list.firstChild.remove();if(nearBottom)list.scrollTop=list.scrollHeight;tick();
  }
  function tick(){
    const extra=Number($('chatOffset').value)||0;
    for(const [id,m] of active)if(window.chatBlocking?.isBlocked(m)||window.chatRules?.blocked(m))active.delete(id);
    for(const [id,m] of active){const media=channels[m.source]?.media;if(media&&media.currentTime>=m.at+duration(m)+extra)active.delete(id);}
    const hidden=!mix.showSC||!mix.showChat;
    let changed=overlay.hidden!==hidden;
    if(changed)overlay.hidden=hidden;
    const visible=[...active.values()].slice(-2),wanted=new Set(visible.map(key));
    for(const el of [...overlay.children])if(!wanted.has(el.dataset.source+':'+el.dataset.scId)){el.remove();changed=true;}
    for(const m of visible){let el=[...overlay.children].find(el=>el.dataset.source===m.source&&el.dataset.scId===m.id);if(!el){el=card(m,true);overlay.append(el);changed=true;}}
    if(changed)window.danmakuLayout?.maskSC();
  }
  window.superChats={add,remove,clear,dismiss,tick};tick();
})();
