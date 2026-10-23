// Shared, DOM-free timeline helpers. Every seek must be buffered by both sources.
((root)=>{
  function intersect(a,b){const out=[];for(const x of a)for(const y of b){const lo=Math.max(x[0],y[0]),hi=Math.min(x[1],y[1]);if(hi>lo)out.push([lo,hi]);}return out.sort((a,b)=>a[0]-b[0]);}
  function lagRanges(ranges,target,limit){return ranges.map(([a,b])=>[Math.max(0,target-b+.15),Math.min(limit,target-a-.15)]).filter(([a,b])=>b>a);}
  function nearest(value,ranges){let best=null,distance=Infinity;for(const [a,b] of ranges){const point=Math.max(a,Math.min(b,value));if(Math.abs(value-point)<distance){best=point;distance=Math.abs(value-point);}}return best;}
  class History{
    constructor(){this.items=[];this.serial=0;}
    add(message,at,seconds){if(!seconds)return;this.items.push({...message,at,replayId:++this.serial});if(this.lastPrune===undefined||at-this.lastPrune>1){this.prune(at-seconds-90);this.lastPrune=at;}if(this.items.length>30000)this.items.splice(0,this.items.length-30000);}
    prune(before){this.items=this.items.filter(m=>m.at>=before).slice(-30000);}
    clear(){this.items=[];this.lastPrune=undefined;}
    remove(ids){const set=new Set(ids);this.items=this.items.filter(m=>m.type!=='superchat'||!set.has(m.id));}
    since(from,to,adjust=0){return this.items.filter(m=>m.at+adjust>from&&m.at+adjust<=to);}
    at(time,adjust,cap){const past=this.items.filter(m=>m.at+adjust<=time);return [...past.filter(m=>m.type!=='superchat').slice(-180),...past.filter(m=>m.type==='superchat'&&m.at+adjust+(cap?Math.min(cap,m.duration):m.duration)>time).slice(-2)];}
  }
  const api={intersect,lagRanges,nearest,History};if(typeof module!=='undefined')module.exports=api;else root.ReplayCore=api;
})(globalThis);
