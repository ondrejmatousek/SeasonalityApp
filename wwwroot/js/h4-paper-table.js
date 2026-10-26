(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.H4PaperTable=factory();})(typeof globalThis==='object'?globalThis:this,()=>{
 'use strict';
 const labels=Object.freeze({waiting:'Čeká na dotyk',open:'Otevřený model',needs_data:'Čeká na data',tp:'TP',sl:'SL',ambiguous:'Nejednoznačné',cancelled:'OCO zrušeno'});
 const collator=new Intl.Collator('cs',{numeric:true,sensitivity:'base'}),numeric=x=>Number.isFinite(x)?x:null,text=x=>typeof x==='string'&&x.length?x:null,date=x=>typeof x==='string'?numeric(Date.parse(x)):null;
 const columns=Object.freeze({registered:s=>date(s.frozen?.registeredAt),instrument:s=>text(s.frozen?.key),side:s=>text(s.frozen?.side),quality:s=>numeric(s.frozen?.zone?.qualityPoints),entry:s=>numeric(s.frozen?.entry),sl:s=>numeric(s.frozen?.sl),tp:s=>numeric(s.frozen?.tp),close:s=>numeric(s.lastClose),gross:s=>numeric(s.grossR),net:s=>numeric(s.netR),status:s=>text(labels[s.status]),resolved:s=>date(s.resolvedAt)});
 function defaultDirection(key){return ['registered','resolved','quality','gross','net'].includes(key)?'desc':'asc';}
 function sort(rows,key='registered',direction='desc'){
  if(!Object.hasOwn(columns,key)||!['asc','desc'].includes(direction))throw Error('Invalid paper table ordering');
  const sign=direction==='asc'?1:-1;
  return [...rows].sort((a,b)=>{
   const av=columns[key](a),bv=columns[key](b);
   // Unknown values stay last in BOTH directions. Never parse rendered Czech prices.
   if(av===null&&bv!==null)return 1;if(av!==null&&bv===null)return -1;
   const primary=av===null?0:typeof av==='number'?av-bv:collator.compare(av,bv);
   return sign*primary||collator.compare(a.frozen?.key||'',b.frozen?.key||'')||collator.compare(a.frozen?.side||'',b.frozen?.side||'')||String(a.id??'').localeCompare(String(b.id??''));
  });
 }
 return {labels,columns,defaultDirection,sort};
});
