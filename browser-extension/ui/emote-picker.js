(()=>{
  let roomId=null,revision=0,packs=[];
  const picker=$('emotePicker'),input=$('chatText');
  const current=()=>{const room=channels[$('sendTarget').value]?.room;return room&&!room.external?String(room.id):null;};
  function clear(){input.classList.remove('has-emote');}
  function close() {picker.hidden=true;$('emoteButton').setAttribute('aria-expanded','false');}
  function render(index){
    $('emoteGrid').replaceChildren();for(const b of $('emotePacks').children)b.setAttribute('aria-pressed',String(Number(b.dataset.index)===index));
    for(const emote of packs[index]?.emotes||[]){const button=document.createElement('button');button.type='button';button.title=emote.allowed?emote.text:emote.text+' · '+emote.reason;button.disabled=!emote.allowed;const img=document.createElement('img');img.src=emote.url;img.alt=emote.text;img.referrerPolicy='no-referrer';img.loading='lazy';button.append(img);button.addEventListener('click',()=>{if(current()!==roomId)return;if(emote.type==='text'){const from=input.selectionStart??input.value.length,to=input.selectionEnd??from,next=input.value.slice(0,from)+emote.text+input.value.slice(to);if([...next].length>40){$('emoteStatus').textContent='弹幕最多 40 字';return;}input.value=next;input.setSelectionRange(from+emote.text.length,from+emote.text.length);input.dispatchEvent(new Event('input',{bubbles:true}));}else{window.chatSender.sendEmote(emote,roomId);}close();input.focus();});$('emoteGrid').append(button);}
  }
  async function open(){
    const room=current();if(!room){$('sendStatus').textContent='请先选择已连接的 B 站直播间';return;}
    if(!picker.hidden){close();return;}picker.hidden=false;$('emoteButton').setAttribute('aria-expanded','true');$('emoteStatus').textContent='加载表情…';$('emotePacks').replaceChildren();$('emoteGrid').replaceChildren();const token=++revision;roomId=room;
    try{const result=await window.live.emoticons(room);if(token!==revision||current()!==room)return;packs=result;packs.forEach((pack,i)=>{const button=document.createElement('button');button.type='button';button.textContent=pack.name;button.dataset.index=i;button.addEventListener('click',()=>render(i));$('emotePacks').append(button);});render(0);$('emoteStatus').textContent=packs.length?'emoji 插入文字；其他表情点击即发送':'该房间暂未返回可用表情';}
    catch(error){if(token===revision)$('emoteStatus').textContent=error.message;}
  }
  function targetChanged(){if(current()!==roomId){revision++;close();roomId=current();}}
  input.addEventListener('input',clear);$('emoteButton').addEventListener('click',open);$('closeEmotes').addEventListener('click',close);$('sendTarget').addEventListener('change',targetChanged);
  document.addEventListener('pointerdown',e=>{if(!picker.contains(e.target)&&e.target!==$('emoteButton'))close();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!picker.hidden){e.preventDefault();e.stopImmediatePropagation();close();input.focus();}},true);
  window.emotePicker={selection:()=>null,clear,targetChanged,close};
})();
