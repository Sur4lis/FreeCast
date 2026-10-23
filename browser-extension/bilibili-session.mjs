const cookieUrl='https://live.bilibili.com/';
const accessError=()=>Object.assign(new Error('B 站网站访问权限不足。点击“重连弹幕”授权；若未出现提示，请在扩展详情中允许访问 bilibili.com。'),{code:'BILIBILI_PERMISSION'});
const denied=error=>/no host permissions|host permission|permission.*(?:denied|cookie)/i.test(String(error?.message||error));

export function createBilibiliSession({cookies,permissions,request=fetch}){
  let devicePromise;
  async function cookieOperation(method,details){
    if(!await permissions.contains({permissions:['cookies'],origins:[cookieUrl+'*']}))throw accessError();
    try{return await cookies[method]({url:cookieUrl,...details});}
    catch(error){if(denied(error))throw accessError();throw error;}
  }
  const cookie=async name=>(await cookieOperation('get',{name}))?.value||'';
  async function ensureDevice(){
    if(await cookie('buvid3'))return;
    if(!devicePromise)devicePromise=(async()=>{
      const response=await request('https://api.bilibili.com/x/frontend/finger/spi',{credentials:'include',signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw Error('B 站设备初始化失败，请打开 B 站网页后重连弹幕');
      const value=await response.json(),buvid=value.data?.b_3;
      if(value.code!==0||typeof buvid!=='string'||!/^[\w-]{10,100}$/.test(buvid))throw Error('B 站设备校验暂不可用，请打开 B 站网页后重连弹幕');
      if(!await cookie('buvid3'))await cookieOperation('set',{domain:'.bilibili.com',path:'/',name:'buvid3',value:buvid,secure:true,sameSite:'no_restriction',expirationDate:Date.now()/1000+31536000});
    })().finally(()=>{devicePromise=null;});
    await devicePromise;
  }
  return {cookie,ensureDevice};
}
