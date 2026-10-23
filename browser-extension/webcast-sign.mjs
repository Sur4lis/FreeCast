// Port of jwwsjlm/douyinLive internal/webcastsign/native.go (MIT).
// Copyright (c) 2025 今晚打打. See vendor/douyinLive-LICENSE.txt.
import {md5} from './wbi.mjs';
const hex=s=>Uint8Array.from(s.match(/../g)||[],x=>parseInt(x,16));
const empty=hex(md5(hex(md5(''))));
const alphabet='Dkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe';
let sequence=0;
export function webcastSign(stub,values){
  if(!/^[a-f\d]{32}$/i.test(stub))throw Error('抖音弹幕签名参数无效');
  const random=()=>{let n;do{n=crypto.getRandomValues(new Uint8Array(1))[0];}while(n===255);return n;};
  const [counter,flag,payloadRandom,key]=values||[++sequence&63,!!(random()&1),random(),random()];
  const digest=hex(md5(hex(stub))),payload=Uint8Array.from([counter&63,0,1,14,empty[14],empty[15],digest[14],digest[15],payloadRandom,0]);
  for(let i=0;i<9;i++)payload[9]^=payload[i];
  const state=Uint8Array.from({length:256},(_,i)=>i);let j=0;
  for(let i=0;i<256;i++){j=(j+state[i]+key)&255;[state[i],state[j]]=[state[j],state[i]];}
  let i=0;j=0;const out=Uint8Array.from([64|(flag?16:0),key,...payload]);
  for(let k=2;k<out.length;k++){i=(i+1)&255;j=(j+state[i])&255;[state[i],state[j]]=[state[j],state[i]];out[k]^=state[(state[i]+state[j])&255];}
  let result='';for(let k=0;k<out.length;k+=3){const n=(out[k]<<16)|(out[k+1]<<8)|out[k+2];for(const shift of [18,12,6,0])result+=alphabet[(n>>>shift)&63];}return result;
}
