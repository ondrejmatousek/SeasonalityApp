(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TradeZoneTable=api;})(typeof window==='undefined'?globalThis:window,()=>{
 'use strict';
 const defaults={instrument:'asc',newest:'desc',distance:'asc',quality:'desc',seasonal:'asc',cot:'asc'};
 const labels={instrument:'instrument',newest:'potvrzení zóny',distance:'vzdálenost ceny od zóny (%)',quality:'body kvality',seasonal:'sezónní kontext',cot:'COT kontext'};
 const states={supports:0,confirms:0,neutral:1,against:2};
 const identity=r=>r.key+'|'+r.zone.timeframe+'|'+r.zone.id;
 function value(r,key){
  if(key==='instrument')return r.key;
  if(key==='newest'){const t=Date.parse(r.zone.confirmedAt);return Number.isFinite(t)?t:null;}
  if(key==='distance')return Number.isFinite(r.distancePct)?r.distancePct:null;
  if(key==='quality')return Number.isFinite(r.zone.qualityPoints)?r.zone.qualityPoints:null;
  if(key==='seasonal'||key==='cot')return states[r.context[key]]??null;
  return null;
 }
 function sort(rows,key='distance',direction=defaults[key]){
  const sign=direction==='desc'?-1:1;
  return [...rows].sort((a,b)=>{
   const x=value(a,key),y=value(b,key);
   if(x==null||y==null){if(x!=null)return -1;if(y!=null)return 1;}
   else{const n=typeof x==='string'?x.localeCompare(y,'cs'):x-y;if(n)return n*sign;}
   return identity(a).localeCompare(identity(b));
  });
 }
 function paginate(rows,page=1,size=20){
  const count=size==='all'?Math.max(1,rows.length):Math.max(1,Number(size)||20),pages=Math.max(1,Math.ceil(rows.length/count));
  page=Math.max(1,Math.min(pages,page));const start=(page-1)*count;
  return {page,pages,total:rows.length,start:rows.length?start+1:0,end:Math.min(start+count,rows.length),rows:rows.slice(start,start+count)};
 }
 return {defaults,labels,sort,paginate};
});
