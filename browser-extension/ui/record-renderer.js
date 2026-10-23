// Render the displayed video geometry and comments without capturing controls.
(()=>{
  const textures=new WeakMap(),images=new Map();
  function image(url){let value=images.get(url);if(value)return value.bitmap;value={};images.set(url,value);fetch(url,{credentials:'omit'}).then(r=>{if(!r.ok)throw Error();return r.blob();}).then(createImageBitmap).then(bitmap=>{value.bitmap=bitmap;}).catch(()=>{});if(images.size>100){const old=images.keys().next().value;images.get(old)?.bitmap?.close();images.delete(old);}return null;}
  function texture(el,scale=1){let cached=textures.get(el);const signature=el.textContent+el.offsetWidth+el.offsetHeight+document.documentElement.dataset.theme+':'+scale;if(cached?.signature===signature&&performance.now()-cached.at<1500)return cached.canvas;
    const r=el.getBoundingClientRect(),canvas=document.createElement('canvas');canvas.width=Math.ceil(r.width*scale);canvas.height=Math.ceil(r.height*scale);const ctx=canvas.getContext('2d'),style=getComputedStyle(el);ctx.scale(scale,scale);ctx.fillStyle=style.backgroundColor;ctx.beginPath();ctx.roundRect(0,0,r.width,r.height,parseFloat(style.borderRadius)||0);ctx.fill();
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);let n;while((n=walker.nextNode())){
      if(n.nodeType===Node.ELEMENT_NODE&&n.tagName==='IMG'){const box=n.getBoundingClientRect(),bitmap=image(n.src);if(bitmap)ctx.drawImage(bitmap,box.left-r.left,box.top-r.top,box.width,box.height);else{ctx.fillStyle=style.color;ctx.font='16px sans-serif';ctx.fillText(n.alt||'☺',box.left-r.left,box.bottom-r.top-2);}continue;}
      if(n.nodeType!==Node.TEXT_NODE||!n.textContent.trim())continue;const s=getComputedStyle(n.parentElement);ctx.font=s.font;ctx.fillStyle=s.color;ctx.textBaseline='bottom';const range=document.createRange();let pos=0;
      for(const char of n.textContent){range.setStart(n,pos);pos+=char.length;range.setEnd(n,pos);const b=range.getBoundingClientRect();if(!b.width)continue;if(el.classList.contains('bullet')){ctx.strokeStyle='#000c';ctx.lineWidth=2;ctx.strokeText(char,b.left-r.left,b.bottom-r.top);}ctx.fillText(char,b.left-r.left,b.bottom-r.top);}
    }textures.set(el,{signature,canvas,at:performance.now()});return canvas;
  }
  function drawVideo(ctx,video,dest,slot){
    if(!video||video.readyState<2||!video.videoWidth)return;ctx.save();ctx.beginPath();ctx.rect(dest.x,dest.y,dest.w,dest.h);ctx.clip();
    const crop=window.miniWindow?.crop(video),sx=crop?crop.x*video.videoWidth:0,sy=crop?crop.y*video.videoHeight:0,sw=crop?crop.w*video.videoWidth:video.videoWidth,sh=crop?crop.h*video.videoHeight:video.videoHeight;
    const scale=Math.min(dest.w/sw,dest.h/sh),w=sw*scale,h=sh*scale;ctx.imageSmoothingEnabled=Math.abs(scale-1)>.00001;ctx.imageSmoothingQuality='high';ctx.drawImage(video,sx,sy,sw,sh,dest.x+(dest.w-w)/2,dest.y+(dest.h-h)/2,w,h);ctx.restore();
  }
  function draw(canvas,includeMini){const ctx=canvas.getContext('2d',{alpha:false}),w=canvas.width,h=canvas.height,main=$('mainSlot'),r=main.getBoundingClientRect();ctx.fillStyle='#08090b';ctx.fillRect(0,0,w,h);if(!r.width||!r.height)return;drawVideo(ctx,main.querySelector('video'),{x:0,y:0,w,h},main);
    const overlay=$('danmaku'),dr=overlay.getBoundingClientRect(),sc=$('superChatOverlay'),sr=sc.getBoundingClientRect();
    ctx.save();ctx.scale(w/r.width,h/r.height);ctx.translate(-r.left,-r.top);
    if(mix.showChat){ctx.save();const holes=window.chatAvoidance.rects(dr.width,dr.height);if(!sc.hidden&&sc.children.length)holes.push({x:sr.left-dr.left-4,y:sr.top-dr.top-4,w:sr.width+8,h:sr.height+8});ctx.beginPath();for(const rect of window.chatAvoidance.visible(dr.width,dr.height,holes))ctx.rect(dr.left+rect.x,dr.top+rect.y,rect.w,rect.h);ctx.clip();
      for(const el of overlay.children){const b=el.getBoundingClientRect();ctx.globalAlpha=1-mix.danmakuTransparency/100;ctx.drawImage(texture(el,Math.max(1,w/r.width,h/r.height)),b.left,b.top,b.width,b.height);}ctx.restore();}
    if(!sc.hidden){for(const el of sc.children){const b=el.getBoundingClientRect();ctx.drawImage(texture(el,Math.max(1,w/r.width,h/r.height)),b.left,b.top,b.width,b.height);}}ctx.restore();
    const mini=$('miniSlot'),panel=$('miniPanel');if(includeMini&&!panel.hidden&&mini.clientWidth>0&&mini.clientHeight>0&&!document.body.classList.contains('mini-minimized')){const mw=w*.26,mh=mw*(mini.clientHeight/Math.max(1,mini.clientWidth)),dest={x:w-mw-16,y:h-Math.min(mh,h*.45)-16,w:mw,h:Math.min(mh,h*.45)};ctx.fillStyle='#08090b';ctx.fillRect(dest.x,dest.y,dest.w,dest.h);drawVideo(ctx,mini.querySelector('video'),dest,mini);}
  }
  window.recordRenderer={draw,clear(){for(const value of images.values())value.bitmap?.close();images.clear();}};
})();
