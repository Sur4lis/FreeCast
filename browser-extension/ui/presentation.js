(()=>{
let minimized=false,lastView=viewMode;const avatarRevision={A:0,B:0},timers={};
const names={A:'A',B:'B'},profiles={A:null,B:null};
const platformNames={huya:'虎牙',douyu:'斗鱼',douyin:'抖音'};
function updateFavorites(input,p){if(p.pendingProfile||p.profileIncomplete)return;let changed=false;for(const f of favorites){if(String(f.inputId||f.id)!==input)continue;for(const key of ['name','avatar','title','roomId','anchorId','platform'])if(p[key]!==undefined&&f[key]!==p[key]){f[key]=p[key];changed=true;}}if(changed){renderFavorites();save();}}
const mainKey=()=>{const visible=['a','b'].filter(k=>mix['video'+k.toUpperCase()]);return (visible.includes(mix.main)?mix.main:visible[0]||'b').toUpperCase();};
const refresh=()=>{const key=mainKey(),src=$('quality'+key),dst=$('mainQuality');const signature=key+src.innerHTML+src.value; if(dst.dataset.signature!==signature){dst.innerHTML=src.innerHTML;dst.value=src.value;dst.dataset.signature=signature;}dst.dataset.source=key;dst.title=key+' · '+(src.dataset.playingQuality||src.selectedOptions[0]?.textContent||'');dst.disabled=$('connect').disabled||src.disabled;
  const hidden=viewMode==='full'&&minimized;document.body.classList.toggle('mini-minimized',hidden);$('restoreMini').hidden=!(hidden&&mix.videoA&&mix.videoB);};
function roomInfo(key,value={}){
  const input=$('room'+key).value.trim(),previous=profiles[key]?.input===input?profiles[key].value:{};
  const p={...previous,...value};profiles[key]={input,value:p};
  const title=$('sourceTitle'+key),name=$('title'+key),displayName=p.pendingProfile?'':String(p.name||'').trim();
  title.textContent=String(p.title||'').trim();title.title=title.textContent;title.hidden=!title.textContent;
  name.textContent=displayName;name.hidden=!displayName;
  name.title=[platformNames[p.platform],displayName,p.roomId?'房间 '+p.roomId:'',p.anchorId?'主播 ID '+p.anchorId:''].filter(Boolean).join(' · ');
  names[key]=displayName||key;
}
function clearInfo(key){profiles[key]=null;roomInfo(key);}
const avatar=async key=>{
  const rev=++avatarRevision[key],input=$('room'+key).value.trim(),img=$('avatar'+key);
  if(profiles[key]?.input!==input)clearInfo(key);
  img.referrerPolicy='no-referrer';img.src='assets/avatar.svg';img.title='正在获取 UP 头像';
  try{
    const p=await window.live.getProfile(input);if(rev!==avatarRevision[key]||$('room'+key).value.trim()!==input)return;
    let url;try{url=new URL(p.avatar);}catch{}img.src=url?.protocol==='https:'?url.href:'assets/avatar.svg';
    roomInfo(key,p);renderChatStatus();img.title=[p.name,p.roomId?'房间 '+p.roomId:''].filter(Boolean).join(' · ');img.alt=(p.name||key)+'头像';updateFavorites(input,p);
  }catch(error){if(rev===avatarRevision[key])img.title='主播资料暂不可用：'+error.message;}
};
async function refreshFavorites(){const items=favorites.filter(f=>{try{return /(^|\.)(huya|douyu|douyin)\.com$/.test(new URL(f.inputId||f.id).hostname);}catch{return false;}});for(let i=0;i<items.length;i+=3)await Promise.all(items.slice(i,i+3).map(async f=>{const input=String(f.inputId||f.id);try{updateFavorites(input,await window.live.getProfile(input));}catch{}}));}
window.presentation={roomInfo,profile(input){return Object.values(profiles).find(p=>p?.input===input)?.value;},name(key){const room=channels[key.toLowerCase()]?.room;return room?(room.name||connectedNames.get(room.id)||names[key]||key):names[key];},refresh,avatars(){for(const k of ['A','B'])avatar(k);refreshFavorites();},viewChanged(next){if(next!==lastView){minimized=false;lastView=next;}queueMicrotask(refresh);}};
$('mainQuality').addEventListener('change',()=>{const src=$('quality'+mainKey());src.value=$('mainQuality').value;src.dispatchEvent(new Event('change'));refresh();});
$('minimizeMini').addEventListener('click',()=>{if(viewMode!=='full')return;minimized=true;refresh();});$('restoreMini').addEventListener('click',()=>{minimized=false;refresh();});
for(const k of ['A','B']){$('avatar'+k).addEventListener('error',()=>{if(!$('avatar'+k).src.endsWith('/assets/avatar.svg'))$('avatar'+k).src='assets/avatar.svg';});$('room'+k).addEventListener('input',()=>{avatarRevision[k]++;clearInfo(k);renderChatStatus();$('avatar'+k).src='assets/avatar.svg';clearTimeout(timers[k]);timers[k]=setTimeout(()=>avatar(k),600);});}
refresh();window.presentation.avatars();
$('toggleAudioSettings').addEventListener('click',()=>{const open=$('audioSettings').hidden;$('audioSettings').hidden=!open;$('toggleAudioSettings').setAttribute('aria-expanded',String(open));$('toggleAudioSettings').textContent=open?'收起设置':'音频设置';});
})();
