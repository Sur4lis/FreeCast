const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function harness(){
 class Element{constructor(){this.children=[];this.isConnected=true;this.style={};this.events={};this.classList={add(){}};}append(...els){this.children.push(...els);}replaceChildren(){this.children=[];}querySelector(){return this.children.find(e=>e.className==='repeat-count')||null;}addEventListener(name,fn){this.events[name]=fn;}setAttribute(){}focus(){}remove(){this.isConnected=false;}}
 const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},window={};
 let time=0,rejectWrites=false;const displayed=[],saved=[];const scope={window,$,performance:{now:()=>time},document:{createElement:()=>new Element(),querySelectorAll:selector=>selector.startsWith('#chatList')?displayed:[]},localStorage:{getItem:()=>JSON.stringify({merge:true,words:['广告']}),setItem(key,value){if(rejectWrites)throw Error('storage full');saved.push(JSON.parse(value));}},clearChat:()=>window.chatRules.reset()};
 vm.runInNewContext(fs.readFileSync('browser-extension/ui/chat-rules.js','utf8'),scope);
 return {rules:window.chatRules,Element,$,displayed,saved,failStorage:()=>rejectWrites=true,time:n=>time=n};
}
test('A and B merge independently, count both views and use a sliding 8-second window',()=>{
 const {rules,Element}=harness(),rowA=new Element(),rowB=new Element(),bullet=new Element();
 const a={source:'a',text:' 好球 ',receivedAt:10000},b={...a,source:'b'};
 const group=rules.track(a,rowA);rules.attachBullet(group,bullet);rules.track(b,rowB);
 assert.equal(bullet.querySelector().textContent,'');assert.equal(rules.merge({...a,text:'好球',receivedAt:17000}),group);
 assert.equal(rules.merge({...a,receivedAt:24000}),group);assert.equal(rowA.querySelector().textContent,'×3');assert.equal(bullet.querySelector().textContent,'×3');assert.equal(rowB.querySelector(),null);
 assert.equal(rules.merge({...a,receivedAt:32001}),null);
});
test('history render speed does not collapse comments more than 8 seconds apart',()=>{
 const {rules,Element}=harness(),message={source:'a',text:'再看一次',at:10};rules.track(message,new Element());
 assert.equal(rules.merge({...message,at:30}),null);rules.track({...message,at:30},new Element());assert.ok(rules.merge({...message,at:31}));
});
test('SC and distinct emotes stay separate, duplicate emote IDs tolerate URL rotation',()=>{
 const {rules,Element}=harness(),message={source:'b',text:'大笑',receivedAt:10,emoticon:{unique:'laugh',url:'https://img/laugh?a=1'}};
 const group=rules.track(message,new Element());assert.equal(rules.merge({...message,emoticon:{unique:'laugh',url:'https://img/laugh?a=2'}}),group);
 assert.equal(rules.merge({...message,emoticon:{unique:'cry',url:'https://img/cry'}}),null);
 assert.equal(rules.merge({...message,type:'superchat'}),null);assert.equal(rules.track({...message,type:'superchat'},new Element()),null);
});
test('removed rows and resets cannot swallow new messages',()=>{
 const {rules,Element}=harness(),message={source:'a',text:'下一条'},row=new Element();rules.track(message,row);row.isConnected=false;assert.equal(rules.merge(message),null);
 rules.track(message,new Element());rules.reset();assert.equal(rules.merge(message),null);
});
test('disabled merging and filters preserve the intended boundaries',()=>{
 const {rules,Element,$}=harness(),message={text:'普通弹幕'};rules.track(message,new Element());$('mergeRepeated').checked=false;$('mergeRepeated').events.change();
 assert.equal(rules.merge(message),null);assert.equal(rules.track(message,new Element()),null);assert.equal(rules.blocked({text:'带广告的 SC',type:'superchat'}),true);assert.equal(rules.blocked(message),false);
});
test('one-click keyword blocking removes matching A/B messages and SC without clearing other comments',()=>{
 const {rules,Element,displayed,saved}=harness(),keep=new Element(),message={source:'a',text:'保留的弹幕',receivedAt:100};
 const group=rules.track(message,keep);displayed.push(keep);
 for(const source of ['a','b']){const row=new Element(),bullet=new Element(),m={source,text:'刷屏内容',receivedAt:100};const r=rules.track(m,row);rules.attachBullet(r,bullet,m);displayed.push(row,bullet);}
 const sc=new Element();rules.tag(sc,{type:'superchat',text:'包含刷屏内容的 SC'});displayed.push(sc);
 rules.addKeyword(' 刷屏内容 ');assert.deepEqual(saved.at(-1).words,['广告','刷屏内容']);assert.equal(keep.isConnected,true);assert.ok(displayed.slice(1).every(e=>!e.isConnected));assert.equal(rules.merge({...message,receivedAt:200}),group);assert.equal(group.count,2);
 assert.equal(rules.blocked({source:'b',text:'后续刷屏内容'}),true);assert.equal(rules.blocked({text:'另一个内容'}),false);
});
test('invalid, duplicate or over-limit keywords cannot broaden the block or silently lose persistence',()=>{
 const {rules,saved,failStorage}=harness();for(const value of ['', '　 ',null,123,'很'.repeat(2001)])assert.throws(()=>rules.addKeyword(value));assert.equal(saved.length,0);
 rules.addKeyword('ＡＢＣ');assert.throws(()=>rules.addKeyword(' abc '),/已屏蔽/);assert.equal(saved.length,1);
 failStorage();assert.throws(()=>rules.addKeyword('不会保存'),/保存失败/);assert.equal(rules.blocked({text:'不会保存'}),false);
});
test('auto-added text is not truncated and the keyword count stays bounded',()=>{
 const {rules,saved}=harness(),long='全文'.repeat(90);rules.addKeyword(long);assert.equal(saved.at(-1).words.at(-1),long);assert.equal(rules.blocked({text:long.slice(0,100)}),false);
 for(let i=0;i<98;i++)rules.addKeyword('词条'+i);assert.throws(()=>rules.addKeyword('超额词条'),/最多添加 100/);assert.equal(saved.at(-1).words.length,100);assert.equal(rules.blocked({text:'超额词条'}),false);
});

test('blocking a displayed comment uses the same removable keyword list',()=>{
 const {rules,$}=harness();rules.addKeyword('  这一句不想再看到  ');
 assert.equal(rules.blocked({text:'前缀这一句不想再看到后缀'}),true);
 assert.throws(()=>rules.addKeyword('这一句不想再看到'),/已屏蔽/);
 assert.throws(()=>rules.addKeyword('   '),/请输入/);
 const chip=$('blockedKeywords').children.find(el=>el.children[0].textContent==='这一句不想再看到');
 chip.children[1].events.click();assert.equal(rules.blocked({text:'这一句不想再看到'}),false);
});
