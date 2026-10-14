(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MarketCandles=factory();})(typeof globalThis==='object'?globalThis:this,function(){
 const ms=86400000,day=s=>Date.parse(s+'T00:00:00Z');
 function valid(b){return /^\d{4}-\d{2}-\d{2}$/.test(b.date)&&[b.open,b.high,b.low,b.close].every(v=>Number.isFinite(v)&&v>0)&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&b.high>=b.low;}
 function weekly(bars,asOf){
  const groups=new Map();
  for(const b of bars.filter(b=>b.date<asOf&&valid(b))){const d=new Date(day(b.date));d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);const key=d.toISOString().slice(0,10);if(day(key)+7*ms>day(asOf))continue;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(b);}
  return [...groups].sort((a,b)=>a[0].localeCompare(b[0])).filter(([,g])=>g.length>=3).map(([date,g])=>({date,open:g[0].open,high:Math.max(...g.map(b=>b.high)),low:Math.min(...g.map(b=>b.low)),close:g.at(-1).close,endDate:g.at(-1).date}));
 }
 function cotState(c){const v=c.scoringV2;if(!c.cotReference||!v||v.samples.similar<8||v.samples.other<8)return 'insufficient';return v.components.C>.5?'confirms':v.components.C<.5?'against':'neutral';}
 return {valid,weekly,cotState};
});
