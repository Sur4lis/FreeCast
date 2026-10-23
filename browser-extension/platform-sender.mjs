import {parseSource} from './platforms.mjs';

// Executed only in an extension-owned room tab, after an explicit send click.
// The site handles login, CSRF, signatures, moderation and the actual submission.
export async function nativeChat({platform,room,text,mode='send',requestId}){
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const sameRoom=()=>{const wanted=new URL(room),here=new URL(location.href);return here.hostname===wanted.hostname&&here.pathname.replace(/\/$/,'')===wanted.pathname.replace(/\/$/,'');};
  if(!sameRoom())return{ok:false,error:'后台页面已离开目标直播间，请重新发送'};
  const visible=el=>Boolean(el&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
  const selectors={huya:'#pub_msg_input,textarea.chat-room__input,.chat-room__input textarea,.chat-room__input [contenteditable],#J_RoomChatSpeaker [contenteditable]',douyu:'.ChatSend-txt,[class*="ChatSend"] textarea',douyin:'[data-e2e="chat-input"][contenteditable],[data-e2e="chat-input"] [contenteditable],[data-e2e="chat-input"] textarea,textarea[placeholder*="聊天"],textarea[placeholder*="弹幕"],[data-placeholder*="聊天"][contenteditable],[data-placeholder*="弹幕"][contenteditable]'};
  function input(){return [...document.querySelectorAll(selectors[platform]||'textarea')].find(visible)||[...document.querySelectorAll('textarea,[contenteditable="true"],[contenteditable="plaintext-only"]')].find(el=>visible(el)&&/聊天|弹幕|说点|说两句/.test([el.getAttribute('placeholder'),el.getAttribute('data-placeholder'),el.getAttribute('aria-label')].join(' ')));}
  function sendButton(field){
    const fixed={huya:'#msg_send_bt,#pub_msg_send,.chat-room__submit',douyu:'.ChatSend-button',douyin:'[data-e2e="chat-send-button"]'};
    const exact=[...document.querySelectorAll(fixed[platform]||'button')].find(visible);if(exact)return exact;
    let node=field.parentElement;for(let depth=0;node&&depth<6;depth++,node=node.parentElement){const button=[...node.querySelectorAll('button,[role="button"],[class*="send"],[class*="Send"]')].find(el=>visible(el)&&/^发送$/.test(el.textContent.trim()));if(button)return button;}return null;
  }
  const state=globalThis.__freecastChatBridge ||= {attempts:new Map()};
  if(!state.pause){state.pause=()=>document.querySelectorAll('video,audio').forEach(media=>{media.muted=true;if(!media.paused)media.pause();});document.addEventListener('play',state.pause,true);state.observer=new MutationObserver(state.pause);state.observer.observe(document.documentElement,{childList:true,subtree:true});}state.pause();
  if(requestId&&state.attempts.has(requestId))return state.attempts.get(requestId);
  let field;
  for(let i=0;i<40;i++){if(!sameRoom())return{ok:false,error:'后台页面跳转，请重新检查直播间'};field=input();if(field)break;await wait(500);}
  if(!field)return{ok:false,needsPage:true,error:'未找到聊天输入框，请在后台直播页完成登录或验证后重试'};
  if(mode==='prepare')return{ok:true,ready:true};
  if(field.disabled||field.getAttribute('contenteditable')==='false')return{ok:false,needsPage:true,error:'聊天暂不可用，请在后台直播页完成登录或验证'};
  const existing=('value' in field?field.value:field.innerText).trim();
  if(existing&&existing!==text)return{ok:false,needsPage:true,error:'后台直播页已有未发送草稿，请先处理该草稿'};
  const max=Number(field.getAttribute('maxlength'));if(max>0&&[...text].length>max)return{ok:false,error:'该平台最多允许 '+max+' 字'};
  field.focus();
  if('value' in field){const proto=field.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(field,text);}
  else {const selection=getSelection(),range=document.createRange();range.selectNodeContents(field);selection.removeAllRanges();selection.addRange(range);if(!document.execCommand('insertText',false,text))field.textContent=text;}
  field.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));field.dispatchEvent(new Event('change',{bubbles:true}));await wait(150);
  if(!sameRoom())return{ok:false,error:'目标直播间已变化，未发送'};
  const button=sendButton(field);if(!button||button.disabled||button.getAttribute('aria-disabled')==='true'||/(?:^|[\s_-])disabled(?:[\s_-]|$)/i.test(button.className))return{ok:false,needsPage:true,error:'平台发送按钮不可用，请检查登录、禁言或发送间隔'};
  const unknown={ok:false,unknown:true,error:'已请求发送，但未收到明确回执，请在后台直播页确认；未自动重发'};
  if(requestId){state.attempts.set(requestId,unknown);if(state.attempts.size>30)state.attempts.delete(state.attempts.keys().next().value);}
  const feedback=()=>[...document.querySelectorAll('[role="alert"],[class*="toast"],[class*="Toast"],[class*="message-notice"]')].filter(visible).map(e=>e.textContent.trim()).join(' ').slice(0,300);
  const before=feedback();button.click();
  let cleared=false;
  for(let i=0;i<12;i++){
    await wait(250);const message=feedback();
    if(message&&message!==before&&/登录|验证|禁言|频繁|失败|敏感|限制|绑定|等级|关注/.test(message)){const result={ok:false,needsPage:/登录|验证|绑定/.test(message),error:message};if(requestId)state.attempts.set(requestId,result);return result;}
    if(!sameRoom())return unknown;
    if(('value'in field?field.value:field.innerText).trim()==='')cleared=true;
  }
  if(cleared){const result={ok:true,submitted:true};if(requestId)state.attempts.set(requestId,result);return result;}
  return unknown;
}

