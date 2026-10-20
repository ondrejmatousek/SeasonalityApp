(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.FmOrderBlocks=factory();})(typeof globalThis==='object'?globalThis:this,()=>{
 'use strict';
 const version='fm-h4-port-v1',defaults=Object.freeze({strictness:'medium',atrLen:96,obSwingLen:5,swingLen:20,internalLen:5,mode:'classic',seriesLevel:'extreme-open',minSeries:1,impulseBars:3,breakRef:'body',zoneSrc:'full',lookbackBars:10000,mitigationPct:25,hideMitigated:false,maxPerSide:5,maxMitKeep:10,freshCap:50});
 function settings(options={}){
  if(Object.keys(options).some(k=>!Object.hasOwn(defaults,k)))throw Error('Unknown FM parameter');const c={...defaults,...options};
  for(const [k,min,max]of [['atrLen',1,2000],['obSwingLen',2,1000],['swingLen',2,1000],['internalLen',1,1000],['minSeries',1,20],['impulseBars',1,10000],['lookbackBars',100,10000],['maxPerSide',1,1000],['maxMitKeep',0,10000],['freshCap',10,10000]])if(!Number.isInteger(c[k])||c[k]<min||c[k]>max)throw Error('Invalid FM '+k);
  for(const [k,values]of [['strictness',['loose','medium','strict']],['mode',['classic','series','both']],['seriesLevel',['extreme-open','first-open']],['breakRef',['body','wick']],['zoneSrc',['full','body']]])if(!values.includes(c[k]))throw Error('Invalid FM '+k);
  if(typeof c.hideMitigated!=='boolean'||!Number.isFinite(c.mitigationPct)||c.mitigationPct<1||c.mitigationPct>100)throw Error('Invalid FM mitigation');return c;
 }
 function validate(bars,timeframe='H4'){
  const duration={H4:14400,D1:86400,W1:604800}[timeframe];if(!duration)throw Error('Invalid FM timeframe');
  if(!Array.isArray(bars)||!bars.length)throw Error('Missing closed H4 bars');
  for(let i=0;i<bars.length;i++){const b=bars[i];if(!Number.isSafeInteger(b.t)||!Number.isSafeInteger(b.end)||b.end<=b.t||b.end-b.t>duration||!['open','high','low','close'].every(k=>Number.isFinite(b[k])&&b[k]>0)||b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close)||b.high<b.low||i&&b.t<bars[i-1].end)throw Error('Invalid FM OHLC/order/close time');}
 }
 function atr(bars,n){let sum=0,value=null;return bars.map((b,i)=>{const prev=i?bars[i-1].close:null,tr=prev==null?b.high-b.low:Math.max(b.high-b.low,Math.abs(b.high-prev),Math.abs(b.low-prev));if(i<n){sum+=tr;if(i===n-1)value=sum/n;}else value=tr/n+value*(1-1/n);return value;});}
 // Rightmost equal extreme wins. Tie behavior remains explicitly subject to
 // TradingView golden-output verification; no claim of runtime parity yet.
 function pivot(bars,i,n,high){const j=i-n;if(j<n)return null;const v=high?bars[j].high:bars[j].low;for(let k=j-n;k<=i;k++){if(k===j)continue;const x=high?bars[k].high:bars[k].low;if(high?(k<j?x>v:x>=v):(k<j?x<v:x<=v))return null;}return {index:j,t:bars[j].t,knownAt:bars[i].end,price:v};}
 function structure(){return {trend:0,bias:0,count:0,lastH:null,lastL:null,hLive:false,lLive:false};}
 function stepStructure(s,b,ph,pl){
  if(ph){s.lastH=ph;s.hLive=true;}if(pl){s.lastL=pl;s.lLive=true;}let ev=0,level=null;
  if(s.hLive&&b.close>s.lastH.price){s.hLive=false;level=s.lastH;if(s.trend===1)ev=1;else if(s.trend===-1){s.trend=0;s.bias=1;ev=2;}else if(s.bias===-1){s.bias=1;ev=2;}else{s.trend=1;s.bias=0;ev=1;}}
  if(s.lLive&&b.close<s.lastL.price){s.lLive=false;level=s.lastL;if(s.trend===-1)ev=-1;else if(s.trend===1){s.trend=0;s.bias=-1;ev=-2;}else if(s.bias===1){s.bias=-1;ev=-2;}else{s.trend=-1;s.bias=0;ev=-1;}}
  if(ev)s.count++;return {ev,level};
 }
 function run(input,options={}){
  const c=settings(options);if(!['H4','D1','W1'].includes(input.timeframe)||typeof input.symbol!=='string'||!input.symbol.includes(':')||!Number.isSafeInteger(input.asOf))throw Error('Exact provider symbol, supported timeframe and asOf required');validate(input.bars,input.timeframe);
  const bars=input.bars.filter(b=>b.end<=input.asOf);if(!bars.length)throw Error('No closed H4 by asOf');
  const values=atr(bars,c.atrLen),sw=structure(),internal=structure(),events=[],formations=[],transitions=[],trace=[],pruned=[];let obs=[],d=null,s=null,sd=null,ss=null,pd=null,ps=null,lastHigh=null,lastLow=null;
  const useClassic=c.mode!=='series',useSeries=c.mode!=='classic',mult=c.strictness==='loose'?0:c.strictness==='medium'?1.5:2.5;
  const top=b=>c.zoneSrc==='body'?Math.max(b.open,b.close):b.high,bot=b=>c.zoneSrc==='body'?Math.min(b.open,b.close):b.low;
  function freshZone(candidate,isDemand,kind,i,ratio){
   const b=bars[i],id=[input.symbol,kind,isDemand?'demand':'supply',bars[candidate.index].t,b.end].join('|');
   const zone={id,kind,type:isDemand?'demand':'supply',top:candidate.top,bot:candidate.bot,startIdx:candidate.index,originTime:bars[candidate.index].t,confirmedAt:b.end,confirmIndex:i,breakLevel:candidate.level,atr:values[i],displacementRatio:ratio,
    mainEvent:trace[i].swing.ev,internalEvent:trace[i].internal.ev,strictSwing:isDemand?lastHigh:lastLow,base:{...bars[candidate.index]},confirmation:{...b},fresh:true,armed:false,extreme:isDemand?candidate.top:candidate.bot};
   obs.push(zone);formations.push(JSON.parse(JSON.stringify(zone)));
  }
  for(let i=0;i<bars.length;i++){
   const b=bars[i],bear=b.close<b.open,bull=b.close>b.open,ph=pivot(bars,i,c.obSwingLen,true),pl=pivot(bars,i,c.obSwingLen,false);if(ph)lastHigh=ph;if(pl)lastLow=pl;
   const se=stepStructure(sw,b,pivot(bars,i,c.swingLen,true),pivot(bars,i,c.swingLen,false)),ie=stepStructure(internal,b,pivot(bars,i,c.internalLen,true),pivot(bars,i,c.internalLen,false));
   for(const [scale,e]of [['swing',se],['internal',ie]])if(e.ev)events.push({scale,code:e.ev,kind:Math.abs(e.ev)===1?'BOS':'CHoCH',direction:Math.sign(e.ev),knownAt:b.end,barTime:b.t,level:e.level});
   trace.push({t:b.t,knownAt:b.end,atr:values[i],swing:{trend:sw.trend,bias:sw.bias,ev:se.ev,count:sw.count},internal:{trend:internal.trend,bias:internal.bias,ev:ie.ev,count:internal.count}});
   // Candidate replacement/aging happens BEFORE confirmation, exactly as source.
   if(bear)d={index:i,age:0,top:top(b),bot:bot(b),level:c.breakRef==='wick'?b.high:Math.max(b.open,b.close)};else if(d)d.age++;
   if(bull)s={index:i,age:0,top:top(b),bot:bot(b),level:c.breakRef==='wick'?b.low:Math.min(b.open,b.close)};else if(s)s.age++;
   if(bear){
    if(ss&&ss.count>=c.minSeries)ps={index:ss.index,top:ss.top,bot:ss.bot,level:c.seriesLevel==='extreme-open'?ss.extremeOpen:ss.first};ss=null;
    if(!sd)sd={index:i,count:0,first:b.open,extremeOpen:b.open,top:top(b),bot:bot(b)};else{sd.extremeOpen=Math.max(sd.extremeOpen,b.open);sd.top=Math.max(sd.top,top(b));sd.bot=Math.min(sd.bot,bot(b));}sd.count++;
   }
   if(bull){
    if(sd&&sd.count>=c.minSeries)pd={index:sd.index,top:sd.top,bot:sd.bot,level:c.seriesLevel==='extreme-open'?sd.extremeOpen:sd.first};sd=null;
    if(!ss)ss={index:i,count:0,first:b.open,extremeOpen:b.open,top:top(b),bot:bot(b)};else{ss.extremeOpen=Math.min(ss.extremeOpen,b.open);ss.top=Math.max(ss.top,top(b));ss.bot=Math.min(ss.bot,bot(b));}ss.count++;
   }
   if(useClassic&&d&&d.age>=1&&d.age<=c.impulseBars&&b.close>d.level&&d.top>d.bot){const leg=b.close-d.bot,ratio=values[i]>0?leg/values[i]:null;if((mult===0||ratio!==null&&leg>=mult*values[i])&&(c.strictness!=='strict'||lastHigh&&b.close>lastHigh.price)){freshZone(d,true,'classic',i,ratio);d=null;}}
   if(useClassic&&s&&s.age>=1&&s.age<=c.impulseBars&&b.close<s.level&&s.top>s.bot){const leg=s.top-b.close,ratio=values[i]>0?leg/values[i]:null;if((mult===0||ratio!==null&&leg>=mult*values[i])&&(c.strictness!=='strict'||lastLow&&b.close<lastLow.price)){freshZone(s,false,'classic',i,ratio);s=null;}}
   if(useSeries&&pd&&b.close>pd.level){if(pd.top>pd.bot)freshZone(pd,true,'series',i,values[i]>0?(b.close-pd.bot)/values[i]:null);pd=null;}
   if(useSeries&&ps&&b.close<ps.level){if(ps.top>ps.bot)freshZone(ps,false,'series',i,values[i]>0?(ps.top-b.close)/values[i]:null);ps=null;}
   for(const z of obs)if(z.fresh){
    const up=z.type==='demand';if(!z.armed&&(up?b.low>z.top:b.high<z.bot)){z.armed=true;z.armedAt=b.end;z.extreme=up?z.top:z.bot;transitions.push({id:z.id,kind:'armed',knownAt:b.end});}
    if(z.armed)z.extreme=up?Math.min(z.extreme,b.low):Math.max(z.extreme,b.high);
    const depth=(up?z.top-z.extreme:z.extreme-z.bot)/(z.top-z.bot),mitigated=z.armed&&depth>c.mitigationPct/100,invalidated=up?b.close<z.bot:b.close>z.top;
    if(mitigated||invalidated){z.fresh=false;z.endedAt=b.end;z.endReason=invalidated?'invalidated-close':'mitigated-wick';z.mitigated=mitigated;z.invalidated=invalidated;transitions.push({id:z.id,kind:z.endReason,knownAt:b.end,depth});}
   }
   // Pine computes caps BEFORE applying lookback/hide, then drops oldest first.
   let dropMit=Math.max(0,obs.filter(z=>!z.fresh).length-c.maxMitKeep),dropFresh=Math.max(0,obs.filter(z=>z.fresh).length-c.freshCap);
   obs=obs.filter(z=>{let reason=null;if(i-z.startIdx>=c.lookbackBars)reason='lookback';else if(!z.fresh&&c.hideMitigated)reason='hide-mitigated';else if(z.fresh&&dropFresh>0){dropFresh--;reason='fresh-cap';}else if(!z.fresh&&dropMit>0){dropMit--;reason='mitigated-cap';}if(reason)pruned.push({id:z.id,knownAt:b.end,reason});return !reason;});
   trace[i].retained=obs.length;trace[i].fresh=obs.filter(z=>z.fresh).length;
  }
  const close=bars.at(-1).close;const zones=obs.map(z=>{let rank=0;if(z.bot>close)rank=obs.filter(a=>a.fresh&&a.bot>close&&a.bot-close<z.bot-close).length;else if(z.top<close)rank=obs.filter(a=>a.fresh&&a.top<close&&close-a.top<close-z.top).length;return {...z,visible:!z.fresh||rank<c.maxPerSide,side:z.bot>close?'above':z.top<close?'below':'inside',rank};});
  return {version,symbol:input.symbol,timeframe:input.timeframe,asOf:input.asOf,settings:c,researchOnly:true,pineParityVerified:false,entryModel:null,tradeSignals:false,firstBar:bars[0].t,lastClosedAt:bars.at(-1).end,bars:bars.length,zones,formations,events,transitions,pruned,trace};
 }
 return {version,defaults,settings,validate,atr,pivot,structure,stepStructure,run};
});
