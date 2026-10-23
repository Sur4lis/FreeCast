import { md5 } from './wbi.mjs';
import { webcastSign } from './webcast-sign.mjs';
// Platform request formats informed by Streamlink (BSD-2-Clause); see vendor/streamlink-LICENSE.txt.
// Parse data only. Never evaluate downloaded JavaScript or relax TLS validation.
export function parseSource(input) {
  const text = String(input).trim();
  if (/^\d+$/.test(text)) return {platform: 'bilibili', input: text};
  let url; try { url = new URL(text); } catch { throw Error('请输入 B 站房间号，或其他平台的完整直播链接'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('只支持 http / https 直播链接');
  url.hash = '';
  const host = url.hostname, is = d => host === d || host.endsWith('.' + d);
  const type = /\.m3u8$/i.test(url.pathname) ? 'hls' : /\.flv$/i.test(url.pathname) ? 'flv' : null;
  const platform = type ? 'direct' : host === 'live.bilibili.com' ? 'bilibili' : is('huya.com') ? 'huya' : is('douyu.com') ? 'douyu' : is('douyin.com') ? 'douyin' : 'generic';
  return {platform, input: url.href, url, type};
}
export const platformNames = {bilibili:'哔哩哔哩', huya:'虎牙', douyu:'斗鱼', douyin:'抖音', direct:'直播直链', generic:'其他平台'};
const decodeHtml = s => String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
export function jsonAt(text, start) {
  while (/\s/.test(text[start] || '') && start < text.length) start++;
  const first = text[start]; if (!['{', '[', '"'].includes(first)) return null;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') { quoted = false; if (first === '"') { try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; } } } continue; }
    if (c === '"') quoted = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { if (--depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}
function namedJson(text, key) {
  const match = new RegExp('(?:"' + key + '"|\\b' + key + ')\\s*[:=]\\s*').exec(text);
  return match ? jsonAt(text, match.index + match[0].length) : null;
}
function safeMedia(value, base) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { const u = new URL(decodeHtml(value), base); if (['http:', 'https:'].includes(u.protocol) && !u.username && !u.password) return u.href; } catch {}
  return null;
}
function findObject(root, predicate) {
  const queue = [root]; let seen = 0;
  while (queue.length && seen++ < 30000) { const node = queue.shift(); if (!node || typeof node !== 'object') continue; if (predicate(node)) return node; for (const v of Object.values(node)) if (v && typeof v === 'object') queue.push(v); }
  return null;
}
function room(input, data) {
  const sources = (data.sources || []).map(s => ({...s, url: safeMedia(s.url, input)})).filter(s => s.url);
  if (!sources.length) throw Error('未找到可播放的公开直播流；可能未开播、需要网页登录验证，或平台暂不兼容');
  return {id: input, inputId: input, external: true, avatar: '', ...data, sources};
}
function avatarUrl(values,input){for(const value of values){const url=safeMedia(value,input);if(url){const parsed=new URL(url);parsed.protocol='https:';return parsed.href;}}return '';}
function identifier(value){return typeof value==='string'?value:typeof value==='number'&&Number.isSafeInteger(value)?String(value):'';}
function profile(input,platform,data){return {id:input,inputId:input,external:true,platform,...data};}
function playbackProfile(read,input,platform,title){try{return read();}catch{return profile(input,platform,{name:platformNames[platform]+'主播',avatar:'',roomId:new URL(input).pathname.slice(1),title:title||platformNames[platform]+'直播',profileIncomplete:true});}}
function huyaData(html){let data=namedJson(html,'stream');if(typeof data==='string')try{data=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(data),c=>c.charCodeAt(0))));}catch{data=null;}return data;}
export function parseHuyaProfile(html,input){
  const info=huyaData(html)?.data?.[0]?.gameLiveInfo||{},anchor=namedJson(html,'TT_PROFILE_INFO')||{},meta=namedJson(html,'TT_ROOM_DATA')||{};
  if(!anchor.nick&&!info.nick)throw Error('虎牙未返回主播资料，请确认直播间链接');
  return profile(input,'huya',{name:anchor.nick||info.nick,avatar:avatarUrl([anchor.avatar,info.avatar180,info.avatar],input),roomId:identifier(anchor.profileRoom||meta.profileRoom||info.profileRoom)||new URL(input).pathname.slice(1),anchorId:identifier(anchor.lp||info.uid),title:meta.introduction||info.roomName||'虎牙直播'});
}
export function parseDouyuProfile(meta,input){
  const info=meta.room;if(!info?.nickname&&!info?.owner_name)throw Error('斗鱼未返回主播资料，请确认直播间链接');
  return profile(input,'douyu',{name:info.nickname||info.owner_name,avatar:avatarUrl([info.avatar?.big,info.owner_avatar,typeof info.avatar==='string'?info.avatar:null,info.avatar_mid,info.avatar?.middle,info.avatar_small],input),roomId:identifier(info.room_id),anchorId:identifier(info.owner_uid),title:info.room_name||'斗鱼直播'});
}
export function parseDouyuPage(page){
  // New Douyu pages embed roomInfo in Next.js Flight text chunks. Read JSON only.
  let flight='';
  for(const match of page.matchAll(/self\.__next_f\.push\(\s*/g)){
    const chunk=jsonAt(page,match.index+match[0].length);
    if(Array.isArray(chunk)&&chunk[0]===1&&typeof chunk[1]==='string')flight+=chunk[1];
  }
  for(const text of [flight,page]){
    for(const match of text.matchAll(/"roomInfo"\s*:\s*/g)){
      const info=jsonAt(text,match.index+match[0].length);
      if(info?.room&&/^\d+$/.test(String(info.room.room_id))&&(info.room.nickname||info.room.owner_name))return info;
    }
  }
  throw Error('斗鱼暂未返回房间资料，请确认链接或稍后重试');
}
export function huyaParams(anti, name, bitrate, now = Date.now(), uid = 12340000 + Math.floor(Math.random() * 10000)) {
  const a = new URLSearchParams(decodeHtml(anti)), fm = a.get('fm');
  if (!fm || !a.get('wsTime')) throw Error('虎牙直播鉴权数据不完整');
  const prefix = atob(decodeURIComponent(fm)).split('_')[0], user = ((uid << 8) | (uid >>> 24)) >>> 0;
  const seq = uid + now, ctype = a.get('ctype') || 'huya_live', t = 100;
  const secret = md5(`${prefix}_${user}_${name}_${md5(`${seq}|${ctype}|${t}`)}_${a.get('wsTime')}`);
  return new URLSearchParams({wsSecret:secret, wsTime:a.get('wsTime'), ctype, fs:a.get('fs') || '', seqid:String(seq), u:String(user), sdk_sid:String(now), ratio:String(bitrate), t:String(t), ver:'1', sv:'2401090219', codec:'264'});
}
export function parseHuya(html, input, quality = 0) {
  let data = namedJson(html, 'stream');
  if (typeof data === 'string') { try { data = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(data), c => c.charCodeAt(0)))); } catch { throw Error('虎牙直播数据格式已变化'); } }
  const entry = data?.data?.[0], info = entry?.gameLiveInfo;
  if (info?.isSecret) throw Error('该虎牙房间有访问限制，请在官方网页查看');
  if (!entry?.gameStreamInfoList?.length) throw Error('虎牙当前未返回公开直播流，请确认开播状态或网页登录状态');
  const qualities = (data.vMultiStreamInfo || [{iBitRate:0, sDisplayName:'原画'}]).filter(q=>!q.iCodecType).map(q => ({value:Number(q.iBitRate), label:q.sDisplayName || (q.iBitRate ? q.iBitRate + ' kbps' : '原画')})).filter((q,i,all)=>all.findIndex(x=>x.value===q.value)===i);
  const selected = qualities.some(q => q.value === quality) ? quality : 0;
  const sources = [];
  for (const s of entry.gameStreamInfoList) {
    if (!s.sFlvUrl || !s.sFlvAntiCode || !s.sStreamName) continue;
    const base = safeMedia(s.sFlvUrl, input); if (!base) continue;
    const url = new URL(base.replace(/\/$/, '') + '/' + s.sStreamName + '.' + (s.sFlvUrlSuffix || 'flv'));
    url.protocol = 'https:'; url.search = huyaParams(s.sFlvAntiCode, s.sStreamName, selected).toString();
    sources.push({url:url.href, type:'flv', quality:selected,line:s.sCdnType||'线路 '+(sources.length+1)});
  }
  return room(input, {...playbackProfile(()=>parseHuyaProfile(html,input),input,'huya',info?.roomName), qualities, requestedQuality:selected, sources});
}
export function douyuAuth(rid, timestamp, data) {
  if (!Number.isInteger(data.enc_time) || data.enc_time < 0 || data.enc_time > 10000 || typeof data.key !== 'string' || typeof data.rand_str !== 'string') throw Error('斗鱼鉴权参数异常');
  let value = data.rand_str;
  for (let i = 0; i < data.enc_time; i++) value = md5(value + data.key);
  return md5(value + data.key + (data.is_special === 1 ? '' : rid + timestamp));
}
function douyinData(html,input){
  const roots = [];
  for (const m of html.matchAll(/self\.(?:__pace_f|__next_f)\.push\(\[\d+,/g)) {
    const data = jsonAt(html, m.index + m[0].length);
    if (typeof data === 'string') { const body = data.replace(/^\w+:/, ''); try { roots.push(JSON.parse(body)); } catch {} }
  }
  for (const id of ['RENDER_DATA', '__NEXT_DATA__']) {
    const m = new RegExp('<script[^>]+id=["\x27]' + id + '["\x27][^>]*>([\\s\\S]*?)</script>').exec(html);
    if (m) try { roots.push(JSON.parse(id === 'RENDER_DATA' ? decodeURIComponent(m[1]) : m[1])); } catch {}
  }
  const wanted=new URL(input).pathname.split('/').filter(Boolean)[0];
  const matching=findObject(roots,n=>n.room&&n.anchor&&String(n.web_rid)===wanted);
  const store=matching||findObject(roots,n=>n.room&&n.anchor)||findObject(roots,n=>n.room&&n.room.status!==undefined);
  const info=store?.room||findObject(roots,n=>n.stream_url&&n.status!==undefined);
  return {info,anchor:store?.anchor||info?.owner,store};
}
export function parseDouyinProfile(html,input){
  const {info,anchor,store}=douyinData(html,input);
  if(!anchor?.nickname)throw Error('抖音未返回主播资料，请在同一浏览器完成网页登录/验证后重试');
  return profile(input,'douyin',{name:anchor.nickname,avatar:avatarUrl([...(anchor.avatar_thumb?.url_list||[]),...(anchor.avatar_medium?.url_list||[]),...(anchor.avatar_large?.url_list||[])],input),roomId:identifier(store?.web_rid||anchor.web_rid)||new URL(input).pathname.split('/').filter(Boolean)[0],anchorId:identifier(anchor.id_str||anchor.id),title:info?.title||'抖音直播'});
}
export function parseDouyin(html, input, quality = 0) {
  const {info,store}=douyinData(html,input);
  if (!info) throw Error('抖音未返回直播数据；请先在同一浏览器完成网页登录/验证后重试');
  if (Number(info.status) !== 2) throw Error('抖音房间当前未开播');
  const stream = info.stream_url||store?.web_stream_url||{}, levels = [], labels = {FULL_HD1:'原画', HD1:'高清', SD2:'标清', SD1:'流畅', ORIGIN:'原画'};
  for (const [key, url] of Object.entries(stream.flv_pull_url || {})) levels.push({key, url, type:'flv'});
  if (!levels.length && stream.hls_pull_url) levels.push({key:'ORIGIN', url:stream.hls_pull_url, type:'hls'});
  const rank = ['ORIGIN','FULL_HD1','HD1','SD2','SD1']; levels.sort((a,b) => (rank.indexOf(a.key.toUpperCase()) < 0 ? 99 : rank.indexOf(a.key.toUpperCase())) - (rank.indexOf(b.key.toUpperCase()) < 0 ? 99 : rank.indexOf(b.key.toUpperCase())));
  const qualities = levels.map((s,i) => ({value:i, label:labels[s.key.toUpperCase()] || s.key}));
  const selected = qualities.some(q => q.value === quality) ? quality : 0;
  return room(input, {...playbackProfile(()=>parseDouyinProfile(html,input),input,'douyin',info.title), qualities, requestedQuality:selected, sources:levels[selected] ? [{...levels[selected], quality:selected}] : []});
}
export function parseGeneric(html, input) {
  // Only explicitly embedded media sources: no scripts executed and no invented API URLs.
  const sources = [], add = value => { const url = safeMedia(value, input); if (!url) return; const path = new URL(url).pathname, type = /\.m3u8$/i.test(path) ? 'hls' : /\.flv$/i.test(path) ? 'flv' : null; if (type && !sources.some(s => s.url === url)) sources.push({url,type,quality:0}); };
  for (const m of html.matchAll(/<(?:video|source)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  for (const m of html.matchAll(/"(?:hls|flv|playUrl|play_url|hls_url|flv_url|contentUrl)"\s*:\s*("(?:\\.|[^"\\])*")/g)) { try { add(JSON.parse(m[1])); } catch {} }
  const title = decodeHtml(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] || new URL(input).hostname).trim().slice(0,160);
  return room(input, {platform:'generic', name:title, title, qualities:[{value:0,label:'源画质'}], requestedQuality:0, sources});
}
export function createPlatformApi({request = fetch} = {}) {
  async function get(url, options = {}) {
    const res = await request(url, {...options, credentials:'include', signal:AbortSignal.timeout(18000)});
    if (!res.ok) throw Error('平台请求失败：HTTP ' + res.status);
    return res;
  }
  async function html(url) { const res = await get(url); const text = await res.text(); if (text.length > 12_000_000) throw Error('网页数据过大，暂不支持'); return text; }
  async function douyuMeta(input) {
    let rid = /^\/(?:topic\/)?(\d+)/.exec(new URL(input).pathname)?.[1];
    if (!rid) { const page = await html(input); rid = /(?:"room_id"|\$ROOM\.room_id)\s*[:=]\s*"?(\d+)/.exec(page)?.[1]; }
    if (!rid) throw Error('斗鱼链接未包含有效房间号');
    let meta;
    try{meta=await (await get('https://www.douyu.com/betard/' + rid)).json();}catch{}
    if(!meta?.room?.room_id)meta=parseDouyuPage(await html('https://www.douyu.com/'+rid));
    return {meta,rid:String(meta.room?.room_id||rid)};
  }
  async function douyu(input, quality, line = '') {
    const {meta,rid}=await douyuMeta(input);
    if (meta.room && Number(meta.room.show_status) !== 1) throw Error('斗鱼房间当前未开播');
    const did = '10000000000000000000000000001501';
    const encResponse = await get('https://www.douyu.com/wgapi/livenc/liveweb/websec/getEncryption?did=' + did);
    let encryption;try{encryption=await encResponse.json();}catch{throw Error('斗鱼直播鉴权暂不可用，请稍后重试');}
    if (encryption.error !== 0 || !encryption.data) throw Error('斗鱼直播鉴权不可用，请稍后重试');
    const date = Date.parse(encResponse.headers.get('date')), ts = String(Math.floor((Number.isFinite(date) ? date : Date.now()) / 1000));
    const rates = meta.room?.multirates || [], rate = Number.isSafeInteger(quality) && quality >= 0 && quality < 10000 ? quality : 0;
    if(typeof line!=='string'||!/^[\w-]{0,40}$/.test(line))throw Error('线路参数无效');
    const body = new URLSearchParams({enc_data:encryption.data.enc_data, tt:ts, did, auth:douyuAuth(rid, ts, encryption.data), cdn:line, rate:String(rate), hevc:'0', fa:'0', ive:'0'});
    let response;try{response=await (await get('https://www.douyu.com/lapi/live/getH5PlayV1/' + rid, {method:'POST', body})).json();}catch{throw Error('斗鱼线路接口暂不可用，请稍后重试');}
    if (response.error !== 0 || !response.data?.rtmp_url || !response.data.rtmp_live) throw Error('斗鱼未提供可播放线路：' + (response.msg || response.error || '请确认网页登录状态'));
    const data = response.data, media = data.rtmp_url.replace(/\/$/, '') + '/' + data.rtmp_live;
    const qualities = (data.multirates || rates).map(q => ({value:q.rate, label:q.name || (q.bit ? q.bit + ' kbps' : '原画')}));
    const lines=(data.cdnsWithName||[]).filter(x=>typeof x.cdn==='string'&&/^[\w-]{1,40}$/.test(x.cdn)).map((x,i)=>({value:x.cdn,label:x.name||'线路 '+(i+1)}));
    return room(input, {...playbackProfile(()=>parseDouyuProfile(meta,input),input,'douyu',meta.room?.room_name), qualities:qualities.length ? qualities : [{value:0,label:'原画'}], requestedQuality:rate,lines,line:data.cdn||line||lines[0]?.value,sources:[{url:media,type:/\.m3u8(?:\?|$)/i.test(media)?'hls':'flv',quality:data.rate ?? rate}]});
  }
  async function resolve(input, quality = 0, line = '') {
    const src = parseSource(input); input = src.input; quality = Number(quality);
    if (src.platform === 'direct') return room(input, {platform:'direct', name:src.url.hostname, title:'直播直链 · ' + src.url.hostname, qualities:[{value:0,label:'源画质'}], requestedQuality:0, sources:[{url:input,type:src.type,quality:0}]});
    if (src.platform === 'huya') return parseHuya(await html(input), input, quality);
    if (src.platform === 'douyu') return douyu(input, quality, line);
    if (src.platform === 'douyin') return parseDouyin(await html(input), input, quality);
    if (src.platform === 'generic') return parseGeneric(await html(input), input);
    throw Error('B 站使用独立解析器');
  }
  async function getProfile(input){const src=parseSource(input);if(src.platform==='huya')return parseHuyaProfile(await html(src.input),src.input);if(src.platform==='douyu')return parseDouyuProfile((await douyuMeta(src.input)).meta,src.input);if(src.platform==='douyin')return parseDouyinProfile(await html(src.input),src.input);throw Error('该平台未提供独立主播资料');}
  async function chatConfig(input){
    const src=parseSource(input);
    if(src.platform==='douyu'){const {rid}=await douyuMeta(src.input);return {platform:'douyu',room:rid,urls:[8506,8503,8502,8505,8504,8501].map(p=>'wss://danmuproxy.douyu.com:'+p+'/')};}
    if(src.platform==='huya'){
      const page=await html(src.input),anchor=namedJson(page,'TT_PROFILE_INFO')||{},meta=namedJson(page,'TT_ROOM_DATA')||{},info=huyaData(page)?.data?.[0]?.gameLiveInfo||{};
      const uid=identifier(anchor.lp||info.uid),tid=identifier(meta.channel||info.channel||meta.liveChannel||info.liveChannel),sid=identifier(meta.liveChannel||info.liveChannel||meta.sid||tid);
      if(![uid,tid,sid].every(x=>/^\d+$/.test(x)))throw Error('虎牙弹幕房间信息不完整，请稍后重连');
      return {platform:'huya',uid,tid,sid,urls:['wss://cdnws.api.huya.com/']};
    }
    if(src.platform==='douyin'){
      const page=await html(src.input),{info:room,store}=douyinData(page,src.input),roomId=identifier(room?.id_str||store?.roomId);
      if(!/^\d+$/.test(roomId))throw Error('抖音弹幕房间信息不完整，请稍后重连');
      if(room?.status!=null&&Number(room.status)!==2)throw Error('抖音房间当前未开播');
      const userId=identifier(store?.user_unique_id)||String(7300000000000000000n+BigInt(Math.floor(Math.random()*1e12)));
      const params=new URLSearchParams({app_name:'douyin_web',version_code:'180800',webcast_sdk_version:'1.0.14-beta.0',update_version_code:'1.0.14-beta.0',compress:'gzip',device_platform:'web',cookie_enabled:'true',browser_language:'zh-CN',browser_platform:'Win32',browser_name:'Mozilla',browser_version:navigator.userAgent.replace(/^Mozilla\//,''),browser_online:'true',screen_width:'1920',screen_height:'1080',tz_name:'Asia/Shanghai',host:'https://live.douyin.com',aid:'6383',live_id:'1',did_rule:'3',endpoint:'live_pc',support_wrds:'1',user_unique_id:userId,im_path:'/webcast/im/fetch/',identity:'audience',room_id:roomId,heartbeatDuration:'0'});
      const now=Date.now();params.set('cursor',`t-${now}_r-1_d-1_u-1_fh-${roomId}`);params.set('internal_ext',`internal_src:dim|wss_push_room_id:${roomId}|wss_push_did:${userId}|first_req_ms:${now}|fetch_time:${now}|seq:1|wss_info:0-${now}-0-0`);params.set('need_persist_msg_count','15');
      const fields=['live_id','aid','version_code','webcast_sdk_version','room_id','sub_room_id','sub_channel_id','did_rule','user_unique_id','device_platform','device_type','ac','identity'];
      params.set('signature',webcastSign(md5(fields.map(key=>key+'='+(params.get(key)||'')).join(','))));
      return {platform:'douyin',room:roomId,urls:['webcast100-ws-web-lq','webcast3-ws-web-lq','webcast5-ws-web-lf'].map(host=>'wss://'+host+'.douyin.com/webcast/im/push/v2/?'+params)};
    }
    throw Error('该直播来源暂不支持独立弹幕');
  }
  return {resolve,getProfile,chatConfig};
}
