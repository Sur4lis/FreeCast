// Mirror encoded AUDIO segments, preserving the selected source's media timestamps.
// No extra network connection and no copied video frames.
class AudioMirror {
  constructor(media,onError){this.media=media;this.onError=onError;this.items=[];this.bytes=0;this.closed=false;this.enabled=false;this.init=null;this.onOpen=()=>this.flush();this.onUpdate=()=>this.flush();this.onFailure=()=>this.fail('音频预处理解码异常');}
  push(data,mime,offset,isInit=false){
    if(this.closed)return;
    const view=data instanceof Uint8Array?data:new Uint8Array(data);
    // HLS emits its init MP4 with the same event as audio media fragments.
    isInit ||= view.length>=8&&String.fromCharCode(...view.subarray(4,8))==='ftyp';
    if(isInit)this.init={data:view.slice(),mime,offset};
    if(!this.enabled)return;
    if(this.bytes+view.byteLength>4*1024*1024||this.items.length>=256){this.fail('音频预处理缓冲超限');return;}
    this.items.push({data:isInit?this.init.data:view.slice(),mime,offset});this.bytes+=view.byteLength;this.flush();
  }
  resume(){
    if(this.closed||this.enabled)return;this.enabled=true;this.mse=new MediaSource();this.url=URL.createObjectURL(this.mse);this.media.src=this.url;this.mse.addEventListener('sourceopen',this.onOpen);
    if(this.init){this.items.push(this.init);this.bytes=this.init.data.byteLength;}
  }
  fail(message){if(this.closed)return;this.close();this.onError(Error(message));}
  flush(){if(this.closed||!this.enabled||this.mse?.readyState!=='open'||this.sb?.updating||!this.items.length)return;
    try{const item=this.items[0];if(!this.sb){if(!item.mime)return;this.sb=this.mse.addSourceBuffer(item.mime);this.mime=item.mime;this.sb.addEventListener('updateend',this.onUpdate);this.sb.addEventListener('error',this.onFailure);}
      const end=this.sb.buffered.length?this.sb.buffered.end(this.sb.buffered.length-1):0;
      const cutoff=end-100;if(cutoff>0&&this.sb.buffered.start(0)<cutoff-5){this.sb.remove(0,cutoff);return;}
      if(item.mime&&item.mime!==this.mime){this.sb.changeType(item.mime);this.mime=item.mime;}
      if(Number.isFinite(item.offset))this.sb.timestampOffset=item.offset;
      this.sb.appendBuffer(item.data);this.items.shift();this.bytes-=item.data.byteLength;
    }catch(e){this.fail('音频预处理缓冲失败：'+e.message);}}
  suspend(){
    this.enabled=false;this.items=[];this.bytes=0;
    this.sb?.removeEventListener('updateend',this.onUpdate);this.sb?.removeEventListener('error',this.onFailure);this.mse?.removeEventListener('sourceopen',this.onOpen);
    if(this.sb&&this.mse?.readyState==='open'){try{if(this.sb.updating)this.sb.abort();this.mse.removeSourceBuffer(this.sb);}catch{}}
    this.media.pause();this.media.removeAttribute('src');this.media.load();if(this.url)URL.revokeObjectURL(this.url);
    this.sb=null;this.mse=null;this.url=null;this.mime=null;
  }
  close(){if(this.closed)return;this.closed=true;this.suspend();this.init=null;}
}
window.AudioMirror=AudioMirror;
