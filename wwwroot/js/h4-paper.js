(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./fm-trade-zones.js'),require('./trade-zones.js'));else root.H4Paper=factory(root.FmTradeZones,root.TradeZones);})(typeof globalThis==='object'?globalThis:this,(FM,T)=>{
 'use strict';
 const model='fm-h4-touch-2r-v1',config=Object.freeze({rr:2,bufferFraction:.05,spreadBps:1,slippageBpsPerSide:.5,commissionBps:0,financingBpsPerDay:null,oco:true,maxRegistrationLagHours:6}),active=s=>['waiting','open','needs_data'].includes(s.status),terminal=s=>!active(s),sec=s=>Date.parse(s)/1000,iso=t=>new Date(t*1000).toISOString(),copy=v=>JSON.parse(JSON.stringify(v));
 const signature=b=>JSON.stringify([b.timestamp,b.endDate,b.open,b.high,b.low,b.close]);
 const ny=t=>new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'numeric',hourCycle:'h23'}).formatToParts(new Date(t*1000)).filter(p=>['weekday','hour'].includes(p.type)).map(p=>p.value);
 function adjacent(a,b){if(b-a===14400)return true;const p=ny(a),n=ny(b);return p[0]==='Fri'&&Number(p[1])===13&&n[0]==='Sun'&&Number(n[1])===17&&b-a>=48*3600&&b-a<=56*3600;}
 function plan(z){const long=z.type==='demand',entry=long?z.upper:z.lower,buffer=(z.upper-z.lower)*config.bufferFraction,sl=long?z.lower-buffer:z.upper+buffer,risk=Math.abs(entry-sl),tp=entry+(long?1:-1)*config.rr*risk;if(!(risk>0&&Math.min(entry,sl,tp)>0))return null;return {side:long?'long':'short',entry,sl,tp,risk};}
 function empty(now){return {schemaVersion:1,model,config:copy(config),startedAt:now,lastRunAt:now,source:null,setups:[],events:[],diagnostics:[]};}
 function event(state,s,kind,at,payload,hash){const e={sequence:state.events.length+1,setupId:s.id,kind,at,payload};state.events.push({...e,id:hash(JSON.stringify(e))});}
 function close(state,s,status,bar,reason,hash,exitPrice,knownAt=bar.endDate){s.status=status;s.reason=reason;s.resolvedAt=knownAt;if(status==='tp'||status==='sl'){s.exit=exitPrice;const f=s.frozen;s.grossR=(exitPrice-f.entry)*(f.side==='long'?1:-1)/f.risk;s.costR=f.entry*(config.spreadBps+config.slippageBpsPerSide*2+config.commissionBps)/10000/f.risk;s.netR=s.grossR-s.costR;}event(state,s,status.toUpperCase(),knownAt,{reason,bar,exitPrice:exitPrice??null,grossR:s.grossR??null,netR:s.netR??null},hash);}
 function resolve(state,s,b,entryBar,hash){const f=s.frozen,long=f.side==='long',stop=long?b.low<=f.sl:b.high>=f.sl,target=long?b.high>=f.tp:b.low<=f.tp;if(!entryBar&&(long?b.open<=f.sl:b.open>=f.sl)){close(state,s,'sl',b,'STOP_GAP_AT_OPEN',hash,b.open);return;}if(!entryBar&&(long?b.open>=f.tp:b.open<=f.tp)){close(state,s,'tp',b,'TARGET_AT_OPEN',hash,f.tp);return;}if(stop&&target){close(state,s,'ambiguous',b,'SL_AND_TP_IN_SAME_H4',hash);return;}if(stop){const exit=long?Math.min(f.sl,b.open):Math.max(f.sl,b.open);close(state,s,'sl',b,'STOP_TOUCHED',hash,entryBar?f.sl:exit);return;}if(target){if(entryBar&&(long?b.open>f.entry&&b.close<f.tp:b.open<f.entry&&b.close>f.tp)){close(state,s,'ambiguous',b,'ENTRY_AND_TP_ORDER_UNKNOWN',hash);return;}close(state,s,'tp',b,'TARGET_TOUCHED',hash,f.tp);}}
 function update(previous,sources,now,hash){
  if(!Number.isFinite(sec(now))||typeof hash!=='function')throw Error('Paper clock/hash required.');const state=previous?copy(previous):empty(now);if(state.schemaVersion!==1||state.model!==model||JSON.stringify(state.config)!==JSON.stringify(config))throw Error('Paper methodology changed; use a new model, never rewrite existing ledger.');if(sec(now)<sec(state.lastRunAt))throw Error('Paper clock moved backwards.');
  state.lastRunAt=now;state.source={asOf:sources.asOf,revision:sources.revision,path:sources.path};state.diagnostics=[];
  for(const [key,price]of Object.entries(sources.prices||{})){
   const h=price.h4;if(h?.status!=='ready'||h.provider!=='OANDA')continue;let bars;
   try{bars=T.sourceBars(h,'H4',h.asOfUtc);if(!bars.length||bars.some(b=>sec(b.endDate)>sec(now)))throw Error('Missing/future completed H4.');}catch(e){state.diagnostics.push({key,reason:e.message});continue;}
   const instrument=state.setups.filter(s=>s.frozen.symbol===h.symbol&&active(s));
   for(const b of bars){const candidates=instrument.filter(s=>active(s)&&b.timestamp>s.lastProcessedStart);if(!candidates.length)continue;
    const eligible=[];
    for(const s of candidates){const cursor=bars.find(p=>p.timestamp===s.lastProcessedStart);const issue=!cursor?'CURSOR_OUTSIDE_HISTORY':signature(cursor)!==s.lastBarSignature?'PREVIOUS_BAR_REVISED':!adjacent(s.lastProcessedStart,b.timestamp)?'MISSING_H4_HISTORY':null;
     if(issue){if(s.status!=='needs_data'){s.resumeState=s.status;s.status='needs_data';s.reason=issue;event(state,s,'NEEDS_DATA',now,{reason:issue,lastProcessedStart:s.lastProcessedStart,next:b.timestamp},hash);}continue;}
     if(s.status==='needs_data'){if(s.reason==='PREVIOUS_BAR_REVISED')continue;s.status=s.resumeState;delete s.resumeState;delete s.reason;event(state,s,'DATA_RESUMED',now,{next:b.timestamp},hash);}
     if(s.status==='waiting'&&sec(b.endDate)<=sec(s.frozen.registeredAt)){s.lastProcessedStart=b.timestamp;s.lastBarSignature=signature(b);s.lastClose=b.close;s.lastBarEnd=b.endDate;if(s.frozen.side==='long'?b.low<=s.frozen.entry:b.high>=s.frozen.entry)close(state,s,'cancelled',b,'LATE_BAR_SHOWS_PRE_REGISTRATION_TOUCH',hash,undefined,now);continue;}
     eligible.push(s);
    }
    // No bar before registration may create a retrospective entry.
    const pending=eligible.filter(s=>s.status==='waiting'),touched=pending.filter(s=>s.frozen.side==='long'?b.low<=s.frozen.entry:b.high>=s.frozen.entry);
    if(touched.length>1){for(const s of touched)close(state,s,'ambiguous',b,'BOTH_OCO_ENTRIES_IN_SAME_H4',hash);}
    else if(touched.length===1){const s=touched[0],f=s.frozen;
     if(b.timestamp<sec(f.registeredAt)){close(state,s,'ambiguous',b,'TOUCH_IN_REGISTRATION_H4',hash);}
     else if(f.side==='long'?b.open<=f.sl:b.open>=f.sl){close(state,s,'ambiguous',b,'GAP_THROUGH_ENTRY_AND_SL',hash);}
     else{s.status='open';s.enteredAt=b.endDate;s.entryBarStart=b.date;event(state,s,'ENTRY',b.endDate,{price:f.entry,bar:b,exactIntrabarTimeKnown:false},hash);resolve(state,s,b,true,hash);}
     for(const other of pending.filter(v=>v.id!==s.id&&active(v)))close(state,other,'cancelled',b,'OCO_OTHER_SIDE_TRIGGERED',hash);
    }
    for(const s of eligible){if(s.status==='open'&&s.entryBarStart!==b.date)resolve(state,s,b,false,hash);s.lastProcessedStart=b.timestamp;s.lastBarSignature=signature(b);s.lastClose=b.close;s.lastBarEnd=b.endDate;}
   }
   // Freeze each fresh zone once. Never move entry/SL/TP to a newer nearest pair.
   if(state.setups.some(s=>s.frozen.symbol===h.symbol&&active(s)))continue;
   if(sec(now)-sec(bars.at(-1).endDate)>config.maxRegistrationLagHours*3600){state.diagnostics.push({key,reason:'STALE_SOURCE_NO_NEW_REGISTRATION'});continue;}
   let zones;try{zones=FM.detect(h,'H4',h.asOfUtc);}catch(e){state.diagnostics.push({key,reason:e.message});continue;}
   const last=bars.at(-1);
   for(const z of zones){const p=plan(z);if(!p)continue;const id=hash(JSON.stringify([model,h.provider,h.symbol,'H4',z.type,z.baseDate,z.confirmedAt,z.lower,z.upper,config]));if(state.setups.some(s=>s.id===id))continue;
    if(p.side==='long'?last.close<=p.entry:last.close>=p.entry){state.diagnostics.push({key,reason:'ALREADY_INSIDE_OR_BEYOND_ENTRY',type:z.type});continue;}
    // Observe first, then wait for future bars; present candles are never fills.
    const frozen={id,key,provider:h.provider,symbol:h.symbol,timeframe:'H4',...p,registeredAt:now,sourceAsOf:h.asOfUtc,sourceRevision:sources.revision,sourcePath:sources.path,sourceHash:hash(JSON.stringify(h)),initialLastStart:last.timestamp,initialLastEnd:last.endDate,zone:copy(z),config:copy(config)};
    const s={id,frozen,status:'waiting',lastProcessedStart:last.timestamp,lastBarSignature:signature(last),lastClose:last.close,lastBarEnd:last.endDate};state.setups.push(s);event(state,s,'REGISTERED',now,frozen,hash);
   }
  }
  for(const s of state.setups.filter(active))if(!Object.values(sources.prices||{}).some(p=>p.h4?.status==='ready'&&p.h4.symbol===s.frozen.symbol))state.diagnostics.push({key:s.frozen.key,reason:'SOURCE_UNAVAILABLE'});
  return state;
 }
 function summary(setups){const closed=setups.filter(s=>['tp','sl'].includes(s.status)).sort((a,b)=>a.resolvedAt.localeCompare(b.resolvedAt)||a.netR-b.netR||a.id.localeCompare(b.id));let equity=0,peak=0,drawdown=0;for(const s of closed){equity+=s.netR;peak=Math.max(peak,equity);drawdown=Math.max(drawdown,peak-equity);}return {closed:closed.length,tp:closed.filter(s=>s.status==='tp').length,sl:closed.filter(s=>s.status==='sl').length,winRate:closed.length?closed.filter(s=>s.status==='tp').length/closed.length*100:null,netR:equity,meanR:closed.length?equity/closed.length:null,drawdownR:drawdown,ambiguous:setups.filter(s=>s.status==='ambiguous').length,waiting:setups.filter(s=>s.status==='waiting').length,open:setups.filter(s=>s.status==='open').length,needsData:setups.filter(s=>s.status==='needs_data').length};}
 return {model,config,active,terminal,adjacent,plan,empty,update,summary};
});
