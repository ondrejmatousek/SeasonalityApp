(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./fm-order-blocks.js'));else root.FmOutlookSource=factory(root.FmOrderBlocks);})(typeof globalThis==='object'?globalThis:this,FM=>{
 'use strict';
 function build(snapshot,{path,sha256,now=Date.now()}={}){
  if(!snapshot.h4||snapshot.h4.source!=='Azure SQL market_h4'||snapshot.h4.validationRule!=='h4-d1-parity-v1')throw Error('Chybí ověřený SQL H4 zdroj.');
  const instruments=[];
  for(const price of Object.values(snapshot.prices||{})){
   const h=price.h4;if(h?.status!=='ready')continue;
   if(h.provider!=='OANDA'||!/^OANDA:[A-Z]{6}$/.test(h.symbol)||h.symbol!==price.symbol||!['h4-d1-parity-v1','zone-provider-boundary-v1'].includes(h.validation))throw Error('Neplatná identita H4 zdroje.');
   const asOf=Math.floor(Date.parse(h.asOfUtc)/1000);if(!Number.isSafeInteger(asOf)||asOf>Math.floor(now/1000)+60)throw Error('Neplatný čas H4 snímku.');
   const bars=h.bars.map(b=>({t:b.timestamp,end:Date.parse(b.endDate)/1000,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume}));
   FM.validate(bars);if(bars.length<96||bars.some(b=>b.end-b.t!==14400||b.end>asOf))throw Error('Neuzavřená nebo nedostatečná H4 historie.');
   instruments.push({symbol:h.symbol,timeframe:'H4',asOf,bars,lastClosedAt:bars.at(-1).end,validation:h.validation,sourceBatchId:h.sourceBatchId??null});
  }
  if(!instruments.length||new Set(instruments.map(i=>i.symbol)).size!==instruments.length)throw Error('Chybí jednoznačné H4 instrumenty.');
  instruments.sort((a,b)=>a.symbol.localeCompare(b.symbol));
  return {schemaVersion:1,mode:'sql-h4',asOf:Math.max(...instruments.map(i=>i.asOf)),sourceSnapshotPath:path,sourceSnapshotSha256:sha256,completionPolicy:'SQL historical parity/provider-boundary validation; closed H4 only. No independent exchange-calendar certification.',assumptions:['Stejný FM algoritmus jako v obchodních zónách. Výchozí Pine parametry; ATR závisí na začátku načtené historie.','Aktualizace po přijetí a úspěšné publikaci SQL H4 dat; nikoli živá ticková kotace.'],instruments,references:[]};
 }
 return {build};
});
