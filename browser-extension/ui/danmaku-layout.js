// Equal pixel velocity prevents long comments catching short comments in the same lane.
(()=>{
  const overlay=$('danmaku');let signature='',nextLane=0;
  function geometry(){const width=overlay.clientWidth,height=overlay.clientHeight,line=Math.ceil(mix.danmakuSize*1.8)+4;return{width,height,line,rows:Math.max(0,Math.floor(height*(mix.danmakuArea/100)/line))};}
  // SC covers only its own rectangle. Never move or delete entire comment lanes.
  function maskSC(){
    const sc=$('superChatOverlay'),rect=overlay.getBoundingClientRect();let clip='none';
    if(!sc.hidden&&sc.children.length&&rect.width&&rect.height){
      const box=sc.getBoundingClientRect(),left=Math.max(0,box.left-rect.left-4),right=Math.min(rect.width,box.right-rect.left+4),top=Math.max(0,box.top-rect.top-4),bottom=Math.min(rect.height,box.bottom-rect.top+4);
      if(right>left&&bottom>top)clip=`path(evenodd, "M0 0H${rect.width}V${rect.height}H0Z M${left} ${top}H${right}V${bottom}H${left}Z")`;
    }
    if(window.chatAvoidance?.regions().length&&rect.width&&rect.height){
      const holes=window.chatAvoidance.rects(rect.width,rect.height);
      if(!sc.hidden&&sc.children.length){const b=sc.getBoundingClientRect();holes.push({x:b.left-rect.left-4,y:b.top-rect.top-4,w:b.width+8,h:b.height+8});}
      const visible=window.chatAvoidance.visible(rect.width,rect.height,holes);
      clip=visible.length?'path("'+visible.map(r=>`M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}Z`).join(' ')+'")':'inset(50%)';
    }
    if(overlay.style.clipPath!==clip)overlay.style.clipPath=clip;
  }
  function layout(){
    const g=geometry(),key=[g.width,g.height,g.line,mix.danmakuArea,mix.danmakuDensity].join(':');
    // Reflowing moving comments onto fewer lanes would create collisions. Sidebar history stays intact.
    if(signature&&signature!==key)overlay.replaceChildren();signature=key;maskSC();return g;
  }
  function add(bullet){
    const g=layout();if(g.width<1||g.rows<1||overlay.children.length>=Math.ceil(60*mix.danmakuDensity/100))return false;
    const origin=overlay.getBoundingClientRect().left,gap=Math.max(24,mix.danmakuSize)*(100/mix.danmakuDensity),available=[];
    const lanes=Array.from({length:Math.max(1,Math.ceil(g.rows*mix.danmakuDensity/100))},(_,i)=>i);
    for(let i=0;i<lanes.length;i++){
      const lane=lanes[(nextLane+i)%lanes.length];
      if(window.danmakuActions?.heldLane()===lane)continue;
      if([...overlay.children].filter(el=>Number(el.dataset.lane)===lane).every(el=>el.getBoundingClientRect().right-origin<=g.width-gap))available.push(lane);
    }
    if(!available.length)return false; // Busy overlay: show the comment in the sidebar, never delay it into the wrong scene.
    const lane=available[0];nextLane=(lanes.indexOf(lane)+1)%lanes.length;bullet.dataset.lane=lane;
    bullet.style.top=lane*g.line+'px';bullet.style.height=g.line-4+'px';bullet.style.setProperty('--travel',g.width+'px');
    overlay.append(bullet);const width=Math.ceil(bullet.getBoundingClientRect().width);
    // Reserve the measured box so late image errors/font loads cannot grow into the following comment.
    bullet.style.width=width+'px';bullet.style.animationDuration=((g.width+width)/(g.width/9))+'s';
    for(const animation of bullet.getAnimations())animation.updatePlaybackRate(mix.danmakuSpeed);
    bullet.addEventListener('animationend',()=>bullet.remove(),{once:true});return true;
  }
  window.danmakuLayout={add,layout,maskSC};
  new ResizeObserver(maskSC).observe($('superChatOverlay'));
})();
