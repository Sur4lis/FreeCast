export function gpuHelp(userAgent=''){
  if(/QQBrowser\//i.test(userAgent))return 'QQ 浏览器的图形加速与 WebGPU 支持并不等同；请更新 QQ 浏览器并完全重启，仍失败可使用最新版 Chrome 或 Edge。';
  const page=/Edg\//.test(userAgent)?'edge://gpu':'chrome://gpu';
  return `请在 ${page} 查看 WebGPU 状态；更改图形加速后需完全重启浏览器。`;
}
export async function requestHardwareGPU(gpu,userAgent='',timeoutMs=5000){
  const attempts=[];
  function failure(code,message){const error=Error(message+' '+gpuHelp(userAgent));error.code=code;error.gpu={attempts};return error;}
  if(!gpu?.requestAdapter)throw failure('WEBGPU_UNAVAILABLE','当前浏览器未提供 WebGPU 接口，请更新 Chrome 或 Edge。');
  for(const preference of ['high-performance','default','low-power']){
    let timer;
    try{
      const request=preference==='default'?gpu.requestAdapter():gpu.requestAdapter({powerPreference:preference});
      const adapter=await Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('设备检测超时')),timeoutMs);})]);
      if(!adapter){attempts.push({preference,status:'unavailable'});continue;}
      let info={};try{info=adapter.info||await adapter.requestAdapterInfo?.()||{};}catch{}
      if(info.isFallbackAdapter===true||adapter.isFallbackAdapter===true){attempts.push({preference,status:'software'});continue;}
      attempts.push({preference,status:'hardware'});
      const device=[info.vendor,info.description||info.architecture].filter(Boolean).join(' ').slice(0,160);
      return{adapter,device,diagnostics:{preference,attempts}};
    }catch(error){attempts.push({preference,status:'error',message:String(error.message||error).slice(0,160)});}
    finally{clearTimeout(timer);}
  }
  const software=attempts.some(attempt=>attempt.status==='software');
  throw failure(software?'WEBGPU_SOFTWARE_ONLY':'WEBGPU_NO_ADAPTER',software?'浏览器仅提供软件 WebGPU，无法实时去人声。':'浏览器未提供可用的 WebGPU 设备；已开启图形加速也可能受浏览器或驱动限制。');
}
