// The bundled MDX model predicts instrumental audio. Derive vocals from the
// phase-aligned complex spectrum before any instrumental residual suppression.
export function selectStem(mixture, instrumental, stem='instrumental', compensate=1.022) {
  if(mixture.length!==instrumental.length)throw Error('音频频谱长度不一致');
  const vocals=stem==='vocals';
  for(let i=0;i<instrumental.length;i++) {
    const estimate=instrumental[i]*compensate;
    instrumental[i]=vocals?mixture[i]-estimate:estimate;
  }
  return instrumental;
}
