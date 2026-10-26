// Independent forward simulations. NEVER calls H4Paper.update or writes its ledger.
const E=require('../wwwroot/js/h4-paper.js');
const copy=x=>JSON.parse(JSON.stringify(x)),sec=x=>Date.parse(x)/1000;
const active=s=>['waiting','open','needs_data'].includes(s.status);
const signature=b=>JSON.stringify([b.timestamp,b.endDate,b.open,b.high,b.low,b.close]);
const variants=Object.freeze([
 {id:'tp3r',label:'Dotyk · TP 3R · SL 5 %',rr:3,buffer:.05,timeframe:'H4'},
 {id:'sl10',label:'Dotyk · TP 2R · SL 10 %',rr:2,buffer:.10,timeframe:'H4'},
 {id:'sfp15',label:'M15 SFP 2/2 · další open · TP 2R',rr:2,buffer:.05,timeframe:'M15'}
]);
function series(price,variant,now){
 const p=variant.timeframe==='M15'?price?.m15:price?.h4;
 if(p?.status!=='ready'||p.provider!=='OANDA'||!p.symbol||!Number.isFinite(sec(p.asOfUtc))||sec(p.asOfUtc)>sec(now))return null;
 // No offline pilot, aggregated H4, guessed candles, or unverifiable M15 feed.
 if(variant.timeframe==='M15'&&(p.validation?.providerBoundaryValidated!==true||p.validation?.rule!=='oanda-m15-boundary-v1'||p.validation?.completedOnly!==true||p.timeframe!=='M15'||!/^[a-f0-9]{64}$/.test(p.rawSha256||'')))return null;
 const duration=variant.timeframe==='M15'?900:14400;
 const bars=(p.bars||[]).filter(b=>sec(b.endDate)<=sec(p.asOfUtc));
 if(!bars.length||bars.some((b,i)=>!Number.isSafeInteger(b.timestamp)||sec(b.endDate)<=b.timestamp||sec(b.endDate)-b.timestamp>duration||sec(b.endDate)>sec(now)||!['open','high','low','close'].every(k=>Number.isFinite(b[k])&&b[k]>0)||b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close)||i&&b.timestamp<=bars[i-1].timestamp))return null;
 return {p,bars};
}
function append(state,s,kind,at,data,hash){const e={sequence:state.events.length+1,setupId:s.id,kind,at,data};state.events.push({...e,id:hash(JSON.stringify(e))});}
function finish(state,s,status,b,reason,hash,exit){
 s.status=status;s.reason=reason;s.resolvedAt=b.endDate;
 if(['tp','sl'].includes(status)){
  const f=s.fill||s.frozen;s.grossR=(exit-f.entry)*(s.frozen.side==='long'?1:-1)/f.risk;
  const c=s.frozen.costs;s.costR=f.entry*(c.spreadBps+2*c.slippageBpsPerSide+c.commissionBps)/10000/f.risk;s.netR=s.grossR-s.costR;s.exit=exit;
 }
 append(state,s,status.toUpperCase(),b.endDate,{reason,bar:b,exit:exit??null},hash);
}
function resolve(state,s,b,entryBar,hash){
 const f=s.fill||s.frozen,long=s.frozen.side==='long',stop=long?b.low<=f.sl:b.high>=f.sl,target=long?b.high>=f.tp:b.low<=f.tp;
 if(!entryBar&&(long?b.open<=f.sl:b.open>=f.sl))return finish(state,s,'sl',b,'STOP_GAP',hash,b.open);
 if(!entryBar&&(long?b.open>=f.tp:b.open<=f.tp))return finish(state,s,'tp',b,'TARGET_AT_OPEN',hash,f.tp);
 if(stop&&target)return finish(state,s,'ambiguous',b,'SL_AND_TP_SAME_BAR',hash);
 if(stop)return finish(state,s,'sl',b,'STOP_TOUCHED',hash,entryBar?f.sl:long?Math.min(f.sl,b.open):Math.max(f.sl,b.open));
 if(target){
  if(entryBar&&!s.fill&&(long?b.open>f.entry&&b.close<f.tp:b.open<f.entry&&b.close>f.tp))return finish(state,s,'ambiguous',b,'ENTRY_TP_ORDER_UNKNOWN',hash);
  finish(state,s,'tp',b,'TARGET_TOUCHED',hash,f.tp);
 }
}
function pivot(bars,i,long){
 // Latest 2-left/2-right pivot confirmed BEFORE the signal candle.
 for(let j=i-3;j>=2;j--){const v=long?bars[j].low:bars[j].high;
  if(bars[j+2].timestamp+900>bars[i].timestamp||bars.slice(j-1,j+3).some((b,k)=>b.timestamp-bars[j-2+k].timestamp!==900))continue;
  if(bars.slice(j-2,j+3).every((b,k)=>k===2||(long?b.low>v:b.high<v)))return {level:v,pivotAt:bars[j].date,knownAt:bars[j+2].endDate,evidence:bars.slice(j-2,j+3)};
 }return null;
}
function update(state,baseline,sources,now,hash){
 state.availability={};
 for(const v of variants){
  const available=Object.values(sources.prices||{}).filter(p=>series(p,v,now));
  state.availability[v.id]={readyInstruments:available.length,status:available.length?'ready':'missing_data'};
  for(const [key,price] of Object.entries(sources.prices||{})){
   const data=series(price,v,now);if(!data)continue;const {p,bars}=data,last=bars.at(-1);
   const candidates=state.simulations.filter(s=>s.frozen.variant===v.id&&s.frozen.symbol===p.symbol&&active(s));
   for(let i=0;i<bars.length;i++){
    const b=bars[i],eligible=[];
    for(const s of candidates.filter(s=>active(s)&&b.timestamp>s.lastProcessedStart)){
     const cursor=bars.find(x=>x.timestamp===s.lastProcessedStart);
     const adjacent=v.timeframe==='H4'?E.adjacent(s.lastProcessedStart,b.timestamp):b.timestamp-s.lastProcessedStart===900||E.adjacent(s.lastProcessedStart-13500,b.timestamp);
     const reason=!cursor?'CURSOR_MISSING':signature(cursor)!==s.lastSignature?'PREVIOUS_BAR_REVISED':!adjacent?'MISSING_CANDLES':null;
     if(reason){if(s.status!=='needs_data'){s.resumeState=s.status;s.status='needs_data';s.reason=reason;append(state,s,'NEEDS_DATA',now,{reason},hash);}continue;}
     if(s.status==='needs_data'){if(s.reason==='PREVIOUS_BAR_REVISED')continue;s.status=s.resumeState;delete s.resumeState;delete s.reason;append(state,s,'DATA_RESUMED',now,{},hash);}
     eligible.push(s);
    }
    const pending=eligible.filter(s=>s.status==='waiting');
    if(v.timeframe==='H4'){
     const touches=pending.filter(s=>s.frozen.side==='long'?b.low<=s.frozen.entry:b.high>=s.frozen.entry);
     if(touches.length>1){for(const s of touches)finish(state,s,'ambiguous',b,'BOTH_OCO_ENTRIES',hash);}
     else if(touches.length){const s=touches[0],f=s.frozen;
      if(b.timestamp<sec(f.registeredAt))finish(state,s,sec(b.endDate)<=sec(f.registeredAt)?'cancelled':'ambiguous',b,'TOUCH_BEFORE_OR_DURING_REGISTRATION',hash);
      else if(f.side==='long'?b.open<=f.sl:b.open>=f.sl)finish(state,s,'ambiguous',b,'GAP_THROUGH_ENTRY_SL',hash);
      else{s.status='open';s.enteredAt=b.endDate;s.entryStart=b.timestamp;append(state,s,'ENTRY',b.endDate,{price:f.entry,bar:b},hash);resolve(state,s,b,true,hash);}
      for(const other of pending.filter(x=>x.id!==s.id&&active(x)))finish(state,other,'cancelled',b,'OCO_OTHER_SIDE',hash);
     }
    }else{
     const entered=[];
     for(const s of pending){const f=s.frozen,long=f.side==='long',z=f.zone;
      if(b.timestamp<sec(f.registeredAt)){s.signalAt=null;continue;}
      if(s.signalAt){
       if(long?b.open<=f.sl:b.open>=f.sl){finish(state,s,'cancelled',b,'SFP_OPEN_BEYOND_STOP',hash);continue;}
       const risk=Math.abs(b.open-f.sl),tp=b.open+(long?1:-1)*v.rr*risk;if(!(risk>0&&tp>0)){finish(state,s,'cancelled',b,'INVALID_SFP_GEOMETRY',hash);continue;}s.fill={entry:b.open,sl:f.sl,tp,risk};s.status='open';s.enteredAt=b.endDate;s.entryStart=b.timestamp;entered.push(s);continue;
      }
      if(long?b.close<z.lower:b.close>z.upper){finish(state,s,'cancelled',b,'SFP_ZONE_INVALIDATED',hash);continue;}
      if(b.high>=z.lower&&b.low<=z.upper&&!s.touchAt)s.touchAt=b.timestamp;
      if(!s.touchAt)continue;
      if(b.timestamp-s.touchAt>8*900){finish(state,s,'cancelled',b,'SFP_WINDOW_EXPIRED',hash);continue;}
      const point=pivot(bars,i,long),level=point?.level;
      if(level!=null&&(long?b.low<level&&b.close>level:b.high>level&&b.close<level)){
       s.signalAt=b.endDate;append(state,s,'SFP_CONFIRMED',b.endDate,{pivot:point,bar:b},hash);
      }
     }
     if(entered.length>1){for(const s of entered)finish(state,s,'ambiguous',b,'BOTH_OCO_ENTRIES',hash);}
     else if(entered.length){const s=entered[0];append(state,s,'ENTRY',b.endDate,{fill:s.fill,bar:b},hash);resolve(state,s,b,true,hash);for(const other of pending.filter(x=>x.id!==s.id&&active(x)))finish(state,other,'cancelled',b,'OCO_OTHER_SIDE',hash);}
    }
    for(const s of eligible){if(s.status==='open'&&s.entryStart!==b.timestamp)resolve(state,s,b,false,hash);s.lastProcessedStart=b.timestamp;s.lastSignature=signature(b);}
   }
   if(state.simulations.some(s=>s.frozen.variant===v.id&&s.frozen.symbol===p.symbol&&active(s)))continue;
   if(sec(now)-sec(last.endDate)>(v.timeframe==='H4'?6*3600:1800))continue;
   for(const s of baseline.state.setups.filter(s=>s.frozen.key===key&&s.frozen.symbol===p.symbol&&s.status==='waiting'&&sec(s.frozen.registeredAt)>=sec(state.startedAt))){
    const id=hash(state.plan.id+'|'+v.id+'|'+s.id);if(state.simulations.some(x=>x.id===id))continue;
    const f=s.frozen,z=f.zone,long=f.side==='long',entry=long?z.upper:z.lower,sl=long?z.lower-(z.upper-z.lower)*v.buffer:z.upper+(z.upper-z.lower)*v.buffer,risk=Math.abs(entry-sl),tp=entry+(long?1:-1)*v.rr*risk;
    if(!(Math.min(entry,sl,tp)>0&&risk>0)||(long?last.close<=entry:last.close>=entry))continue;
    const frozen={id,variant:v.id,parentId:s.id,key,symbol:p.symbol,provider:'OANDA',timeframe:v.timeframe,side:f.side,entry,sl,tp,risk,rr:v.rr,buffer:v.buffer,zone:copy(z),costs:copy(E.config),registeredAt:now,baselineRegisteredAt:f.registeredAt,sourceAsOf:p.asOfUtc,sourceHash:hash(JSON.stringify(p)),sourcePath:sources.path??null,sourceRevision:sources.revision??null,baselineSourceHash:f.sourceHash??null};
    const next={id,frozen,status:'waiting',lastProcessedStart:last.timestamp,lastSignature:signature(last)};state.simulations.push(next);append(state,next,'REGISTERED',now,frozen,hash);
   }
  }
 }
 return state;
}
module.exports={variants,update,active,resolve,series};
