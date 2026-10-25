import { createRoomApi } from './rooms.mjs';
import { signWbi } from './wbi.mjs';
import { createFollowingApi } from './live-following.mjs';

const liveUpId = value => /^\d+$/.test(String(value ?? '')) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0;
// The live-up feed identifies each room only through its public live link.
function liveUpRoom(value) {
  const direct = liveUpId(value);
  if (direct) return direct;
  if (typeof value !== 'string') return 0;
  try {
    const url = new URL(value);
    if (url.hostname !== 'live.bilibili.com' || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return 0;
    return liveUpId(url.pathname.replace(/^\/+|\/+$/g, ''));
  } catch { return 0; }
}
function liveUpFace(value) {
  try {
    const url = new URL(String(value).startsWith('//') ? 'https:' + value : String(value));
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    if (!['hdslb.com', 'biliimg.com'].some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))) return '';
    return url.href;
  } catch { return ''; }
}
function liveUpArray(data) {
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.list)) return data.list;
  const queue = [data];
  for (let seen = 0; queue.length && seen < 2000; seen++) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') continue;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) { if (value.some(item => item && typeof item === 'object' && (item.room_id || item.roomId || item.roomid || item.link))) return value; }
      else if (value && typeof value === 'object') queue.push(value);
    }
  }
  return [];
}
// Only publishable fields are returned: favorites never receive raw API payloads.
export function parseLiveUpItems(data) {
  const items = [], seen = new Set();
  for (const value of liveUpArray(data)) {
    if (!value || typeof value !== 'object') continue;
    const roomId = liveUpRoom(value.room_id || value.roomId || value.roomid || value.link);
    if (!roomId || seen.has(roomId)) continue;
    if (value.live_status !== undefined && Number(value.live_status) !== 1) continue;
    const name = String(value.uname || value.name || '').trim().slice(0, 100);
    if (!name) continue;
    const uid = liveUpId(value.uid || value.mid);
    seen.add(roomId);
    items.push({id: roomId, inputId: roomId, name, avatar: liveUpFace(value.face || value.avatar), title: String(value.title || '').trim().slice(0, 200), roomId, ...(uid ? {anchorId: uid} : {}), platform: 'bilibili'});
  }
  return items;
}
const liveUpQuery = offset => 'web_location=333.1007'
  + '&x-bili-locale-json=' + encodeURIComponent(JSON.stringify({c_locale: {language: 'zh', script: 'Hans'}, always_translate: false}))
  + '&x-bili-device-req-json=' + encodeURIComponent(JSON.stringify({platform: 'web', device: 'pc', spmid: '333.1007', mobi_app: 'web_cn'}))
  + (offset === null ? '' : '&offset=' + offset);

