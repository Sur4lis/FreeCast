(()=>{
  let folder,db,session,startTask,stopping,recovering=false,scanRevision=0,error='',stage='',result,auto=false,includeMini=true,quality='source',moduleContext;
  const optionsKey='freecast-recording',abort=()=>new DOMException('已取消','AbortError'),busy=()=>Boolean(startTask||stopping||session?.active||recovering);
  try{const s=JSON.parse(localStorage.getItem(optionsKey)||'{}');auto=s.auto===true;includeMini=s.mini!==false;quality=window.recordQuality.normalize(s.quality);}catch{}
  $('autoRecord').checked=auto;$('recordMini').checked=includeMini;$('recordQuality').value=quality;
  const ready=new Promise(resolve=>{const request=indexedDB.open('freecast-recording',1);request.onupgradeneeded=()=>request.result.createObjectStore('handles');request.onsuccess=()=>{db=request.result;const read=db.transaction('handles').objectStore('handles').get('folder');read.onsuccess=()=>{folder=read.result;$('recordFolderName').textContent=folder?.name||'';resolve();};read.onerror=()=>resolve();};request.onerror=()=>resolve();});
  const size=bytes=>bytes>=1024**3?(bytes/1024**3).toFixed(2)+' GB':(bytes/1024**2).toFixed(1)+' MB';
  function status(){
    if(stopping||recovering)return stage||'正在完成 MP4…';
    if(error)return '保存未完成：'+error+(result?' · 已保留 '+Math.round(result.duration)+' 秒录像':'');
    if(session?.active)return '正在保存 '+Math.floor((vocal.ctx.currentTime-session.origin)/60)+' 分钟 · '+(session.segments?'已保护 '+session.segments+' 个片段':'首个片段保存中');
    if(startTask)return stage||'正在准备…';
    if(result)return '已保存 · '+Math.round(result.duration)+' 秒 · '+size(result.bytes);
    return folder?'已停止 · '+folder.name:'未选择文件夹';
  }
  function render(){
    const active=Boolean(session?.active),locked=busy();$('recordStatus').textContent=status();$('recordButton').textContent=active?'● 保存中':'本地保存';$('recordButton').classList.toggle('recording',active);
    $('startRecording').disabled=locked;$('stopRecording').disabled=(!active&&!startTask)||Boolean(stopping)||recovering;
    for(const id of ['chooseRecordFolder','recordQuality','checkRecordRecovery'])$(id).disabled=locked;
    for(const button of $('recordRecoveryList').querySelectorAll('button'))button.disabled=locked;
    const config=session?.config;$('recordQualityHint').textContent=config&&(active||startTask)?config.width+' × '+config.height+' · '+config.fps+' 帧 · 自动码率'+(config.adjusted?' · 已根据性能调整':''):window.recordQuality.presets[quality].hint;
    $('recordMetrics').textContent=active?'实测 '+(session.fps==null?'检测中':session.fps.toFixed(1)+' 帧/秒')+' · 已写入 '+size(session.bytes||0)+(session.slow?' · 性能不足，建议停止后选择性能模式':''):'';
  }
  async function permission(ask=false){await ready;if(!folder)throw Error('请先选择保存文件夹');let value=await folder.queryPermission({mode:'readwrite'});if(value!=='granted'&&ask)value=await folder.requestPermission({mode:'readwrite'});if(value!=='granted')throw Error('请允许访问保存文件夹');}
  async function choose(){try{const picked=await showDirectoryPicker({id:'freecast-recordings',mode:'readwrite'});await ready;folder=picked;if(db)try{db.transaction('handles','readwrite').objectStore('handles').put(folder,'folder');}catch{}error='';$('recordFolderName').textContent=folder.name;render();await scan();}catch(e){if(e.name!=='AbortError'){error=e.message;render();}}}
  function fail(s,e){if(s!==session)return;if(e.name==='AbortError')return;if(!error){error=String(e.message||e);notice('本地保存：'+error,true);}if(s.active)void stop();render();}
  function settle(s,type,value,e){const waiting=s.waiting.get(type);if(!waiting)return;s.waiting.delete(type);clearTimeout(waiting.timer);e?waiting.reject(e):waiting.resolve(value);}
  function request(s,send,expect,timeout=30000){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>settle(s,expect,null,Error('处理超时，已完成的片段仍可恢复')),timeout);s.waiting.set(expect,{resolve,reject,timer});s.worker.postMessage(send);});}
  function createWorker(s){
    s.worker=new Worker('record-worker.js',{type:'module'});s.waiting=new Map();s.done=new Promise(resolve=>{s.resolveDone=resolve;});
    s.worker.onmessage=e=>{
      const d=e.data;if(s!==session)return;s.lastWorkerAt=performance.now();
      if(d.type==='probeFrame'){
        try{if(s.cancel)throw abort();if(s.canvas.width!==d.width)s.canvas.width=d.width;if(s.canvas.height!==d.height)s.canvas.height=d.height;window.recordRenderer.draw(s.canvas,includeMini);const frame=new VideoFrame(s.canvas,{timestamp:0});s.worker.postMessage({type:'probeFrame',id:d.id,frame},[frame]);}catch(e){s.worker?.postMessage({type:'probeFrame',id:d.id,message:e.message});}return;
      }
      if(d.type==='error'){const problem=Error(d.message);for(const type of s.waiting.keys())settle(s,type,null,problem);fail(s,problem);}
      else if(d.type==='done'){s.resolveDone();settle(s,'done',d);}
      else if(d.type==='saved'){result=d;settle(s,'saved',d);}
      else if(d.type==='videoDone'){s.videoPending=false;if(d.accepted!==false)s.frames++;}
      else if(d.type==='audioDone')s.audioPending=Math.max(0,s.audioPending-1);
      else if(d.type==='progress'){
        if(d.step==='probe')stage='正在检测录制性能 · '+d.width+' × '+d.height+' · '+d.fps+' 帧';
        if(d.step==='merge')stage='正在合成 MP4 · '+d.current+'/'+d.total;
        if(d.bytes!=null)s.bytes=d.bytes;if(d.segments!=null)s.segments=d.segments;render();
      }else settle(s,d.type,d);
    };
    s.worker.onerror=e=>{const problem=Error(e.message||'录像编码器异常');for(const type of s.waiting.keys())settle(s,type,null,problem);s.resolveDone();fail(s,problem);};
  }
  function metrics(s){const now=performance.now();if(now-s.lastStatus<1000)return;s.lastStatus=now;const dt=(now-s.fpsAt)/1000;if(dt>=2){s.fps=(s.frames-s.fpsFrames)/dt;s.fpsFrames=s.frames;s.fpsAt=now;s.slowCount=s.fps<s.config.fps*.8?(s.slowCount||0)+1:0;s.slow=s.slowCount>=3;}render();}
  function frame(s){
    if(!s.active)return;metrics(s);if(s.videoPending)return;const timestamp=Math.round((vocal.ctx.currentTime-s.origin)*1e6);if(timestamp<0||timestamp<=s.lastFrame)return;
    try{window.recordRenderer.draw(s.canvas,includeMini);const frame=new VideoFrame(s.canvas,{timestamp,duration:Math.round(1e6/s.config.fps)});s.worker.postMessage({type:'video',frame},[frame]);s.videoPending=true;s.lastFrame=timestamp;}catch(e){fail(s,e);}
  }
  async function begin(automatic,s){
    try{
      if(!running||demo)throw Error('请先连接直播');await permission(!automatic);if(s.cancel)return;
      await vocal.graph();await vocal.ctx.resume();if(s.cancel||!running)return;
      if(moduleContext!==vocal.ctx){await vocal.ctx.audioWorklet.addModule('record-capture.js');moduleContext=vocal.ctx;}if(s.cancel||!running)return;
      const main=$('mainSlot').querySelector('video')||{},fps=quality==='source'?await window.recordQuality.frameRate(main):30;if(s.cancel||!running)return;
      const wanted=window.recordQuality.config(quality,main,fps);s.canvas=document.createElement('canvas');createWorker(s);s.probing=true;
      const prepared=await request(s,{type:'probe',sampleRate:vocal.ctx.sampleRate,...wanted},'prepared',30000);s.probing=false;s.config=prepared.config;if(s.cancel||!running)return;
      stage='正在创建录像…';render();s.dir=await folder.getDirectoryHandle('FreeCast_'+new Date().toISOString().replace(/[:.]/g,'-')+'_'+crypto.randomUUID().slice(0,6),{create:true});if(s.cancel)return;
      s.initialized=true;await request(s,{type:'init',dir:s.dir,sampleRate:vocal.ctx.sampleRate,plan:s.config},'ready');if(s.cancel||!running)return;
      s.canvas.width=s.config.width;s.canvas.height=s.config.height;
      s.capture=new AudioWorkletNode(vocal.ctx,'recording-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
      s.capture.port.onmessage=e=>{const d=e.data;if(d.type==='stopped'){s.resolveCapture?.();return;}if(d.type!=='audio'||!s.worker)return;if(++s.audioPending>30){fail(s,Error('编码或磁盘写入过慢，已停止保存；完整片段会保留'));return;}s.worker.postMessage(d,[d.samples.buffer]);};
      for(const output of Object.values(vocal.outputs))output.connect(s.capture);s.capture.connect(vocal.ctx.destination);
      s.origin=vocal.ctx.currentTime;s.lastFrame=-1;s.frames=0;s.fpsFrames=0;s.fpsAt=performance.now();s.lastStatus=0;s.videoPending=false;s.audioPending=0;s.active=true;
      s.capture.port.postMessage({type:'start',origin:s.origin});
      s.worker.postMessage({type:'chat',value:{type:'start',format:'FreeCast recording 3',created:new Date().toISOString(),a:channels.a?.room?.platform||'',b:channels.b?.room?.platform||'',offset,video:s.config,ai:vocal.settings()}});
      frame(s);s.clock=new Worker('record-clock.js');s.clock.onmessage=()=>frame(s);s.clock.postMessage({type:'start',fps:s.config.fps});
      navigator.wakeLock?.request('screen').then(lock=>{if(s.active)s.wakeLock=lock;else void lock.release();}).catch(()=>{});
    }catch(e){fail(s,e);}finally{if(!s.active)await cleanup(s);render();}
  }
  async function cleanup(s){
    if(!s)return;if(s.cleanup)return s.cleanup;
    s.cleanup=(async()=>{
      s.active=false;s.clock?.terminate();s.clock=null;
      if(s.capture){const node=s.capture;if(vocal.ctx.state==='running'){let timer;const flushed=new Promise(resolve=>{s.resolveCapture=resolve;timer=setTimeout(resolve,1500);});node.port.postMessage({type:'stop'});await flushed;clearTimeout(timer);}s.resolveCapture=null;for(const output of Object.values(vocal.outputs))try{output.disconnect(node);}catch{}node.disconnect();node.port.onmessage=null;s.capture=null;}
      if(s.worker){if(s.initialized){let timer;s.lastWorkerAt=performance.now();s.worker.postMessage({type:'finish'});await Promise.race([s.done,new Promise(resolve=>{timer=setInterval(()=>{if(performance.now()-s.lastWorkerAt<120000)return;if(!error)error='完成文件超时，请使用恢复录像继续';resolve();},1000);})]);clearInterval(timer);}s.worker.terminate();s.worker=null;}
      for(const type of s.waiting?.keys()||[])settle(s,type,null,abort());
      await s.wakeLock?.release().catch(()=>{});s.wakeLock=null;window.recordRenderer.clear();s.canvas=null;s.videoPending=false;s.audioPending=0;
    })();return s.cleanup;
  }
  async function start(automatic=false){if(busy())return startTask;error='';result=null;stage='正在准备…';session={active:false,cancel:false,frames:0,bytes:0,segments:0};const s=session;startTask=begin(automatic,s);render();try{await startTask;}finally{startTask=null;render();}}
  async function stop(){
    if(stopping)return stopping;if(recovering)return;const s=session;if(!s)return;s.cancel=true;s.active=false;s.clock?.terminate();
    if(s.probing&&s.worker){for(const type of s.waiting.keys())settle(s,type,null,abort());s.worker.terminate();s.worker=null;s.resolveDone();}
    stage='正在完成 MP4…';stopping=(async()=>{if(startTask)await startTask;await cleanup(s);})();render();try{await stopping;}finally{stopping=null;render();}
  }
  function message(m){const s=session;if(!s?.active)return;s.worker.postMessage({type:'chat',value:{type:m.type||'danmaku',t:Math.round((vocal.ctx.currentTime-s.origin)*1000),source:m.source||'a',user:m.user,uid:m.uid,isSelf:m.isSelf===true,text:m.text,emoticon:m.emoticon,emotes:m.emotes,price:m.price,duration:m.duration,at:m.at}});}
  async function scan(ask=false){
    const revision=++scanRevision,list=$('recordRecoveryList');list.replaceChildren();$('recordRecoveryStatus').textContent='正在检查…';
    try{await permission(ask);const selected=folder,{readJournal,partsName}=await import('./record-files.js');let count=0;
      for await(const [name,dir]of selected.entries()){
        if(revision!==scanRevision)return;if(dir.kind!=='directory'||!/^FreeCast_/.test(name))continue;let journal;try{journal=await readJournal(dir);}catch{continue;}
        if(journal.state==='complete')continue;let complete=false;try{const parts=await dir.getDirectoryHandle(partsName);for await(const [name,handle]of parts.entries())if(handle.kind==='file'&&/^video-\d{6}\.mp4$/.test(name)&&(await handle.getFile()).size){complete=true;break;}}catch{}if(!complete)continue;
        const row=document.createElement('div'),label=document.createElement('span'),button=document.createElement('button');label.textContent=new Date(journal.created).toLocaleString()+' · '+journal.config.width+' × '+journal.config.height;button.textContent='恢复';button.onclick=()=>recover(dir);button.disabled=busy();row.append(label,button);list.append(row);count++;
      }
      if(revision===scanRevision)$('recordRecoveryStatus').textContent=count?'发现 '+count+' 份未完成录像，恢复已保存的完整片段。':'未发现需要恢复的录像。';
    }catch(e){if(revision===scanRevision)$('recordRecoveryStatus').textContent=e.message;}
  }
  async function recover(dir){
    if(busy())return;recovering=true;error='';result=null;stage='正在恢复录像…';session={active:false,bytes:0,segments:0};const s=session;createWorker(s);render();
    try{await request(s,{type:'recover',dir},'done',300000);}catch(e){fail(s,e);}finally{s.worker.terminate();s.worker=null;recovering=false;render();await scan();}
  }
  $('recordButton').onclick=()=>{render();$('recordDialog').showModal();if(!busy())void scan();};$('chooseRecordFolder').onclick=choose;$('startRecording').onclick=()=>start();$('stopRecording').onclick=()=>stop();$('checkRecordRecovery').onclick=()=>scan(true);
  for(const id of ['autoRecord','recordMini','recordQuality'])$(id).onchange=()=>{auto=$('autoRecord').checked;includeMini=$('recordMini').checked;quality=$('recordQuality').value;render();localStorage.setItem(optionsKey,JSON.stringify({auto,mini:includeMini,quality}));};
  addEventListener('beforeunload',e=>{if(busy()){e.preventDefault();e.returnValue='';}});addEventListener('pagehide',()=>{void stop();});
  window.localRecording={get active(){return Boolean(session?.active);},status,message,start,stop,connected(){if(auto)void start(true);}};render();
})();
