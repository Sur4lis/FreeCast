(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SuperChatStyle=api;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const tiers=[
    [2000,'#FFD8D8','#AB1A32','#C86A7A'],
    [1000,'#FFE7E4','#E54D4D','#EE8B8B'],
    [500,'#FFEAD2','#E09443','#E6B27E'],
    [100,'#FFF1C5','#E2B52B','#E8CC5F'],
    [50,'#DBFFFD','#427D9E','#7DA4BD'],
    [0,'#EDF5FF','#2A60B2','#7497CD']
  ];
  const hex=value=>/^#[0-9a-f]{6}$/i.test(value||'')?value:undefined;
  const amount=value=>Number.isFinite(Number(value))&&Number(value)>=0?Math.min(10000000,Number(value)):0;
  function ink(color){
    const linear=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(n=>n<=.04045?n/12.92:Math.pow((n+.055)/1.055,2.4));
    return linear[0]*.2126+linear[1]*.7152+linear[2]*.0722>.179?'#18212B':'#FFFFFF';
  }
  function resolve(message){
    const price=amount(message.price),tier=tiers.find(t=>price>=t[0]);
    const header=hex(message.scHeaderColor)||tier[1],body=hex(message.scColor)||tier[2],badge=hex(message.scPriceColor)||tier[3];
    return {header,body,badge,headerInk:hex(message.scNameColor)||ink(header),bodyInk:hex(message.scTextColor)||ink(body),priceInk:ink(badge)};
  }
  function formatPrice(value){return '￥'+amount(value).toLocaleString('zh-CN',{maximumFractionDigits:2});}
  return {resolve,formatPrice};
});