// Credentials stay in the browser cookie jar. Never copy SESSDATA into storage or a message.
export function createBackend({ request = fetch, cookie, cooldownStore, ensureDevice, huyaUid }) {
  const platformFollowing = createFollowingApi({request, huyaUid});
  const pending = new Set();
  const lastSent = new Map();
  let wbiImages;
  async function json(url, options = {}) {
    const response = await request(url, { ...options, credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('B 站接口 HTTP ' + response.status);
    const result = await response.json();
    if (result.code !== 0) throw new Error(`B 站 ${result.code}：${result.message || result.msg || '请求失败'}`);
    return result;
  }
  const api = async path => (await json('https://api.live.bilibili.com' + path)).data;
  const rooms = createRoomApi(api);
  // The live-up feed only lists followed anchors who are currently streaming.
  async function liveFollowing(platform = 'bilibili') {
    if (platform !== 'bilibili') return platformFollowing(platform);
    const items = new Map();
    let offset = null, truncated = false;
    for (let page = 0; page < 5; page++) {
      let data;
      try { data = (await json('https://api.bilibili.com/x/polymer/web-dynamic/v1/live-up?' + liveUpQuery(offset))).data; }
      catch (error) {
        if (/-101|未登录/.test(error.message)) throw Error('请先在 B 站官网登录，再导入关注列表');
        if (/-352|校验|HTTP 412|HTTP 429/.test(error.message)) throw Error('B 站要求验证或请求过于频繁，请先在同一浏览器打开 B 站完成验证，稍后重试（' + error.message + '）');
        throw error;
      }
      const before = items.size;
      for (const item of parseLiveUpItems(data)) if (!items.has(item.id)) items.set(item.id, item);
      const next = liveUpId(data?.offset);
      // Stop when the feed has no more pages, repeats an offset, or returns nothing new.
      if (![true, 1, '1'].includes(data?.has_more) || !next || next === offset || items.size === before) break;
      offset = next;
      if (page === 4) truncated = true;
    }
    return {items: [...items.values()], total: items.size, truncated};
  }
  async function status() {
    const response = await request('https://api.bilibili.com/x/web-interface/nav', { credentials: 'include', redirect: 'error', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('登录状态检查失败：HTTP ' + response.status);
    const value = await response.json();
    if(value.data?.wbi_img)wbiImages=value.data.wbi_img;
    if (value.code === -101 || value.data?.isLogin === false) return { loggedIn: false };
    if (value.code !== 0) throw new Error('登录状态暂不可用');
    wbiImages=value.data?.wbi_img;
    return { loggedIn: value.data?.isLogin === true, name: String(value.data?.uname || ''), uid: Number(value.data?.mid || 0) };
  }
  async function chatConfig(input) {
    const room = rooms.roomId(input);
    if(ensureDevice)await ensureDevice();
    // Refresh public signing keys for each reconnect. The old unsigned fallback can return unusable tokens.
    await status();
    let config;
    try{config = await api('/xlive/web-room/v1/index/getDanmuInfo?' + signWbi({id:room,type:0,web_location:'444.8'},wbiImages));}
    catch(error){if(error.message.includes('-352')||error.message.includes('-403'))throw Error('B 站弹幕校验未通过，请在同一浏览器打开 B 站完成验证后点重连弹幕');throw error;}
    const servers = (config.host_list || []).filter(x=>typeof x.host==='string'&&/^[\w.-]+\.chat\.bilibili\.com$/.test(x.host));
    const hosts = [...new Set(servers.flatMap(x=>{const port=Number(x.wss_port);return Number.isInteger(port)&&port>0&&port<=65535&&port!==443?[x.host+':'+port,x.host]:[x.host];}))];
    if (!config.token || !hosts.length) throw new Error('弹幕鉴权暂不可用');
    const [uid, buvid] = await Promise.all([cookie('DedeUserID'), cookie('buvid3')]);
    return { room, hosts, token: config.token, uid: Number(uid || 0), buvid: buvid || '' };
  }
  async function emoticons(input){
    const room=rooms.roomId(input),data=await api('/xlive/web-ucenter/v2/emoticon/GetEmoticons?platform=pc&room_id='+room);
    const safeImage=value=>{try{if(typeof value!=='string'||value.length>2048)return '';const u=new URL(value.startsWith('//')?'https:'+value:value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||!['hdslb.com','biliimg.com'].some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))return '';u.protocol='https:';return u.href;}catch{return '';}};
    return (data?.data||data?.packages||[]).slice(0,60).map(pack=>({id:String(pack.pkg_id||pack.id||''),name:String(pack.pkg_name||pack.name||'表情'),emotes:(pack.emoticons||[]).slice(0,300).map(e=>{
      // Bilibili pkg_type 3 inserts descript into ordinary text; other packs send dm_type 1.
      const type=Number(pack.pkg_type)===3?'text':'image',text=String(type==='text'?(e.descript||e.emoji||''):(e.emoji||e.descript||'[表情]'));
      return {id:String(e.emoticon_unique||(type==='text'?text:'')),type,text,url:safeImage(e.url),allowed:type==='text'||Number(e.perm)===1,reason:String(e.unlock_show_text||'当前账号暂不能发送此表情')};
    }).filter(e=>e.id&&e.text&&e.url)})).filter(p=>p.emotes.length);
  }
  async function sendChat(input, value, expectedUid, options={}) {
    if(options.emoticon)throw new Error('大表情请使用 B 站原生表情发送通道');
    const room = rooms.roomId(input);
    if (typeof value !== 'string' || !value.trim()) throw new Error('请输入弹幕内容');
    const text = value.trim();
    if ([...text].length > 40 || /[\u0000-\u001f\u007f]/u.test(text) || text.length>200) throw new Error('弹幕请使用 1–40 字的单行文字');
    if (pending.size) throw new Error('上一条弹幕正在发送，请稍候');
    pending.add(room);
    try {
      const stored = cooldownStore ? await cooldownStore.get() : 0;
      const last = Math.max(stored || 0, lastSent.get('all') || 0);
      if (Date.now() - last < 3000) throw new Error('发送太快，请稍等 3 秒');
      if(ensureDevice)await ensureDevice();
      const account = await status();
      if (!account.loggedIn) throw new Error('请先在同一浏览器登录 B 站，然后刷新登录状态');
      if (!Number.isSafeInteger(expectedUid) || account.uid !== expectedUid) throw new Error('浏览器账号已切换，请刷新登录状态后再发送');
      const csrf = await cookie('bili_jct');
      if (!csrf) throw new Error('登录校验已失效，请在 B 站重新登录');
      lastSent.set('all', Date.now());
      if (cooldownStore) await cooldownStore.set(Date.now());
      // Match the live web player's multipart submission and signed page location.
      const body = new FormData();
      for(const [key,value] of Object.entries({ bubble:'0', msg:text, color:'16777215', mode:'1', fontsize:'25', rnd:String(Math.floor(Date.now()/1000)), roomid:String(room), data_extend:'{}', csrf, csrf_token:csrf }))body.set(key,value);
      body.set('dm_type','0');
      // A timeout has an unknown outcome; do not retry and risk posting twice.
      let result;
      try { result = await json('https://api.live.bilibili.com/msg/send?' + signWbi({web_location:'444.8'},wbiImages), { method:'POST', body }); }
      catch (error) { if (error.name === 'TimeoutError' || error.name === 'TypeError') throw new Error('发送结果未知，请到直播间确认，未自动重发'); throw error; }
      const warning=[result.message,result.msg].find(value=>value!=null&&String(value).trim()!==''&&String(value).trim()!=='0');
      if(warning)throw new Error('平台提示：'+warning);
      let extra=result.data?.mode_info?.extra;
      if(typeof extra==='string')try{extra=JSON.parse(extra);}catch{extra=null;}
      const receipt=String(extra?.id_str||result.data?.mode_info?.id_str||'');
      // code=0 alone is not proof of publication (some moderation paths return an empty body).
      return {submitted:true,accepted:/^[a-z0-9_-]{1,128}$/i.test(receipt)&&!/^0+$/.test(receipt),receipt,room};
    } finally { pending.delete(room); }
  }
  async function prepareEmote(input,id,expectedUid){
    const room=rooms.roomId(input),account=await status();
    if(!account.loggedIn)throw Error('请先在同一浏览器登录 B 站');
    if(!Number.isSafeInteger(expectedUid)||account.uid!==expectedUid)throw Error('浏览器账号已切换，请刷新登录状态后再发送');
    // Official room pages redirect the real room ID to a short ID when one exists.
    // Resolve that identity through the API, never trust a redirected page as another room.
    const info=await api('/room/v1/Room/get_info?room_id='+room);
    const realRoom=info?.room_id,shortRoom=info?.short_id;
    if(!Number.isSafeInteger(realRoom)||realRoom<=0||![realRoom,shortRoom].includes(room))throw Error('B 站房间信息校验失败，未发送表情');
    const pageRoom=Number.isSafeInteger(shortRoom)&&shortRoom>0?shortRoom:realRoom;
    const emote=(await emoticons(realRoom)).flatMap(p=>p.emotes).find(e=>e.id===id);
    if(!emote||emote.type!=='image'||!emote.allowed)throw Error('当前账号或房间不能发送此表情，请刷新表情列表');
    return {...emote,room:realRoom,pageRoom};
  }
  return { ...rooms, status, chatConfig, sendChat, emoticons, prepareEmote, liveFollowing };
}