// Runs only in our muted Bilibili room tab. The site's own emote item submits the message.
export async function nativeBiliEmote({room,roomUrls=[room],emote,expectedUid,requestId}){
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const sameRoom=()=>roomUrls.some(url=>{const wanted=new URL(url);return location.origin===wanted.origin&&location.pathname.replace(/\/$/,'')===wanted.pathname.replace(/\/$/,'');});
  if(!sameRoom())return{ok:false,needsPage:true,error:'后台页面已离开目标直播间，未发送'};
  const state=globalThis.__freecastBiliEmote ||= {attempts:new Map()};
  if(state.attempts.has(requestId))return state.attempts.get(requestId);
  if(state.pending)return{ok:false,error:'上一条表情仍在发送，请稍候'};
  state.pending=true;
  if(!state.pause){state.pause=()=>document.querySelectorAll('video,audio').forEach(media=>{media.muted=true;if(!media.paused)media.pause();});document.addEventListener('play',state.pause,true);state.observer=new MutationObserver(state.pause);state.observer.observe(document.documentElement,{childList:true,subtree:true});}state.pause();
  const visible=el=>Boolean(el&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
  const imageKey=value=>{try{const u=new URL(value,location.href);return u.hostname.replace(/^i\d+\./,'')+u.pathname.split('@')[0];}catch{return '';}};
  const wantedImage=imageKey(emote.url);
  let restore=()=>{},timer;
  try{
    const response=await fetch('https://api.bilibili.com/x/web-interface/nav',{credentials:'include',signal:AbortSignal.timeout(12000)}),account=await response.json();
    if(account.code!==0||account.data?.isLogin!==true)return{ok:false,needsPage:true,error:'请在后台 B 站直播页完成登录后重试'};
    if(Number(account.data.mid)!==expectedUid)return{ok:false,needsPage:true,error:'后台 B 站账号已变化，未发送表情'};
    let opener;
    for(let i=0;i<40&&sameRoom();i++){opener=[...document.querySelectorAll('.emoticons-panel[title="表情包"]')].find(visible);if(opener)break;await wait(500);}
    if(!opener||!sameRoom())return{ok:false,needsPage:true,error:'未找到 B 站原生表情入口，请检查后台直播页的登录或验证提示'};
    if(![...document.querySelectorAll('.emoticons-pane')].some(visible))opener.click();
    let item;
    for(let i=0;i<30&&sameRoom();i++){item=[...document.querySelectorAll('.emoticons-pane .img-pane .emoticon-item')].find(el=>imageKey(el.querySelector('img')?.src)===wantedImage);if(item)break;await wait(300);}
    if(!item||!sameRoom())return{ok:false,needsPage:true,error:'后台直播页没有找到此表情，未发送；请刷新表情列表'};
    if(item.classList.contains('lock'))return{ok:false,error:'B 站提示此表情尚未解锁，未发送'};
    const pane=item.closest('.img-pane'),panes=[...pane.parentElement.querySelectorAll(':scope > .img-pane')],tabs=document.querySelectorAll('.emoticons-pane .tab-pane-item'),index=panes.indexOf(pane);
    if(!visible(item)&&index>=0){tabs[index]?.click();await wait(100);}
    if(!visible(item))return{ok:false,needsPage:true,error:'无法选中后台直播页的表情，未发送'};
    let resolveReply,observed=false;
    const reply=new Promise(resolve=>resolveReply=resolve),originalFetch=window.fetch;
    const wrapped=function(input,init){
      let matches=false;
      try{
        const url=new URL(typeof input==='string'?input:input.url,location.href),body=init?.body;
        if(url.hostname==='api.live.bilibili.com'&&url.pathname==='/msg/send'){
          if(observed||!(body instanceof FormData)||body.get('msg')!==emote.id||body.get('dm_type')!=='1'||body.get('roomid')!==String(emote.room)){
            const error='原生页面没有提交所选表情，已阻止误发文字或重复发送';
            resolveReply({ok:false,error});return Promise.resolve(new Response(JSON.stringify({code:-400,message:error}),{headers:{'content-type':'application/json'}}));
          }
          observed=true;matches=true;
        }
      }catch{}
      const request=Reflect.apply(originalFetch,this,arguments);
      try{
        if(matches){
          request.then(async response=>{const result=await response.clone().json();if(result.code!==0){resolveReply({ok:false,error:'B 站 '+result.code+'：'+(result.message||result.msg||'表情发送失败'),needsPage:[-101,-352,1990000].includes(Number(result.code))});return;}
            const warning=[result.message,result.msg].find(x=>x!=null&&String(x).trim()!==''&&String(x).trim()!=='0');
            if(warning){resolveReply({ok:false,error:'B 站未发送此表情：'+warning});return;}
            let extra=result.data?.mode_info?.extra;try{if(typeof extra==='string')extra=JSON.parse(extra);}catch{extra=null;}
            if(extra?.dm_type!=null&&Number(extra.dm_type)!==1){resolveReply({ok:false,error:'B 站返回的不是表情消息，未确认送达'});return;}
            resolveReply({ok:true,submitted:true,receipt:String(extra?.id_str||''),emoticon:emote.id});
          }).catch(()=>resolveReply({ok:false,unknown:true,error:'表情发送结果未知，请在后台直播页确认；未自动重发'}));
        }
      }catch{}
      return request;
    };
    window.fetch=wrapped;restore=()=>{if(window.fetch===wrapped)window.fetch=originalFetch;};
    const unknown={ok:false,unknown:true,needsPage:true,error:'未收到此表情的发送回执，请查看后台直播页；未自动重发'};
    state.attempts.set(requestId,unknown);if(state.attempts.size>30)state.attempts.delete(state.attempts.keys().next().value);
    if(!sameRoom())return{ok:false,needsPage:true,error:'后台页面已离开目标直播间，未发送'};
    item.click();
    const result=await Promise.race([reply,new Promise(resolve=>timer=setTimeout(()=>resolve({...unknown,error:observed?'表情发送结果未知，请查看后台直播页；未自动重发':'B 站未提交此表情，请查看后台直播页的校验提示'}),10000))]);
    state.attempts.set(requestId,result);return result;
  }catch{return{ok:false,needsPage:true,error:'后台 B 站页面校验失败，请打开后台直播页检查，未自动重发'};}
  finally{clearTimeout(timer);restore();state.pending=false;}
}

function matchesRoomUrl(value,rooms){
  try{const here=new URL(value);return rooms.some(room=>{const wanted=new URL(room);return here.origin===wanted.origin&&here.pathname.replace(/\/$/,'')===wanted.pathname.replace(/\/$/,'');});}catch{return false;}
}

export async function waitForRoomTab(browser,id,rooms,{timeout=20000,interval=250}={}){
  const deadline=Date.now()+timeout;
  do{
    const tab=await browser.tabs.get(id);
    // A new about:blank tab can still report complete while the real navigation is pending.
    if(tab.status==='complete'&&!tab.pendingUrl&&matchesRoomUrl(tab.url,rooms))return tab;
    if(tab.status==='complete'&&!tab.pendingUrl&&tab.url&&tab.url!=='about:blank'&&!matchesRoomUrl(tab.url,rooms))return null;
    if(Date.now()>=deadline)break;
    await new Promise(resolve=>setTimeout(resolve,interval));
  }while(true);
  return null;
}

export function createPlatformSender(browser=chrome){
  let pending=false;
  const key='freecast-send-tabs-v1',ruleId=id=>20000+(id%1000000000);
  const cleanUrl=input=>{const src=parseSource(input);if(!['bilibili','huya','douyu','douyin'].includes(src.platform))throw Error('此平台暂不支持发送');const url=new URL(src.platform==='bilibili'&&/^\d+$/.test(src.input)?'https://live.bilibili.com/'+src.input:src.input);const allowed={bilibili:['live.bilibili.com'],huya:['www.huya.com','huya.com'],douyu:['www.douyu.com','douyu.com'],douyin:['live.douyin.com']}[src.platform];if(!allowed.includes(url.hostname)||!/^\/[\w-]+\/?$/.test(url.pathname))throw Error('请使用该平台直播间的完整链接');url.protocol='https:';if(['huya','douyu'].includes(src.platform))url.hostname='www.'+src.platform+'.com';url.search='';url.hash='';return{...src,input:url.href};};
  const records=async()=> (await browser.storage.session.get(key))[key]||[];
  async function forget(record){try{const tab=await browser.tabs.get(record.id);if(matchesRoomUrl(tab.url,record.roomUrls||[record.room]))await browser.tabs.remove(record.id);}catch{}await browser.declarativeNetRequest.updateSessionRules({removeRuleIds:[ruleId(record.id)]});}
  async function tabFor(src,owner,roomUrls){
    let all=await records(),record=all.find(x=>x.owner===owner&&x.room===src.input),tab;
    if(record)try{tab=await browser.tabs.get(record.id);if(!matchesRoomUrl(tab.url,roomUrls)&&!matchesRoomUrl(tab.pendingUrl,roomUrls))tab=null;}catch{}
    if(tab){record.roomUrls=roomUrls;await browser.storage.session.set({[key]:all});return tab;}
    if(record){await forget(record);all=all.filter(x=>x!==record);}
    const mine=all.filter(x=>x.owner===owner);if(mine.length>=2){await forget(mine[0]);all=all.filter(x=>x!==mine[0]);}
    tab=await browser.tabs.create({url:'about:blank',active:false});await browser.tabs.update(tab.id,{muted:true,autoDiscardable:false});
    all.push({id:tab.id,owner,room:src.input,roomUrls});await browser.storage.session.set({[key]:all});
    await browser.declarativeNetRequest.updateSessionRules({removeRuleIds:[ruleId(tab.id)],addRules:[{id:ruleId(tab.id),priority:5,action:{type:'block'},condition:{tabIds:[tab.id],regexFilter:'\\.(flv|m3u8|m4s|ts)([?]|$)',resourceTypes:['media','xmlhttprequest']}}]});
    await browser.tabs.update(tab.id,{url:src.input});
    return tab;
  }
  async function send(room,text,owner,options={}){
    const src=cleanUrl(room);if(!Number.isInteger(owner))throw Error('播放器标签页无效');
    if(src.platform==='bilibili'&&(!options.emote||options.emote.type!=='image'||!options.emote.allowed||!options.emote.id||!options.emote.url||!Number.isSafeInteger(options.expectedUid)||!Number.isSafeInteger(options.emote.room)))throw Error('请选择可发送的 B 站大表情');
    const roomUrls=[src.input];
    if(src.platform==='bilibili'){
      if(options.emote.room<=0||!matchesRoomUrl(src.input,['https://live.bilibili.com/'+options.emote.room]))throw Error('表情与目标房间不一致，未发送');
      if(Number.isSafeInteger(options.emote.pageRoom)&&options.emote.pageRoom>0)roomUrls.push('https://live.bilibili.com/'+options.emote.pageRoom);
    }
    if(typeof text!=='string'||!text.trim()||[...text.trim()].length>100||/[\u0000-\u001f\u007f]/.test(text))throw Error('请输入 1–100 字的单行弹幕');
    if(pending)throw Error('上一条弹幕正在发送，请稍候');pending=true;let tab,clicked=false;
    try{
      const last=(await browser.storage.session.get('freecast-last-platform-send'))['freecast-last-platform-send'];
      if(last&&Date.now()-last<3000)throw Error('发送太快，请稍等 3 秒');
      tab=await tabFor(src,owner,roomUrls);
      const check=await waitForRoomTab(browser,tab.id,roomUrls);
      if(!check)return{sent:false,error:'后台直播页未能加载，请检查网络或完成平台验证后重试',tabId:tab.id,needsPage:true};
      await browser.storage.session.set({'freecast-last-platform-send':Date.now()});clicked=true;
      const values=await browser.scripting.executeScript({target:{tabId:tab.id},world:src.platform==='bilibili'?'MAIN':'ISOLATED',func:src.platform==='bilibili'?nativeBiliEmote:nativeChat,args:[{platform:src.platform,room:src.input,roomUrls,text:text.trim(),emote:options.emote,expectedUid:options.expectedUid,requestId:crypto.randomUUID()}]});
      const result=values[0]?.result;if(!result?.ok)return{sent:false,submitted:false,error:result?.error||'发送结果未知，请检查后台直播页',page:src.input,tabId:tab.id,needsPage:result?.needsPage===true};
      return{submitted:true,sent:false,platform:src.platform,room:src.input,receipt:result.receipt,emoticon:result.emoticon,...(src.platform==='bilibili'?{tabId:tab.id}:{})};
    }catch(error){if(clicked)return{sent:false,error:'发送结果未知，请检查后台直播页，未自动重发',tabId:tab?.id};throw error;}finally{pending=false;}
  }
  async function cleanup(owner){const all=await records(),mine=all.filter(x=>x.owner===owner);for(const r of mine)await forget(r);if(mine.length)await browser.storage.session.set({[key]:all.filter(x=>x.owner!==owner)});}
  async function reveal(owner,id){const record=(await records()).find(x=>x.id===id&&x.owner===owner);if(!record)throw Error('后台直播页已关闭');await browser.tabs.update(id,{active:true});}
  return{send,cleanup,reveal};
}
