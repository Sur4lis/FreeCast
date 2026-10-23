import FFT from '../vendor/fft.mjs';
// MDX HQ3 uses a 6144-point STFT: three radix-2 FFTs with a radix-3 merge.
class FFT6144 {
  constructor() {
    this.n = 6144; this.m = 2048; this.fft = new FFT(this.m);
    this.input = new Float64Array(2 * this.m);
    this.parts = Array.from({ length: 3 }, () => new Float64Array(2 * this.m));
    this.cos = new Float64Array(this.n); this.sin = new Float64Array(this.n);
    for (let k = 0; k < this.n; k++) { this.cos[k] = Math.cos(-2 * Math.PI * k / this.n); this.sin[k] = Math.sin(-2 * Math.PI * k / this.n); }
  }
  transform(out, input, inverse = false) {
    const { n, m } = this;
    for (let r = 0; r < 3; r++) {
      for (let j = 0; j < m; j++) { this.input[2*j] = input[2*(3*j+r)]; this.input[2*j+1] = input[2*(3*j+r)+1] * (inverse ? -1 : 1); }
      this.fft.transform(this.parts[r], this.input);
    }
    for (let k = 0; k < n; k++) {
      const idx = 2 * (k % m); let re = this.parts[0][idx], im = this.parts[0][idx+1];
      for (let r = 1; r < 3; r++) { const w = (r*k) % n, a = this.parts[r][idx], b = this.parts[r][idx+1]; re += a*this.cos[w] - b*this.sin[w]; im += a*this.sin[w] + b*this.cos[w]; }
      out[2*k] = re / (inverse ? n : 1); out[2*k+1] = im * (inverse ? -1/n : 1);
    }
  }
}
const N = 6144, HOP = 1024, F = 3072, T = 256, LENGTH = HOP*(T-1), TRIM = N/2, CORE = LENGTH-2*TRIM, OVERLAP = 22050, STEP = CORE-OVERLAP, RATE = 44100;
class Spectral {
  constructor() {
    this.fft = new FFT6144(); this.window = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5*Math.cos(2*Math.PI*i/N));
    this.input = new Float64Array(2*N); this.output = new Float64Array(2*N);
    this.norm = new Float64Array(LENGTH);
    for (let t=0;t<T;t++) for (let j=0;j<N;j++) { const i=t*HOP+j-TRIM; if(i>=0&&i<LENGTH)this.norm[i]+=this.window[j]**2; }
  }
  encode(channels, lowCut = true) {
    const tensor = new Float32Array(4*F*T);
    for (let c=0;c<2;c++) for(let t=0;t<T;t++) {
      for(let j=0;j<N;j++) { let i=t*HOP+j-TRIM; if(i<0)i=-i; if(i>=LENGTH)i=2*LENGTH-2-i; this.input[2*j]=channels[c][i]*this.window[j]; this.input[2*j+1]=0; }
      this.fft.transform(this.output,this.input);
      for(let f=lowCut?3:0;f<F;f++) { tensor[(c*2*F+f)*T+t]=this.output[2*f]; tensor[((c*2+1)*F+f)*T+t]=this.output[2*f+1]; }
    }
    return tensor;
  }
  decode(tensor, compensate = 1) {
    const channels = [new Float32Array(LENGTH),new Float32Array(LENGTH)];
    for(let c=0;c<2;c++) for(let t=0;t<T;t++) {
      this.input.fill(0);
      for(let f=0;f<F;f++) { const re=tensor[(c*2*F+f)*T+t],im=tensor[((c*2+1)*F+f)*T+t];this.input[2*f]=re;this.input[2*f+1]=im;if(f>0){this.input[2*(N-f)]=re;this.input[2*(N-f)+1]=-im;} }
      this.fft.transform(this.output,this.input,true);
      for(let j=0;j<N;j++) {const i=t*HOP+j-TRIM;if(i>=0&&i<LENGTH)channels[c][i]+=this.output[2*j]*this.window[j];}
    }
    for(const channel of channels)for(let i=0;i<LENGTH;i++)channel[i]=channel[i]*compensate/Math.max(1e-8,this.norm[i]);
    return channels;
  }
}
export {FFT6144,Spectral,N,HOP,F,T,LENGTH,TRIM,CORE,OVERLAP,STEP,RATE};
