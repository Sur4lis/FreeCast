(()=>{
 let serial=Promise.resolve();let worker,id=0,initializing,info,revision=0,queued=0,diagnostic=null;const pending=new Map();
 function release(reason='人声过滤已关闭'){
  revision++;worker?.terminate();worker=null;initializing=null;info=null;serial=Promise.resolve();queued=0;
  if(diagnostic?.state==='ready'||diagnostic?.state==='checking')diagnostic={...diagnostic,state:'stopped'};
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error(reason));}pending.clear();
 }
 function request(type,data={},timeout=30000){
  return new Promise((resolve,reject)=>{
   if(!worker){reject(Error('过滤引擎未启动'));return;}
   const key=++id,expire=()=>{const error=type==='init'?'AI 初始化超时，请重试或使用原声':'AI 处理超时，已停止处理，请尝试兼容模式';diagnostic={...diagnostic,state:'error',code:'AI_TIMEOUT',error};release(error);};
   const timer=setTimeout(expire,timeout);pending.set(key,{resolve,reject,timer,type,expire});
   try{worker.postMessage({id:key,type,...data},data.left?[data.left.buffer,data.right.buffer]:[]);}catch(error){clearTimeout(timer);pending.delete(key);reject(error);}
  });
 }
 window.live.vocalInit=async(options={})=>{
  if(info)return info;if(initializing)return initializing;
  diagnostic={state:'checking'};
  try{worker=new Worker(new URL('../ai/worker.mjs',location.href),{type:'module'});}catch(error){diagnostic={state:'error',code:'WORKER_UNAVAILABLE',error:error.message};throw error;}
  const token=revision,currentWorker=worker;
  worker.onmessage=({data})=>{if(worker!==currentWorker)return;const p=pending.get(data.id);if(!p)return;
    pending.delete(data.id);clearTimeout(p.timer);if(p.type==='init')diagnostic={state:data.error?'error':'ready',device:data.device||'',provider:data.provider,gpu:data.gpu,code:data.code,error:data.error};data.error?p.reject(Error(data.error)):p.resolve(data);};
  worker.onerror=event=>{event.preventDefault();if(worker===currentWorker){const error=event.message||'浏览器无法启动 AI 引擎';diagnostic={...diagnostic,state:'error',code:'WORKER_ERROR',error};release(error);}};
  initializing=request('init',options,options.forceCpu?45000:180000).then(result=>{if(token!==revision)throw Error('AI 初始化已取消');return info=result;}).catch(error=>{if(token===revision)release();throw error;});
  return initializing;
 };
 window.live.vocalProcess=data=>{if(queued>=2)return Promise.reject(Error('过滤跟不上播放，已停止积压'));const token=revision;queued++;const task=serial.then(()=>{if(token!==revision)throw Error('处理已取消');return request('process',{...data,left:data.left.slice(),right:data.right.slice()});}).finally(()=>{if(token===revision)queued--;});serial=task.then(()=>{},()=>{});return task;};
 window.live.vocalRelease=release;
 window.live.vocalDiagnostics=()=>diagnostic;
 window.addEventListener('pagehide',()=>release());
})();
