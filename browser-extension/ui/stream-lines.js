(()=>{
  const revisions={a:0,b:0},pending={a:null,b:null};
  function render(key){
    const channel=channels[key],select=$('line'+key.toUpperCase());if(!select)return;
    const room=channel?.room,signature=JSON.stringify([room?.id,room?.sources?.map(s=>[s.type,s.line,s.cdn,new URL(s.url).hostname]),room?.lines]);
    if(select.dataset.signature!==signature){
      select.replaceChildren();
      if(!room){select.add(new Option('自动','0'));}
      else if(room.lines?.length){for(const [i,line] of room.lines.entries())select.add(new Option(line.label||'线路 '+(i+1),line.value));}
      else for(const [i,source] of (room.sources||[]).entries())select.add(new Option(source.line||'线路 '+(i+1)+' · '+source.type.toUpperCase(),String(i)));
      select.dataset.signature=signature;
    }
    const request=pending[key];
    if(request?.channel===channel&&request?.token===generation)select.dataset.loading=String(request.revision);else delete select.dataset.loading;
    select.disabled=!running||Boolean(connecting)||select.options.length<2||Boolean(select.dataset.loading);
    if(room)select.value=room.lines?.length?String(room.line||room.lines[0].value):String(channel.index);
    if(key===$('mainLine').dataset.source){$('mainLine').innerHTML=select.innerHTML;$('mainLine').value=select.value;$('mainLine').disabled=select.disabled;}
  }
  async function change(key,value){
    const channel=channels[key],token=generation;if(!running||!channel||connecting)return;
    const revision=++revisions[key],current=()=>running&&channel===channels[key]&&token===generation&&revision===revisions[key]&&!channel.closed;
    pending[key]={channel,token,revision};render(key);
    try{
      let room=channel.room,index=Number(value);
      if(room.lines?.length){room=await window.live.resolveRoom(room.inputId||room.id,room.requestedQuality,{line:value});index=0;}
      if(!current())return;
      if(!Number.isInteger(index)||!room.sources[index])throw Error('线路已失效，请重新连接直播');
      if(window.replay?.active)replay.live();
      if(window.vocal?.pipes[key]?.active)vocal.pipes[key].reset('line-switch');
      paused=false;pauseLag=0;$('pause').textContent='暂停';$('player').classList.remove('paused');
      clearTimeout(channel.retryTimer);channel.retryTimer=null;channel.room=room;channel.index=index;
      window.superChats?.clear(key);channel.load();notice(key.toUpperCase()+' 路已切换线路，正在缓冲');
    }catch(error){if(current())notice('线路切换失败：'+error.message,true);}finally{if(pending[key]?.revision===revision)pending[key]=null;refresh();}
  }
  function refresh(){const visible=['a','b'].filter(k=>mix['video'+k.toUpperCase()]);$('mainLine').dataset.source=visible.includes(mix.main)?mix.main:visible[0]||'b';for(const k of ['a','b'])render(k);}
  for(const k of ['a','b'])$('line'+k.toUpperCase()).addEventListener('change',e=>change(k,e.target.value));
  $('mainLine').addEventListener('change',e=>change(e.target.dataset.source,e.target.value));
  window.streamLines={refresh,change};refresh();
})();
