(()=>{
  const chats=new Map(),listeners=new Set();
  const rpc=async(op,fields={})=>{const r=await chrome.runtime.sendMessage({op,...fields});if(!r?.ok){const error=new Error(r?.error||'插件连接已失效，请刷新页面');error.code=r?.errorCode;throw error;}return r.value;};
  window.live={
    ensureSources:async inputs=>{
      const platforms=inputs.map(value=>{if(/^\d+$/.test(String(value).trim()))return 'bilibili';try{const url=new URL(value);return /^https?:$/.test(url.protocol)?url.hostname==='live.bilibili.com'?'bilibili':'other':'';}catch{return '';}});
      if(!platforms.some(Boolean))return;
      const other=platforms.includes('other'),origins=other?['https://*/*','http://*/*']:[...new Set(['https://*.bilibili.com/*',...(chrome.runtime.getManifest().host_permissions||[])])];
      const access={origins},hint=other?'直播平台网站访问未授权，请点击连接直播或重连弹幕并允许访问。':'B 站网站访问未授权，请点击连接直播或重连弹幕并允许访问 bilibili.com。';
      // Ask while the click is active; automatic reconnects only check existing access.
      if(navigator.userActivation?.isActive){if(!await chrome.permissions.request(access))throw Error(hint);}
      else if(!await chrome.permissions.contains(access))throw Error(hint);
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
