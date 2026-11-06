(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TradeZoneViewState=api;})(typeof globalThis==='object'?globalThis:this,()=>{
 'use strict';
 const day=t=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague'}).format(new Date(t));
 function context(snapshot,opportunities,exportedAt){
  const unavailable={available:false,asOf:null};
  if(!opportunities||!Array.isArray(opportunities.assets)||!Number.isFinite(Date.parse(exportedAt))||opportunities.exportedAt!==exportedAt)return unavailable;
  const sameDay=opportunities.asOf===snapshot.asOf;
  const independent=opportunities.asOf===day(exportedAt)&&snapshot.asOf<=opportunities.asOf;
  return sameDay||independent?{available:true,asOf:opportunities.asOf}:unavailable;
 }
 function freshness(snapshot,timeframe='all',keys=null,now=Date.now()){
  const parts=[],warnings=[],allowed=keys&&new Set(keys),prices=Object.entries(snapshot.prices).filter(([key])=>!allowed||allowed.has(key));
  if(timeframe!=='H4'){
   parts.push(`D1/W1 snapshot ${snapshot.asOf}`);
   if(Date.parse(day(now))-Date.parse(snapshot.asOf)>4*86400000)warnings.push('D1/W1 snapshot je starší');
  }
  if(timeframe==='all'||timeframe==='H4'){
   const dates=prices.filter(([,p])=>p.h4?.status==='ready').map(([,p])=>p.h4.latestDate).filter(t=>Number.isFinite(Date.parse(t))).sort((a,b)=>Date.parse(a)-Date.parse(b));
   if(dates.length){
    const format=t=>new Intl.DateTimeFormat('cs-CZ',{timeZone:'Europe/Prague',dateStyle:'short',timeStyle:'short'}).format(new Date(t));
    parts.push(`H4 poslední začátky svíček ${format(dates[0])}${dates[0]===dates.at(-1)?'':' – '+format(dates.at(-1))} · Praha`);
    const weekend=[0,1,6].includes(new Date(now).getUTCDay()),limit=(weekend?72:12)*3600000;
    if(now-Date.parse(dates[0])>limit)warnings.push('Některé H4 řady jsou starší; zkontroluj poslední svíčku vybraného trhu');
   }else{parts.push('H4 bez dostupných svíček');warnings.push('H4 data nejsou dostupná');}
  }
  return {label:parts.join(' · '),stale:warnings.length>0,warning:warnings.join('. ')};
 }
 return {context,freshness};
});
