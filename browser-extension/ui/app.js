const $ = id => document.getElementById(id);
const { clamp, delays, targetTime, correction, ChatQueue } = Sync;
const queue = new ChatQueue();
const queueB = new ChatQueue();
const chatStates = { a: '未连接', b: '未连接' };
let channels = {}, running = false, paused = false, demo = false, generation = 0;
let connecting = null;
let offset = 0, pauseStarted = 0, pauseLag = 0, demoStart = 0, demoPaused = 0, lastDemoMessage = -1;
let audioContext, oscillator, gain, lane = 0;
const defaultMix = Object.freeze({ audioA: true, audioB: true, videoA: true, videoB: true, chatA: true, chatB: false, qualityA: 10000, qualityB: 10000, main: 'b', muted: false, showChat: true, showSC: true, danmakuTransparency: 50, danmakuSize: 20, danmakuSpeed: 1, scMaxDuration: 60, danmakuDensity: 75, danmakuArea: 50 });
let mix = {...defaultMix};
let favorites = [], activeSource = 'a', viewMode = 'normal';
const defaultFavorites = [
  { id: 84074, inputId: 84074, name: '炫神', avatar: '' },
  { id: 6, inputId: 6, name: '哔哩哔哩英雄联盟赛事', avatar: '' }
];
const settingsKey = 'dual-live-settings-v1';
const hadSavedPlayerSettings = Boolean(localStorage.getItem(settingsKey));
const noticePopup = (() => {
  const popup = $('connectionToast');
  let timer;
  function position() {
    if (popup.hidden) return;
    const anchor = $('connect').getBoundingClientRect(), width = popup.offsetWidth, height = popup.offsetHeight;
    const nearButton = viewMode === 'normal' && anchor.top >= height + 18 && anchor.top < innerHeight && anchor.right > 0 && anchor.left < innerWidth;
    popup.style.left = clamp(nearButton ? anchor.left + anchor.width / 2 - width / 2 : (innerWidth - width) / 2, 12, Math.max(12, innerWidth - width - 12)) + 'px';
    popup.style.top = (nearButton ? anchor.top - height - 10 : 16) + 'px';
  }
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, {passive:true});
  return {show(text, error) {
    clearTimeout(timer);popup.textContent = text;popup.classList.toggle('error', error);popup.hidden = false;position();
    timer = setTimeout(() => { popup.hidden = true; }, 2000);
  }};
})();
function notice(text, error = false) { $('notice').textContent = text; $('notice').classList.toggle('error', error); noticePopup.show(text, error); }
function save() {
  localStorage.setItem(settingsKey, JSON.stringify({ a: $('roomA').value, b: $('roomB').value, offset, base: $('base').value, chat: $('chatOffset').value, volume: $('volume').value, mix, favorites, activeSource }));
}
try {
  const s = JSON.parse(localStorage.getItem(settingsKey) || 'null');
  if (s) { $('roomA').value = s.a || '84074'; $('roomB').value = s.b || '6'; offset = clamp(Number(s.offset) || 0, -60, 60); $('base').value = ['3', '5', '8'].includes(s.base) ? s.base : '3'; $('chatOffset').value = clamp(Number(s.chat) || 0, -10, 30); $('volume').value = clamp(Number(s.volume) || 0, 0, 100); }
  if (s) {
    for (const key of ['audioA', 'audioB', 'videoA', 'videoB', 'chatA', 'chatB', 'muted', 'showChat', 'showSC']) if (typeof s.mix?.[key] === 'boolean') mix[key] = s.mix[key];
    for (const key of ['qualityA', 'qualityB']) if (Number.isSafeInteger(s.mix?.[key]) && s.mix[key]>=0 && s.mix[key]<=1000000) mix[key] = s.mix[key];
    for (const [key, min, max] of [['danmakuTransparency', 0, 100], ['danmakuSize', 14, 48]]) if (Number.isFinite(s.mix?.[key])) mix[key] = clamp(Math.round(s.mix[key]), min, max);
    if(Number.isFinite(s.mix?.danmakuSpeed))mix.danmakuSpeed=clamp(s.mix.danmakuSpeed,.5,2);
    if([0,10,15,30,60,120,300].includes(s.mix?.scMaxDuration))mix.scMaxDuration=s.mix.scMaxDuration;
    if(Number.isFinite(s.mix?.danmakuDensity))mix.danmakuDensity=clamp(Math.round(s.mix.danmakuDensity),20,100);
    if([25,50,75,100].includes(s.mix?.danmakuArea))mix.danmakuArea=s.mix.danmakuArea;
    mix.main = s.mix?.main === 'a' ? 'a' : 'b';
    favorites = Array.isArray(s.favorites) ? s.favorites.filter(f => ((Number.isSafeInteger(f.id) && f.id > 0) || (typeof f.id==='string' && /^https?:\/\//.test(f.id))) && typeof f.name === 'string').slice(0, 100) : [];
    activeSource = s.activeSource === 'b' ? 'b' : 'a';
  }
} catch { /* Invalid saved settings use defaults. */ }
// One-time migration: preserve existing favorites and respect later removals.
if (!localStorage.getItem('goat-default-favorites-v1')) {
  for (const item of defaultFavorites) if (!favorites.some(f => String(f.inputId || f.id) === String(item.id))) favorites.push({...item});
  save(); localStorage.setItem('goat-default-favorites-v1', '1');
}
function getDelays() { const d = delays(offset, Number($('base').value)), extra = window.vocal?.active && !demo ? window.vocal.delay + window.vocal.bufferPadding() : 0; return { a: d.a + pauseLag + extra, b: d.b + pauseLag + extra }; }
function updateOffset(value = offset) {
  const replayLag=window.replay?.active?window.replay.currentLag():null;
  offset = Math.round(clamp(Number(value) || 0, -60, 60) * 10) / 10;
  $('offset').value = offset;
  $('offsetValue').value = offset.toFixed(1);
  save();
  if(replayLag!==null)window.replay.seek(replayLag);
}
class Channel {
  constructor(media, room, name, token) {
    this.media = media; this.room = room; this.name = name; this.token = token; this.index = 0; this.latest = null; this.edgeAt = 0; this.closed = false; this.error = ''; this.lastProgress = performance.now();
    this.load();
  }
  destroyEngine() { clearTimeout(this.bufferRecovery);this.bufferRecovery=null;window.vocal?.detachMirror(this.media.id === 'videoB' ? 'b' : 'a'); if (this.engine) { this.engine.destroy(); this.engine = null; } this.media.pause(); this.media.removeAttribute('src'); this.media.load(); }
  load() {
    this.loadRevision=(this.loadRevision||0)+1;
    window.replay?.clearSource(this.name === 'A 音频' ? 'a' : 'b');
    this.destroyEngine(); this.playout = {}; this.latest = null; this.lastProgress = performance.now();
    if (this.name === 'A 音频') queue.clear();
    else queueB.clear();
    const source = this.room.sources[this.index];
    if (!source) { this.error = `${this.name} 所有线路连接失败，请重新连接`; notice(this.error, true); return; }
    this.error = '';
    updateQualityState(this.name === 'A 音频' ? 'A' : 'B', source.quality);
    queueMicrotask(()=>window.streamLines?.refresh());
    try {
      if (source.type === 'flv') {
        if (!mpegts.isSupported()) throw new Error('当前系统不支持 FLV 播放');
        this.engine = mpegts.createPlayer({ type: 'flv', isLive: true, url: source.url, cors:true, withCredentials:Boolean(this.room.external) }, {
          enableWorker: false, lazyLoad: false, liveBufferLatencyChasing: false, liveSync: false,
          autoCleanupSourceBuffer: true, autoCleanupMaxBackwardDuration: 150, autoCleanupMinBackwardDuration: 120,
          stashInitialSize: 128, fixAudioTimestampGap: true
        });
        this.engine.on(mpegts.Events.ERROR, () => this.fallback());
        this.engine.attachMediaElement(this.media);
        window.mediaBuffers?.attach(this);
        window.replay?.configure(this);
        window.vocal?.attachFLV(this.engine, this.media.id === 'videoB' ? 'b' : 'a');
        this.engine.load();
      } else {
        this.engine = new Hls({ enableWorker: false, lowLatencyMode: false, backBufferLength: 150,
          xhrSetup:xhr=>{xhr.withCredentials=Boolean(this.room.external);},
          maxBufferLength: 120, maxMaxBufferLength: 150, maxBufferSize: 160 * 1000 * 1000,
          liveSyncDuration: 3, liveMaxLatencyDuration: Infinity, maxLiveSyncPlaybackRate: 1 });
        this.engine.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) this.fallback(); });
        window.replay?.configure(this);
        window.vocal?.attachHLS(this.engine, this.media.id === 'videoB' ? 'b' : 'a');
        this.engine.loadSource(source.url); this.engine.attachMedia(this.media);
      }
    } catch { this.fallback(); }
  }
  fallback() {
    if (this.closed || this.retryTimer) return;
    const revision=this.loadRevision;
    notice(`${this.name} 当前线路异常，正在切换备用线路…`);
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      if (this.closed||this.loadRevision!==revision) return;
      this.index++;
      // URLs can expire. Resolve fresh URLs once after exhausting the original list.
      if (this.index >= this.room.sources.length && !this.refreshed) {
        this.refreshed = true;
        try { const fresh=await window.live.resolveRoom(this.room.id,this.room.requestedQuality,{line:this.room.line});if(this.closed||this.loadRevision!==revision)return;this.room=fresh;this.index=0; } catch { /* load displays failure */ }
      }
      if (!this.closed&&this.loadRevision===revision) this.load();
    }, 500);
  }
  sample(now) {
    window.mediaBuffers?.trim(this);
    const ranges = [];
    for (let i = 0; i < this.media.buffered.length; i++) ranges.push([this.media.buffered.start(i), this.media.buffered.end(i)]);
    if (ranges.length) {
      const end = ranges[ranges.length - 1][1];
      if (this.latest === null || end > this.latest + 0.01) { this.latest = end; this.edgeAt = now; this.lastProgress = now; }
    }
    if (now - this.lastProgress > 20000 && !this.error) { this.lastProgress = now; this.fallback(); }
    return ranges;
  }
  edge(now) { return this.latest === null ? null : this.latest + Math.min(5, (now - this.edgeAt) / 1000); }
  stop() { this.closed = true; clearTimeout(this.retryTimer); this.destroyEngine(); }
}
function clearChat() { window.chatRules?.reset(); queue.clear(); queueB.clear(); window.superChats?.clear(); $('chatList').replaceChildren(); $('danmaku').replaceChildren(); }
function connectionUI() {
  $('connect').disabled = Boolean(connecting?.committing);
  $('connect').textContent = connecting ? (connecting.committing ? '正在切换…' : '取消连接') : '连接直播 →';
  $('connect').setAttribute('aria-busy', String(Boolean(connecting)));
  $('qualityA').disabled = $('qualityB').disabled = Boolean(connecting);
  $('roomA').disabled = $('roomB').disabled = Boolean(connecting?.committing);
  $('stop').disabled = !running && !connecting;
  window.presentation?.refresh();
  window.streamLines?.refresh();
}
function cancelConnection(showNotice = true) {
  if (!connecting) return;
  connecting.cancelled = true; connecting = null; connectionUI();
  if (!running) $('playStatus').textContent = '准备就绪';
  if (showNotice) notice(running ? '已取消换源，继续播放当前直播。' : '已取消连接。');
}
async function stop({preserveConnection = null} = {}) {
  const closingRecording = window.localRecording?.stop();
  if (connecting !== preserveConnection) cancelConnection(false);
  window.vocal?.disable();
  window.replay?.reset();
  window.vocal?.reset();
  generation++; running = false; paused = false; demo = false; pauseLag = 0;
  window.playerUI?.wake();
  for (const channel of Object.values(channels)) channel.stop(); channels = {};
  if (oscillator) { oscillator.stop(); oscillator = null; }
  const closingAudio = audioContext; audioContext = null;
  const closingChats = window.live.stopChat();
  chatStates.a = chatStates.b = '未连接';
  clearChat();  $('placeholder').hidden = false;
  $('pause').disabled = true; $('stop').disabled = true; $('pause').textContent = '暂停'; $('player').classList.remove('paused');
  $('modeBadge').textContent = '待连接'; $('playStatus').textContent = '已断开'; $('chatStatus').textContent = '未连接 · 弹幕跟随 A 音频播放';
  updateOffset();
  applyMix();
  connectionUI();
  await Promise.allSettled([closingRecording, closingChats, closingAudio?.close()]);
}
async function connect() {
  cancelConnection(false);
  const request = connecting = {cancelled:false, committing:false, a:$('roomA').value.trim(), b:$('roomB').value.trim(), qualityA:mix.qualityA, qualityB:mix.qualityB, originalA:originalQualitySelected('A'), originalB:originalQualitySelected('B')};
  const current = () => connecting === request && !request.cancelled;
  connectionUI();
  try {
    await window.live.ensureSources([request.a, request.b]);
    if (!current()) return;
    notice(running ? '正在检查新直播源，当前直播继续播放…' : '正在获取两路直播…');
    if (!running) $('playStatus').textContent = '正在连接…'; save();
    const [a, b] = await Promise.all(['a','b'].map(async key => {
      try { return await window.live.resolveRoom(request[key], request['quality'+key.toUpperCase()], {preview:true}); }
      catch (error) { throw Error(key.toUpperCase()+' 直播源：'+String(error.message||error).replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    }));
    if (!current()) return;
    if (request.a !== $('roomA').value.trim() || request.b !== $('roomB').value.trim()) { cancelConnection(); return; }
    request.committing = true; connectionUI();
    await stop({preserveConnection:request});
    if (!current()) return;
    const token = generation;
    await window.live.prepareSources([a,b]);
    if (!current()) return;
    window.presentation?.avatars();
    window.presentation?.roomInfo('A',a); window.presentation?.roomInfo('B',b);
    renderQualities('A', a); renderQualities('B', b);
    applyMix();
    channels.a = new Channel($('audioA'), a, 'A 音频', token);
    channels.b = new Channel($('videoB'), b, 'B 画面', token);
    running = true; applyMix(); $('pause').disabled = false; $('stop').disabled = false;
    window.playerUI?.wake();
    $('modeBadge').textContent = 'LIVE · 组合播放'; $('placeholder').hidden = true;
    await refreshChat('a'); if (!current()) return;
    await refreshChat('b'); if (!current()) return;
    window.configurations?.connected();window.localRecording?.connected();
    notice('两路已连接。听到解说和画面不同步时，调整下方时间偏移。');
    notifyOriginalQuality(request,token);
  } catch (error) {
    if (!current()) return;
    const retained = running && !request.committing;
    if (request.committing) { await stop({preserveConnection:request}); if (!current()) return; }
    notice(String(error.message||error)+(retained?'；当前直播继续播放。':''), true);
    if (!retained) $('playStatus').textContent = '连接失败';
  } finally { if (connecting === request) { connecting = null; connectionUI(); } }
}
function showMessage(message, historyOnly = false) {
  if (message.isSelf === undefined) message = {...message, isSelf: window.chatSender?.isOwn(message) === true};
  if(window.chatBlocking?.isBlocked(message)||window.chatRules?.blocked(message))return;
  if(!historyOnly||message.type==='superchat')window.localRecording?.message(message);
  const merged=window.chatRules?.merge(message);
  if(merged){if(!historyOnly&&!merged.bullet?.isConnected)showDanmaku(message,merged);return;}
  if(message.type==='superchat'){window.superChats?.add(message);return;}
  const row = document.createElement('div'); row.className = 'chat-row';
  const username = document.createElement('span'); username.className = 'username'; username.textContent = (message.source ? '[' + message.source.toUpperCase() + '] ' : '') + message.user;
  row.dataset.source = message.source || 'a';
  window.chatBlocking?.decorate(row,username,message);
  row.append(username); ChatContent.append(row, message);const group=window.chatRules?.track(message,row);
  const list = $('chatList'), nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 70;
  $('chatEmpty')?.remove(); list.append(row); while (list.children.length > 180) list.firstChild.remove();
  if (nearBottom) list.scrollTop = list.scrollHeight;
  if(!historyOnly)showDanmaku(message,group);
}
function showDanmaku(message,group){
  if(!$('showChat').checked)return;
  const bullet = document.createElement('span'); bullet.className = message.isSelf ? 'bullet is-self' : 'bullet'; ChatContent.append(bullet, message);
  bullet.dataset.source = message.source || 'a';
  window.chatBlocking?.tag(bullet,message);
  window.chatRules?.attachBullet(group,bullet,message);
  if(window.danmakuLayout?.add(bullet))window.danmakuActions?.attach(bullet,message);
}
window.live.onChat(message => {
  if (!running || demo) return;
  const source = message.source === 'b' ? 'b' : 'a';
  if(message.type==='superchat-delete'){window.replay?.remove(source,message.ids);window.superChats?.remove(source,message.ids);return;}
  if (!mix['chat' + source.toUpperCase()]) return;
  if (message.type === 'status') { chatStates[source] = message.text; renderChatStatus(); return; }
  message = {...message, isSelf: window.chatSender?.isOwn(message) === true};
  const edge = channels[source]?.edge(performance.now());
  if (edge !== null && edge !== undefined) { window.replay?.remember({...message,source},edge); (source === 'a' ? queue : queueB).push(message, edge); }
});
function togglePause() {
  if (!running) return;
  window.replay?.capturePause();
  paused = !paused; const now = performance.now();
  if (paused) { pauseStarted = now; for (const c of Object.values(channels)) c.media.pause(); window.vocal?.pause(); demoPaused = now; }
  else if (!window.replay?.active) { pauseLag += (now - pauseStarted) / 1000; if (pauseLag > 90) { pauseLag = 0; clearChat(); notice('暂停超过 90 秒，已回到当前设定的直播延迟。'); } updateOffset(); }
  $('pause').textContent = paused ? '继续' : '暂停'; $('player').classList.toggle('paused', paused);
  if (gain) gain.gain.value = 0;
}
function tick() {
  if (!running) return;
  const now = performance.now(), d = getDelays();
  const miniMedia = $('miniSlot').querySelector('video');
  if (miniMedia) $('miniTime').textContent = `播放 ${Math.floor(miniMedia.currentTime / 60)}:${(miniMedia.currentTime % 60).toFixed(1).padStart(4, '0')} · 音画同轴 · 偏移 ${offset.toFixed(1)} s`;

  window.vocal?.tick();
  if(window.replay?.active){for(const c of Object.values(channels))c.sample(now);if(window.replay.step())return;}
  window.replay?.render();
  let buffering=false;
  for (const key of ['a','b']) {
    const c=channels[key],media=c.media,ranges=c.sample(now),edge=c.edge(now);
    if(paused)continue;
    if(c.error){buffering=true;continue;}
    if(window.vocal?.pipes[key]?.active){buffering ||= !window.vocal.pipes[key].ready;continue;}
    if(window.vocal?.active&&!window.vocal.pipes[key]?.active&&!window.vocal.ready&&!c.playout.started){buffering=true;continue;}
    const action=Sync.playoutStep(c.playout,{now,current:media.currentTime,ranges,edge,delay:d[key],ready:media.readyState});
    if(action.wait){media.pause();buffering=true;continue;}
    if(action.seek!==null&&!media.seeking){media.currentTime=action.seek;c.syncSeeks=(c.syncSeeks||0)+1;}
    media.playbackRate=action.rate;
    if(media.paused)media.play().catch(error=>{if(error.name!=='AbortError')notice('请点击继续播放。',true);});
    buffering ||= media.readyState<3;
  }
  window.superChats?.tick();
  if(paused){$('playStatus').textContent='已暂停 · 两路保持同一观看位置';return;}
  for (const key of ['a', 'b']) {
    const media = channels[key].media;
    const chatTime = media.currentTime;
    if (mix['chat' + key.toUpperCase()] && !media.paused && !media.seeking && media.readyState >= 3) {
      const ready=(key === 'a' ? queue : queueB).take(chatTime, Number($('chatOffset').value) || 0);
      ready.filter(m=>m.type==='superchat').forEach(m=>showMessage(m));
      ready.filter(m=>m.type!=='superchat').slice(-12).forEach(m=>showMessage(m));
    }
  }
  $('playStatus').textContent = buffering ? (window.vocal?.active&&!window.vocal.ready?'AI 正在准备 · 其他直播继续播放':'等待直播数据…') : window.vocal?.active?'AI 处理播放 · 音画已补偿':'播放中 · 偏移保持';
  if ($('notice').textContent.includes('正在切换备用线路') && !channels.a.retryTimer && !channels.b.retryTimer) notice('备用线路已恢复播放。线路切换后请确认音画偏移。');
}
$('connect').addEventListener('click', () => connecting ? cancelConnection() : connect());

$('stop').addEventListener('click', () => stop().then(() => notice('已断开连接')));
$('pause').addEventListener('click', togglePause);
$('offset').addEventListener('input', event => updateOffset(event.target.value));
function commitOffset(){const field=$('offsetValue');updateOffset(field.value.trim()!==''&&Number.isFinite(field.valueAsNumber)?field.valueAsNumber:offset);}
$('offsetValue').addEventListener('change',commitOffset);
$('offsetValue').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();commitOffset();}});
document.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => updateOffset(offset + Number(button.dataset.step))));
$('reset').addEventListener('click', () => { pauseLag = 0; updateOffset(0); });
$('base').addEventListener('change', () => updateOffset());
$('chatOffset').addEventListener('change', () => { $('chatOffset').value = clamp(Number($('chatOffset').value) || 0, -10, 30); save(); });
$('volume').addEventListener('input', () => { applyMix(); save(); });
$('showChat').addEventListener('change', () => { mix.showChat = $('showChat').checked; if (!mix.showChat) $('danmaku').replaceChildren(); window.superChats?.tick(); save(); });
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || document.querySelector('dialog[open]') || event.target.isContentEditable || event.target.closest('input,select,textarea,button,[role="button"]')) return;
  if (event.code === 'Space') { event.preventDefault(); togglePause(); }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); updateOffset(offset + (event.key === 'ArrowLeft' ? -.1 : .1)); window.configurations?.changed(); }
});
updateOffset(); setInterval(tick, 100);
