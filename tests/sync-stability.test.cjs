const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {playoutStep,delays,shiftPlayout}=require(path.resolve(process.env.SYNC_MODULE||'browser-extension/ui/sync.js'));

for(const step of [.1,-.1])test('a manual '+step+' second step is not swallowed by existing clock error',()=>{
  const state={started:true,at:0,target:27.06,delay:3};
  shiftPlayout(state,step);
  const action=playoutStep(state,{now:0,current:27,ranges:[[0,30]],edge:30,delay:3+step,ready:4});
  assert.ok(Math.abs(action.seek-(27-step))<1e-9);
  assert.equal(state.manualShift,0);
});

test('manual steps received during decoding stay queued and share one clock',()=>{
  const state={started:true,at:0,target:27,delay:3},frame={ranges:[[0,40]],edge:40,ready:4};
  shiftPlayout(state,.1);
  assert.equal(playoutStep(state,{...frame,now:0,current:27,delay:3.1}).seek,26.9);
  shiftPlayout(state,.1);
  assert.equal(playoutStep(state,{...frame,now:50,current:26.9,delay:3.2,seeking:true}).seek,null);
  assert.equal(state.manualShift,.1);
  const next=playoutStep(state,{...frame,now:100,current:26.93,delay:3.2,seeking:false});
  assert.ok(Math.abs(next.seek-26.9)<1e-9,'keep the original clock rather than adding decode latency');
  assert.equal(state.manualShift,0);
});

test('opposite pending steps cancel without a seek',()=>{
  const state={started:true,at:0,target:27,delay:3};
  shiftPlayout(state,.1);shiftPlayout(state,-.1);
  const action=playoutStep(state,{now:100,current:27.1,ranges:[[0,30]],edge:30,delay:3,ready:4});
  assert.equal(action.seek,null);assert.equal(action.rate,1);assert.equal(state.manualShift,0);
});

test('manual adjustment settles decode latency without repeated seeks',()=>{
  const state={started:true,at:0,target:27.06,delay:3},frame={ranges:[[0,40]],edge:40,delay:3.1,ready:4};
  shiftPlayout(state,.1);
  let current=playoutStep(state,{...frame,now:0,current:27}).seek,rate=1;
  for(let n=1;n<=30;n++){
    if(n>1)current+=.1*rate; // 100 ms decoding stall after the initial seek.
    const action=playoutStep(state,{...frame,now:n*100,current});
    assert.equal(action.seek,null);rate=action.rate;
  }
  assert.ok(Math.abs(current-29.9)<.012);
});

test('a manual step while paused preserves the paused position on resume',()=>{
  const state={started:true,at:0,target:27.06,delay:3};shiftPlayout(state,.1);
  const resumed=playoutStep(state,{now:10000,current:27,ranges:[[0,40]],edge:40,delay:13.1,ready:4});
  assert.ok(Math.abs(resumed.seek-26.9)<1e-9);
});

test('manual alignment adjusts the existing clock despite segment download bursts',()=>{
  const state={};
  const start=playoutStep(state,{now:0,current:0,ranges:[[0,30]],edge:30,delay:3,ready:4});
  assert.equal(start.seek,27);
  const moved=playoutStep(state,{now:1000,current:28,ranges:[[0,40]],edge:40,delay:4,ready:4});
  assert.equal(moved.seek,27,'one second of extra delay moves playback back one second, not toward the latest download');
  const next=playoutStep(state,{now:1100,current:27.1,ranges:[[0,40]],edge:40.1,delay:4,ready:4});
  assert.equal(next.seek,null);assert.equal(next.rate,1);
});

test('30 minutes of independent bursty downloads and a stall retain the calibrated A/B offset',()=>{
  const state={a:{},b:{}},media={a:0,b:0},rates={a:1,b:1};let offset=0,seeks=0;
  for(let n=0;n<=18000;n++){
    const now=n*100,t=now/1000;
    if(n===250)offset=5.6;
    const delay=delays(offset);
    for(const k of ['a','b']){
      const stalled=k==='a'&&n>=950&&n<1010;
      if(n&&!stalled)media[k]+=.1*rates[k];
      const edge=30+Math.floor(t/(k==='a'?2:7))*(k==='a'?2:7);
      const action=playoutStep(state[k],{now,current:media[k],ranges:[[Math.max(0,t-90),edge]],edge,delay:delay[k],ready:stalled?2:4});
      if(action.seek!==null){media[k]=action.seek;seeks++;}
      rates[k]=action.rate;
      if(n>1100)assert.ok(Math.abs((media.b-media.a)-offset)<.2,'alignment at '+t);
    }
  }
  assert.ok(seeks<10,'no repeated seeks at segment boundaries');
});

test('a requested delay waits for enough history without losing the adjustment',()=>{
  const state={};playoutStep(state,{now:0,current:0,ranges:[[0,8]],edge:8,delay:3,ready:4});
  assert.equal(playoutStep(state,{now:1000,current:6,ranges:[[0,9]],edge:9,delay:11,ready:4}).wait,true);
  const ready=playoutStep(state,{now:5000,current:6,ranges:[[0,13]],edge:13,delay:11,ready:4});
  assert.equal(ready.wait,false);assert.equal(ready.seek,2);
});

test('pause compensation preserves the paused point instead of following a fresh edge',()=>{
  const state={};playoutStep(state,{now:0,current:0,ranges:[[0,30]],edge:30,delay:3,ready:4});
  const resumed=playoutStep(state,{now:15000,current:32,ranges:[[0,50]],edge:50,delay:13,ready:4});
  assert.equal(resumed.seek,null);assert.equal(resumed.rate,1);
  const settling=playoutStep(state,{now:15100,current:32.05,ranges:[[0,50]],edge:50,delay:13,ready:4});
  assert.equal(settling.seek,null);assert.ok(settling.rate>1,'correct the resume latency even below the usual drift tolerance');
});

test('an evicted clock target recovers into the playable buffer',()=>{
  const state={};playoutStep(state,{now:0,current:0,ranges:[[0,30]],edge:30,delay:3,ready:4});
  playoutStep(state,{now:1000,current:28,ranges:[[50,70]],edge:70,delay:3,ready:4});
  const recovered=playoutStep(state,{now:3200,current:28,ranges:[[50,72.2]],edge:72.2,delay:3,ready:4});
  assert.ok(recovered.seek>=67&&recovered.seek<=70);
});
