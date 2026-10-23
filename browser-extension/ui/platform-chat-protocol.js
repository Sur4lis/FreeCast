// Bounded binary readers for public live chat protocols. IDs stay strings/BigInt.
(()=>{
  const enc=new TextEncoder(),dec=new TextDecoder(),LIMIT=8*1024*1024;
  const bytes=x=>x instanceof Uint8Array?x:new Uint8Array(x);
  const concat=parts=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let i=0;for(const p of parts){out.set(p,i);i+=p.length;}return out;};
  function douyuPacket(fields){const escape=x=>String(x).replaceAll('@','@A').replaceAll('/','@S');const text=Object.entries(fields).map(([k,v])=>escape(k)+'@='+escape(v)+'/').join('');const b=enc.encode(text),out=new Uint8Array(b.length+13),v=new DataView(out.buffer);v.setUint32(0,b.length+9,true);v.setUint32(4,b.length+9,true);v.setUint16(8,689,true);out.set(b,12);return out;}
  class DouyuDecoder{
    constructor(){this.pending=new Uint8Array();}
    read(data){const b=concat([this.pending,bytes(data)]);if(b.length>LIMIT)throw Error('弹幕数据超限');const v=new DataView(b.buffer),out=[];let i=0;while(b.length-i>=12){const n=v.getUint32(i,true);if(n<9||n>LIMIT||n!==v.getUint32(i+4,true))throw Error('斗鱼弹幕包无效');if(i+n+4>b.length)break;const obj=Object.create(null);for(const part of dec.decode(b.subarray(i+12,i+n+3)).split('/')){const at=part.indexOf('@=');if(at<0)continue;const un=s=>s.replaceAll('@S','/').replaceAll('@A','@');obj[un(part.slice(0,at))]=un(part.slice(at+2));}out.push(obj);i+=n+4;}this.pending=b.slice(i);return out;}
  }
  class TarsWriter{
    constructor(){this.parts=[];}
    head(tag,type){this.parts.push(Uint8Array.from(tag<15?[tag*16+type]:[240+type,tag]));return this;}
    int(tag,value){const n=BigInt(value||0);if(n===0n)return this.head(tag,12);const size=n>=-128n&&n<=127n?1:n>=-32768n&&n<=32767n?2:n>=-2147483648n&&n<=2147483647n?4:8,b=new Uint8Array(size),v=new DataView(b.buffer);this.head(tag,{1:0,2:1,4:2,8:3}[size]);if(size===8)v.setBigInt64(0,n);else if(size===4)v.setInt32(0,Number(n));else if(size===2)v.setInt16(0,Number(n));else v.setInt8(0,Number(n));this.parts.push(b);return this;}
    string(tag,text){const b=enc.encode(text);this.head(tag,b.length<256?6:7);const len=new Uint8Array(b.length<256?1:4),v=new DataView(len.buffer);if(len.length===1)len[0]=b.length;else v.setUint32(0,b.length);this.parts.push(len,b);return this;}
    data(tag,b){this.head(tag,13).head(0,0).int(0,b.length);this.parts.push(bytes(b));return this;}
    finish(){return concat(this.parts);}
  }
  function tars(data){const b=bytes(data);if(b.length>LIMIT)throw Error('弹幕数据超限');const v=new DataView(b.buffer,b.byteOffset,b.length);let i=0,nodes=0;
    const need=n=>{if(n<0||i+n>b.length)throw Error('虎牙弹幕包不完整');};
    const head=()=>{need(1);const x=b[i++];let tag=x>>4;if(tag===15){need(1);tag=b[i++];}return{tag,type:x&15};};
    const count=depth=>{const n=Number(read(head().type,depth));if(!Number.isInteger(n)||n<0||n>100000)throw Error('虎牙弹幕长度无效');return n;};
    function read(type,depth){if(depth>20||++nodes>100000)throw Error('弹幕数据超限');let n,x;
      switch(type){case 12:return 0;case 0:need(1);return v.getInt8(i++);case 1:need(2);x=v.getInt16(i);i+=2;return x;case 2:need(4);x=v.getInt32(i);i+=4;return x;case 3:need(8);x=v.getBigInt64(i).toString();i+=8;return x;case 4:need(4);x=v.getFloat32(i);i+=4;return x;case 5:need(8);x=v.getFloat64(i);i+=8;return x;
        case 6:need(1);n=b[i++];need(n);x=dec.decode(b.subarray(i,i+n));i+=n;return x;
        case 7:need(4);n=v.getUint32(i);i+=4;need(n);x=dec.decode(b.subarray(i,i+n));i+=n;return x;
        case 13:if(head().type!==0)throw Error('虎牙字节类型无效');n=count(depth+1);need(n);x=b.slice(i,i+n);i+=n;return x;
        case 9:n=count(depth+1);x=[];for(let k=0;k<n;k++)x.push(read(head().type,depth+1));return x;
        case 8:n=count(depth+1);x=[];for(let k=0;k<n;k++)x.push([read(head().type,depth+1),read(head().type,depth+1)]);return x;
        case 10:return fields(depth+1,true);default:throw Error('虎牙弹幕类型无效');}
    }
    function fields(depth,struct=false){const out=Object.create(null);while(i<b.length){const h=head();if(h.type===11){if(!struct)throw Error('虎牙结构无效');return out;}out[h.tag]=read(h.type,depth);}if(struct)throw Error('虎牙结构不完整');return out;}
    return fields(0);
  }
  function huyaJoin(c){const w=new TarsWriter().int(0,c.uid).int(1,1).string(2,'').string(3,'').int(4,c.tid).int(5,c.sid).int(6,0).int(7,0);return new TarsWriter().int(0,1).data(1,w.finish()).finish();}
  const huyaHeartbeat=Uint8Array.from([0,20,29,0,12,44,54,0,76]);
  function pb(data){const b=bytes(data);if(b.length>LIMIT)throw Error('弹幕数据超限');let i=0,nodes=0;const out=Object.create(null);
    const vari=()=>{let n=0n;for(let k=0;k<10;k++){if(i>=b.length)throw Error('抖音弹幕包不完整');const v=b[i++];n|=BigInt(v&127)<<BigInt(k*7);if(!(v&128))return n;}throw Error('抖音整数无效');};
    while(i<b.length){if(++nodes>100000)throw Error('弹幕数据超限');const h=Number(vari()),tag=h>>>3,type=h&7;if(!tag)throw Error('抖音字段无效');let value;if(type===0)value=vari();else{const n=type===2?Number(vari()):type===1?8:type===5?4:-1;if(n<0||!Number.isSafeInteger(n)||i+n>b.length)throw Error('抖音字段长度无效');value=b.slice(i,i+n);i+=n;} (out[tag]??=[]).push(value);}
    return out;
  }
  function varint(n){n=BigInt(n);if(n<0n)throw Error('整数无效');const b=[];do{const v=Number(n&127n);n>>=7n;b.push(v|(n?128:0));}while(n);return Uint8Array.from(b);}
  function pbPacket(fields){return concat(fields.flatMap(([tag,value])=>{if(typeof value==='bigint'||typeof value==='number')return[varint(tag*8),varint(value)];const b=typeof value==='string'?enc.encode(value):bytes(value);return[varint(tag*8+2),varint(b.length),b];}));}
  const one=(o,n)=>o[n]?.[0],text=(o,n)=>{const v=one(o,n);return v instanceof Uint8Array?dec.decode(v):'';};
  async function gunzip(b){if(b[0]!==31||b[1]!==139)return b;const reader=new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(),parts=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>LIMIT)throw Error('弹幕数据超限');parts.push(value);}}finally{await reader.cancel();}return concat(parts);}
  const message=(platform,user,uid,text,id='')=>({type:'message',platform,user:String(user||'观众').slice(0,100),uid:String(uid||''),text:String(text||'').slice(0,2000),id:String(id||''),receivedAt:Date.now()});
  async function douyinDecode(data){const frame=pb(data),payload=one(frame,8);if(!payload?.length)return {messages:[]};const response=pb(await gunzip(payload)),messages=[];
    for(const raw of response[1]||[]){const item=pb(raw),method=text(item,1);if(method!=='WebcastChatMessage')continue;const chat=pb(one(item,2)),user=pb(one(chat,2)||new Uint8Array()),m=message('douyin',text(user,3),one(user,1),text(chat,3),one(item,3));const secUid=text(user,46);if(/^MS4wLjAB[A-Za-z0-9_-]{10,200}$/.test(secUid))m.secUid=secUid;messages.push(m);}
    return{messages,ack:one(response,9)===1n?pbPacket([[2,one(frame,2)||0n],[7,'ack'],[8,text(response,5)]]):null};
  }
  function huyaDecode(data){const command=tars(data),type=Number(command[0]),messages=[];if(type===7){const push=tars(command[1]);if(Number(push[1])===1400){const chat=tars(push[2]),u=chat[0]||{};messages.push(message('huya',u[2],u[0],chat[3]));}}return{messages,connected:type===2||type===7,kind:type};}
  window.PlatformChatProtocol={douyuPacket,DouyuDecoder,TarsWriter,tars,huyaJoin,huyaHeartbeat,huyaDecode,pb,pbPacket,douyinDecode,message};
})();
