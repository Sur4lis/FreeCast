(()=>{
  const chats=new Map(),listeners=new Set();
  const rpc=async(op,fields={})=>{const r=await chrome.runtime.sendMessage({op,...fields});if(!r?.ok)throw new Error(r?.error||'插件连接已失效，请刷新页面');return r.value;};
  window.live={
    ensureSources:async inputs=>{
      const other=inputs.some(value=>{if(/^\d+$/.test(String(value).trim()))return false;try{return new URL(value).hostname!=='live.bilibili.com';}catch{return false;}});
      if(other&&!await chrome.permissions.request({origins:['https://*/*','http://*/*']}))throw Error('其他平台需要网站访问权限；取消后仍可使用 B 站');
    },
    resolveRoom:(room,quality,options={})=>rpc('resolve',{room,quality,preview:options.preview===true,line:options.line}),
    prepareSources:rooms=>rpc('prepareSources',{rooms}),
    getProfile:room=>rpc('profile',{room}),
    roomStats:room=>rpc('roomStats',{room}),
    authStatus:()=>rpc('status'),authBrowser:()=>rpc('login'),qualitySession:()=>rpc('qualitySession'),
    sendChat:(room,text,expectedUid,options={})=>rpc('sendChat',{room,text,expectedUid,...options}),
    emoticons:room=>rpc('emoticons',{room}),
    showSendPage:tabId=>rpc('showSendPage',{tabId}),
    fullscreen:async enabled=>{if(enabled&&!document.fullscreenElement)await document.documentElement.requestFullscreen();else if(!enabled&&document.fullscreenElement)await document.exitFullscreen();},
    onFullscreenLeft:fn=>document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)fn();}),
    onChat:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
    startChat:async(room,source='a')=>{
      chats.get(source)?.stop();
      let external=false;try{external=new URL(room).hostname!=='live.bilibili.com';}catch{}
      const Client=external?PlatformChat:BrowserChat;
      const chat=new Client(room,()=>rpc('chatConfig',{room}),data=>{for(const fn of listeners)fn({...data,source});});chats.set(source,chat);chat.start();
    },
    stopChat:async source=>{for(const key of source?[source]:[...chats.keys()]){chats.get(key)?.stop();chats.delete(key);}}
  };
  window.addEventListener('pagehide',()=>window.live.stopChat());
})();
