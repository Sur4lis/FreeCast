export function createRoomApi(api) {
function roomId(input) {
  const s = String(input).trim();
  let id = s;
  if (!/^\d+$/.test(s)) {
    let url;
    try { url = new URL(s); } catch { throw new Error('请输入房间号或完整的 B 站直播间链接'); }
    if (url.hostname !== 'live.bilibili.com' || !/^https?:$/.test(url.protocol)) throw new Error('仅支持 live.bilibili.com 直播间');
    id = url.pathname.replace(/^\//, '').replace(/\/$/, '');
  }
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new Error('房间号无效');
  return Number(id);
}
function trustedHost(host) {
  return ['bilibili.com', 'bilivideo.com', 'bilivideo.cn', 'biliapi.net'].some(d => host === d || host.endsWith('.' + d));
}

async function getProfile(input) {
  const id = roomId(input);
  const room = await api('/room/v1/Room/get_info?room_id=' + id);
  const anchor = await api('/live_user/v1/UserInfo/get_anchor_in_room?roomid=' + room.room_id);
  let avatar = '';
  try { const url = new URL(anchor.info?.face); if (url.hostname.endsWith('.hdslb.com')) { url.protocol = 'https:'; avatar = url.href; } } catch {}
  return { id: room.room_id, inputId: id, roomId: room.room_id, shortId: room.short_id || 0, anchorId: room.uid, platform: 'bilibili', name: anchor.info?.uname || `UP ${room.uid}`, avatar, title: room.title };
}
async function getStats(input) {
  const id=roomId(input),room=await api('/room/v1/Room/get_info?room_id='+id);
  if(!Number.isSafeInteger(room.room_id)||!Number.isSafeInteger(room.uid)||room.uid<=0)throw Error('房间信息暂不可用');
  const data=await api(`/xlive/general-interface/v1/rank/getOnlineGoldRank?roomId=${room.room_id}&ruid=${room.uid}&page=1&pageSize=1`);
  const raw=data?.onlineNum;
  const viewers=(typeof raw==='number'||typeof raw==='string'&&/^\d+$/.test(raw))&&Number.isSafeInteger(Number(raw))&&Number(raw)>=0?Number(raw):null;
  return {platform:'bilibili',room:room.room_id,viewers,updatedAt:Date.now()};
}
async function resolveRoom(input, quality = 10000) {
  quality = Number(quality);
  if (![80, 150, 250, 400, 10000, 15000, 20000, 30000].includes(quality)) throw new Error('不支持的画质选项');
  const id = roomId(input);
  const init = await api('/room/v1/Room/room_init?id=' + id);
  if (init.live_status !== 1) throw new Error(`房间 ${id} 当前未开播`);
  if (init.encrypted || init.is_locked || init.is_hidden) throw new Error('该房间有访问限制，请在 B 站官方页面查看');
  const [play, info] = await Promise.all([
    api(`/xlive/web-room/v2/index/getRoomPlayInfo?room_id=${init.room_id}&protocol=0,1&format=0,1,2&codec=0&qn=${quality}&platform=web&ptype=8`),
    api('/room/v1/Room/get_info?room_id=' + init.room_id).catch(() => ({}))
  ]);
  const sources = [], accepted = new Set();
  for (const stream of play.playurl_info?.playurl?.stream || []) {
    for (const format of stream.format || []) for (const codec of format.codec || []) {
      if (codec.codec_name !== 'avc' || codec.drm) continue;
      for (const qn of codec.accept_qn || []) accepted.add(qn);
      for (const u of codec.url_info || []) {
        const url = new URL(u.host + codec.base_url + u.extra);
        if (url.protocol !== 'https:' || !trustedHost(url.hostname)) continue;
        sources.push({ url: url.href, type: format.format_name === 'flv' ? 'flv' : 'hls', quality: codec.current_qn });
      }
    }
  }
  // FLV gives a continuous arriving edge, useful for long local delay buffers.
  sources.sort((a, b) => Number(b.type === 'flv') - Number(a.type === 'flv'));
  if (!sources.length) throw new Error('没有可播放的公开 AVC 直播流');
  const qualities = (play.playurl_info?.playurl?.g_qn_desc || []).filter(q => accepted.has(q.qn)).map(q => ({ value: q.qn, label: q.desc }));
  return { id: init.room_id, inputId: id, title: info.title || `直播间 ${id}`, sources, qualities, requestedQuality: quality };
}

return {roomId, trustedHost, getProfile, getStats, resolveRoom};
}
