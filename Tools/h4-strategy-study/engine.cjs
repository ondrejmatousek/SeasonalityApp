'use strict';
// Independent historical experiment. No SQL, network, baseline updates, or live writes.
const FM=require('../../wwwroot/js/fm-order-blocks.js'),T=require('../../wwwroot/js/trade-zones.js'),E=require('../../wwwroot/js/h4-paper.js');
const iso=t=>new Date(t*1000).toISOString(),sec=s=>Date.parse(s)/1000,active=s=>['waiting','open'].includes(s.status);
const ny=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
function sessionDay(t){const local=ny.format(new Date(t*1000)),d=new Date(local.slice(0,10)+'T00:00:00Z');if(Number(local.slice(-2))>=17)d.setUTCDate(d.getUTCDate()+1);return d.getUTCDay();}
function prepare(h,to='9999-12-31'){
 const end=sec(to+'T23:59:59.999Z'),bars=T.sourceBars(h,'H4',h.asOfUtc).filter(b=>sec(b.endDate)<=end),segments=[];
 for(const b of bars){if(!segments.length||!E.adjacent(segments.at(-1).at(-1).timestamp,b.timestamp))segments.push([]);segments.at(-1).push(b);}
 return {symbol:h.symbol,segments:segments.map((source,segment)=>{
  const input=source.map(b=>({t:b.timestamp,end:sec(b.endDate),open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume})),r=FM.run({symbol:h.symbol,timeframe:'H4',asOf:input.at(-1).end,bars:input}),formations=new Map(),transitions=new Map(),pruned=new Map();
  const add=(map,key,v)=>{if(!map.has(key))map.set(key,[]);map.get(key).push(v);};
  for(const z of r.formations)add(formations,z.confirmIndex,z);for(const t of r.transitions)add(transitions,t.knownAt,t);for(const p of r.pruned)add(pruned,p.knownAt,p);
  const obs=new Map(),ticks=[],settings=T.settings();
  for(let i=0;i<source.length;i++){
   const b=source[i],known=sec(b.endDate);
   for(const z of formations.get(i)||[]){const bos=r.events.findLast(e=>e.kind==='BOS'&&e.scale==='swing'&&e.direction===(z.type==='demand'?1:-1)&&e.barTime>=z.originTime&&e.knownAt<=z.confirmedAt),volume=T.volumeAt(source,z.startIdx,z.startIdx,settings);
    obs.set(z.id,{id:'H4|'+z.id,type:z.type,lower:z.bot,upper:z.top,baseDate:iso(z.originTime),confirmedAt:iso(z.confirmedAt),atr:z.atr,impulseAtr:z.displacementRatio,bos:bos?'yes':'no',volume:volume.state,volumeRatio:volume.ratio,qualityPoints:(bos?2:0)+(volume.state==='high'?1:0),armed:false,fresh:true});
   }
   for(const t of transitions.get(known)||[]){const z=obs.get(t.id);if(!z)throw Error('Missing chronological zone transition');if(t.kind==='armed'){z.armed=true;z.armedAt=t.knownAt;}else z.fresh=false;}
   for(const p of pruned.get(known)||[])obs.delete(p.id);
   const zones=['supply','demand'].flatMap(type=>[...obs.values()].filter(z=>z.type===type&&z.fresh&&z.armed).map(z=>({...z,distancePct:T.distancePercent(b.close,z.lower,z.upper)})).sort((a,b)=>a.distancePct-b.distancePct||b.confirmedAt.localeCompare(a.confirmedAt)||a.id.localeCompare(b.id)).slice(0,1));
   ticks.push({b,zones,day:sessionDay(b.timestamp),index:i,segment});
  }
  return {source,ticks,segment};
 })};
}
function seasonal(daily,at){
 const date=iso(at).slice(0,10),year=Number(date.slice(0,4)),monthDay=date.slice(5)==='02-29'?'02-28':date.slice(5),samples=[];
 for(let y=year-10;y<year;y++){const anchor=y+'-'+monthDay;let lo=0,hi=daily.length;while(lo<hi){const mid=(lo+hi)>>>1;if(daily[mid][0]<anchor)lo=mid+1;else hi=mid;}const start=lo;if(start+20>=daily.length)continue;const a=daily[start],b=daily[start+20];if(Number(a[0].slice(0,4))!==y||Number(b[0].slice(0,4))!==y||Date.parse(b[0]+'T23:59:59Z')/1000>=at)continue;samples.push({year:y,from:a[0],to:b[0],return:b[1]/a[1]-1});}
 const values=samples.map(s=>s.return).sort((a,b)=>a-b),n=values.length,median=n?(n%2?values[(n-1)/2]:(values[n/2-1]+values[n/2])/2):null;
 return {samples:n,median,longRate:n?samples.filter(s=>s.return>0).length/n:null,shortRate:n?samples.filter(s=>s.return<0).length/n:null,lastEvidence:samples.at(-1)?.to??null};
}
function qualifies(z,v,season){if(v.quality.includes('bos')&&z.bos!=='yes'||v.quality.includes('volume')&&z.volume!=='high')return false;if(v.season==='off')return true;const up=z.type==='demand';return season?.samples>=8&&(up?season.median>0&&season.longRate>=.6:season.median<0&&season.shortRate>=.6);}
function dayAllowed(day,rule){return rule==='all'||rule==='no_monday'&&day!==1||rule==='no_friday'&&day!==5||rule==='tue_thu'&&[2,3,4].includes(day);}
function geometry(z,v){const long=z.type==='demand',entry=long?z.upper:z.lower,buffer=(v.stop.basis==='atr'?z.atr:z.upper-z.lower)*v.stop.fraction,sl=long?z.lower-buffer:z.upper+buffer,risk=Math.abs(entry-sl),tp=entry+(long?1:-1)*v.rr*risk;return risk>0&&Math.min(entry,sl,tp)>0?{entry,sl,tp,risk,side:long?'long':'short'}:null;}
function finish(s,status,b,reason,exit){s.status=status;s.reason=reason;s.resolvedAt=b.endDate;s.exitBar=b.date;if(['tp','sl'].includes(status)){s.exit=exit;s.grossR=(exit-s.entry)*(s.side==='long'?1:-1)/s.risk;s.costR=s.entry*(E.config.spreadBps+2*E.config.slippageBpsPerSide+E.config.commissionBps)/10000/s.risk;s.netR=s.grossR-s.costR;}}
function resolve(s,b,entryBar){
 const long=s.side==='long',stop=long?b.low<=s.sl:b.high>=s.sl,target=long?b.high>=s.tp:b.low<=s.tp;
 if(!entryBar&&(long?b.open<=s.sl:b.open>=s.sl))return finish(s,'sl',b,'STOP_GAP_AT_OPEN',b.open);
 if(!entryBar&&(long?b.open>=s.tp:b.open<=s.tp))return finish(s,'tp',b,'TARGET_AT_OPEN',s.tp);
 if(stop&&target)return finish(s,'ambiguous',b,'SL_AND_TP_IN_SAME_H4');
 if(stop)return finish(s,'sl',b,'STOP_TOUCHED',entryBar?s.sl:long?Math.min(s.sl,b.open):Math.max(s.sl,b.open));
 if(target){if(entryBar&&(long?b.open>s.entry&&b.close<s.tp:b.open<s.entry&&b.close>s.tp))return finish(s,'ambiguous',b,'ENTRY_AND_TP_ORDER_UNKNOWN');finish(s,'tp',b,'TARGET_TOUCHED',s.tp);}
}
function simulate(prepared,variant,{daily={},to='9999-12-31',from='0001-01-01',seasonCache=new Map()}={}){
 const end=sec(to+'T23:59:59.999Z'),begin=sec(from+'T00:00:00Z'),out=[],diagnostics={dayCancelled:0,qualityRejected:0,seasonMissing:0};
 for(const [key,data]of Object.entries(prepared)){
  if(variant.season!=='off'&&!daily[key])continue;
  for(const segment of data.segments){let pending=[];const used=new Set();
   for(const tick of segment.ticks){const {b,index,zones}=tick,now=sec(b.endDate);if(now>end)break;if(index<199||now<begin)continue;
    const eligible=pending.filter(active),waiting=eligible.filter(s=>s.status==='waiting');let touched=waiting.filter(s=>s.side==='long'?b.low<=s.entry:b.high>=s.entry);
    // Existing scenarios were registered strictly at an earlier close; only future bars fill.
    if(touched.some(s=>b.timestamp<sec(s.registeredAt)))throw Error('Entry before registration');
    if(touched.length&&!dayAllowed(tick.day,variant.entryDays)){for(const s of touched){finish(s,'cancelled',b,'DAY_FILTER');diagnostics.dayCancelled++;}touched=[];}
    if(touched.length>1){for(const s of touched)finish(s,'ambiguous',b,'BOTH_OCO_ENTRIES_IN_SAME_H4');}
    else if(touched.length){const s=touched[0];if(s.side==='long'?b.open<=s.sl:b.open>=s.sl)finish(s,'ambiguous',b,'GAP_THROUGH_ENTRY_AND_SL');else{s.status='open';s.enteredAt=b.endDate;s.entryBar=b.date;s.entrySessionDay=tick.day;resolve(s,b,true);}for(const other of waiting.filter(v=>v!==s&&active(v)))finish(other,'cancelled',b,'OCO_OTHER_SIDE_TRIGGERED');}
    for(const s of eligible)if(s.status==='open'&&s.entryBar!==b.date)resolve(s,b,false);
    pending=pending.filter(active);if(pending.length)continue;
    let season=null;if(variant.season!=='off'){const cacheKey=key+'|'+b.endDate.slice(0,10);if(!seasonCache.has(cacheKey))seasonCache.set(cacheKey,seasonal(daily[key],now));season=seasonCache.get(cacheKey);if(season.samples<8)diagnostics.seasonMissing++;}
    for(const z of zones){if(used.has(z.id))continue;if(!qualifies(z,variant,season)){diagnostics.qualityRejected++;continue;}const g=geometry(z,variant);if(!g||(g.side==='long'?b.close<=g.entry:b.close>=g.entry))continue;const s={id:key+'|'+variant.id+'|'+z.id,key,symbol:data.symbol,variant:variant.id,zoneId:z.id,zone:z,segment:segment.segment,registeredAt:b.endDate,...g,status:'waiting',season};used.add(z.id);pending.push(s);out.push(s);}
   }
   for(const s of pending){const gap=segment.segment<data.segments.length-1&&sec(segment.source.at(-1).endDate)<=end;s.backtestEndReason=gap?'HISTORY_GAP':'END_OF_TEST';if(gap){s.resumeState=s.status;s.status='needs_data';s.reason='HISTORY_GAP';}}
  }
 }
 return {rows:out,diagnostics};
}
function grid(plan){const variants=[];for(const season of plan.grid.season)for(const rr of plan.grid.rr)for(const stop of plan.grid.stop)for(const quality of plan.grid.quality)for(const entryDays of plan.grid.entryDays)variants.push({id:[season,rr,stop.id,quality,entryDays].join('|'),rr,stop,quality,entryDays,season});return variants;}
module.exports={prepare,seasonal,qualifies,sessionDay,dayAllowed,geometry,finish,resolve,simulate,grid};
