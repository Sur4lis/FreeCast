const names = {douyu: '斗鱼', huya: '虎牙'};
const domains = {douyu: ['douyucdn.cn', 'douyu.com', 'douyucdn2.cn'], huya: ['msstatic.com', 'huya.com']};
const identifier = value => /^(?:[1-9]\d{0,19})$/.test(String(value ?? '')) ? String(value) : '';
const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
function avatar(value, platform) {
  try {
    const url = new URL(String(value).startsWith('//') ? 'https:' + value : String(value));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return '';
    if (!domains[platform].some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))) return '';
    url.protocol = 'https:';
    return url.href;
  } catch { return ''; }
}
export function parseFollowingItems(platform, list) {
  if (!['douyu', 'huya'].includes(platform) || !Array.isArray(list)) return [];
  const items = [], seen = new Set();
  for (const row of list.slice(0, 1000)) {
    if (!row || typeof row !== 'object') continue;
    const live = platform === 'douyu' ? row.show_status : row.isLive;
    if (![true, 1, '1'].includes(live)) continue;
    const alias = platform === 'huya' && /^[a-z][a-z\d_-]{0,59}$/i.test(String(row.privateHost || '')) ? row.privateHost : '';
    const roomId = identifier(platform === 'douyu' ? row.room_id : row.roomId || row.profileRoom) || alias;
    const name = text(platform === 'douyu' ? row.nickname : row.nick, 100);
    if (!roomId || !name || seen.has(roomId)) continue;
    seen.add(roomId);
    const id = 'https://www.' + platform + '.com/' + roomId;
    const anchorId = identifier(platform === 'douyu' ? row.owner_uid : row.uid);
    items.push({id, inputId: id, platform, external: true, roomId, name,
      avatar: avatar(platform === 'douyu' ? row.avatar_small : row.avatar180, platform),
      title: text(platform === 'douyu' ? row.room_name : row.roomName || row.introduction, 200),
      ...(anchorId ? {anchorId} : {}), ...(alias ? {aliases: ['https://www.huya.com/' + alias]} : {})});
  }
  return items;
}

export function createFollowingApi({request = fetch, huyaUid = async () => ''} = {}) {
  async function page(platform, url) {
    const name = names[platform];
    const response = await request(url, {credentials: 'include', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000)});
    const login = () => Error('请先在' + name + '官网登录，再导入关注列表');
    if ([401].includes(response.status)) throw login();
    if ([403, 412, 429].includes(response.status)) throw Error(name + '要求验证或请求过于频繁，请先在同一浏览器打开' + name + '完成验证，稍后重试（HTTP ' + response.status + '）');
    if (!response.ok) throw Error(name + '关注接口 HTTP ' + response.status);
    let result;
    try { result = await response.json(); } catch { throw Error(name + '关注接口返回异常，请打开平台完成登录或验证后重试'); }
    const code = platform === 'douyu' ? result?.error ?? result?.code : result?.statusCode;
    const message = text(result?.msg || result?.message || result?.statusMsg, 120);
    if (Number(code) === 401 || /未登[录陆]|登录.*(?:失效|过期)|token.*(?:失效|过期)/i.test(message)) throw login();
    if (code === undefined || code === null || Number(code) !== (platform === 'huya' ? 200 : 0)) {
      throw Error(name + '关注列表读取失败' + (code == null ? '' : '（' + String(code).slice(0, 20) + '）') + (message ? '：' + message : '，请重新登录后重试'));
    }
    let data = result.data;
    if (typeof data === 'string') try { data = JSON.parse(data); } catch { data = null; }
    if (!data || !Array.isArray(data.list)) throw Error(name + '关注列表格式发生变化，请稍后重试');
    return data;
  }
  return async function liveFollowing(platform) {
    if (!['douyu', 'huya'].includes(platform)) throw Error('暂不支持该平台的关注导入');
    const uid = platform === 'huya' ? identifier(await huyaUid()) : '';
    if (platform === 'huya' && !uid) throw Error('请先在虎牙官网登录，再导入关注列表');
    const items = new Map(), pages = new Set();
    let truncated = false;
    for (let index = 1; index <= 10; index++) {
      const url = platform === 'douyu'
        ? 'https://www.douyu.com/wgapi/livenc/liveweb/follow/list?' + new URLSearchParams({page: String(index), sort: '0', cid1: '0'})
        : 'https://open.huya.com/cache.php?' + new URLSearchParams({m: 'InterModalUser', do: 'getSubscribeList', appId: 'huya_h5_10', data: JSON.stringify({page: index, pageSize: 30, uid})});
      const data = await page(platform, url), list = data.list;
      if (!list.length) break;
      const fingerprint = JSON.stringify(list.map(row => platform === 'douyu' ? row?.room_id : row?.uid || row?.roomId || row?.profileRoom));
      if (pages.has(fingerprint)) { truncated = true; break; }
      pages.add(fingerprint);
      for (const item of parseFollowingItems(platform, list)) if (!items.has(item.id)) items.set(item.id, item);
      const more = platform === 'douyu' ? Number(data.pageCount) > index : list.length >= 30;
      if (!more) break;
      if (index === 10) truncated = true;
    }
    return {items: [...items.values()], total: items.size, truncated};
  };
}
