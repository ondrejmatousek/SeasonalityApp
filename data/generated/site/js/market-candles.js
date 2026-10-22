(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MarketCandles=factory();})(typeof globalThis==='object'?globalThis:this,function(){
 const ms=86400000,day=s=>Date.parse(s+'T00:00:00Z');
 function valid(b){return /^\d{4}-\d{2}-\d{2}$/.test(b.date)&&[b.open,b.high,b.low,b.close].every(v=>Number.isFinite(v)&&v>0)&&b.high>=Math.max(b.open,b.close)&&b.low<=Math.min(b.open,b.close)&&b.high>=b.low;}
 function validH4(b){return Number.isSafeInteger(b.timestamp)&&typeof b.date==='string'&&b.date===new Date(b.timestamp*1000).toISOString()&&b.endDate===new Date((b.timestamp+14400)*1000).toISOString()&&[b.open,b.high,b.low,b.close].every(v=>Number.isFinite(v)&&v>0)&&b.low<=Math.min(b.open,b.close)&&b.high>=Math.max(b.open,b.close);}
 function weekly(bars,asOf){
  const groups=new Map();
  for(const b of bars.filter(b=>b.date<asOf&&valid(b))){const d=new Date(day(b.date));d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);const key=d.toISOString().slice(0,10);if(day(key)+7*ms>day(asOf))continue;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(b);}
  return [...groups].sort((a,b)=>a[0].localeCompare(b[0])).filter(([,g])=>g.length>=3).map(([date,g])=>({date,open:g[0].open,high:Math.max(...g.map(b=>b.high)),low:Math.min(...g.map(b=>b.low)),close:g.at(-1).close,endDate:g.at(-1).date}));
 }
 function cotState(c){const v=c.scoringV2;if(!c.cotReference||!v||v.samples.similar<8||v.samples.other<8)return 'insufficient';return v.components.C>.5?'confirms':v.components.C<.5?'against':'neutral';}
 function dateInfo(price,bar){
  const info={barDate:bar?.date||price.latestDate,sessionDate:null,sessionDateBasis:null,providerTimestamp:bar?.providerTimestamp||null};
  // Display metadata only. NEVER change bar.date, the chart axis, W1 grouping,
  // history hashes, completion admission or seasonal/COT calculations.
  if(price.provider!=='NYMEX'||price.symbol!=='NYMEX:CL1!'||!Number.isSafeInteger(bar?.timestamp))return info;
  const instant=new Date(bar.timestamp*1000);if(!Number.isFinite(+instant)||instant.toISOString().slice(0,10)!==bar.date)return info;
  const local=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(instant);
  const start=new Date(local.slice(0,10)+'T00:00:00Z');
  if(local.slice(-8)!=='17:00:00'||![0,1,2,3,4].includes(start.getUTCDay()))return info;
  info.providerTimestamp=instant.toISOString();start.setUTCDate(start.getUTCDate()+1);info.sessionDate=start.toISOString().slice(0,10);
  info.sessionDateBasis='Odvozeno ze začátku v 17:00 America/Chicago; sváteční výjimky nejsou tímto přepočtem ověřeny.';
  return info;
 }
 function dateLabel(price,bar){const d=dateInfo(price,bar);return d.sessionDate?`datum svíčky ${d.barDate} · den session ${d.sessionDate} (odvozený)`:(d.barDate||'—');}
 function latestDateLabel(price){return dateLabel(price,price.bars?.find(b=>b.date===price.latestDate));}
 return {valid,validH4,weekly,cotState,dateInfo,dateLabel,latestDateLabel};
});
