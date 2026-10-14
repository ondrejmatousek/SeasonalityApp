(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./htf-zones.js'));else root.TradeZones=factory(root.HtfZones);})(typeof globalThis==='object'?globalThis:this,function(Htf){
 'use strict';
 const defaults=Object.freeze({version:'trade-zones-v1-experimental',atr:14,impulseAtr:1.5,departureBars:3,baseMax:3,baseAtr:1,bodyFraction:.5,swing:2,volumeLookback:20,volumeRatio:1.5,volumeWindow:1,bounds:'full',maxAgeDays:365});
 const day=s=>Date.parse(s+'T00:00:00Z'),ms=86400000;
 const median=a=>{const s=[...a].sort((a,b)=>a-b);return s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2;};
 function settings(options={}){
  const c={...defaults,...options};
  for(const [k,min,max]of [['impulseAtr',1,4],['departureBars',1,5],['volumeRatio',1,4],['volumeWindow',1,3]])if(!Number.isFinite(c[k])||c[k]<min||c[k]>max)throw Error('Neplatný parametr '+k);
  if(!Number.isInteger(c.departureBars)||!Number.isInteger(c.volumeWindow)||!['full','body-wick'].includes(c.bounds))throw Error('Neplatné hranice nebo počet svíček');return c;
 }
 function sourceBars(price,tf,asOf){
  const raw=(price.bars||[]).filter(b=>b.date<asOf&&Htf.valid(b)).sort((a,b)=>a.date.localeCompare(b.date));
  if(new Set(raw.map(b=>b.date)).size!==raw.length)throw Error('Duplicitní OHLC datum');
  if(tf==='D1')return raw;
  if(tf!=='W1')throw Error('Nepodporovaný timeframe');
  return (price.weekly||Htf.weekly(raw,asOf)).filter(w=>Htf.valid(w)&&day(w.date)+7*ms<=day(asOf)).map(w=>{
   const g=raw.filter(b=>b.date>=w.date&&day(b.date)<day(w.date)+7*ms);
   const complete=raw.length&&raw[0].date<=w.date&&g.length>=3&&g.at(-1).date===w.endDate&&g.every(b=>Number.isFinite(b.volume)&&b.volume>0)&&g[0].open===w.open&&g.at(-1).close===w.close&&Math.max(...g.map(b=>b.high))===w.high&&Math.min(...g.map(b=>b.low))===w.low;
   return {...w,volume:complete?g.reduce((n,b)=>n+b.volume,0):null};
  }).sort((a,b)=>a.date.localeCompare(b.date));
 }
 function volumeAt(bars,start,end,c){
  const sampleStart=Math.max(0,end-c.volumeWindow+1),history=bars.slice(Math.max(0,sampleStart-c.volumeLookback),sampleStart);
  const sample=bars.slice(sampleStart,end+1);
  if(history.length!==c.volumeLookback||history.some(b=>!Number.isFinite(b.volume)||b.volume<=0)||sample.some(b=>!Number.isFinite(b.volume)||b.volume<=0))return {state:'unknown',ratio:null,sample:sample.map(b=>b.date),note:'Chybí srovnatelný objem nebo 20 předchozích svíček.'};
  const reference=median(history.map(b=>b.volume)),ratio=sample.reduce((n,b)=>n+b.volume,0)/sample.length/reference;
  return {state:ratio>=c.volumeRatio?'high':'normal',ratio,sample:sample.map(b=>b.date),note:'Průměr výchozích svíček / medián předchozích 20. Bez prostého součtu.'};
 }
 function swingAt(bars,start,up,c){
  // Pivot must be fully confirmed BEFORE the base; no future candles determine the swing.
  for(let j=start-c.swing-1;j>=c.swing;j--){const v=up?bars[j].high:bars[j].low;
   if(bars.slice(j-c.swing,j+c.swing+1).every((b,k)=>k===c.swing||(up?b.high<v:b.low>v)))return {date:bars[j].date,price:v};
  }return null;
 }
 function detect(price,tf,asOf,options={}){
  const c=settings(options),bars=sourceBars(price,tf,asOf),out=[],seen=new Set(),daily=(price.bars||[]).filter(b=>b.date<asOf&&Htf.valid(b)).sort((a,b)=>a.date.localeCompare(b.date));
  for(let start=Math.max(c.atr,c.volumeLookback);start<bars.length-1;start++){
   const prior=bars.slice(start-c.atr,start),atr=prior.reduce((n,b,k)=>{const previous=bars[start-c.atr+k-1]?.close??b.open;return n+Math.max(b.high-b.low,Math.abs(b.high-previous),Math.abs(b.low-previous));},0)/c.atr;
   if(!(atr>0))continue;
   for(let count=1;count<=c.baseMax&&start+count<bars.length;count++){
    const base=bars.slice(start,start+count),lo=Math.min(...base.map(b=>b.low)),hi=Math.max(...base.map(b=>b.high));
    const kinds=[];if(count===1&&base[0].close!==base[0].open)kinds.push('origin');
    if(hi-lo<=atr*c.baseAtr&&base.every(b=>Math.abs(b.close-b.open)<=(b.high-b.low)*c.bodyFraction))kinds.push('base');
    for(const kind of kinds)for(const up of [true,false]){
     if(kind==='origin'&&(up?base[0].close>=base[0].open:base[0].close<=base[0].open))continue;
     const first=bars[start+count];if(up?first.close<=first.open:first.close>=first.open)continue;
     for(let k=0;k<c.departureBars&&start+count+k<bars.length;k++){
      const index=start+count+k,departure=bars.slice(start+count,index+1),segment=bars.slice(start,index+1);
      if(segment.some((b,i)=>i&&day(b.date)-day(segment[i-1].date)>(tf==='W1'?10:7)*ms))break;
      if(departure.some(b=>up?b.close<lo:b.close>hi))break;
      const b=bars[index],displacement=(up?b.close-hi:lo-b.close)/atr;if(displacement<c.impulseAtr)continue;
      const knownAt=b.endDate||b.date;if(day(asOf)-day(knownAt)>c.maxAgeDays*ms)break;
      const lower=c.bounds==='full'||up?lo:Math.min(...base.flatMap(b=>[b.open,b.close]));
      const upper=c.bounds==='full'||!up?hi:Math.max(...base.flatMap(b=>[b.open,b.close]));
      if(!(upper>lower))break;
      const swing=swingAt(bars,start,up,c),applicable=swing&&(up?swing.price>hi:swing.price<lo);
      const bos=applicable?{state:departure.some(d=>up?d.close>swing.price:d.close<swing.price)?'yes':'no',...swing}:{state:'unknown',note:'Před základnou není potvrzený relevantní swing před směrem pohybu.'};
      let invalid=false,visits=0,inside=false;for(const later of daily.filter(d=>d.date>knownAt)){
       if(up?later.close<lower:later.close>upper){invalid=true;break;}const touch=later.high>=lower&&later.low<=upper;if(touch&&!inside)visits++;inside=touch;
      }if(invalid)break;
      const id=[tf,kind,up?'demand':'supply',base[0].date,base.at(-1).date].join(':');if(seen.has(id))break;seen.add(id);
      const volume=volumeAt(bars,start,start+count-1,c),distance=Math.max(lower-price.latestClose,price.latestClose-upper,0);
      out.push({id,timeframe:tf,kind,type:up?'demand':'supply',lower,upper,baseDate:base[0].date,baseEnd:base.at(-1).endDate||base.at(-1).date,confirmedAt:knownAt,atr,impulseAtr:displacement,departureCount:departure.length,bos,volume,session:{state:'unknown',note:'D1/W1 neurčuje intradenní čas odchodu; timestamp začátku svíčky není session impulzu.'},visits,fresh:visits===0,distanceAtr:distance/atr,priceState:distance===0?'inside':distance<=.5*atr?'near':'far',qualityPoints:(bos.state==='yes'?2:0)+(volume.state==='high'?1:0),knownCriteria:Number(bos.state!=='unknown')+Number(volume.state!=='unknown')});break;
     }
    }
   }
  }return out.sort((a,b)=>b.qualityPoints-a.qualityPoints||a.distanceAtr-b.distanceAtr||b.confirmedAt.localeCompare(a.confirmedAt)||a.id.localeCompare(b.id));
 }
 function refine(parent,dailyZones){
  if(parent.timeframe!=='W1')return [];
  return dailyZones.filter(z=>z.timeframe==='D1'&&z.type===parent.type&&z.lower>=parent.lower&&z.upper<=parent.upper&&z.baseDate>=parent.baseDate&&z.baseEnd<=parent.baseEnd&&z.confirmedAt<=parent.confirmedAt);
 }
 function context(zone,asset,asOf){
  const candidates=(asset?.candidates||[]).filter(c=>c.endDate>=asOf&&day(c.startDate)<=day(asOf)+30*ms).sort((a,b)=>Math.max(0,day(a.startDate)-day(asOf))-Math.max(0,day(b.startDate)-day(asOf))||a.startDate.localeCompare(b.startDate)||a.direction.localeCompare(b.direction));
  const c=candidates[0];if(!c)return {seasonal:'unknown',cot:'insufficient',macro:'unknown',candidate:null};
  const s=c.histories?.[20]?.seasonal,aligned=(zone.type==='demand')===(c.direction==='up');
  const sufficient=s&&s.count>=8&&s.rate>50&&((c.direction==='up'?1:-1)*s.median)>0;
  const cot=aligned?Htf.cotState(c):'insufficient';
  return {seasonal:sufficient?(aligned?'supports':'against'):'unknown',cot,macro:'unknown',candidate:c};
 }
 return {defaults,settings,sourceBars,detect,volumeAt,swingAt,refine,context};
});
