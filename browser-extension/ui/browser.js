let account={loggedIn:false},checkingAccount=false,accountRevision=0,accountRefreshQueued=false,accountRetry=0,accountError='';
async function refreshAccount(){
  if(checkingAccount){accountRefreshQueued=true;return;}checkingAccount=true;accountRefreshQueued=false;const revision=accountRevision;
  try{const result=await window.live.authStatus();if(revision!==accountRevision)return;account=result;accountError='';
    $('loginButton').textContent=account.loggedIn?'已登录 · '+account.name:'未登录 · 刷新状态';$('loginButton').title='使用当前浏览器的 B 站网页账号；点击刷新';
    if(account.loggedIn)accountRetry=0;
  }catch(error){if(revision===accountRevision){account={loggedIn:false};accountError=error.message;$('loginButton').textContent='验证失败 · 点击重试';$('loginButton').title=error.message;}}
  finally{
    checkingAccount=false;renderSendTargets();
    if(revision!==accountRevision||accountRefreshQueued){clearTimeout(authTimer);authTimer=setTimeout(refreshAccount,100);}
    else if(accountRetry>0&&!account.loggedIn){clearTimeout(authTimer);authTimer=setTimeout(refreshAccount,(4-accountRetry)*800);accountRetry--;}
  }
}
$('loginButton').addEventListener('click',async()=>{try{await window.live.ensureSources(['https://live.bilibili.com/']);await refreshAccount();if(accountError)notice(accountError,true);}catch(error){notice(error.message,true);}});
$('browserLoginButton').addEventListener('click',()=>window.live.authBrowser().catch(error=>notice(error.message,true)));
let authTimer;
function accountChanged(){accountRevision++;account={loggedIn:false};accountError='';accountRetry=window.mobileNative?3:0;renderSendTargets();$('loginButton').textContent='正在更新登录状态…';clearTimeout(authTimer);authTimer=setTimeout(refreshAccount,100);}
chrome.runtime.onMessage.addListener(message=>{if(message.type==='accountChanged')accountChanged();});
window.addEventListener('freecast-account-changed',accountChanged);
window.addEventListener('focus',refreshAccount);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshAccount();});
let sending=false;
const connectedNames=new Map(),pendingNames=new Set();
const sendPlatforms={bilibili:'B 站',huya:'虎牙',douyu:'斗鱼',douyin:'抖音'};
function renderSendTargets(){
  for(const option of $('sendTarget').options){const key=option.value,room=channels[key]?.room,platform=room?.external?room.platform:'bilibili';
    option.disabled=Boolean(room&&!sendPlatforms[platform]);
    if(room&&!room.name&&!connectedNames.has(room.id)&&!pendingNames.has(room.id)){pendingNames.add(room.id);window.live.getProfile(room.id).then(p=>{connectedNames.set(room.id,p.name);renderChatStatus();}).catch(()=>{}).finally(()=>pendingNames.delete(room.id));}
    const label=key.toUpperCase()+' · '+(room?(room.name||connectedNames.get(room.id)||room.title||'直播间')+' · '+(sendPlatforms[platform]||'暂不支持发送'):'未连接');
    if(option.textContent!==label)option.textContent=label;
  }
  const room=channels[$('sendTarget').value]?.room,unsupported=room?.external&&!sendPlatforms[room.platform];
  $('chatText').disabled=Boolean(unsupported);$('chatText').maxLength=room?.external?100:40;
  $('sendChat').disabled=sending||Boolean(unsupported)||(!room?.external&&!account.loggedIn);
  $('emoteButton').hidden=Boolean(room?.external);$('emoteButton').disabled=sending||!room||!account.loggedIn;
  window.emotePicker?.targetChanged?.();
}
setInterval(renderSendTargets,1000);
$('sendTarget').addEventListener('change',()=>{renderSendTargets();$('sendStatus').replaceChildren();});
function sendFeedback(text,tabId){$('sendStatus').textContent=text;if(tabId){const button=document.createElement('button');button.type='button';button.textContent='查看后台直播页';button.addEventListener('click',()=>window.live.showSendPage(tabId).catch(error=>{$('sendStatus').textContent=error.message;}));$('sendStatus').append(' ',button);}return text;}
async function submitChat(emote=null,expectedRoom=null,quick=null){
  if(sending)return '正在发送，请稍候';
  const key=quick?.source||$('sendTarget').value,room=channels[key]?.room,draft=$('chatText').value,text=emote?emote.text:quick?String(quick.text||''):draft;
  if(!running||!room)return sendFeedback('请先连接直播，再发送弹幕');
  if(quick&&room!==quick.room)return sendFeedback('直播源已切换，请选择当前直播间的弹幕');
  if(room.external&&!sendPlatforms[room.platform])return sendFeedback('此平台暂不支持发送弹幕');
  if(emote&&(room.external||String(room.id)!==expectedRoom||emote.type!=='image'))return sendFeedback('发送目标已变化，请重新选择表情');
  if(!room.external&&!account.loggedIn)return sendFeedback('请先登录并刷新账号状态');
  if(!text.trim())return sendFeedback('弹幕内容为空');
  if(!emote&&Array.from(text).length>(room.external?100:40))return sendFeedback('弹幕过长，请通过回复编辑后发送');
  const target=key.toUpperCase()+' · '+(room.name||connectedNames.get(room.id)||room.title||'直播间');
  let echoed=false,releaseEcho=()=>{},resolveEcho;const echo=new Promise(resolve=>{resolveEcho=resolve;});
  const uid=String(account.uid),sourceRoom=String(room.id);
  if(!room.external)releaseEcho=live.onChat(m=>{const sameContent=emote?m.emoticon?.unique===emote.id:!m.emoticon&&String(m.text).trim()===text.trim();if(m.source===key&&String(channels[key]?.room?.id)===sourceRoom&&m.type==='message'&&String(m.uid)===uid&&sameContent){echoed=true;resolveEcho();}});
  sending=true;renderSendTargets();$('sendTarget').disabled=true;sendFeedback('正在发送到 '+target+'…');
  try{
    const result=await window.live.sendChat(room.id,text,account.uid,emote?{emoticon:emote.id}:{});
    if(result.error)return sendFeedback(result.error,result.tabId);
    if(!result.sent&&!result.submitted)return sendFeedback('发送结果未知，请在平台确认');
    if(!room.external&&!result.sent&&!echoed&&mix['chat'+key.toUpperCase()]){sendFeedback('已提交，等待回执…');let timer;await Promise.race([echo,new Promise(resolve=>timer=setTimeout(resolve,4000))]);clearTimeout(timer);}
    const confirmed=emote?echoed:result.sent||echoed;
    if(!quick&&!emote&&(confirmed||result.accepted||room.external&&result.submitted)&&$('chatText').value===draft){$('chatText').value='';window.emotePicker?.clear();}
    return sendFeedback(confirmed?(emote?'表情已发送 · ':'已发送 · ')+target:emote?'未确认表情送达，请查看后台直播页；未自动重发':result.accepted||room.external?'已提交 · '+target:'未确认送达，请查看直播间；内容已保留',emote&&!confirmed?result.tabId:undefined);
  }catch(error){return sendFeedback(error.message);}
  finally{releaseEcho();sending=false;$('sendTarget').disabled=false;renderSendTargets();}
}
$('sendChatForm').addEventListener('submit',event=>{event.preventDefault();if(!event.isComposing)submitChat();});
window.chatSender={isOwn:message=>(message.platform||'bilibili')==='bilibili'&&account.loggedIn===true&&Number.isSafeInteger(account.uid)&&account.uid>0&&String(message.uid)===String(account.uid),sendEmote:(emote,room)=>submitChat(emote,room),repeat:async()=>'+1 暂停使用',reply(message,room){
  const key=message.source==='b'?'b':'a';
  if(sending)return sendFeedback('正在发送，请稍候');
  if(!room||channels[key]?.room!==room)return sendFeedback('直播源已切换，请选择当前直播间的弹幕');
  if(room.external&&!sendPlatforms[room.platform])return sendFeedback('此平台暂不支持发送弹幕');
  $('sendTarget').value=key;$('sendTarget').dispatchEvent(new Event('change'));window.emotePicker?.clear();
  const prefix='@'+String(message.user||'观众')+' ';
  if(!$('chatText').value.startsWith(prefix))$('chatText').value=prefix+$('chatText').value;
  window.playerUI?.wake();$('chatText').focus();$('chatText').setSelectionRange(prefix.length,$('chatText').value.length);
  return sendFeedback('回复 '+message.user+' · '+key.toUpperCase()+' 直播间');
}};
$('chatText').addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.isComposing||event.keyCode===229))event.preventDefault();});

for(const key of ['A','B']){
  const input=$('sourceVolume'+key);const stored=Number(localStorage.getItem('source-volume-'+key)??input.value);input.value=clamp(stored,0,100);
  input.addEventListener('input',()=>{localStorage.setItem('source-volume-'+key,input.value);applyMix();});
}
function offerRoom(room){
  if(!/^\d+$/.test(String(room)))return;
  $('favoriteRoom').value=String(room);$('favoriteError').textContent='从直播网页打开：收藏后可点击 A / B 选择来源';if(!$('favoriteDialog').open)$('favoriteDialog').showModal();
}
chrome.runtime.onMessage.addListener(message=>{if(message.type==='chooseRoom')offerRoom(message.room);});
const initialRoom=new URLSearchParams(location.search).get('room');if(initialRoom){offerRoom(initialRoom);history.replaceState(null,'',location.pathname);}
applyMix();refreshAccount();
chrome.tabs.getCurrent().then(tab=>{if(tab?.id)return chrome.tabs.update(tab.id,{autoDiscardable:false});}).catch(()=>{});
