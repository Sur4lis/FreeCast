(()=>{
  let words=[],mergeEnabled=false;const recent=new Map();
  try{const s=JSON.parse(localStorage.getItem('freecast-chat-rules')||'{}');words=Array.isArray(s.words)?s.words.filter(x=>typeof x==='string').slice(0,100):[];mergeEnabled=s.merge===true;}catch{}
  const normalize=s=>String(s||'').normalize('NFKC').toLocaleLowerCase();
  const key=m=>(m.source||'a')+'|'+(m.isSelf?'self':'other')+'|'+normalize(m.text)+'|'+(m.emoticon?.url||'')+'|'+(m.emotes||[]).map(e=>e.token+e.url).join('|');
  function blocked(m){const text=normalize(m.text);return words.some(word=>text.includes(normalize(word)));}
  function reset(){recent.clear();}
  function merge(m){
    if(!mergeEnabled||m.type==='superchat')return false;
    const now=performance.now();for(const [k,r] of recent)if(now-r.at>8000||!r.row.isConnected)recent.delete(k);
    const r=recent.get(key(m));if(!r)return false;
    r.count++;let badge=r.row.querySelector('.repeat-count');if(!badge){badge=document.createElement('small');badge.className='repeat-count';r.row.append(badge);}badge.textContent='×'+r.count;return true;
  }
  function track(m,row){if(!mergeEnabled)return;recent.set(key(m),{row,count:1,at:performance.now()});if(recent.size>180)recent.delete(recent.keys().next().value);}
  $('blockedKeywords').value=words.join('\n');$('mergeRepeated').checked=mergeEnabled;
  function saveRules(){words=$('blockedKeywords').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).slice(0,100);mergeEnabled=$('mergeRepeated').checked;localStorage.setItem('freecast-chat-rules',JSON.stringify({words,merge:mergeEnabled}));reset();clearChat();if(window.replay?.active)window.replay.seek(window.replay.currentLag());}
  $('blockedKeywords').addEventListener('change',saveRules);$('mergeRepeated').addEventListener('change',saveRules);
  $('chatRulesButton').addEventListener('click',()=>$('chatRulesDialog').showModal());
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
  window.chatRules={blocked,merge,track,reset};
})();
