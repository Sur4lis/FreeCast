class VocalCapture extends AudioWorkletProcessor {
  constructor(){super();this.enabled=false;this.left=new Float32Array(4410);this.right=new Float32Array(4410);this.used=0;this.start=0;this.epoch=0;this.port.onmessage=e=>{if(this.epoch!==e.data.epoch||this.enabled!==e.data.enabled)this.used=0;this.enabled=e.data.enabled;this.epoch=e.data.epoch;};}
  process(inputs){
    const channels=inputs[0];if(!this.enabled)return true;
    // Missing input quanta are silence, not a hole in the sample clock.
    for(let i=0;i<(channels?.[0]?.length||128);i++){
      if(!this.used)this.start=(currentFrame+i)/sampleRate;
      this.left[this.used]=channels?.[0]?.[i]||0;this.right[this.used]=(channels?.[1]||channels?.[0])?.[i]||0;this.used++;
      if(this.used===4410){this.port.postMessage({left:this.left,right:this.right,time:this.start,epoch:this.epoch},[this.left.buffer,this.right.buffer]);this.left=new Float32Array(4410);this.right=new Float32Array(4410);this.used=0;}
    }return true;
  }
}
registerProcessor('vocal-capture',VocalCapture);
