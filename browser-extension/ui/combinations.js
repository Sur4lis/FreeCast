(()=>{
  let items=[],dragged=null,previewToken=0;const key='freecast-combinations-v1',selectedKey=key+'-selected';
  try{const s=JSON.parse(localStorage.getItem(key)||'[]');if(Array.isArray(s))items=s.filter(x=>typeof x.name==='string'&&typeof x.a==='string'&&typeof x.b==='string'&&x.settings).slice(0,30);}catch{}
  let selected=localStorage.getItem(selectedKey)||'';
  const picker=document.createElement('button'),label=document.createElement('span'),menu=document.createElement('div'),preview=document.createElement('div'),profiles=new Map();
  picker.id='combinationPicker';picker.type='button';picker.setAttribute('aria-haspopup','menu');picker.setAttribute('aria-expanded','false');picker.setAttribute('aria-controls','combinationMenu');label.className='combination-label';
  picker.append(label,$('themePickerButton').lastElementChild.cloneNode(true));$('combinations').append(picker);
  menu.id='combinationMenu';menu.className='combination-menu';menu.hidden=true;menu.setAttribute('role','menu');menu.setAttribute('aria-label','组合收藏');
  preview.id='combinationPreview';preview.className='combination-preview';preview.hidden=true;preview.setAttribute('role','tooltip');document.body.append(menu,preview);
  function position(el,anchor,side=false){const r=anchor.getBoundingClientRect();let x=side?r.right+8:r.left,y=side?r.top:r.bottom+6;if(x+el.offsetWidth>innerWidth-8)x=side?r.left-el.offsetWidth-8:innerWidth-el.offsetWidth-8;el.style.left=Math.max(8,x)+'px';el.style.top=Math.max(8,Math.min(y,innerHeight-el.offsetHeight-8))+'px';}
  function hidePreview(){previewToken++;preview.hidden=true;}
  function close(focus=false){menu.hidden=true;picker.setAttribute('aria-expanded','false');hidePreview();if(focus)picker.focus();}
  function metadata(input){const p=window.presentation?.profile(input),f=favorites.find(f=>String(f.inputId||f.id)===input),value=p?.name&&!p.pendingProfile?p:f;if(!value)return null;return Object.fromEntries(['name','avatar','anchorId','roomId','platform'].filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));}
  function profileRow(k,input,p){
    const row=document.createElement('div'),img=document.createElement('img'),info=document.createElement('div'),name=document.createElement('strong'),id=document.createElement('small');row.className='combination-profile';row.dataset.source=k;
    let avatar='assets/avatar.svg';try{const u=new URL(p.avatar);if(u.protocol==='https:')avatar=u.href;}catch{}img.src=avatar;img.alt='';img.referrerPolicy='no-referrer';img.onerror=()=>{img.onerror=null;img.src='assets/avatar.svg';};
    name.textContent=k.toUpperCase()+' · '+(p.name||'直播源');id.textContent=p.anchorId?'ID '+p.anchorId:p.roomId?'房间 '+p.roomId:input;id.title=input;info.append(name,id);row.append(img,info);return row;
  }
  async function showPreview(item,anchor,side=false){
    if(!item)return;const token=++previewToken;
    const draw=()=>{preview.replaceChildren(...['a','b'].map(k=>profileRow(k,item[k],profiles.get(item[k])||metadata(item[k])||item.profiles?.[k]||{})));preview.hidden=false;position(preview,anchor,side);};
    draw();
    await Promise.allSettled(['a','b'].map(async k=>{if(profiles.has(item[k]))return;const stored=metadata(item[k]);if(stored?.name){profiles.set(item[k],stored);return;}const p=await window.live.getProfile(item[k]);if(p&&!p.pendingProfile)profiles.set(item[k],p);}));
    if(token===previewToken&&anchor.isConnected)draw();
  }
  function persist(){localStorage.setItem(key,JSON.stringify(items));render();}
  async function use(item){
    cancelConnection(false);$('roomA').value=item.a;$('roomB').value=item.b;
    window.configurations.apply(item.settings,{deferConnect:true});save();window.presentation?.avatars();
    selected=item.id;localStorage.setItem(selectedKey,selected);render();close();
    if(running)await connect();else notice('组合已载入，点击连接直播开始观看。');
  }
  function render(){
    const current=items.find(i=>i.id===selected);label.textContent=current?'组合 · '+current.name:'组合';picker.setAttribute('aria-label',current?'选择组合，当前 '+current.name:'选择组合');menu.replaceChildren();
    if(!items.length){const empty=document.createElement('div');empty.className='combination-empty';empty.textContent='尚无组合，点击「＋ 组合」添加';menu.append(empty);}
    for(const item of items){const row=document.createElement('div'),button=document.createElement('button'),remove=document.createElement('button');row.className='combination-row';button.type='button';button.className='combination-option';button.textContent=item.name;button.setAttribute('role','menuitemradio');button.setAttribute('aria-checked',String(item.id===selected));button.draggable=true;button.onclick=()=>{void use(item).catch(e=>notice(e.message,true));};
      button.onpointerenter=()=>showPreview(item,row,true);button.onpointerleave=hidePreview;button.onfocus=()=>showPreview(item,row,true);button.onblur=hidePreview;
      button.ondragstart=e=>{hidePreview();dragged=item;e.dataTransfer.setData('application/x-freecast-combination',item.id);e.dataTransfer.effectAllowed='move';};button.ondragend=()=>{dragged=null;};row.ondragover=e=>{if(dragged)e.preventDefault();};row.ondrop=e=>{if(!dragged||dragged===item)return;e.preventDefault();items.splice(items.indexOf(dragged),1);items.splice(items.indexOf(item),0,dragged);dragged=null;persist();};
      remove.type='button';remove.className='combination-remove';remove.textContent='×';remove.title='删除组合';remove.setAttribute('aria-label','删除组合 '+item.name);remove.onclick=()=>{items=items.filter(x=>x!==item);if(selected===item.id){selected='';localStorage.removeItem(selectedKey);}hidePreview();persist();};row.append(button,remove);menu.append(row);
    }
  }
  function open(){hidePreview();menu.hidden=false;picker.setAttribute('aria-expanded','true');position(menu,picker);(menu.querySelector('[aria-checked=true]')||menu.querySelector('.combination-option'))?.focus();}
  picker.onclick=()=>menu.hidden?open():close();picker.onpointerenter=()=>{if(menu.hidden)showPreview(items.find(i=>i.id===selected),picker);};picker.onpointerleave=hidePreview;
  picker.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();open();}};
  menu.onkeydown=e=>{const buttons=[...menu.querySelectorAll('.combination-option')],i=buttons.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length]?.focus();}else if(e.key==='Tab')hidePreview();};
  document.addEventListener('pointerdown',e=>{if(!menu.hidden&&!menu.contains(e.target)&&!picker.contains(e.target))close();});
  document.addEventListener('focusin',e=>{if(!menu.hidden&&!menu.contains(e.target)&&!picker.contains(e.target))close();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!menu.hidden){e.preventDefault();e.stopImmediatePropagation();close(true);}},true);
  window.addEventListener('resize',()=>close());window.addEventListener('scroll',()=>close(),{passive:true});
  $('addCombination').onclick=()=>{close();$('combinationName').value='';$('combinationDialog').showModal();$('combinationName').focus();};
  $('combinationForm').onsubmit=e=>{e.preventDefault();const name=$('combinationName').value.trim(),a=$('roomA').value.trim(),b=$('roomB').value.trim();if(!name||!a||!b)return;
    if(items.length>=30){notice('最多收藏 30 个组合，请先删除不用的组合');return;}
    const item={id:crypto.randomUUID(),name,a,b,settings:window.configurations.capture(),profiles:{a:metadata(a),b:metadata(b)}};items.push(item);selected=item.id;localStorage.setItem(selectedKey,selected);persist();$('combinationDialog').close();};
  window.combinations={use,items:()=>items};render();
})();
