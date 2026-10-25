import * as ort from '../vendor/ort/ort.webgpu.min.mjs';
import {Spectral,LENGTH,TRIM,CORE,F,T} from './dsp.mjs';
import {suppressResidual} from './residual.mjs';
import {selectStem} from './stems.mjs';
import {assess,REALTIME_BUDGET_MS} from './performance.mjs';
import {requestHardwareGPU,gpuHelp} from './gpu-device.mjs';

let session,spectral,provider,device='',passes=2,slowBlocks=0;
const profile=()=>passes===2?'双次增强':'兼容推理';
ort.env.wasm.numThreads=1; // Runs inside our own worker; no UI-thread FFT or inference.
ort.env.wasm.proxy=false;
ort.env.wasm.wasmPaths=new URL('../vendor/ort/',import.meta.url).href;
ort.env.logLevel='error';
async function process(left,right,mode='game',stem='instrumental'){
  const start=performance.now(),tensors=[];
  try{
    if(left?.length!==LENGTH||right?.length!==LENGTH)throw Error('音频块长度无效');
    const input=new ort.Tensor('float32',spectral.encode([left,right]),[1,4,F,T]);tensors.push(input);
    const output=await session.run({[session.inputNames[0]]:input});tensors.push(...Object.values(output));
    const positive=output[session.outputNames[0]].data,clean=new Float32Array(positive);
    if(passes===2){
      const negativeData=new Float32Array(input.data.length);
      for(let i=0;i<negativeData.length;i++)negativeData[i]=-input.data[i];
      const negativeTensor=new ort.Tensor('float32',negativeData,[1,4,F,T]);tensors.push(negativeTensor);
      const negativeOutput=await session.run({[session.inputNames[0]]:negativeTensor});tensors.push(...Object.values(negativeOutput));
      const negative=negativeOutput[session.outputNames[0]].data;
      for(let i=0;i<clean.length;i++)clean[i]=(positive[i]-negative[i])*.5;
    }
    // Invert the unmasked instrumental estimate. Suppressing it first would
    // incorrectly move the discarded game sounds into the vocal stem.
    if(stem==='vocals')selectStem(input.data,clean,stem);
    else { suppressResidual(input.data,clean,F,T,mode); selectStem(input.data,clean,'instrumental'); }
    const [l,r]=spectral.decode(clean).map(c=>c.slice(TRIM,TRIM+CORE));
    return {left:l,right:r,ms:performance.now()-start,profile:profile(),passes};
  }finally{for(const tensor of tensors)tensor.dispose();}
}
async function init(forceCpu=false,performanceMode='auto',streams=1){
  const selected=forceCpu?null:await requestHardwareGPU(navigator.gpu,navigator.userAgent);
  device=selected?.device||'';
  const config=await(await fetch(new URL('../models/model.json',import.meta.url))).json();
  const bytes=await(await fetch(new URL('../models/'+config.file,import.meta.url))).arrayBuffer();
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  if(hash!==config.sha256)throw Error('模型校验失败，请重新解压插件');
  spectral=new Spectral();
  const options={executionMode:'sequential',graphOptimizationLevel:'all',logSeverityLevel:3};
  passes=forceCpu||performanceMode==='compatible'?1:2;slowBlocks=0;
  // Non-silent, deterministic audio exercises the complete path; initial shader compilation is excluded.
  const probe=Float32Array.from({length:LENGTH},(_,i)=>.08*Math.sin(2*Math.PI*220*i/44100)+.025*Math.sin(2*Math.PI*731*i/44100));
  if(forceCpu){
    session=await ort.InferenceSession.create(bytes,{...options,executionProviders:['wasm']});provider='WASM CPU';
    await process(probe,probe);
  }else{
  try{
    ort.env.webgpu.adapter=selected.adapter;
    session=await ort.InferenceSession.create(bytes,{...options,executionProviders:['webgpu']});provider='WebGPU GPU';
    await process(probe,probe); // Compile kernels before collecting steady-state timings.
  }catch(error){
    if(session){try{await session.release();}catch{}session=null;}
    const failure=Error('已检测到 GPU，但人声处理初始化失败。'+gpuHelp(navigator.userAgent)+' '+String(error.message||error).slice(0,240));failure.code='WEBGPU_INIT_FAILED';failure.gpu=selected.diagnostics;throw failure;
  }
  }
  // Diagnostic-only: the UI never automatically falls back to CPU inference.
  if(forceCpu){const result=await process(probe,probe);return{provider,device,profile:profile(),passes,blockMs:result.ms,delay:14,ready:true,realtime:false};}
  async function benchmark(){const samples=[];for(let i=0;i<3;i++)samples.push((await process(probe,probe)).ms);return{...assess(samples.map(ms=>ms*Math.max(1,Math.min(2,streams)))),samples};}
  let result=await benchmark();
  if(!result.realtime&&passes===2){passes=1;await process(probe,probe);result=await benchmark();}
  if(!result.realtime)throw Error('GPU 实测仍跟不上直播（'+(device||'WebGPU')+'，兼容推理 '+Math.round(result.ms)+' ms/块）。请确认浏览器使用独立显卡、开启图形加速并关闭节能模式');
  return {provider,device,gpu:selected.diagnostics,profile:profile(),passes,blockMs:result.ms,benchmarkMs:result.samples,delay:result.delay,ready:true,realtime:true};
}
let busy=false;
self.onmessage=async({data:message})=>{
  if(busy){self.postMessage({id:message.id,error:'正在处理上一块音频'});return;}
  busy=true;
  try{
    if(message.type==='init')self.postMessage({id:message.id,...await init(message.forceCpu,message.performanceMode,message.streams)});
    else{if(!session)throw Error('模型尚未加载');const result=await process(message.left,message.right,message.mode,message.stem);
      slowBlocks=result.ms*Math.max(1,Math.min(2,message.streams||1))>REALTIME_BUDGET_MS?slowBlocks+1:0;
      if(passes===2&&slowBlocks>=2){passes=1;slowBlocks=0;result.nextProfile=profile();}
      self.postMessage({id:message.id,...result},[result.left.buffer,result.right.buffer]);}
  }catch(error){self.postMessage({id:message.id,error:error.message||String(error),code:error.code,gpu:error.gpu});}
  finally{busy=false;}
};
