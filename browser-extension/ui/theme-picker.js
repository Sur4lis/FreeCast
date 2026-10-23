(()=>{
  const get=id=>document.getElementById(id),button=get('themePickerButton'),menu=get('themeMenu'),rootMenu=get('themeRootMenu'),select=get('themeSelect');
  let opened=false;
  function sync(){
    const id=document.documentElement.dataset.theme;
    get('themePickerLabel').textContent=freecastTheme.catalog.find(t=>t.id===id)?.name||'bilibili';
    menu.querySelectorAll('[data-theme-value]').forEach(node=>node.setAttribute('aria-checked',String(node.dataset.themeValue===id)));
  }
  function position(){if(!opened)return;const rect=button.getBoundingClientRect();menu.style.left=Math.max(12,Math.min(rect.right-menu.offsetWidth,innerWidth-menu.offsetWidth-12))+'px';menu.style.top=Math.max(12,Math.min(rect.bottom+8,innerHeight-menu.offsetHeight-12))+'px';}
  function close(focus=false){opened=false;menu.hidden=true;button.setAttribute('aria-expanded','false');if(focus)button.focus();}
  function open(){opened=true;menu.hidden=false;button.setAttribute('aria-expanded','true');sync();position();rootMenu.querySelector('[aria-checked=true]')?.focus();}
  for(const theme of freecastTheme.catalog){
    const item=document.createElement('button'),swatch=document.createElement('i'),label=document.createElement('span'),check=document.createElement('span');
    item.type='button';item.className='theme-menu-item';item.setAttribute('role','menuitemradio');item.dataset.themeValue=theme.id;
    swatch.className='theme-swatch swatch-'+theme.id;swatch.setAttribute('aria-hidden','true');label.textContent=theme.name;check.className='theme-check';check.textContent='✓';check.setAttribute('aria-hidden','true');
    item.append(swatch,label,check);item.addEventListener('click',()=>{select.value=theme.id;select.dispatchEvent(new Event('change',{bubbles:true}));close(true);});rootMenu.append(item);
  }
  button.addEventListener('click',()=>opened?close():open());
  button.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();open();}});
  menu.addEventListener('keydown',event=>{
    const items=[...rootMenu.querySelectorAll('button')],index=items.indexOf(document.activeElement);
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();}
    else if(event.key==='Tab')close();
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&opened){event.preventDefault();event.stopImmediatePropagation();close(true);}},true);
  document.addEventListener('pointerdown',event=>{if(opened&&!menu.contains(event.target)&&!button.contains(event.target))close();});
  document.addEventListener('focusin',event=>{if(opened&&!menu.contains(event.target)&&!button.contains(event.target))close();});
  window.addEventListener('resize',position);window.addEventListener('scroll',position,{passive:true});window.addEventListener('freecast-theme-change',sync);sync();
})();
