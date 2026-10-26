(()=>{
  const key='freecast-sc-scale-v1',overlay=$('superChatOverlay');
  let scale=100;
  try{const saved=Number(localStorage.getItem(key));if(Number.isFinite(saved)&&saved>=70&&saved<=180)scale=Math.round(saved/5)*5;}catch{}
  const control=document.createElement('div');control.className='danmaku-control sc-size-control';
  control.innerHTML='<label for="scScale">SC 大小<output id="scScaleValue" for="scScale">100%</output></label><input id="scScale" type="range" min="70" max="180" step="5" value="100">';
  document.querySelector('.sc-position-actions').before(control);
  function apply(){
    overlay.style.setProperty('--sc-scale',String(scale/100));
    $('scScale').value=scale;$('scScaleValue').value=scale+'%';
    window.scPosition?.place();window.danmakuLayout?.maskSC();
  }
  function set(value){if(!Number.isFinite(value))return;scale=clamp(Math.round(value/5)*5,70,180);apply();try{localStorage.setItem(key,String(scale));}catch{}}
  $('scScale').addEventListener('input',event=>set(Number(event.target.value)));
  $('resetDanmakuStyle').addEventListener('click',()=>set(100));
  apply();
})();
