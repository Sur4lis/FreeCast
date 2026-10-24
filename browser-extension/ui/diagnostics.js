(()=>{
  let timer,last='';const dialog=$('diagnosticsDialog');
  function snapshot(){const lines=['FreeCast 播放诊断',`观看：${running?(paused?'暂停':replay.active?'回看':'直播'):'未连接'} · 缓存 ${replay.seconds()/60} 分钟`, `浏览器 WebGPU：${navigator.gpu?'可用':'不可用'}`];
    for(const k of ['a','b']){const c=channels[k],p=vocal.pipes[k],m=$(k==='a'?'audioA':'videoB'),q=m.getVideoPlaybackQuality?.();let ahead=0;for(let i=0;i<m.buffered.length;i++)if(m.currentTime>=m.buffered.start(i)&&m.currentTime<=m.buffered.end(i))ahead=m.buffered.end(i)-m.currentTime;
      lines.push(`${k.toUpperCase()} 路：${c?(c.room.platform||'bilibili'):'未连接'} · ${m.videoWidth||0}×${m.videoHeight||0} · 前方缓冲 ${ahead.toFixed(1)} 秒`, `线路 ${(c?.index??0)+1} · 解码丢帧 ${q?.droppedVideoFrames||0}/${q?.totalVideoFrames||0} · 自动校准 ${c?.syncSeeks||p.videoSeeks||0} 次`, `弹幕：${chatStates[k]}`,`AI：${p.error?'失败：'+p.error:p.loading?'加载中':p.active?(p.stem==='vocals'?'只保留人声':'去人声'):'关闭'}${p.active?' · '+(p.provider||'')+' · '+Math.round(p.lastMs||0)+' ms/块 · 待处理 '+(p.samples/44100).toFixed(1)+' 秒':''}`);
      if(c?.error)lines.push('播放异常：'+c.error);else if(running&&ahead<1)lines.push('建议：缓冲不足，可切换线路或降低画质。');
      if(p.error)lines.push(/WebGPU|GPU|图形加速/i.test(p.error)?'建议：更新浏览器并检查图形加速；仍不可用时选择使用原声。':/超时|跟不上|时间预算/.test(p.error)?'建议：切换兼容模式或仅保留一路 AI，再点击重试 AI；也可继续使用原声。':'建议：点击重试 AI；若音轨中断持续出现，可切换线路或使用原声。');
    }
    if(vocal.ctx)lines.push('音频设备：'+vocal.ctx.state+' · '+vocal.ctx.sampleRate+' Hz');if(window.localRecording)lines.push('本地保存：'+window.localRecording.status());
    // No stream URLs, cookies, room names or account identifiers in copied diagnostics.
    return lines.join('\n').replace(/https?:\/\/\S+/gi,'[直播地址已省略]');}
  function refresh(){last=snapshot();$('diagnosticsContent').textContent=last;}
  $('diagnosticsButton').onclick=()=>{refresh();dialog.showModal();clearInterval(timer);timer=setInterval(refresh,1000);};dialog.addEventListener('close',()=>clearInterval(timer));
  $('copyDiagnostics').onclick=async()=>{try{await navigator.clipboard.writeText(last);$('copyDiagnostics').textContent='已复制';}catch{notice('复制失败，请重试',true);}};
  window.playbackDiagnostics={snapshot};
})();
