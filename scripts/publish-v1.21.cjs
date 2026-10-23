const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),repository=process.env.GITHUB_REPOSITORY,commit=process.env.GITHUB_SHA,token=process.env.GH_TOKEN;
if(repository!=='Sur4lis/FreeCast'||!/^[a-f0-9]{40}$/.test(commit||'')||!token)throw Error('Missing release context');
const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function api(route,method='GET',body){
 const response=await fetch('https://api.github.com/repos/'+repository+route,{method,headers:{...headers,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 if(response.status===404&&method==='GET')return null;if(!response.ok)throw Error('GitHub '+method+' '+route+': '+response.status);return response.json();
}
async function main(){
 const version=JSON.parse(fs.readFileSync(path.join(root,'browser-extension/manifest.json'))).version_name;
 if(version!=='1.21')throw Error('Unexpected version');
 const body=fs.readFileSync(path.join(root,'releases/v1.21.md'),'utf8').trim();if(body!=='修复了若干BUG')throw Error('Unexpected release notes');
 let release=await api('/releases/tags/v1.21');
 if(release&&!release.draft)throw Error('v1.21 is already published');
 if(release&&release.target_commitish!==commit)throw Error('Draft targets another commit');
 const android=JSON.parse(fs.readFileSync(path.join(root,'releases/android-v1.21.json')));
 if(android.name!=='FreeCast_Android_v1.21.apk'||!/^[a-f0-9]{40}$/.test(android.blob))throw Error('Invalid APK reference');
 const blob=await api('/git/blobs/'+android.blob);if(!blob||blob.encoding!=='base64')throw Error('APK blob unavailable');
 const apk=Buffer.from(blob.content,'base64');if(apk.length!==android.size||digest(apk)!==android.sha256)throw Error('APK checksum mismatch');
 fs.writeFileSync(path.join(root,'release',android.name),apk);
 if(!release)release=await api('/releases','POST',{tag_name:'v1.21',target_commitish:commit,name:'FreeCast v1.21',draft:true,prerelease:false,make_latest:'false',body});
 for(const name of ['FreeCast_v1.21.zip','FreeCast_v1.21_source.zip',android.name]){
  const bytes=fs.readFileSync(path.join(root,'release',name)),sha='sha256:'+digest(bytes),existing=release.assets.find(a=>a.name===name);
  if(existing){if(existing.digest!==sha||existing.size!==bytes.length||existing.state!=='uploaded')throw Error('Conflicting asset '+name);continue;}
  const url=release.upload_url.split('{')[0]+'?name='+encodeURIComponent(name);
  const response=await fetch(url,{method:'POST',headers:{...headers,'Content-Type':name.endsWith('.apk')?'application/vnd.android.package-archive':'application/zip'},body:bytes,signal:AbortSignal.timeout(300000)});
  if(!response.ok)throw Error('Upload failed '+name+': '+response.status);const asset=await response.json();
  if(asset.digest!==sha||asset.size!==bytes.length||asset.state!=='uploaded')throw Error('Asset verification failed '+name);console.log('Verified '+name);
 }
 release=await api('/releases/'+release.id,'PATCH',{draft:false,prerelease:false,make_latest:'true',body});console.log(release.html_url);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
