// Suppress low-confidence residuals with one stereo-linked, time-smoothed mask.
// Strong instrumental bins remain unchanged; no raw vocal mix-back is added.
function suppressResidual(mixture,instrumental,F,T,mode='game'){
  const size=F*T,mask=new Float32Array(size),threshold=mode==='strong'?.65:.28,power=mode==='strong'?1.15:.6;
  for(let i=0;i<size;i++){let input=0,output=0;for(let c=0;c<4;c++){input+=mixture[c*size+i]**2;output+=instrumental[c*size+i]**2;}
    const ratio=Math.sqrt(output/(input+1e-12));mask[i]=Math.min(1,Math.max(.001,ratio/threshold))**power;}
  for(let f=0;f<F;f++)for(let t=0;t<T;t++){const i=f*T+t,gain=(mask[f*T+Math.max(0,t-1)]+2*mask[i]+mask[f*T+Math.min(T-1,t+1)])/4;for(let c=0;c<4;c++)instrumental[c*size+i]*=gain;}
  return instrumental;
}
export {suppressResidual};
