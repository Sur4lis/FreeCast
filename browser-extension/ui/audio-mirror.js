// Mirror encoded AUDIO segments, preserving the selected source's media timestamps.
// No extra network connection and no copied video frames.
class AudioMirror {
  constructor(media,onError){this.media=media;this.onError=onError;this.items=[];this.bytes=0;this.closed=false;this.mse=new MediaSource();this.url=URL.createObjectURL(this.mse);media.src=this.url;this.mse.addEventListener('sourceopen',()=>this.flush());}
  push(data,mime,offset){if(this.closed)return;const bytes=new Uint8Array(data).slice();this.items.push({data:bytes,mime,offset});this.bytes+=bytes.byteLength;if(this.bytes>16*1024*1024){this.fail('音频预处理缓冲超限');return;}this.flush();}
  fail(message){if(this.closed)return;this.close();this.onError(Error(message));}
  flush(){if(this.closed||this.mse.readyState!=='open'||this.sb?.updating||!this.items.length)return;
    try{const item=this.items[0];if(!this.sb){if(!item.mime)return;this.sb=this.mse.addSourceBuffer(item.mime);this.mime=item.mime;this.sb.addEventListener('updateend',()=>this.flush());this.sb.addEventListener('error',()=>this.fail('音频预处理解码异常'));}
      const end=this.sb.buffered.length?this.sb.buffered.end(this.sb.buffered.length-1):0;
      const cutoff=end-140;if(cutoff>0&&this.sb.buffered.start(0)<cutoff-5){this.sb.remove(0,cutoff);return;}
      if(item.mime&&item.mime!==this.mime){this.sb.changeType(item.mime);this.mime=item.mime;}
      if(Number.isFinite(item.offset))this.sb.timestampOffset=item.offset;
      this.sb.appendBuffer(item.data);this.items.shift();this.bytes-=item.data.byteLength;
    }catch(e){this.fail('音频预处理缓冲失败：'+e.message);}}
  close(){if(this.closed)return;this.closed=true;this.items=[];this.media.pause();this.media.removeAttribute('src');this.media.load();URL.revokeObjectURL(this.url);}
}
window.AudioMirror=AudioMirror;
