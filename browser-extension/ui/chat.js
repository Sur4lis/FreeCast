(()=>{
  const encoder=new TextEncoder(),decoder=new TextDecoder(),limit=8*1024*1024;
  function packet(op,body='') {
    const data=encoder.encode(typeof body==='string'?body:JSON.stringify(body)),out=new Uint8Array(16+data.length),v=new DataView(out.buffer);
    v.setUint32(0,out.length);v.setUint16(4,16);v.setUint16(6,1);v.setUint32(8,op);v.setUint32(12,1);out.set(data,16);return out;
  }
  async function inflate(body) {
    const reader=new Blob([body]).stream().pipeThrough(new DecompressionStream('deflate')).getReader(),parts=[];let size=0;
    try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw new Error('弹幕数据超限');parts.push(value);}}finally{await reader.cancel();}
    const out=new Uint8Array(size);let i=0;for(const p of parts){out.set(p,i);i+=p.length;}return out;
  }
  async function decode(data,depth=0) {
    if(depth>4||data.byteLength>limit)throw new Error('弹幕数据超限');
    const bytes=data instanceof Uint8Array?data:new Uint8Array(data),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out=[];
    for(let i=0;i<bytes.length;) {
      if(bytes.length-i<16)throw new Error('弹幕包头不完整');
      const n=view.getUint32(i),h=view.getUint16(i+4),v=view.getUint16(i+6),op=view.getUint32(i+8);
      if(n<16||h<16||h>n||i+n>bytes.length)throw new Error('弹幕包长度无效');
      const body=bytes.subarray(i+h,i+n);
      if(v===2)out.push(...await decode(await inflate(body),depth+1));
      else if(op===3)out.push({op,body:null});
      else if(op===5||op===8){try{out.push({op,body:JSON.parse(decoder.decode(body))});}catch{}}
      i+=n;
    }
    return out;
  }
  function object(value){if(value&&typeof value==='object'&&!Array.isArray(value))return value;if(typeof value==='string'&&value.length<65536){try{return object(JSON.parse(value));}catch{}}return {};}
  function imageUrl(value){
    if(typeof value!=='string'||value.length>2048)return '';
    try{const u=new URL(value.startsWith('//')?'https:'+value:value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||!['hdslb.com','biliimg.com'].some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))return '';u.protocol='https:';return u.href;}catch{return '';}
  }
  function emoticon(value){const data=object(value),url=imageUrl(data.url);if(!url)return null;const width=Number(data.width),height=Number(data.height),unique=String(data.emoticon_unique||data.unique||'').slice(0,200);return {url,...(unique?{unique}:{}),ratio:Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0?Math.min(5,Math.max(.3,width/height)):1};}
  function normalize(body,receivedAt=Date.now()){
    if(typeof body?.cmd!=='string')return null;
    const cmd=body.cmd.split(':')[0],data=object(body.data);
    if(cmd==='DANMU_MSG'){
      const info=body.info;if(!Array.isArray(info))return null;
      const text=String(info[1]||'').slice(0,2000),extra=object(object(info[0]?.[15]).extra),emotes=[];
      for(const [token,value] of Object.entries(object(extra.emots)).slice(0,64)){const image=emoticon(value);if(image&&token.length<=80&&token.length&&text.includes(token))emotes.push({token,...image});}
      return {type:'message',text,user:String(info[2]?.[1]||'观众').slice(0,100),uid:String(info[2]?.[0]||''),emoticon:emoticon(info[0]?.[13]),emotes,receivedAt};
    }
    if(cmd==='SUPER_CHAT_MESSAGE'){
      const id=String(data.id??'');if(!/^[\w-]{1,80}$/.test(id))return null;
      const price=Number(data.price),duration=Number(data.time)||Number(data.end_time)-Number(data.start_time);
      const color=data.background_bottom_color||data.background_color;
      return {type:'superchat',id,text:String(data.message||'').slice(0,2000),user:String(data.user_info?.uname||'观众').slice(0,100),uid:String(data.uid||data.user_info?.uid||''),avatar:imageUrl(data.user_info?.face),scColor:/^#[0-9a-f]{6}$/i.test(color||'')?color:undefined,price:Number.isFinite(price)&&price>=0?Math.min(price,10000000):0,duration:Number.isFinite(duration)&&duration>0?Math.min(7200,duration):60,receivedAt};
    }
    if(cmd==='SUPER_CHAT_MESSAGE_DELETE')return {type:'superchat-delete',ids:(Array.isArray(data.ids)?data.ids:[]).slice(0,1000).map(String).filter(id=>/^[\w-]{1,80}$/.test(id)),receivedAt};
    return null;
  }
  class BrowserChat {
    constructor(room,config,emit){this.room=room;this.config=config;this.emit=emit;this.closed=false;this.attempt=0;this.route=0;this.revision=0;}
    async start(){
      if(this.closed)return;const revision=++this.revision;
      clearTimeout(this.timer);clearTimeout(this.authTimer);clearInterval(this.heartbeat);
      try{
        this.emit({type:'status',text:'正在连接弹幕…'});const config=await this.config();if(this.closed||revision!==this.revision)return;
        if(!config.hosts?.length)throw Error('未获取到弹幕线路');
        const host=config.hosts[this.route++%config.hosts.length];
        if(!/^[\w.-]+\.chat\.bilibili\.com(?::\d{1,5})?$/.test(host))throw Error('弹幕线路无效');
        const ws=this.ws=new WebSocket('wss://'+host+'/sub');ws.binaryType='arraybuffer';
        let reason='弹幕连接中断',authenticated=false,lastReply=Date.now(),serial=Promise.resolve(),queued=0;
        const current=()=>!this.closed&&this.ws===ws&&revision===this.revision;
        const fail=text=>{if(!current())return;reason=text;ws.close();};
        this.authTimer=setTimeout(()=>fail('弹幕连接或鉴权超时'),15000);
        ws.onopen=()=>{if(current())ws.send(packet(7,{uid:config.uid,buvid:config.buvid,roomid:config.room||this.room,protover:2,platform:'web',type:2,key:config.token}));};
        ws.onmessage=event=>{
          if(!current())return;if(++queued>64){fail('弹幕数据积压，正在换线');return;}
          serial=serial.then(async()=>{
            for(const p of await decode(event.data)){
              if(!current())return;
              if(p.op===8){
                if(Number(p.body.code)!==0){fail('弹幕鉴权失败（'+String(p.body.code??'未知')+'），请刷新 B 站网页登录状态');return;}
                authenticated=true;lastReply=Date.now();clearTimeout(this.authTimer);this.emit({type:'status',text:'弹幕已连接'});
                ws.send(packet(2,'[object Object]'));clearInterval(this.heartbeat);
                this.heartbeat=setInterval(()=>{if(!current())return;if(Date.now()-lastReply>70000){fail('弹幕心跳超时');return;}if(ws.readyState===1)ws.send(packet(2,'[object Object]'));},25000);
              }
              if(p.op===3||p.op===5){lastReply=Date.now();if(authenticated)this.attempt=0;}
              if(p.op===5){const message=normalize(p.body);if(message)this.emit(message);}
            }
          }).catch(error=>fail(error.message||'弹幕解码失败')).finally(()=>queued--);
        };
        ws.onerror=()=>fail('弹幕线路无法连接');
        ws.onclose=event=>{if(!current())return;clearTimeout(this.authTimer);clearInterval(this.heartbeat);this.retry(reason+(event.code&&event.code!==1000?'（'+event.code+'）':''));};
      }catch(error){if(!this.closed&&revision===this.revision)this.retry(error);}
    }
    retry(error){
      if(this.closed)return;clearTimeout(this.timer);this.timer=null;
      const reason=String(error?.message||error||'弹幕配置获取失败');
      if(error?.code==='BILIBILI_PERMISSION'||/No host permissions|网站访问权限不足|网站访问未授权|请允许访问直播平台/i.test(reason)){
        this.emit({type:'status',text:'B 站网站访问未授权，请点击「重连弹幕」并允许访问 bilibili.com；若仍失败，请在扩展设置中允许网站访问后刷新本页。'});return;
      }
      if(/\b412\b/.test(reason)){
        this.emit({type:'status',text:'B 站暂时限制请求（HTTP 412），已暂停自动重试。请打开 B 站直播页完成验证，稍后点击「重连弹幕」。'});return;
      }
      const seconds=Math.min(30,2**Math.min(++this.attempt,5));this.emit({type:'status',text:reason+' · '+seconds+' 秒后重试'});this.timer=setTimeout(()=>this.start(),seconds*1000);
    }
    stop(){this.closed=true;this.revision++;clearTimeout(this.timer);clearTimeout(this.authTimer);clearInterval(this.heartbeat);this.ws?.close();}
  }
  window.BrowserChat=BrowserChat;window.ChatProtocol={packet,decode,normalize,imageUrl};
})();
