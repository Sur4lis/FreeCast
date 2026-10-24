(()=>{
  const active=new Map(),seen=new Set(),deleted=new Set(),overlay=$('superChatOverlay');
  const duration=m=>mix.scMaxDuration>0?Math.min(m.duration,mix.scMaxDuration):m.duration;
  const key=m=>(m.source||'a')+':'+m.id;
  function remember(set,id){set.add(id);if(set.size>2000)set.delete(set.values().next().value);}
  function card(message,pinned=false){
    const el=document.createElement('article');el.className='superchat-card'+(pinned?' pinned-superchat':' chat-row');el.dataset.source=message.source||'a';el.dataset.scId=message.id;
    el.dataset.tier=message.price>=1000?'high':message.price>=100?'medium':'normal';
    const fallback=message.price>=2000?'#AB1A32':message.price>=1000?'#E09443':message.price>=500?'#E2B52B':message.price>=100?'#1E9576':message.price>=50?'#427D9E':'#2A60B2';
    const color=/^#[0-9a-f]{6}$/i.test(message.scColor||'')?message.scColor:fallback;
    const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
    el.style.backgroundColor=`rgba(${rgb.join(',')},.94)`;el.style.borderColor=`rgba(${rgb.join(',')},.85)`;
    el.style.color=rgb[0]*.299+rgb[1]*.587+rgb[2]*.114>145?'#273241':'#fff';
    const heading=document.createElement('a');heading.className='superchat-heading';
    window.chatBlocking?.decorate(el,heading,message);
    const img=document.createElement('img');img.src=ChatProtocol.imageUrl(message.avatar)||'assets/avatar.svg';img.alt='';img.className='superchat-avatar';img.referrerPolicy='no-referrer';img.addEventListener('error',()=>{img.src='assets/avatar.svg';},{once:true});heading.append(img);
    const user=document.createElement('span');user.className='superchat-user';user.textContent=message.user;user.title=message.uid?'UID '+message.uid:'';
    window.chatBlocking?.tag(el,message);
    window.chatRules?.tag(el,message);
    heading.append(user);
    const text=document.createElement('button');text.type='button';text.className='superchat-message';text.title='点击复制留言内容';ChatContent.append(text,message);
    text.addEventListener('click',async()=>{if(window.scPosition?.moved())return;try{await navigator.clipboard.writeText(String(message.text||''));text.title='已复制';notice('已复制 SC 内容');}catch{notice('复制失败，请重试',true);}});
    heading.addEventListener('click',event=>{if(window.scPosition?.moved())event.preventDefault();});el.append(heading,text);
    return el;
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
    const id=key(message);if(seen.has(id)||deleted.has(id))return;remember(seen,id);
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
  window.superChats={add,remove,clear,tick};tick();
})();
