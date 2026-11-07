(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.danmakuColorDefaults=api;})(globalThis,()=>{
  const marker='freecast-platform-colors-v1242';
  function migrate(storage){
    if(storage.getItem(marker))return false;
    function update(value){if(!value||typeof value!=='object'||Array.isArray(value))return;if(!value.mix||typeof value.mix!=='object'||Array.isArray(value.mix))value.mix={};value.mix.danmakuPlatformColors=true;value.mix.danmakuSourceColors=false;}
    for(const key of ['dual-live-settings-v1','freecast-configurations-v1','freecast-combinations-v1']){
      const raw=storage.getItem(key);if(!raw)continue;let value;try{value=JSON.parse(raw);}catch{continue;}
      if(key==='dual-live-settings-v1')update(value);
      else if(key==='freecast-configurations-v1')update(value?.custom);
      else if(Array.isArray(value))for(const item of value)update(item?.settings);
      storage.setItem(key,JSON.stringify(value));
    }
    storage.setItem(marker,'1');return true;
  }
  return{migrate};
});
