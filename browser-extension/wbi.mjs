// WBI query signing used by the official web player. Public nav image keys are not login secrets.
export function md5(text) {
  const input=text instanceof Uint8Array?text:new TextEncoder().encode(text),size=Math.ceil((input.length+9)/64)*64,bytes=new Uint8Array(size);bytes.set(input);bytes[input.length]=128;
  const v=new DataView(bytes.buffer);v.setUint32(size-8,input.length*8,true);v.setUint32(size-4,Math.floor(input.length/0x20000000),true);
  const shifts=[7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];let h=[0x67452301,0xefcdab89,0x98badcfe,0x10325476];
  for(let offset=0;offset<size;offset+=64){let[a,b,c,d]=h;for(let i=0;i<64;i++){const group=i>>4,g=group===0?i:group===1?(5*i+1)%16:group===2?(3*i+5)%16:(7*i)%16;
    const f=group===0?(b&c)|(~b&d):group===1?(d&b)|(~d&c):group===2?b^c^d:c^(b|~d);
    const sum=(a+f+Math.floor(Math.abs(Math.sin(i+1))*0x100000000)+v.getUint32(offset+g*4,true))|0,s=shifts[group*4+i%4];
    [a,b,c,d]=[d,(b+((sum<<s)|(sum>>>(32-s))))|0,b,c];
  }h=h.map((x,i)=>(x+[a,b,c,d][i])|0);}
  return h.map(x=>[0,8,16,24].map(n=>((x>>>n)&255).toString(16).padStart(2,'0')).join('')).join('');
}
export function signWbi(params,images,now=Date.now()){
 const extract=url=>{try{return new URL(url).pathname.split('/').at(-1).split('.')[0];}catch{return '';}};
 const key=extract(images?.img_url)+extract(images?.sub_url);
 if(key.length!==64)throw new Error('B 站签名信息暂不可用，请刷新登录状态');
 const table=[46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
 const mix=table.map(i=>key[i]).join('').slice(0,32),wts=String(Math.round(now/1000));
 const query=Object.entries({...params,wts}).sort(([a],[b])=>a<b?-1:a>b?1:0).filter(([,v])=>v!=null).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(String(v).replace(/[!'()*]/g,''))).join('&');
 return new URLSearchParams({...params,wts,w_rid:md5(query+mix)}).toString();
}
