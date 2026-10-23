class RecordingCapture extends AudioWorkletProcessor {
  constructor(){super();this.enabled=false;this.used=0;this.size=Math.round(sampleRate/10);this.left=new Float32Array(this.size);this.right=new Float32Array(this.size);this.port.onmessage=e=>{if(e.data.type==='start'){this.enabled=true;this.used=0;this.origin=e.data.origin;}if(e.data.type==='stop'){this.enabled=false;this.flush();this.port.postMessage({type:'stopped'});}};}
  flush(){if(!this.used)return;const samples=new Float32Array(this.used*2);samples.set(this.left.subarray(0,this.used));samples.set(this.right.subarray(0,this.used),this.used);this.port.postMessage({type:'audio',samples,time:this.start-this.origin,sampleRate},[samples.buffer]);this.used=0;}
  process(inputs){if(!this.enabled)return true;const channels=inputs[0];for(let i=0;i<(channels?.[0]?.length||128);i++){const time=(currentFrame+i)/sampleRate;if(time<this.origin)continue;if(!this.used)this.start=time;this.left[this.used]=channels?.[0]?.[i]||0;this.right[this.used]=(channels?.[1]||channels?.[0])?.[i]||0;if(++this.used===this.size)this.flush();}return true;}
}
registerProcessor('recording-capture',RecordingCapture);
