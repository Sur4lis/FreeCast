(()=>{
  const states={a:null,b:null};
  function description(state){
    const n=state?.data?.viewers;
    return !state?.data?.unsupported&&Number.isSafeInteger(n)&&n>=0?'房间观众 '+n.toLocaleString('zh-CN'):'';
  }
  function render(){
    for(const key of ['a','b']){
      const state=states[key],text=description(state),upper=key.toUpperCase();
      const detail=state?.data?.updatedAt?'平台统计 · '+new Date(state.data.updatedAt).toLocaleTimeString('zh-CN')+' 更新':'';
      const el=$('sideAudience'+upper),value=text?upper+' · '+text:'';
      if(el.textContent!==value)el.textContent=value;
      el.hidden=!text;el.title=text?(state?.failed?'上次数据。':'')+detail:'';
    }
    document.querySelector('.room-audience-panel').hidden=!['A','B'].some(k=>!$('sideAudience'+k).hidden);
  }
  async function fetchStats(key,state){
    state.pending=true;state.next=Date.now()+30000;render();
    try{const data=await live.roomStats(state.room);if(states[key]!==state||state.generation!==generation)return;state.data=data;state.failed=false;}
    catch{if(states[key]===state)state.failed=true;}
    finally{state.pending=false;if(states[key]===state)render();}
  }
  function update(){
    for(const key of ['a','b']){
      const room=running&&!demo?channels[key]?.room?.id:null;
      if(!room){states[key]=null;continue;}
      if(!states[key]||states[key].room!==room||states[key].generation!==generation)states[key]={room,generation,next:0,pending:false,data:null};
      const state=states[key];if(!state.pending&&Date.now()>=state.next&&!state.data?.unsupported)fetchStats(key,state);
    }
    render();
  }
  window.roomAudience={update};setInterval(update,1000);update();
})();
