(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./h4-paper.js'),require('./trade-zones.js'),require('./backtest-sha256.js'));else root.H4Backtest=factory(root.H4Paper,root.TradeZones,root.BacktestSha256);})(typeof globalThis==='object'?globalThis:this,(E,T,hash)=>{
 'use strict';
 const version='fm-h4-historical-replay-v1',warmup=200,iso=t=>new Date(t*1000).toISOString();
 function run({snapshot,path,sha256,keys,from=null,to=null},progress=()=>{}){
  if(!snapshot?.prices||!Array.isArray(keys)||!keys.length||new Set(keys).size!==keys.length||typeof path!=='string'||!/^[a-f0-9]{64}$/.test(sha256))throw Error('Invalid backtest source/selection');
  const boundary=(s,end)=>{if(s===null)return end?Infinity:-Infinity;if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw Error('Invalid UTC date');return Date.parse(s+'T00:00:00Z')/1000+(end?86400-0.001:0);};
  const fromSec=boundary(from,false),toSec=boundary(to,true);if(fromSec>toSec)throw Error('Začátek musí být před koncem testu.');
  const report={schemaVersion:1,version,model:E.model,config:JSON.parse(JSON.stringify(E.config)),source:{path,sha256,asOf:snapshot.asOf},selection:{keys:[...keys],from,to,warmup},coverage:[],setups:[],events:[]};
  for(const [keyIndex,key]of keys.entries()){
   const h=snapshot.prices[key]?.h4;if(h?.status!=='ready'||h.provider!=='OANDA')throw Error('OANDA H4 nedostupné: '+key);
   const bars=T.sourceBars(h,'H4',h.asOfUtc).filter(b=>Date.parse(b.endDate)/1000<=toSec),expected=h.bars.filter(b=>Date.parse(b.endDate)<=Date.parse(h.asOfUtc)&&Date.parse(b.endDate)/1000<=toSec);
   if(bars.length!==expected.length)throw Error('Neplatné H4 OHLC nelze tiše vyřadit: '+key);
   const segments=[];for(const b of bars){if(!segments.length||!E.adjacent(segments.at(-1).at(-1).timestamp,b.timestamp))segments.push([]);segments.at(-1).push(b);}
   const coverage={key,symbol:h.symbol,availableBars:bars.length,first:bars[0]?.date??null,last:bars.at(-1)?.endDate??null,segments:[],gaps:[]};report.coverage.push(coverage);
   for(let si=0;si<segments.length;si++){
    const segment=segments[si],firstIndex=Math.max(warmup-1,segment.findIndex(b=>Date.parse(b.endDate)/1000>=fromSec));
    const usable=segment.length>=warmup&&Date.parse(segment.at(-1).endDate)/1000>=fromSec;
    const info={index:si,first:segment[0].date,last:segment.at(-1).endDate,bars:segment.length,warmup:Math.min(warmup,segment.length),firstRegistrationCheck:usable?segment[firstIndex].endDate:null,checks:0,unresolved:0};coverage.segments.push(info);
    if(si)coverage.gaps.push({previousEnd:segments[si-1].at(-1).endDate,nextStart:segment[0].date});
    if(!usable)continue;let state=null;
    for(let i=firstIndex;i<segment.length;i++){
     const prefix=segment.slice(0,i+1),last=prefix.at(-1),now=last.endDate;
     const price={status:'ready',provider:h.provider,symbol:h.symbol,timeframe:'H4',validation:h.validation,bars:prefix,asOfUtc:now,latestClose:last.close,latestDate:last.date};
     state=E.update(state,{asOf:now,revision:sha256,path,prices:{[key]:{h4:price}}},now,hash);info.checks++;
     if(i%25===0||i===segment.length-1)progress({key,keyIndex,totalKeys:keys.length,segment:si+1,segments:segments.length,bar:i+1,bars:segment.length});
    }
    for(const setup of state.setups){setup.backtestSegment=si;setup.backtestEndReason=E.active(setup)?(si<segments.length-1?'HISTORY_GAP':'END_OF_TEST'):null;if(E.active(setup)){info.unresolved++;if(si<segments.length-1){setup.resumeState=setup.status;setup.status='needs_data';setup.reason='HISTORY_GAP';}}report.setups.push(setup);}
    report.events.push(...state.events.map(e=>({...e,backtestKey:key,backtestSegment:si})));
   }
  }
  report.summary=E.summary(report.setups);const resolved=report.setups.filter(s=>['tp','sl'].includes(s.status)),gains=resolved.reduce((n,s)=>n+Math.max(0,s.netR),0),losses=resolved.reduce((n,s)=>n+Math.max(0,-s.netR),0);
  report.summary.profitFactor=losses>0?gains/losses:null;report.summary.netRDoubleCosts=resolved.reduce((n,s)=>n+s.grossR-2*s.costR,0);
  return report;
 }
 return {version,warmup,run};
});
