(()=>{
  function appendImage(parent,data,label){
    const url=ChatProtocol.imageUrl(data?.url);if(!url){parent.append(document.createTextNode(label));return;}
    const img=document.createElement('img');img.className='chat-emote';img.alt=label;img.title=label;img.decoding='async';img.referrerPolicy='no-referrer';img.draggable=false;
    const ratio=Number.isFinite(data.ratio)?Math.max(.3,Math.min(5,data.ratio)):1;img.style.width=(1.4*ratio)+'em';
    img.addEventListener('error',()=>img.replaceWith(document.createTextNode(label)),{once:true});img.src=url;parent.append(img);
  }
  window.ChatContent={append(parent,message){
    const text=String(message.text||'');if(message.emoticon){appendImage(parent,message.emoticon,text||'[表情]');return;}
    const images=new Map((message.emotes||[]).filter(e=>e.token&&ChatProtocol.imageUrl(e.url)).map(e=>[e.token,e]));
    if(!images.size){parent.append(document.createTextNode(text));return;}
    const pattern=new RegExp('('+[...images.keys()].sort((a,b)=>b.length-a.length).map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')','g');
    let count=0;for(const part of text.split(pattern)){const image=images.get(part);if(image&&count++<40)appendImage(parent,image,part);else parent.append(document.createTextNode(part));}
  }};
})();
