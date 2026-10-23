import { createBackend } from './backend.mjs';
import { createBilibiliSession } from './bilibili-session.mjs';
import { createPlatformSender } from './platform-sender.mjs';
import { createPlatformApi, parseSource, platformNames } from './platforms.mjs';
const platforms = createPlatformApi(), profiles = new Map(), profileRequests=new Map();
const platformSender=createPlatformSender();
chrome.tabs.onRemoved.addListener(id=>{platformSender.cleanup(id).catch(()=>{});});
const statsCache=new Map();
async function roomStats(input){
  const src=parseSource(input);
  if(src.platform!=='bilibili')return{platform:src.platform,viewers:null,unsupported:true};
  const key=String(backend.roomId(src.input)),entry=statsCache.get(key);
  if(entry&&Date.now()-entry.at<25000)return entry.promise;
  const promise=backend.getStats(key).catch(error=>{if(statsCache.get(key)?.promise===promise)statsCache.delete(key);throw error;});
  statsCache.set(key,{at:Date.now(),promise});if(statsCache.size>100)statsCache.delete(statsCache.keys().next().value);return promise;
}
async function resolveSource(input, quality, preview = false, line = '') {
  const src = parseSource(input);
  if (src.platform === 'bilibili') return backend.resolveRoom(src.input, [80,150,250,400,10000,15000,20000,30000].includes(Number(quality)) ? Number(quality) : 10000);
  if (!await chrome.permissions.contains({origins:['https://*/*','http://*/*']})) throw Error('请点击连接直播并允许访问其他平台');
  const result = await platforms.resolve(src.input, quality, line);
  profiles.set(src.input, {profile:{...result, sources:undefined},at:Date.now()});
  if (profiles.size > 100) profiles.delete(profiles.keys().next().value);
  if (!preview) await prepareSourceHeaders(result);
  return result;
}
async function prepareSourceHeaders(result) {
  if (!result.external) return;
  const src = parseSource(result.inputId || result.id);
  if (!await chrome.permissions.contains({origins:['https://*/*','http://*/*']})) throw Error('请允许访问直播平台');
  // Apply source-site headers only to requests initiated by this extension.
  const domain = new URL(src.input).hostname;
  const id = 100 + (src.platform === 'huya' ? 0 : src.platform === 'douyu' ? 1 : src.platform === 'douyin' ? 2 : 3 + [...profiles.keys()].indexOf(src.input));
  const referer = src.platform === 'direct' ? new URL(src.input).origin + '/' : src.input;
  const hosts = [...new Set(result.sources.map(s => new URL(s.url).hostname))];
  await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[id], addRules:[{id, priority:2,
    action:{type:'modifyHeaders', requestHeaders:[{header:'Referer',operation:'set',value:referer},{header:'Origin',operation:'set',value:new URL(referer).origin}]},
    condition:{initiatorDomains:[chrome.runtime.id],requestDomains:hosts,resourceTypes:['xmlhttprequest','media']}
  }]});
}
async function sourceProfile(input) {
  const src = parseSource(input);
  if (src.platform === 'bilibili') return backend.getProfile(src.input);
  const cached=profiles.get(src.input);
  if(cached&&!cached.profile.profileIncomplete&&Date.now()-cached.at<300000)return cached.profile;
  if(['huya','douyu','douyin'].includes(src.platform)&&await chrome.permissions.contains({origins:['https://*/*','http://*/*']})){
    if(!profileRequests.has(src.input))profileRequests.set(src.input,platforms.getProfile(src.input).then(profile=>{if(profiles.get(src.input)===cached||profiles.get(src.input)?.profile.profileIncomplete)profiles.set(src.input,{profile,at:Date.now()});if(profiles.size>100)profiles.delete(profiles.keys().next().value);return profiles.get(src.input)?.profile||profile;}).finally(()=>profileRequests.delete(src.input)));
    return profileRequests.get(src.input);
  }
  return cached?.profile || {id:src.input,inputId:src.input,external:true,pendingProfile:true,platform:src.platform,name:platformNames[src.platform] + ' · ' + src.url.pathname.slice(1,45),title:platformNames[src.platform] + '直播',avatar:''};
}
const {cookie,ensureDevice}=createBilibiliSession({cookies:chrome.cookies,permissions:chrome.permissions});
const backend = createBackend({ cookie, ensureDevice, cooldownStore: {
  get: async () => (await chrome.storage.session.get('lastDanmakuAt')).lastDanmakuAt || 0,
  set: value => chrome.storage.session.set({lastDanmakuAt:value})
}});
const pageUrl = chrome.runtime.getURL('ui/index.html');
// Scope request headers to this extension, never modify normal Bilibili page requests.
async function rules() {
  const siteRules = [['huya.com','https://www.huya.com/'],['douyu.com','https://www.douyu.com/'],['douyin.com','https://live.douyin.com/']].map(([domain,referer],i)=>({
    id:10+i,priority:1,action:{type:'modifyHeaders',requestHeaders:[{header:'Referer',operation:'set',value:referer},{header:'Origin',operation:'set',value:new URL(referer).origin}]},condition:{initiatorDomains:[chrome.runtime.id],requestDomains:[domain],resourceTypes:['xmlhttprequest','websocket']}
  }));
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds:[1,10,11,12], addRules:[...siteRules,{
    id:1, priority:1, action:{type:'modifyHeaders', requestHeaders:[
      {header:'Referer',operation:'set',value:'https://live.bilibili.com/'},
      {header:'Origin',operation:'set',value:'https://live.bilibili.com'}
    ]}, condition:{initiatorDomains:[chrome.runtime.id],requestDomains:['bilibili.com','bilivideo.com','bilivideo.cn','biliapi.net','bytefcdnrd.com','smtcdns.net'],resourceTypes:['xmlhttprequest','media','websocket']}
  }]});
}
let ready = rules();
ready.catch(() => {});
async function openPlayer() {
  const tabs = await chrome.tabs.query({url:pageUrl+'*'});
  if(tabs.length) {
    await chrome.tabs.update(tabs[0].id,{active:true});
    await chrome.windows.update(tabs[0].windowId,{focused:true});
  } else await chrome.tabs.create({url:pageUrl});
}
chrome.action.onClicked.addListener(()=>openPlayer().catch(()=>{}));
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id) return;
  const internal=sender.url?.split(/[?#]/)[0]===pageUrl;
  if(!internal) return;
  (async()=>{
    await ready;
    switch(message?.op) {
      case 'status': return backend.status();
      case 'qualitySession': {
        if(!await chrome.permissions.contains({origins:['https://*/*','http://*/*']}))return {hasSession:null};
        const cookies=await Promise.all(['sessionid','sessionid_ss'].map(name=>chrome.cookies.get({url:'https://live.douyin.com/',name})));
        return {hasSession:cookies.some(value=>Boolean(value?.value))};
      }
      case 'profile': return sourceProfile(message.room);
      case 'roomStats': return roomStats(message.room);
      case 'resolve': return resolveSource(message.room,message.quality,message.preview===true,message.line);
      case 'prepareSources': {
        if (!Array.isArray(message.rooms) || message.rooms.length!==2) throw Error('直播来源无效');
        for (const room of message.rooms) await prepareSourceHeaders(room);
        return true;
      }
      case 'chatConfig': {
        const src=parseSource(message.room);
        if(src.platform==='bilibili')return {...await backend.chatConfig(src.input),platform:'bilibili'};
        if(!await chrome.permissions.contains({origins:['https://*/*','http://*/*']}))throw Error('请允许访问直播平台后重连弹幕');
        return platforms.chatConfig(src.input);
      }
      case 'emoticons': return backend.emoticons(message.room);
      case 'sendChat': {
        const src=parseSource(message.room);
        if(src.platform==='bilibili'){
          if(message.emoticon){const emote=await backend.prepareEmote(message.room,message.emoticon,message.expectedUid);return platformSender.send(String(emote.room),emote.text,sender.tab?.id,{emote,expectedUid:message.expectedUid});}
          return backend.sendChat(message.room,message.text,message.expectedUid);
        }
        if(!await chrome.permissions.contains({origins:['https://*/*','http://*/*']}))throw Error('请允许访问直播平台后发送');
        return platformSender.send(message.room,message.text,sender.tab?.id);
      }
      case 'showSendPage': return platformSender.reveal(sender.tab?.id,message.tabId);
      case 'login': await chrome.tabs.create({url:'https://www.bilibili.com/'});return true;
      default: throw new Error('不支持的请求');
    }
  })().then(value=>respond({ok:true,value}),error=>respond({ok:false,error:error.message||'请求失败',errorCode:error.code}));
  return true;
});
chrome.cookies.onChanged.addListener(({cookie:changed})=>{
  if(['SESSDATA','DedeUserID','bili_jct'].includes(changed.name) && /(^|\.)bilibili\.com$/.test(changed.domain)) chrome.runtime.sendMessage({type:'accountChanged'}).catch(()=>{});
});

