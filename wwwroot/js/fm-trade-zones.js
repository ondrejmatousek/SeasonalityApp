(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./fm-order-blocks.js'),require('./trade-zones.js'));else root.FmTradeZones=factory(root.FmOrderBlocks,root.TradeZones);})(typeof globalThis==='object'?globalThis:this,(FM,T)=>{
 'use strict';
 const seconds=s=>Date.parse(s.includes('T')?s:s+'T00:00:00Z')/1000,iso=t=>new Date(t*1000).toISOString();
 const policy='fm-nearest-pair-v1';
 // Quality is descriptive only. Equal distance uses recency then stable ID.
 function compare(a,b){return a.distancePct-b.distancePct||b.confirmedAt.localeCompare(a.confirmedAt)||a.id.localeCompare(b.id);}
 function nearest(zones){return ['supply','demand'].flatMap(side=>[...zones].filter(z=>z.type===side&&z.fm.fresh&&z.fm.armed&&Number.isFinite(z.distancePct)).sort(compare).slice(0,1));}
 function detect(price,tf,asOf,volumeOptions={}){
  const source=T.sourceBars(price,tf,asOf);if(!source.length)return [];
  // D1/W1 use the existing date-labelled, completed provider snapshot; their
  // nominal UTC day/week ends are not claimed to be exchange session timestamps.
  const bars=source.map(b=>({t:tf==='H4'?b.timestamp:seconds(b.date),end:tf==='H4'?seconds(b.endDate):seconds(b.date)+(tf==='W1'?604800:86400),open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume}));
  const symbol=price.symbol.includes(':')?price.symbol:price.provider+':'+price.symbol,result=FM.run({symbol,timeframe:tf,asOf:Math.floor(seconds(asOf)),bars});
  const last=bars.at(-1).close,c=T.settings(volumeOptions);
  const zones=result.zones.filter(z=>z.fresh&&z.armed).map(z=>{
   const direction=z.type==='demand'?1:-1,bos=result.events.findLast(e=>e.kind==='BOS'&&e.scale==='swing'&&e.direction===direction&&e.barTime>=z.originTime&&e.knownAt<=z.confirmedAt),volume=T.volumeAt(source,z.startIdx,z.startIdx,c);
   const distance=Math.max(z.bot-last,last-z.top,0),depth=Math.max(0,(z.type==='demand'?z.top-z.extreme:z.extreme-z.bot)/(z.top-z.bot));let visits=0,inside=false;
   for(const b of bars.filter(b=>b.t>=z.armedAt)){const touch=b.high>=z.bot&&b.low<=z.top;if(touch&&!inside)visits++;inside=touch;}
   return {id:tf+'|'+z.id,timeframe:tf,type:z.type,kind:'origin',kinds:['origin'],chartLabel:`${tf} ${z.type}\n${bos?'BOS':'bez BOS'} · ${z.displacementRatio.toFixed(2).replace('.',',')} ATR`,lower:z.bot,upper:z.top,baseDate:tf==='H4'?iso(z.originTime):iso(z.originTime).slice(0,10),baseEnd:iso(z.base.end),confirmedAt:iso(z.confirmedAt),atr:z.atr,impulseAtr:z.displacementRatio,departureCount:z.confirmIndex-z.startIdx,
    bos:bos?{state:'yes',price:bos.level.price,date:iso(bos.level.t),knownAt:iso(bos.knownAt)}:{state:'no'},volume,session:{state:'unknown'},qualityPoints:(bos?2:0)+(volume.state==='high'?1:0),knownCriteria:1+Number(volume.state!=='unknown'),visits,maxPenetration:depth,fresh:true,distancePct:T.distancePercent(last,z.bot,z.top),distanceAtr:distance/z.atr,priceState:distance===0?'inside':distance<=z.atr*.5?'near':'far',selectionPolicy:policy,fm:z};
  });
  return nearest(zones);
 }
 return {policy,compare,nearest,detect};
});
