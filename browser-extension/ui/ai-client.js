(()=>{
 let serial=Promise.resolve();let worker,id=0,initializing,info,revision=0;const pending=new Map();
 function release(reason='人声过滤已关闭'){
  revision++;worker?.terminate();worker=null;initializing=null;info=null;
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error(reason));}pending.clear();
 }
 function request(type,data={},timeout=30000){
  return new Promise((resolve,reject)=>{
   if(!worker){reject(Error('过滤引擎未启动'));return;}
   const key=++id,timer=setTimeout(()=>release('处理超时，请关闭过滤或检查浏览器图形加速'),timeout);pending.set(key,{resolve,reject,timer});
   worker.postMessage({id:key,type,...data},data.left?[data.left.buffer,data.right.buffer]:[]);
  });
 }
 window.live.vocalInit=async(options={})=>{
  if(info)return info;if(initializing)return initializing;
  worker=new Worker(new URL('../ai/worker.mjs',location.href),{type:'module'});
  const token=revision,currentWorker=worker;
  worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);clearTimeout(p.timer);data.error?p.reject(Error(data.error)):p.resolve(data);};
  worker.onerror=event=>{event.preventDefault();if(worker===currentWorker)release(event.message||'浏览器无法启动 AI 引擎');};
  initializing=request('init',options,180000).then(result=>{if(token!==revision)throw Error('AI 初始化已取消');return info=result;}).catch(error=>{if(token===revision)release();throw error;});
  return initializing;
 };
 window.live.vocalProcess=data=>{const token=revision;const task=serial.catch(()=>{}).then(()=>{if(token!==revision)throw Error('处理已取消');return request('process',{...data,left:data.left.slice(),right:data.right.slice()});});serial=task;return task;};
 window.live.vocalRelease=release;
 window.addEventListener('pagehide',()=>release());
})();
