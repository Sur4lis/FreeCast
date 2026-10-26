function applyMix() {
  const a = $('audioA'), b = $('videoB');
  a.volume = Number($('volume').value) / 100 * Number($('sourceVolumeA').value) / 100;
  b.volume = Number($('volume').value) / 100 * Number($('sourceVolumeB').value) / 100;
  a.muted = mix.muted || !mix.audioA;
  b.muted = mix.muted || !mix.audioB;
  for (const key of ['audioA', 'audioB', 'videoA', 'videoB', 'chatA', 'chatB']) $(key.replace(/(A|B)$/, 'Toggle$1')).checked = mix[key];
  $('showChat').checked = mix.showChat;
  window.danmakuStyle?.sourceColors();
  $('mute').textContent = mix.muted ? '取消静音' : '静音';
  $('mute').setAttribute('aria-pressed', String(mix.muted));
  $('mute').setAttribute('aria-label', mix.muted ? '取消静音' : '静音');
  const visible = ['a', 'b'].filter(key => mix['video' + key.toUpperCase()]);
  const main = visible.includes(mix.main) ? mix.main : visible[0];
  const mini = visible.find(key => key !== main);
  const media = { a, b: window.vocal?.visual() || b };
  for (const key of ['a', 'b']) {
    const parent = key === main ? $('mainSlot') : key === mini ? $('miniSlot') : $('mediaParking');
    if (media[key].parentElement !== parent) parent.append(media[key]);
  }
  $('pictureOff').hidden = Boolean(main);
  $('miniPanel').hidden = !mini;
  $('miniEmpty').hidden = running;
  $('miniLabel').textContent = `${(mini || 'a').toUpperCase()} · 小窗`;
  $('miniEmpty').textContent = `连接后显示 ${(mini || 'a').toUpperCase()} 画面`;
  const sounds = ['a', 'b'].filter(key => mix['audio' + key.toUpperCase()]).map(key => key.toUpperCase());
  $('videoStatus').textContent = `主画面 ${main?.toUpperCase() || '关闭'} · ${mix.muted || !sounds.length ? '静音' : '声音 ' + sounds.join(' + ')}`;
  window.vocal?.applyMix();
  window.presentation?.refresh();
  window.streamLines?.refresh();
  window.miniWindow?.refresh();
}
function selectSource(key) {
  activeSource = key;
  document.querySelectorAll('[data-source]').forEach(el => el.classList.toggle('active-source', el.dataset.source === key));
  save();
}
async function useFavorite(favorite, target) {
  const input = $('room' + target.toUpperCase());
  input.value = String(favorite.inputId || favorite.id);
  window.presentation?.roomInfo(target.toUpperCase(),{name:favorite.name,title:favorite.title||''});
  selectSource(target); save(); window.presentation?.avatars();
  if (running && !demo && !$('connect').disabled) await connect();
  else notice(`${favorite.name} 已填入 ${target.toUpperCase()} 直播源，点击连接直播即可播放。`);
}
let draggedFavorite=null;
function renderFavorites() {
  if(draggedFavorite!==null)return;
  const list = $('favorites'); list.replaceChildren();
  if (!favorites.length) { const empty = document.createElement('span'); empty.className = 'favorites-empty'; empty.textContent = '把常看的 UP 主放在这里'; list.append(empty); }
  for (const favorite of favorites) {
    const card = document.createElement('div'); card.className = 'favorite';
    const button = document.createElement('button'); button.className = 'favorite-main'; button.draggable = true;
    button.title = `拖动排序，拖入 A / B 使用；点击放入 ${activeSource.toUpperCase()}`;
    const avatar = document.createElement('img'); avatar.alt = favorite.name + '头像'; avatar.draggable = false; avatar.referrerPolicy='no-referrer';
    const fallback = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#35412e"/><text x="20" y="27" text-anchor="middle" fill="#c8f583" font-size="18">UP</text></svg>');
    let url; try { url = new URL(favorite.avatar); } catch {}
    avatar.src = url?.protocol === 'https:' ? url.href : fallback;
    avatar.addEventListener('error', () => { avatar.src = fallback; }, { once: true });
    const name = document.createElement('span'); name.className = 'favorite-name'; name.textContent = favorite.name;
    button.append(avatar, name);
    button.addEventListener('dragstart', event => { draggedFavorite=String(favorite.id);card.classList.add('favorite-dragging');event.dataTransfer.setData('application/x-goat-room', String(favorite.id)); event.dataTransfer.setData('text/plain', String(favorite.inputId || favorite.id)); event.dataTransfer.effectAllowed = 'copyMove'; });
    button.addEventListener('dragend',()=>{draggedFavorite=null;renderFavorites();document.querySelectorAll('.source.drop-target').forEach(el=>el.classList.remove('drop-target'));});
    card.addEventListener('dragover',event=>{if(draggedFavorite===null||draggedFavorite===String(favorite.id))return;event.preventDefault();event.dataTransfer.dropEffect='move';const after=event.clientX>card.getBoundingClientRect().left+card.offsetWidth/2;card.classList.toggle('drop-after',after);card.classList.toggle('drop-before',!after);});
    card.addEventListener('dragleave',()=>card.classList.remove('drop-before','drop-after'));
    card.addEventListener('drop',event=>{if(draggedFavorite===null)return;event.preventDefault();event.stopPropagation();const from=favorites.findIndex(f=>String(f.id)===draggedFavorite);if(from<0||draggedFavorite===String(favorite.id))return;const after=event.clientX>card.getBoundingClientRect().left+card.offsetWidth/2;const [moved]=favorites.splice(from,1),target=favorites.findIndex(f=>f===favorite);favorites.splice(target+(after?1:0),0,moved);draggedFavorite=null;save();renderFavorites();});
    button.addEventListener('click', () => useFavorite(favorite, activeSource));
    const actions = document.createElement('div'); actions.className = 'favorite-actions';
    for (const key of ['a', 'b']) { const use = document.createElement('button'); use.textContent = key.toUpperCase(); use.title = `放入 ${key.toUpperCase()} 直播源`; use.addEventListener('click', () => useFavorite(favorite, key)); actions.append(use); }
    const remove = document.createElement('button'); remove.className = 'favorite-remove'; remove.textContent = '×'; remove.title = '取消收藏'; remove.setAttribute('aria-label', '取消收藏 ' + favorite.name);
    remove.addEventListener('click', () => { favorites = favorites.filter(f => f.id !== favorite.id); renderFavorites(); save(); });
    card.append(button, actions, remove); list.append(card);
  }
}
function updateView() {
  window.presentation?.viewChanged(viewMode);
  document.body.classList.toggle('view-full', viewMode === 'full');
  document.body.classList.toggle('view-theater', viewMode === 'theater');
  $('fullscreen').textContent = viewMode === 'full' ? '退出全屏' : '全屏 ⛶';
  $('theater').textContent = viewMode === 'theater' ? '退出部分全屏' : '部分全屏';
  $('fullscreen').setAttribute('aria-pressed', String(viewMode === 'full'));
  $('theater').setAttribute('aria-pressed', String(viewMode === 'theater'));
  window.playbackPerformance?.refresh();
}
let beforeFull = 'normal';
async function setView(next) {
  const previous = viewMode;
  if (next === 'full' && previous !== 'full') beforeFull = previous;
  try {
    viewMode = next; updateView();
    await window.live.fullscreen(next === 'full');
  } catch (error) { viewMode = previous; updateView(); notice('切换全屏失败：' + error.message, true); }
}
$('fullscreen').addEventListener('click', () => setView(viewMode === 'full' ? beforeFull : 'full'));
$('theater').addEventListener('click', () => setView(viewMode === 'theater' ? 'normal' : 'theater'));
window.live.onFullscreenLeft(() => { if (viewMode === 'full') { viewMode = beforeFull; updateView(); } });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing && !document.querySelector('dialog[open]')) { if ($('miniPanel').classList.contains('enlarged')) setMiniZoom(false); else if (viewMode !== 'normal') setView(viewMode === 'full' ? beforeFull : 'normal'); } });
for (const key of ['audioA', 'audioB', 'videoA', 'videoB']) $(key.replace(/(A|B)$/, 'Toggle$1')).addEventListener('change', event => { mix[key] = event.target.checked; applyMix(); save(); });
$('mute').addEventListener('click', () => { mix.muted = !mix.muted; applyMix(); save(); });
$('swapView').addEventListener('click', () => { mix.main = mix.main === 'a' ? 'b' : 'a'; applyMix(); save(); });
for (const source of document.querySelectorAll('[data-source]')) {
  source.addEventListener('focusin', () => selectSource(source.dataset.source));
  source.addEventListener('click', () => selectSource(source.dataset.source));
  source.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; source.classList.add('drop-target'); });
  source.addEventListener('dragleave', () => source.classList.remove('drop-target'));
  source.addEventListener('drop', event => {
    event.preventDefault(); source.classList.remove('drop-target');
    const favorite = favorites.find(f => String(f.id) === event.dataTransfer.getData('application/x-goat-room'));
    if (favorite) useFavorite(favorite, source.dataset.source);
  });
}
for (const id of ['roomA', 'roomB']) $(id).addEventListener('input', () => { if (connecting && !connecting.committing) cancelConnection(); save(); });
let favoriteRequest = 0;
function cancelFavoriteRequest() { favoriteRequest++; $('favoriteSubmit').disabled = false; }
$('addFavorite').addEventListener('click', () => { cancelFavoriteRequest(); $('favoriteRoom').value = $('room' + activeSource.toUpperCase()).value; $('favoriteError').textContent = ''; $('favoriteDialog').showModal(); $('favoriteRoom').focus(); });
$('favoriteCancel').addEventListener('click', () => { cancelFavoriteRequest(); $('favoriteDialog').close(); });
$('favoriteDialog').addEventListener('cancel', cancelFavoriteRequest);
$('favoriteRoom').addEventListener('input', () => { if ($('favoriteSubmit').disabled) { cancelFavoriteRequest(); $('favoriteError').textContent = '输入已更改，请重新添加'; } });
$('favoriteForm').addEventListener('submit', async event => {
  event.preventDefault(); $('favoriteSubmit').disabled = true; $('favoriteError').textContent = '正在获取头像与昵称…';
  const request = ++favoriteRequest, input = $('favoriteRoom').value.trim();
  const current = () => request === favoriteRequest && $('favoriteDialog').open;
  try {
    await window.live.ensureSources([input]);
    if (!current()) return;
    const favorite = await window.live.getProfile(input);
    if (!current()) return;
    if (!favorites.some(f => f.id === favorite.id)) { if (favorites.length >= 100) throw new Error('最多收藏 100 个 UP 主'); favorites.push(favorite); }
    renderFavorites(); save(); $('favoriteDialog').close(); notice(`已收藏 ${favorite.name}`);
  } catch (error) { if (current()) $('favoriteError').textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''); }
  finally { if (request === favoriteRequest) $('favoriteSubmit').disabled = false; }
});
let followingRequest = 0, followingItems = [], followingTruncated = false;
const followingPlatforms = {bilibili: {name: 'B 站', source: '1'}, douyu: {name: '斗鱼', source: 'https://www.douyu.com/'}, huya: {name: '虎牙', source: 'https://www.huya.com/'}};
function followingPlatform() { return Object.prototype.hasOwnProperty.call(followingPlatforms, $('followingPlatform').value) ? $('followingPlatform').value : 'bilibili'; }
const followingAvatarFallback = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#35412e"/><text x="20" y="27" text-anchor="middle" fill="#c8f583" font-size="18">UP</text></svg>');
function followingRoomId(value) {
  const input = String(value ?? '').trim();
  if (/^\d+$/.test(input)) return Number(input) || 0;
  try { const url = new URL(input); return url.hostname === 'live.bilibili.com' && /^https?:$/.test(url.protocol) && /^\/\d+\/?$/.test(url.pathname) ? Number(url.pathname.replaceAll('/', '')) : 0; } catch { return 0; }
}
function isBiliFavorite(favorite) {
  return (!favorite.platform || favorite.platform === 'bilibili') && followingRoomId(favorite.inputId || favorite.id) > 0;
}
function followingIdentity(value, platform) {
  const input = String(value ?? '').trim();
  if (/^[a-z\d_-]+$/i.test(input)) return input;
  try {
    const url = new URL(input), domain = platform + '.com';
    return /^https?:$/.test(url.protocol) && !url.username && !url.password &&
      (url.hostname === domain || url.hostname.endsWith('.' + domain)) && /^\/[a-z\d_-]+\/?$/i.test(url.pathname) ? url.pathname.replaceAll('/', '') : '';
  } catch { return ''; }
}
function followingFavoritePlatform(favorite) {
  if (favorite.platform) return favorite.platform;
  if (isBiliFavorite(favorite)) return 'bilibili';
  for (const platform of ['douyu', 'huya']) {
    const input = String(favorite.inputId || favorite.id);
    if (input.includes('://') && followingIdentity(input, platform)) return platform;
  }
  return '';
}
function followingOwned(item) {
  if (item.platform && item.platform !== 'bilibili') {
    const platform = item.platform;
    const ids = [item.id, item.inputId, item.roomId, ...(item.aliases || [])].map(value => followingIdentity(value, platform)).filter(Boolean);
    return favorites.find(f => followingFavoritePlatform(f) === platform && (
      [f.id, f.inputId, f.roomId, ...(f.aliases || [])].some(value => ids.includes(followingIdentity(value, platform))) ||
      item.anchorId && f.anchorId && String(f.anchorId) === String(item.anchorId)));
  }
  const ids = [item.id, item.roomId, item.inputId, item.shortId].map(followingRoomId).filter(Boolean);
  return favorites.find(f => isBiliFavorite(f) && (
    [f.id, f.inputId, f.roomId, f.shortId].some(value => ids.includes(followingRoomId(value))) ||
    item.anchorId && f.anchorId && String(f.anchorId) === String(item.anchorId)));
}
function followingBusy(busy) {
  $('importFollowing').disabled = busy;
  $('followingRefresh').disabled = busy;
  $('followingList').setAttribute('aria-busy', String(busy));
}
function clearFollowing() {
  followingRequest++; followingItems = []; followingTruncated = false;
  $('followingList').replaceChildren(); followingBusy(false);
}
function refreshFollowingStatus() {
  const pending = followingItems.filter(item => !followingOwned(item)).length;
  $('followingStatus').textContent = !followingItems.length
    ? '没有找到正在直播的关注主播'
    : `${followingTruncated ? '已读取前' : '正在直播'} ${followingItems.length} 位${pending ? '，点击右侧按钮收藏' : '，已全部收藏'}${followingTruncated ? '；关注较多，仅显示部分结果' : ''}${favorites.length >= 100 ? '；收藏已达上限 100' : ''}`;
}
async function importFollowingItem(item, button) {
  if (favorites.length >= 100) { notice('最多收藏 100 个 UP 主', true); return; }
  const request = followingRequest;
  const current = () => request === followingRequest && $('followingDialog').open;
  button.disabled = true; button.textContent = '正在导入';
  try {
    // Older favorites may contain only a short room number or a room URL.
    if ((!item.platform || item.platform === 'bilibili') && !followingOwned(item) && favorites.some(f => isBiliFavorite(f) && !f.roomId)) {
      const profile = await window.live.getProfile(item.id);
      if (!current()) return;
      if (Number(profile.id) === Number(item.id)) Object.assign(item, {shortId: profile.shortId, anchorId: profile.anchorId || item.anchorId});
    }
    if (!current()) return;
    const owned = followingOwned(item);
    if (owned) Object.assign(owned, {roomId: item.roomId, anchorId: item.anchorId, platform: item.platform || 'bilibili'});
    else {
      if (favorites.length >= 100) throw Error('最多收藏 100 个 UP 主');
      favorites.push({...item});
    }
    renderFavorites(); save(); renderFollowing(); notice(`${owned ? '已在收藏中：' : '已收藏 '}${item.name}`);
  } catch (error) {
    if (!current()) return;
    button.disabled = false; button.textContent = '导入';
    $('followingStatus').textContent = '导入失败：' + String(error.message || error);
  }
}
function renderFollowing() {
  const list = $('followingList'); list.replaceChildren();
  for (const item of followingItems) {
    const owned = Boolean(followingOwned(item));
    const row = document.createElement('div'); row.className = 'following-item' + (owned ? ' is-added' : '');
    const img = document.createElement('img'); img.alt = item.name + '头像'; img.referrerPolicy = 'no-referrer';
    let url; try { url = new URL(item.avatar); } catch {}
    img.src = url?.protocol === 'https:' ? url.href : followingAvatarFallback;
    img.addEventListener('error', () => { img.src = followingAvatarFallback; }, { once: true });
    const meta = document.createElement('span'); meta.className = 'following-meta';
    const name = document.createElement('strong'); name.textContent = item.name;
    const sub = document.createElement('small'); sub.textContent = owned ? '已在收藏中' : (item.title || '房间 ' + item.roomId);
    meta.append(name, sub);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'primary following-add';
    button.textContent = owned ? '已收藏' : '导入'; button.disabled = owned;
    button.setAttribute('aria-label', (owned ? '已收藏 ' : '收藏 ') + item.name);
    button.addEventListener('click', () => importFollowingItem(item, button));
    row.append(img, meta, button); list.append(row);
  }
  refreshFollowingStatus();
}
async function openFollowing() {
  const request = ++followingRequest;
  const platform = followingPlatform(), info = followingPlatforms[platform];
  followingItems = []; followingTruncated = false; $('followingList').replaceChildren();
  $('followingStatus').textContent = '正在读取' + info.name + '关注列表…'; followingBusy(true);
  if (!$('followingDialog').open) $('followingDialog').showModal();
  try {
    await window.live.ensureSources([info.source]);
    if (request !== followingRequest || !$('followingDialog').open) return;
    const result = await window.live.liveFollowing(platform);
    if (request !== followingRequest || !$('followingDialog').open) return;
    followingItems = Array.isArray(result?.items) ? result.items : [];
    followingTruncated = result?.truncated === true;
    renderFollowing();
  } catch (error) {
    if (request !== followingRequest || !$('followingDialog').open) return;
    $('followingStatus').textContent = String(error.message || error).replace(/^Error invoking remote method '[^']+': Error: /, '');
  } finally { if (request === followingRequest) followingBusy(false); }
}
$('importFollowing').addEventListener('click', openFollowing);
$('importFollowing').hidden = typeof window.live.liveFollowing !== 'function';
$('followingRefresh').addEventListener('click', openFollowing);
$('followingPlatform').addEventListener('change', openFollowing);
$('followingLogin').addEventListener('click', async () => {
  clearFollowing(); $('followingStatus').textContent = '登录完成后，点击重新读取';
  try { await window.live.authBrowser(followingPlatform()); }
  catch (error) { $('followingStatus').textContent = String(error.message || error); }
});
$('followingCancel').addEventListener('click', () => { clearFollowing(); $('followingDialog').close(); });
$('followingDialog').addEventListener('cancel', clearFollowing);
$('followingDialog').addEventListener('close', () => { if (!$('followingDialog').open) clearFollowing(); });
function followingAccountChanged() {
  if (!$('followingDialog').open) return;
  clearFollowing(); $('followingStatus').textContent = '账号已变更，请点击重新读取';
}
chrome.runtime.onMessage.addListener(message => { if (message.type === 'accountChanged' && (!message.platform || message.platform === followingPlatform())) followingAccountChanged(); });
window.addEventListener('freecast-account-changed', followingAccountChanged);
window.addEventListener('beforeunload', save);
applyMix(); renderFavorites(); selectSource(activeSource); updateView();
const playerSizeObserver=new ResizeObserver(() => {
  if (viewMode === 'normal') document.documentElement.style.setProperty('--player-height', ($('player').getBoundingClientRect().height+$('playerControlsHome').getBoundingClientRect().height) + 'px');
});
playerSizeObserver.observe($('player'));playerSizeObserver.observe($('playerControlsHome'));
const qualityNames = { 80: '流畅', 150: '高清', 250: '超清', 400: '蓝光', 10000: '原画', 15000: '2K', 20000: '4K', 30000: '杜比' };
function updateQualityState(key, quality) {
  const select=$('quality'+key);
  const option=[...$('quality'+key).options].find(o=>Number(o.value)===Number(quality));
  select.dataset.playingQuality=option?.textContent || qualityNames[quality] || String(quality);
  select.title='当前播放：'+select.dataset.playingQuality;
  window.presentation?.refresh();
}
function originalQualitySelected(key){return Number($('quality'+key).value)===10000||/原画/.test($('quality'+key).selectedOptions[0]?.textContent||'');}
async function notifyOriginalQuality(request,token){
  const limited=new Set();
  for(const key of ['a','b']){
    if(!request['original'+key.toUpperCase()])continue;
    const channel=channels[key],room=channel?.room,platform=room?.external?room.platform:'bilibili',quality=room?.sources?.[channel.index]?.quality;
    if((platform==='bilibili'&&Number(quality)<10000)||(platform==='douyin'&&!room.qualities?.some(q=>Number(q.value)===Number(quality)&&/原画/.test(q.label))))limited.add(platform);
  }
  const messages=await Promise.all([...limited].map(async platform=>{
    let unsigned=false;
    try{unsigned=platform==='bilibili'?(await window.live.authStatus()).loggedIn===false:(await window.live.qualitySession()).hasSession===false;}catch{}
    const name=platform==='bilibili'?'B 站':'抖音';
    return unsigned?'未登录 '+name+'，无法获取原画质，请登录后重试。':name+' 未返回原画质，已使用当前可用画质；请检查平台登录状态或画质限制。';
  }));
  if(messages.length&&generation===token&&(!connecting||connecting===request)&&!request.cancelled&&running)notice(messages.join('\n'),true);
}
function renderQualities(key, room) {
  if(room?.external){
    const select=$('quality'+key);select.replaceChildren();
    if(room.platform==='douyin'&&!room.qualities.some(q=>/原画/.test(q.label)))select.add(new Option('原画','10000'));
    for(const q of room.qualities){const option=document.createElement('option');option.value=q.value;option.textContent=q.label;select.append(option);}
    mix['quality'+key]=room.requestedQuality;select.value=room.requestedQuality;save();window.presentation?.refresh();return;
  }
  if(room)mix['quality'+key]=room.requestedQuality;
  const select = $('quality' + key), wanted = mix['quality' + key];
  const values = new Map((room?.qualities?.length ? room.qualities : Object.entries(qualityNames).map(([value, label]) => ({ value: Number(value), label }))).map(q => [q.value, q.label]));
  if (!values.has(wanted)) values.set(wanted, (qualityNames[wanted] || wanted) + '（请求）');
  select.replaceChildren();
  for (const [value, label] of [...values].sort((a, b) => b[0] - a[0])) { const option = document.createElement('option'); option.value = value; option.textContent = label;option.title='实际画质以平台返回为准'; select.append(option); }
  select.value = wanted;
  window.presentation?.refresh();
}
function renderChatStatus() {
  const enabled = ['a', 'b'].filter(key => mix['chat' + key.toUpperCase()]);
  $('chatHeading').textContent = enabled.length ? enabled.map(k => window.presentation?.name(k.toUpperCase()) || k.toUpperCase()).join(' + ') + ' 直播间弹幕' : '弹幕已关闭';
  $('chatStatus').textContent = enabled.length ? enabled.map(k => k.toUpperCase() + '：' + chatStates[k]).join(' · ') : 'A / B 均已关闭弹幕接收';
}
const chatRevisions = { a: 0, b: 0 };
async function refreshChat(key) {
  window.replay?.clearSource(key,false);
  const revision = ++chatRevisions[key], token = generation;
  (key === 'a' ? queue : queueB).clear();
  window.superChats?.clear(key);
  document.querySelectorAll(`#chatList [data-source="${key}"], #danmaku [data-source="${key}"]`).forEach(el => el.remove());
  await window.live.stopChat(key);
  if (revision !== chatRevisions[key] || token !== generation) return;
  chatStates[key] = '未连接'; renderChatStatus();
  if(channels[key]?.room.external&&!['huya','douyu','douyin'].includes(channels[key].room.platform)){chatStates[key]='该直播来源暂不支持独立弹幕';renderChatStatus();return;}
  if (running && !demo && mix['chat' + key.toUpperCase()] && channels[key]) await window.live.startChat(channels[key].room.id, key);
}
for (const key of ['A', 'B']) {
  let toggleRevision=0;
  renderQualities(key);
  $('quality' + key).addEventListener('change', async () => {
    mix['quality' + key] = Number($('quality' + key).value); save();
    if (running && !demo && !$('connect').disabled) await connect();
  });
  $('chatToggle' + key).addEventListener('change', async () => {
    const source=key.toLowerCase(),enabled=$('chatToggle'+key).checked,token=generation,revision=++toggleRevision;mix['chat'+key]=enabled;window.danmakuStyle?.sourceColors();save();
    const current=()=>token===generation&&revision===toggleRevision;
    try{if(enabled&&running&&!demo&&channels[source])await window.live.ensureSources([channels[source].room.id]);if(current())await refreshChat(source);}
    catch(error){if(current()){chatStates[source]=error.message;renderChatStatus();notice(error.message,true);}}
  });
}
function setMiniZoom(enabled) {
  $('miniPanel').classList.toggle('enlarged', enabled);
  $('zoomMini').textContent = enabled ? '恢复' : '放大';
  $('zoomMini').setAttribute('aria-pressed', String(enabled));
  window.miniWindow?.zoom(enabled);
}
$('zoomMini').addEventListener('click', () => setMiniZoom(!$('miniPanel').classList.contains('enlarged')));
$('miniSlot').addEventListener('dblclick', () => setMiniZoom(!$('miniPanel').classList.contains('enlarged')));
renderChatStatus();
// Enrich bundled favorites without restoring entries the user has removed.
Promise.allSettled(favorites.filter(f=>!f.external&&!f.avatar).map(async favorite=>{
  const profile=await window.live.getProfile(favorite.inputId||favorite.id);
  if(!favorites.includes(favorite))return;
  Object.assign(favorite,profile);
})).then(()=>{favorites=favorites.filter((f,i,all)=>all.findIndex(x=>x.id===f.id)===i);renderFavorites();save();});
