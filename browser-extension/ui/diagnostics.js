(()=>{
  let timer,last='';const dialog=$('diagnosticsDialog');
  function snapshot(){const gpu=window.live.vocalDiagnostics?.(),ua=navigator.userAgent||'',qq=ua.match(/QQBrowser\/([\d.]+)/i),edge=ua.match(/Edg\/([\d.]+)/),chrome=ua.match(/Chrome\/([\d.]+)/),browser=qq?'QQ 浏览器 '+qq[1]:edge?'Edge '+edge[1]:chrome?'Chrome '+chrome[1]:'其他浏览器',lines=['FreeCast 播放诊断',`浏览器：${browser}${qq&&chrome?' · Chromium '+chrome[1]:''}`,`观看：${running?(paused?'暂停':replay.active?'回看':'直播'):'未连接'} · 缓存 ${replay.seconds()/60} 分钟`, `浏览器 WebGPU：${navigator.gpu?'接口已提供；设备以 AI 检测结果为准':'接口不可用'}`];
    if(window.playbackPerformance)lines.push('显示模式：'+(playbackPerformance.smooth()?'流畅':'完整')+' · '+playbackPerformance.mode());
    if(gpu){lines.push(`AI 检测：${gpu.state}${gpu.provider?' · '+gpu.provider:''}${gpu.device?' · '+gpu.device:''}${gpu.code?' · '+gpu.code:''}`);if(gpu.gpu?.attempts)lines.push('设备尝试：'+gpu.gpu.attempts.map(a=>a.preference+'='+a.status).join('，'));}
    for(const k of ['a','b']){const c=channels[k],p=vocal.pipes[k],m=$(k==='a'?'audioA':'videoB'),q=m.getVideoPlaybackQuality?.();let ahead=0;for(let i=0;i<m.buffered.length;i++)if(m.currentTime>=m.buffered.start(i)&&m.currentTime<=m.buffered.end(i))ahead=m.buffered.end(i)-m.currentTime;
      lines.push(`${k.toUpperCase()} 路：${c?(c.room.platform||'bilibili'):'未连接'} · ${m.videoWidth||0}×${m.videoHeight||0} · 前方缓冲 ${ahead.toFixed(1)} 秒`, `线路 ${(c?.index??0)+1} · 解码丢帧 ${q?.droppedVideoFrames||0}/${q?.totalVideoFrames||0} · 自动校准 ${c?.syncSeeks||p.videoSeeks||0} 次`, `弹幕：${chatStates[k]}`,`AI：${p.error?'失败：'+p.error:p.loading?'加载中':p.active?(p.stem==='vocals'?'只保留人声':'去人声'):'关闭'}${p.active?' · '+(p.provider||'')+' · '+Math.round(p.lastMs||0)+' ms/块 · 待处理 '+(p.samples/44100).toFixed(1)+' 秒':''}`);
      if(c)lines.push('转封装：'+(c.engine instanceof Hls?(c.engine.config.enableWorker?'独立线程':'兼容播放'):c.engine?._player_engine?._transmuxer?._worker?'独立线程':'兼容播放'));
      if(c?.error)lines.push('播放异常：'+c.error);else if(running&&ahead<1)lines.push('建议：缓冲不足，可切换线路或降低画质。');
      if(c)lines.push('连接恢复：'+(c.recoveryBlocked?'等待验证或授权':c.recovering?'自动重连中':'正常')+' · 已恢复 '+(c.recoveries||0)+' 次'+(c.recoveryReason?' · 最近原因：'+c.recoveryReason:''));
      if(p.error&&/^CPU/.test(p.error))lines.push('CPU 测速未通过：已释放模型，继续使用原声。虚拟机可用的算力取决于宿主分配。');
      else if(p.error)lines.push(/WebGPU|GPU|图形加速/i.test(p.error)?qq?'建议：更新 QQ 浏览器并完全重启；图形加速开启不代表 WebGPU 可用。仍失败可改用最新版 Chrome 或 Edge，暂时可使用原声。':'建议：在 '+(edge?'edge://gpu':'chrome://gpu')+' 查看 WebGPU 状态。图形加速已开启时，仍需检查浏览器限制和驱动；暂时可使用原声。':/超时|跟不上|时间预算/.test(p.error)?'建议：切换兼容模式或仅保留一路 AI，再点击重试 AI；也可继续使用原声。':'建议：点击重试 AI；若音轨中断持续出现，可切换线路或使用原声。');
    }
    if(vocal.ctx)lines.push('音频设备：'+vocal.ctx.state+' · '+vocal.ctx.sampleRate+' Hz');if(window.localRecording)lines.push('本地保存：'+window.localRecording.status());
    // No stream URLs, cookies, room names or account identifiers in copied diagnostics.
    return lines.join('\n').replace(/https?:\/\/\S+/gi,'[直播地址已省略]');}
  function refresh(){last=snapshot();$('diagnosticsContent').textContent=last;}
  $('diagnosticsButton').onclick=()=>{refresh();dialog.showModal();clearInterval(timer);timer=setInterval(refresh,1000);};dialog.addEventListener('close',()=>clearInterval(timer));
  $('copyDiagnostics').onclick=async()=>{try{await navigator.clipboard.writeText(last);$('copyDiagnostics').textContent='已复制';}catch{notice('复制失败，请重试',true);}};
  window.playbackDiagnostics={snapshot};
})();
