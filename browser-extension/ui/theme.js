// Restore and migrate the selected palette before the first paint.
(()=>{
  const key='freecast-theme-v1',catalog=Object.freeze([
    {id:'bilibili',name:'bilibili'},{id:'bluepink',name:'蓝粉'},{id:'light',name:'白天'},{id:'dark',name:'黑夜'}
  ]),themes=new Set(catalog.map(t=>t.id));
  const normalize=value=>value==='worlds2026-blg'?'bluepink':themes.has(value)?value:'bluepink';
  function apply(value){
    const theme=normalize(value);document.documentElement.dataset.theme=theme;
    for(const attribute of ['season','team','skin'])delete document.documentElement.dataset[attribute];
    const select=document.getElementById('themeSelect');if(select)select.value=theme;
    const color=document.querySelector('meta[name="theme-color"]');if(color)color.content=theme==='dark'?'#101115':theme==='light'?'#f3f5f8':theme==='bluepink'?'#e7f4fc':'#e7f1f4';
    window.dispatchEvent(new CustomEvent('freecast-theme-change',{detail:{theme}}));
  }
  let initial='bluepink';try{initial=normalize(localStorage.getItem(key));localStorage.setItem(key,initial);}catch{}apply(initial);
  window.freecastTheme={catalog,normalize,has:value=>themes.has(value),set(value){const theme=normalize(value);apply(theme);try{localStorage.setItem(key,theme);}catch{}}};
  document.addEventListener('DOMContentLoaded',()=>{
    const select=document.getElementById('themeSelect');select.value=document.documentElement.dataset.theme;
    select.addEventListener('change',()=>window.freecastTheme.set(select.value));
  });
  window.addEventListener('storage',event=>{if(event.key===key||event.key===null)apply(event.newValue);});
})();
