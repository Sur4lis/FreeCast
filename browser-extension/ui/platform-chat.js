(()=>{
  const P=window.PlatformChatProtocol;
  const validEndpoint=(platform,value)=>{try{const u=new URL(value);return u.protocol==='wss:'&&!u.username&&!u.password&&(platform==='huya'?u.hostname==='cdnws.api.huya.com'&&!u.port:platform==='douyu'?u.hostname==='danmuproxy.douyu.com'&&/^850[1-6]$/.test(u.port):platform==='douyin'?['webcast100-ws-web-lq.douyin.com','webcast3-ws-web-lq.douyin.com','webcast5-ws-web-lf.douyin.com'].includes(u.hostname)&&!u.port&&u.pathname==='/webcast/im/push/v2/':false);}catch{return false;}};
  class PlatformChat{
    constructor(room,config,emit){this.room=room;this.config=config;this.emit=emit;this.closed=false;this.revision=0;this.attempt=0;this.route=0;this.seen=new Map();}
    async start(){
      if(this.closed)return;const revision=++this.revision;clearTimeout(this.timer);clearTimeout(this.deadline);clearInterval(this.heartbeat);
      try{
        this.emit({type:'status',text:'正在连接弹幕…'});const c=await this.config();if(this.closed||revision!==this.revision)return;
        const url=c.urls?.[this.route++%c.urls.length];if(!validEndpoint(c.platform,url))throw Error('弹幕线路无效');
        const ws=this.ws=new WebSocket(url);ws.binaryType='arraybuffer';const decoder=new P.DouyuDecoder();let serial=Promise.resolve(),queued=0,lastReply=Date.now(),connected=false,reason='弹幕连接中断',failed=false;
        const current=()=>!this.closed&&this.ws===ws&&revision===this.revision;
        const fail=text=>{if(!current()||failed)return;failed=true;reason=text;clearTimeout(this.deadline);clearInterval(this.heartbeat);this.revision++;ws.close();this.retry(reason);};
        const ready=()=>{if(!connected){connected=true;clearTimeout(this.deadline);this.emit({type:'status',text:'弹幕已连接'});}this.attempt=0;};
        const send=b=>{if(current()&&ws.readyState===1)ws.send(b);};
        const heartbeat=()=>send(c.platform==='huya'?P.huyaHeartbeat:c.platform==='douyu'?P.douyuPacket({type:'mrkl'}):P.pbPacket([[7,'hb']]));
        this.deadline=setTimeout(()=>fail('弹幕连接或鉴权超时'),18000);
        ws.onopen=()=>{if(!current())return;if(c.platform==='huya')send(P.huyaJoin(c));else if(c.platform==='douyu'){send(P.douyuPacket({type:'loginreq',roomid:c.room,ver:'20190610'}));}heartbeat();this.heartbeat=setInterval(()=>{if(!current())return;if(Date.now()-lastReply>75000){fail('弹幕心跳超时');return;}heartbeat();},c.platform==='douyin'?5000:25000);};
        ws.onmessage=event=>{
          if(!current())return;if(++queued>64){fail('弹幕积压，正在重连');return;}
          serial=serial.then(async()=>{
            if(!current())return;let messages=[];
            if(c.platform==='douyu')for(const item of decoder.read(event.data)){
              if(item.type==='loginres'){send(P.douyuPacket({type:'joingroup',rid:c.room,gid:'-9999'}));ready();}
              if(item.type==='error')throw Error('斗鱼弹幕鉴权失败');
              if(item.type==='chatmsg'&&(!item.rid||item.rid===String(c.room)))messages.push(P.message('douyu',item.nn,item.uid,item.txt,item.cid));
            }
            else if(c.platform==='huya'){const decoded=P.huyaDecode(event.data);messages=decoded.messages;if(decoded.connected)ready();}
            else {const decoded=await P.douyinDecode(event.data);if(!current())return;if(decoded.ack)send(decoded.ack);messages=decoded.messages;ready();}
            lastReply=Date.now();
            for(const m of messages){if(!current())return;if(!m.text)continue;if(m.id){const key=c.platform+':'+m.id;if(this.seen.has(key))continue;this.seen.set(key,Date.now());while(this.seen.size>4000)this.seen.delete(this.seen.keys().next().value);}this.emit(m);}
          }).catch(error=>fail(error.message||'弹幕解码失败')).finally(()=>queued--);
        };
        ws.onerror=()=>fail('弹幕线路无法连接');ws.onclose=event=>fail(reason+(event.code&&event.code!==1000?'（'+event.code+'）':''));
      }catch(error){if(!this.closed&&revision===this.revision)this.retry(error.message||'弹幕配置获取失败');}
    }
    retry(reason){if(this.closed)return;const seconds=Math.min(30,2**Math.min(++this.attempt,5));this.emit({type:'status',text:reason+' · '+seconds+' 秒后重试'});clearTimeout(this.timer);this.timer=setTimeout(()=>this.start(),seconds*1000);}
    stop(){this.closed=true;this.revision++;clearTimeout(this.timer);clearTimeout(this.deadline);clearInterval(this.heartbeat);this.ws?.close();this.seen.clear();}
  }
  window.PlatformChat=PlatformChat;
})();
