(()=>{
  const normalize=s=>String(s||'').normalize('NFKC').toLocaleLowerCase().trim().replace(/\s+/g,' ');
  let words=[],mergeEnabled=false;const recent=new Map(),messageText=new WeakMap();
  try{const s=JSON.parse(localStorage.getItem('freecast-chat-rules')||'{}'),seen=new Set();words=(Array.isArray(s.words)?s.words:[]).filter(x=>{if(typeof x!=='string'||!normalize(x)||seen.has(normalize(x)))return false;seen.add(normalize(x));return true;}).map(x=>x.trim()).slice(0,100);mergeEnabled=s.merge===true;}catch{}
  const imageKey=e=>e?.unique||e?.url||'';
  const key=m=>JSON.stringify([m.source==='b'?'b':'a',m.isSelf===true,normalize(m.text),imageKey(m.emoticon),(m.emotes||[]).map(e=>[e.token,imageKey(e)])]);
  const stamp=m=>Number.isFinite(m.receivedAt)?['received',m.receivedAt]:Number.isFinite(m.at)?['media',m.at*1000]:['render',performance.now()];
  function blocked(m){const text=normalize(m.text);return words.some(word=>text.includes(normalize(word)));}
  function tag(el,m){messageText.set(el,String(m.text||''));}
  function purge(){
    for(const el of document.querySelectorAll('#chatList .chat-row, #danmaku .bullet, #superChatOverlay .superchat-card')){
      const text=messageText.get(el);if(text!==undefined&&blocked({text}))el.remove();
    }
    for(const [key,group] of recent)if(!group.row.isConnected)recent.delete(key);
    window.superChats?.tick();
  }
  function reset(){recent.clear();}
  function countBadge(el,count,reserve=false){
    let badge=el.querySelector('.repeat-count');
    if(!badge){badge=document.createElement('small');badge.className='repeat-count';el.append(badge);}
    badge.textContent=count>1?(count>999?'×999+':'×'+count):'';badge.title='相同弹幕 '+count+' 条';
    badge.style.visibility=count>1?'visible':'hidden';if(reserve)badge.classList.add('bullet-repeat-count');
  }
  function merge(m){
    if(!mergeEnabled||m.type==='superchat')return null;
    const [clock,now]=stamp(m);
    for(const [k,r] of recent)if(!r.row.isConnected||(r.clock===clock&&now-r.at>8000))recent.delete(k);
    const r=recent.get(key(m));if(!r||r.clock!==clock||now<r.at)return null;
    r.at=now;r.count++;countBadge(r.row,r.count);if(r.bullet?.isConnected)countBadge(r.bullet,r.count,true);return r;
  }
  function track(m,row){
    tag(row,m);
    if(!mergeEnabled||m.type==='superchat')return null;
    const [clock,at]=stamp(m),r={row,count:1,clock,at,bullet:null};recent.set(key(m),r);
    if(recent.size>180)recent.delete(recent.keys().next().value);return r;
  }
  function attachBullet(r,bullet,m){if(m)tag(bullet,m);if(r){r.bullet=bullet;countBadge(bullet,r.count,true);}}
  const list=$('blockedKeywords'),editor=$('keywordEditor'),input=$('keywordInput'),add=$('addKeyword'),status=$('keywordStatus');
  function renderWords(){
    list.replaceChildren();
    for(const word of words){
      const chip=document.createElement('span'),label=document.createElement('span'),remove=document.createElement('button');
      chip.className='keyword-chip';label.textContent=word;remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','取消屏蔽 '+word);
      remove.addEventListener('click',()=>{words=words.filter(w=>w!==word);saveRules();renderWords();add.focus();});chip.append(label,remove);list.append(chip);
    }
  }
  function saveRules(){localStorage.setItem('freecast-chat-rules',JSON.stringify({words,merge:mergeEnabled}));clearChat();if(window.replay?.active)window.replay.seek(window.replay.currentLag());}
  function closeEditor(){editor.hidden=true;input.value='';status.textContent='';add.hidden=false;add.focus();}
  function addKeyword(value){
    const word=typeof value==='string'?value.trim():'';
    if(!normalize(word))throw Error('请输入要屏蔽的关键词');
    if(word.length>2000)throw Error('内容过长，请在关键词设置中添加');
    if(words.some(w=>normalize(w)===normalize(word)))throw Error('这个关键词已屏蔽');
    if(words.length>=100)throw Error('最多添加 100 个关键词');
    const next=[...words,word];
    try{localStorage.setItem('freecast-chat-rules',JSON.stringify({words:next,merge:mergeEnabled}));}
    catch{throw Error('保存失败，请清理浏览器存储后重试');}
    words=next;renderWords();purge();
  }
  function addWord(){
    try{addKeyword(input.value);closeEditor();}
    catch(error){status.textContent=error.message;input.focus();}
  }
  add.addEventListener('click',()=>{editor.hidden=false;add.hidden=true;status.textContent='';input.focus();});
  $('confirmKeyword').addEventListener('click',addWord);
  editor.addEventListener('keydown',event=>{if(event.isComposing)return;if(event.key==='Enter'){event.preventDefault();addWord();}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeEditor();}});
  $('mergeRepeated').checked=mergeEnabled;
  $('mergeRepeated').addEventListener('change',()=>{mergeEnabled=$('mergeRepeated').checked;saveRules();});
  $('chatRulesButton').addEventListener('click',()=>$('chatRulesDialog').showModal());
  $('chatRulesDialog').addEventListener('close',()=>{editor.hidden=true;input.value='';status.textContent='';add.hidden=false;});
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
  renderWords();window.chatRules={blocked,merge,track,attachBullet,reset,tag,addKeyword};
})();
