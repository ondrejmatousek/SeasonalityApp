// Isolated tick aggregation prototype. No downloads, registry switches, or price repairs.
const ny=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}),DAY=86400000;
function boundary(date){if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw Error('Invalid session date');let t=Date.parse(date+'T17:00:00Z');for(let i=0;i<3;i++)t+=Date.parse(date+'T17:00:00Z')-Date.parse(ny.format(new Date(t)).replace(' ','T')+'Z');return t;}
const nextDate=d=>new Date(Date.parse(d+'T00:00:00Z')+DAY).toISOString().slice(0,10);
function aggregate(ticks,{symbol,observedAt,transportComplete,priceSide='bid'}={}){
 if(!['EURUSD','GBPUSD','USDCAD','USDCHF'].includes(symbol))throw Error('Four-pair pilot only');
 if(priceSide!=='bid'||transportComplete!==true)throw Error('Complete transport evidence and explicit BID policy required');
 const observed=Date.parse(observedAt);if(!Number.isFinite(observed))throw Error('Invalid observation time');
 const sessions=new Map();let previous=-Infinity;
 for(const tick of ticks){if(!Number.isSafeInteger(tick.time)||tick.time<=previous)throw Error('Unsorted/duplicate ticks require source investigation');previous=tick.time;if(!Number.isFinite(tick.bid)||tick.bid<=0)throw Error('Invalid tick price');
  const local=ny.format(new Date(tick.time)),d=local.slice(0,10),label=tick.time>=boundary(d)?nextDate(d):d;
  const end=boundary(label);if(end>observed)continue;
  if([0,6].includes(new Date(label).getUTCDay()))throw Error('Unexpected weekend session: do not silently discard provider ticks');
  let bar=sessions.get(label);if(!bar){const start=boundary(new Date(Date.parse(label+'T00:00:00Z')-DAY).toISOString().slice(0,10));bar={date:label,startedAt:new Date(start).toISOString(),completedAt:new Date(end).toISOString(),firstTickAt:new Date(tick.time).toISOString(),lastTickAt:null,open:tick.bid,high:tick.bid,low:tick.bid,close:tick.bid,ticks:0};sessions.set(label,bar);}
  bar.high=Math.max(bar.high,tick.bid);bar.low=Math.min(bar.low,tick.bid);bar.close=tick.bid;bar.lastTickAt=new Date(tick.time).toISOString();bar.ticks++;
 }
 return{symbol,provider:'Dukascopy',priceType:'BID ticks; not synthetic midpoint',session:{timezone:'America/New_York',cutoff:'17:00',dateLabel:'session-end-date',bounds:'[start,end)',dst:'IANA timezone'},bars:[...sessions.values()],activationAllowed:false,warning:'Transport completeness is required externally. This prototype alone does not certify missing hours, history coverage, or production readiness.'};
}
module.exports={boundary,aggregate};
