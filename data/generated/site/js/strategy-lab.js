(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./trade-zones.js'));else root.StrategyLab=factory(root.TradeZones);})(typeof globalThis==='object'?globalThis:this,function(Z){
 'use strict';
 const version='strategy-lab-v1-pilot',step=900,iso=t=>new Date(t*1000).toISOString();
 const defaults=Object.freeze({model:'d1-sfp',bos:false,stop:'swing',rr:2,entryLagBars:1,spreadBps:1,commissionBps:0,slippageBps:.5,financingBpsPerDay:0,maxHoldingBars:480,swing:2,bufferAtr:.05});
 function settings(input={}){
  const allowed=new Set([...Object.keys(defaults),'fast','slow','stopAtr']);
  if(Object.keys(input).some(k=>!allowed.has(k)))throw Error('Neznámý parametr strategie.');
  const c={...defaults,...input};
  if(!['d1-sfp','refined-sfp','h4-sfp','ema'].includes(c.model)||!['swing','zone'].includes(c.stop)||typeof c.bos!=='boolean')throw Error('Neplatný model strategie.');
  for(const [k,min,max]of [['rr',1,10],['entryLagBars',0,8],['spreadBps',0,100],['commissionBps',0,100],['slippageBps',0,100],['financingBpsPerDay',0,100],['maxHoldingBars',1,5000],['swing',2,5],['bufferAtr',0,1]])if(!Number.isFinite(c[k])||c[k]<min||c[k]>max)throw Error('Neplatný parametr '+k);
  for(const k of ['entryLagBars','maxHoldingBars','swing'])if(!Number.isInteger(c[k]))throw Error('Parametr musí být celé číslo: '+k);
  if(c.model==='ema'&&(![20,50].includes(c.fast)||c.slow!==(c.fast===20?50:200)||![1.5,2].includes(c.stopAtr)))throw Error('Neplatné samostatné EMA nastavení.');
  if(c.model==='ema'&&c.bos)throw Error('EMA je samostatná strategie, bez BOS nebo zón.');
  if(c.model!=='ema'&&['fast','slow','stopAtr'].some(k=>Object.hasOwn(input,k)))throw Error('EMA parametry nepatří do zónové strategie.');
  return c;
 }
 function matrix(family='zones'){
  const out=[];
  if(family==='zones')for(const model of ['d1-sfp','refined-sfp','h4-sfp'])for(const bos of [false,true])for(const stop of ['swing','zone'])for(const rr of [2,3])out.push(settings({model,bos,stop,rr}));
  else if(family==='ema')for(const fast of [20,50])for(const stopAtr of [1.5,2])for(const rr of [2,3])out.push(settings({model:'ema',fast,slow:fast===20?50:200,stopAtr,rr}));
  else throw Error('Neznámá rodina strategií.');
  return out;
 }
 const ny=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 function weekendGap(end,start){
  const parts=t=>Object.fromEntries(ny.formatToParts(new Date(t*1000)).map(p=>[p.type,p.value]));
  const a=parts(end),b=parts(start);
  return a.weekday==='Fri'&&a.hour==='17'&&a.minute==='00'&&b.weekday==='Sun'&&b.hour==='17'&&b.minute==='00'&&start-end>=47*3600&&start-end<=49*3600;
 }
 function continuous(a,b){return b.t===a.end||weekendGap(a.end,b.t);}
 function validate(bars,duration){
  if(!Array.isArray(bars)||!bars.length)throw Error('Chybí ověřené svíčky.');
  for(let i=0;i<bars.length;i++){
   const b=bars[i];
   if(!Number.isSafeInteger(b.t)||!Number.isSafeInteger(b.end)||b.end-b.t!==duration||!['open','high','low','close'].every(k=>Number.isFinite(b[k])&&b[k]>0)||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)||i&&b.t<bars[i-1].end)throw Error('Neplatné, překrývající se nebo neseřazené svíčky.');
  }
 }
 function ema(bars,n){let seed=0,last=null,count=0;return bars.map((b,i)=>{if(i&&!continuous(bars[i-1],b)){seed=0;last=null;count=0;}if(count<n){seed+=b.close;if(++count===n)last=seed/n;}else last=b.close*2/(n+1)+last*(1-2/(n+1));return last;});}
 function atr(bars,n=14){let history=[];return bars.map((b,i)=>{if(i&&!continuous(bars[i-1],b))history=[];const previous=history.length?bars[i-1].close:b.open;history.push(Math.max(b.high-b.low,Math.abs(b.high-previous),Math.abs(b.low-previous)));if(history.length>n)history.shift();return history.length===n?history.reduce((a,b)=>a+b,0)/n:null;});}
 function prepare(data){
  if(data.provider!=='OANDA'||!/^OANDA:[A-Z]{6}$/.test(data.symbol)||data.timeframe!=='M15'||data.validation!=='m15-h4-exact-v1')throw Error('Pilot vyžaduje oddělený OANDA M15 zdroj a přesnou H4 návaznost.');
  validate(data.m15,step);validate(data.h4,14400);validate(data.d1,86400);
  const parentSlots=new Map(),groups=new Map();for(const h of data.h4)for(let k=0;k<16;k++)parentSlots.set(h.t+k*step,h);
  for(const b of data.m15){const parent=parentSlots.get(b.t);if(!parent||b.end>parent.end)throw Error('M15 nemá doloženou H4 hranici.');if(!groups.has(parent.t))groups.set(parent.t,[]);groups.get(parent.t).push(b);}
  for(const [t,rows]of groups){const h=parentSlots.get(t);if(rows.length!==16||rows.some((b,i)=>b.t!==t+i*step)||rows[0].open!==h.open||rows.at(-1).close!==h.close||Math.max(...rows.map(b=>b.high))!==h.high||Math.min(...rows.map(b=>b.low))!==h.low)throw Error('M15/H4 OHLC nebo úplnost nesouhlasí.');}
  const end=data.m15.at(-1).end,asOf=iso(end),toBar=b=>({...b,timestamp:b.t,date:iso(b.t),endDate:iso(b.end)});
  const h4=data.h4.filter(b=>b.end<=end),d1=data.d1.filter(b=>b.end<=end);
  const h4Price={timeframe:'H4',validation:data.h4Validation,bars:h4.map(toBar),latestClose:h4.at(-1)?.close};
  const d1Price={bars:d1.map(b=>({...b,date:b.sessionDate,endDate:iso(b.end)})),latestClose:d1.at(-1)?.close};
  const zones=[...Z.formations(d1Price,'D1',asOf),...Z.formations(h4Price,'H4',asOf)].map(z=>({...z,known:Date.parse(z.confirmedAt)/1000,baseStart:z.timeframe==='D1'?d1.find(b=>b.sessionDate===z.baseDate)?.t:Date.parse(z.baseDate)/1000})).sort((a,b)=>a.known-b.known||a.id.localeCompare(b.id));
  return {data,h4,d1,zones,atr:atr(data.m15),h4Atr:atr(h4),emas:{20:ema(h4,20),50:ema(h4,50),200:ema(h4,200)}};
 }
 function penetration(z,b){return Math.max(0,(z.type==='demand'?z.upper-b.low:b.high-z.lower)/(z.upper-z.lower));}
 function invalid(z,b){return penetration(z,b)>=.25-Number.EPSILON*16;}
 function overlap(z,b){return b.high>=z.lower&&b.low<=z.upper;}
 function pivot(bars,i,n,high){
  const j=i-n-1;if(j<n)return null;
  const group=bars.slice(j-n,j+n+1),v=high?bars[j].high:bars[j].low;
  if(group.some((b,k)=>k&&!continuous(group[k-1],b)))return null;
  return group.every((b,k)=>k===n||(high?b.high<v:b.low>v))?{price:v,t:bars[j].t,known:bars[j+n].end}:null;
 }
 function seedValid(z,p,first){
  if(!Number.isFinite(z.baseStart)||z.known>first)return false;
  const history=p.h4.filter(b=>b.t>=z.known&&b.end<=first);
  // Missing history may not silently preserve a previously mitigated zone.
  if(z.known<first&&(!history.length||history[0].t!==z.known||history.at(-1).end!==first&&!weekendGap(history.at(-1).end,first)))return false;
  if(history.some((b,i)=>invalid(z,b)||i&&!continuous(history[i-1],b)))return false;
  // A return before the measured interval consumes a first-return opportunity.
  return !history.some(b=>overlap(z,b));
 }
 function signalEngine(p,c){
  const bars=p.data.m15,start=bars[0].t;let cursor=0,active=[],low=null,high=null,h4Index=0;
  const diagnostics={swingFailures:0,zoneReturns:0,zoneInvalidations:0};
  if(c.model!=='ema'){
   while(cursor<p.zones.length&&p.zones[cursor].known<start){const z=p.zones[cursor++];if(seedValid(z,p,start))active.push({...z});}
  }
  function next(i){
   const b=bars[i],gap=i&&!continuous(bars[i-1],b);
   if(gap){active=[];low=high=null;while(cursor<p.zones.length&&p.zones[cursor].known<b.t)cursor++;}
   const lo=pivot(bars,i,c.swing,false),hi=pivot(bars,i,c.swing,true);if(lo)low=lo;if(hi)high=hi;
   const sfpLow=low&&b.low<low.price&&b.close>low.price?low:null,sfpHigh=high&&b.high>high.price&&b.close<high.price?high:null;
   if(sfpLow||sfpHigh)diagnostics.swingFailures++;
   if(low&&b.low<low.price)low=null;if(high&&b.high>high.price)high=null;
   if(c.model==='ema'){
    let signal=null;
    while(h4Index<p.h4.length&&p.h4[h4Index].end<=b.end){
     const j=h4Index++,h=p.h4[j],fast=p.emas[c.fast][j],slow=p.emas[c.slow][j],previous=p.emas[c.fast][j-1],a=p.h4Atr[j];
     if(h.end!==b.end||fast==null||slow==null||previous==null||!a||j&&!continuous(p.h4[j-1],h))continue;
     const up=fast>slow&&h.low<=previous&&h.close>fast&&h.close>h.open,down=fast<slow&&h.high>=previous&&h.close<fast&&h.close<h.open;
     if(up||down)signal={direction:up?1:-1,known:b.end,stop:h.close+(up?-1:1)*a*c.stopAtr,reason:'Samostatný H4 EMA pullback',reference:{fast:c.fast,slow:c.slow,h4ClosedAt:iso(h.end)}};
    }
    return {signal,gap};
   }
   while(cursor<p.zones.length&&p.zones[cursor].known<=b.t)active.push({...p.zones[cursor++]});
   active=active.filter(z=>{if(invalid(z,b)){diagnostics.zoneInvalidations++;return false;}return b.t-z.known<=365*86400;});
   const candidates=[];
   for(const z of active){
    if(z.used||!overlap(z,b))continue;
    z.used=true;z.touchAt=b.t;diagnostics.zoneReturns++;
    const parent=c.model==='refined-sfp'?active.filter(x=>x.timeframe==='D1'&&x.type===z.type&&x.lower<=z.lower&&x.upper>=z.upper&&x.baseStart<=z.baseStart&&!x.consumed&&(!x.used||x.touchAt===b.t)).sort((a,b)=>b.known-a.known||a.id.localeCompare(b.id))[0]:null;
    if(c.model==='d1-sfp'&&z.timeframe!=='D1'||c.model==='h4-sfp'&&z.timeframe!=='H4'||c.model==='refined-sfp'&&(z.timeframe!=='H4'||!parent)||c.bos&&z.bos.state!=='yes')continue;
    const up=z.type==='demand',swing=up?sfpLow:sfpHigh,a=p.atr[i];if(!swing||!a)continue;
    const stop=(c.stop==='zone'?(up?z.lower:z.upper):(up?b.low:b.high))+(up?-1:1)*a*c.bufferAtr;
    candidates.push({direction:up?1:-1,known:b.end,stop,zone:z,parent,swing,reason:'M15 swing failure při prvním platném návratu',reference:{zoneId:z.id,zoneKnownAt:iso(z.known),swingKnownAt:iso(swing.known),swingPrice:swing.price,parentId:parent?.id||null}});
   }
   const lastClose=b.close;
   candidates.sort((a,b)=>Z.distancePercent(lastClose,a.zone.lower,a.zone.upper)-Z.distancePercent(lastClose,b.zone.lower,b.zone.upper)||b.zone.known-a.zone.known||a.zone.id.localeCompare(b.zone.id));
   const signal=candidates[0]||null;if(signal?.parent)signal.parent.consumed=true;
   return {signal,gap};
  }
  return {next,diagnostics};
 }
 function metrics(trades){
  let cumulative=0,peak=0,drawdown=0,losses=0,maxLosses=0;
  const wins=trades.filter(t=>t.netR>0),positive=wins.reduce((n,t)=>n+t.netR,0),negative=-trades.filter(t=>t.netR<0).reduce((n,t)=>n+t.netR,0);
  for(const t of trades){cumulative+=t.netR;peak=Math.max(peak,cumulative);drawdown=Math.max(drawdown,peak-cumulative);losses=t.netR<0?losses+1:0;maxLosses=Math.max(maxLosses,losses);}
  return {trades:trades.length,totalR:cumulative,meanR:trades.length?cumulative/trades.length:null,winRate:trades.length?wins.length/trades.length*100:null,profitFactor:negative?positive/negative:null,maxDrawdownR:drawdown,drawdownBasis:'closed-trades-only',maxConsecutiveLosses:maxLosses};
 }
 function simulate(bars,rawConfig,signals){
  validate(bars,step);
  const c=settings(rawConfig),trades=[],unresolved=[],audit={gaps:0,cancelledEntries:0,signals:0};let pending=null,position=null;
  function close(b,price,reason){
   const p=position,grossR=p.direction*(price-p.entry)/p.risk,days=(b.end-p.enteredAt)/86400;
   const costR=p.entry*((c.spreadBps+c.commissionBps+2*c.slippageBps+c.financingBpsPerDay*days)/10000)/p.risk;
   trades.push({...p,exit:price,exitedAt:b.end,exitReason:reason,grossR,costR,netR:grossR-costR});position=null;
  }
  for(let i=0;i<bars.length;i++){
   const b=bars[i],gap=i&&!continuous(bars[i-1],b);
   if(gap){audit.gaps++;if(position)unresolved.push({...position,reason:'Chybějící M15 mezi vstupem a výstupem'});position=pending=null;}
   // Only information known at bar OPEN is used to decide whether to enter.
   if(pending&&pending.enterAt<=b.t){
    const s=pending;pending=null;
    const invalidOpen=s.zone&&(invalid(s.zone,{low:b.open,high:b.open})||s.parent&&invalid(s.parent,{low:b.open,high:b.open}));
    const risk=s.direction*(b.open-s.stop);
    if(!position&&!invalidOpen&&risk>0)position={enteredAt:b.t,signalAt:s.known,entry:b.open,stop:s.stop,target:b.open+s.direction*risk*c.rr,risk,direction:s.direction,reference:s.reference,heldBars:0};else audit.cancelledEntries++;
   }
   if(position){
    const up=position.direction===1,stop=up?b.low<=position.stop:b.high>=position.stop,tp=up?b.high>=position.target:b.low<=position.target;
    if(stop)close(b,up?Math.min(position.stop,b.open):Math.max(position.stop,b.open),tp?'SL i TP v jedné svíčce — SL první':'Stop-loss');
    else if(tp)close(b,position.target,'Take-profit');
    else if(++position.heldBars>=c.maxHoldingBars)close(b,b.close,'Časový výstup');
   }
   const {signal}=signals.next(i);
   if(pending?.zone&&(invalid(pending.zone,b)||pending.parent&&invalid(pending.parent,b))){pending=null;audit.cancelledEntries++;}
   if(signal){audit.signals++;if(!position&&!pending)pending={...signal,enterAt:b.end+c.entryLagBars*step};}
  }
  if(position)unresolved.push({...position,reason:'Pozice na konci dostupných dat zůstává otevřená'});
  return {version,config:c,metrics:metrics(trades),trades,unresolved,pendingAtEnd:Boolean(pending),audit:{...audit,...signals.diagnostics}};
 }
 function run(prepared,config){const c=settings(config);return simulate(prepared.data.m15,c,signalEngine(prepared,c));}
 return {version,defaults,settings,matrix,continuous,validate,prepare,run,simulate,metrics,ema,atr,pivot,penetration};
});
