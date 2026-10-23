(()=>{
  let folder,db,active=false,starting=false,stopping,canvas,clock,encoder,capture,sessionDir,chatWriter,chatTail=Promise.resolve(),chatPending=0,error='',origin=0,wakeLock,auto=false,includeMini=true,startTask,revision=0,moduleContext,readyWorker,doneWorker,resolveDone,rejectReady,resolveCapture,videoPending=false,audioPending=0,lastFrame=-1,lastStatus=0,quality='source',recordConfig;
  const optionsKey='freecast-recording';try{const s=JSON.parse(localStorage.getItem(optionsKey)||'{}');auto=s.auto===true;includeMini=s.mini!==false;quality=window.recordQuality.normalize(s.quality);}catch{}
  $('autoRecord').checked=auto;$('recordMini').checked=includeMini;$('recordQuality').value=quality;qualityHint();
  const ready=new Promise(resolve=>{const request=indexedDB.open('freecast-recording',1);request.onupgradeneeded=()=>request.result.createObjectStore('handles');request.onsuccess=()=>{db=request.result;const read=db.transaction('handles').objectStore('handles').get('folder');read.onsuccess=()=>{folder=read.result;$('recordFolderName').textContent=folder?.name||'';resolve();};read.onerror=()=>resolve();};request.onerror=()=>resolve();});
  function qualityHint(){$('recordQualityHint').textContent=active&&recordConfig?'本次保存：'+recordConfig.width+' × '+recordConfig.height+' · '+recordConfig.fps+' 帧 · 自动码率':window.recordQuality.presets[quality].hint;}
  function status(){return error?'保存失败：'+error:active?'正在保存 '+Math.floor((vocal.ctx.currentTime-origin)/60)+' 分钟':starting?'正在准备…':stopping?'正在完成 MP4…':folder?'已停止 · '+folder.name:'未选择文件夹';}
  function render(){const text=status();$('recordStatus').textContent=text;$('recordButton').textContent=active?'● 保存中':'本地保存';$('recordButton').classList.toggle('recording',active);$('startRecording').disabled=active||starting||Boolean(stopping);$('stopRecording').disabled=!active;$('chooseRecordFolder').disabled=active||starting||Boolean(stopping);$('recordQuality').disabled=active||starting||Boolean(stopping);qualityHint();}
  async function choose(){try{const picked=await showDirectoryPicker({id:'freecast-recordings',mode:'readwrite'});await ready;folder=picked;if(db)try{db.transaction('handles','readwrite').objectStore('handles').put(folder,'folder');}catch{}error='';$('recordFolderName').textContent=folder.name;render();}catch(e){if(e.name!=='AbortError'){error=e.message;render();}}}
  function fail(e){if(!error){error=String(e.message||e);notice('本地保存失败：'+error,true);}void stop();render();}
  function log(data){if(!chatWriter)return;const text=JSON.stringify(data)+'\n';chatPending+=text.length;if(chatPending>2*1024*1024){fail(Error('弹幕文件写入过慢，请检查磁盘'));return;}chatTail=chatTail.then(()=>chatWriter.write(text)).catch(fail).finally(()=>{chatPending-=text.length;});}
  function frame(){if(!active||videoPending)return;const timestamp=Math.round((vocal.ctx.currentTime-origin)*1e6);if(timestamp<0||timestamp<=lastFrame)return;try{window.recordRenderer.draw(canvas,includeMini);const frame=new VideoFrame(canvas,{timestamp,duration:Math.round(1e6/recordConfig.fps)});encoder.postMessage({type:'video',frame},[frame]);videoPending=true;lastFrame=timestamp;if(performance.now()-lastStatus>1000){lastStatus=performance.now();render();}}catch(e){fail(e);}}
  async function start(automatic=false){if(startTask)return startTask;if(active||starting||stopping)return;const token=++revision;startTask=begin(automatic,token);try{await startTask;}finally{startTask=null;}}
  async function begin(automatic,token){
    if(!running||demo){error='请先连接直播';render();return;}starting=true;error='';render();
    try{
      await ready;if(!folder)throw Error('请先选择保存文件夹');let permission=await folder.queryPermission({mode:'readwrite'});if(permission!=='granted'&&!automatic)permission=await folder.requestPermission({mode:'readwrite'});if(permission!=='granted')throw Error('请点击开始保存，允许写入文件夹');if(token!==revision||!running)return;
      await vocal.graph();await vocal.ctx.resume();if(token!==revision||!running)return;
      if(moduleContext!==vocal.ctx){await vocal.ctx.audioWorklet.addModule('record-capture.js');moduleContext=vocal.ctx;}if(token!==revision||!running)return;
      const mainVideo=$('mainSlot').querySelector('video')||{},fps=quality==='source'?await window.recordQuality.frameRate(mainVideo):30;
      if(token!==revision||!running)return;
      recordConfig=window.recordQuality.config(quality,mainVideo,fps);
      const session='FreeCast_'+new Date().toISOString().replace(/[:.]/g,'-')+'_'+crypto.randomUUID().slice(0,6);
      sessionDir=await folder.getDirectoryHandle(session,{create:true});
      const file=await sessionDir.getFileHandle('录像.mp4',{create:true}),chat=await sessionDir.getFileHandle('弹幕.jsonl',{create:true});chatWriter=await chat.createWritable();chatTail=Promise.resolve();chatPending=0;
      canvas=document.createElement('canvas');canvas.width=recordConfig.width;canvas.height=recordConfig.height;
      encoder=new Worker('record-worker.js',{type:'module'});doneWorker=new Promise(resolve=>{resolveDone=resolve;});let resolveReady;readyWorker=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
      encoder.onmessage=e=>{const d=e.data;if(d.type==='ready'){recordConfig=d.config;canvas.width=recordConfig.width;canvas.height=recordConfig.height;resolveReady();}else if(d.type==='done')resolveDone();else if(d.type==='videoDone')videoPending=false;else if(d.type==='audioDone')audioPending=Math.max(0,audioPending-1);else if(d.type==='error'){rejectReady(Error(d.message));fail(Error(d.message));}};
      encoder.onerror=e=>{const problem=Error(e.message||'录像编码器异常');rejectReady(problem);resolveDone();fail(problem);};
      encoder.postMessage({type:'init',file,sampleRate:vocal.ctx.sampleRate,...recordConfig});
      let timer;try{await Promise.race([readyWorker,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('录像编码器启动超时')),30000))]);}finally{clearTimeout(timer);}
      if(token!==revision||!running)return;
      capture=new AudioWorkletNode(vocal.ctx,'recording-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
      capture.port.onmessage=e=>{const d=e.data;if(d.type==='stopped'){resolveCapture?.();return;}if(d.type!=='audio'||!encoder)return;if(++audioPending>30){fail(Error('编码或磁盘写入过慢，已停止保存'));return;}encoder.postMessage(d,[d.samples.buffer]);};
      for(const output of Object.values(vocal.outputs))output.connect(capture);capture.connect(vocal.ctx.destination);
      origin=vocal.ctx.currentTime;lastFrame=-1;videoPending=false;audioPending=0;capture.port.postMessage({type:'start',origin});
      log({type:'start',format:'FreeCast recording 2',created:new Date().toISOString(),a:channels.a?.room?.platform||'',b:channels.b?.room?.platform||'',offset,video:recordConfig,ai:vocal.settings()});
      active=true;frame();if(!active)return;clock=new Worker('record-clock.js');clock.onmessage=frame;clock.postMessage({type:'start',fps:recordConfig.fps});
      // Acquiring the wake lock must not delay canceling/closing a recording.
      navigator.wakeLock?.request('screen').then(lock=>{if(active)wakeLock=lock;else void lock.release();}).catch(()=>{});
    }catch(e){if(!error)error=String(e.message||e);}finally{starting=false;if(!active)await cleanup();render();}
  }
  async function cleanup(){
    if(capture){const node=capture;if(vocal.ctx.state==='running'){let timer;const flushed=new Promise(resolve=>{resolveCapture=resolve;timer=setTimeout(resolve,1500);});node.port.postMessage({type:'stop'});await flushed;clearTimeout(timer);}resolveCapture=null;for(const output of Object.values(vocal.outputs))try{output.disconnect(node);}catch{}node.disconnect();node.port.onmessage=null;capture=null;}
    if(encoder){const worker=encoder;let timer;worker.postMessage({type:'finish'});await Promise.race([doneWorker,new Promise(resolve=>timer=setTimeout(()=>{if(!error)error='完成文件超时，请检查磁盘';resolve();},30000))]);clearTimeout(timer);worker.terminate();encoder=null;}
    await chatTail;if(chatWriter){try{await chatWriter.close();}catch(e){error=String(e.message||e);await chatWriter.abort().catch(()=>{});}chatWriter=null;}
    await wakeLock?.release().catch(()=>{});wakeLock=null;videoPending=false;audioPending=0;window.recordRenderer.clear();canvas=null;
  }
  async function stop(){if(stopping)return stopping;revision++;active=false;clock?.terminate();clock=null;stopping=(async()=>{if(startTask)await startTask;await cleanup();})();try{await stopping;}finally{stopping=null;render();}}
  function message(m){if(!active)return;log({type:m.type||'danmaku',t:Math.round((vocal.ctx.currentTime-origin)*1000),source:m.source||'a',user:m.user,uid:m.uid,isSelf:m.isSelf===true,text:m.text,emoticon:m.emoticon,emotes:m.emotes,price:m.price,duration:m.duration,at:m.at});}
  $('recordButton').onclick=()=>{render();$('recordDialog').showModal();};$('chooseRecordFolder').onclick=choose;$('startRecording').onclick=()=>start();$('stopRecording').onclick=()=>stop();
  for(const id of ['autoRecord','recordMini','recordQuality'])$(id).onchange=()=>{auto=$('autoRecord').checked;includeMini=$('recordMini').checked;quality=$('recordQuality').value;qualityHint();localStorage.setItem(optionsKey,JSON.stringify({auto,mini:includeMini,quality}));};
  addEventListener('beforeunload',e=>{if(active||starting||stopping){e.preventDefault();e.returnValue='';}});addEventListener('pagehide',()=>{void stop();});
  window.localRecording={get active(){return active;},status,message,start,stop,connected(){if(auto)void start(true);}};render();
})();
