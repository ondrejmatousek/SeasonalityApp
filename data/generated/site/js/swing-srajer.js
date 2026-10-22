(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./fm-trade-zones.js'));else root.SwingSrajer=factory(root.FmTradeZones);})(typeof globalThis==='object'?globalThis:this,FM=>{
 'use strict';
 const version='srajer-checklist-working-v1',ms=86400000,date=t=>new Date(t).toISOString().slice(0,10),day=s=>Date.parse(s.slice(0,10)+'T00:00:00Z');
 const unknown=note=>({state:'unknown',note});
 function options(o={}){const c={days:30,bufferPct:5,...o};if(!Number.isInteger(c.days)||c.days<1||c.days>120||!Number.isFinite(c.bufferPct)||c.bufferPct<.1||c.bufferPct>50)throw Error('Horizont musí být 1–120 celých dnů a buffer 0,1–50 %.');return c;}
 function pair(weekly,daily,close){
  return ['demand','supply'].flatMap(type=>{
   const w=weekly.filter(z=>z.type===type&&(type==='demand'?z.lower<=close:z.upper>=close)).sort(FM.compare)[0];if(!w)return [];
   const d=daily.filter(z=>z.type===type&&z.lower>=w.lower&&z.upper<=w.upper&&z.baseDate>=w.baseDate).sort(FM.compare)[0]||null;
   return [{weekly:w,daily:d,opposite:weekly.filter(z=>z.type!==type&&(type==='demand'?z.lower>close:z.upper<close)).sort(FM.compare)[0]||null}];
  });
 }
 function scan(snapshot,o={},revision=''){
  const config=options(o),rows=[],errors=[];let scanned=0;
  for(const [key,price]of Object.entries(snapshot.prices||{})){if(price.status!=='ready')continue;
   try{const weekly=FM.detectAll(price,'W1',snapshot.asOf),daily=FM.detectAll(price,'D1',snapshot.asOf);scanned++;
    for(const p of pair(weekly,daily,price.latestClose))rows.push({key,price,...p,snapshotRevision:revision,knownAt:p.daily?[p.weekly.confirmedAt,p.daily.confirmedAt].sort().at(-1):p.weekly.confirmedAt,id:JSON.stringify([version,snapshot.asOf,revision,price.provider,price.symbol,key,p.weekly.id,p.weekly.lower,p.weekly.upper,p.daily?.id,p.daily?.lower,p.daily?.upper,price.latestClose,price.bars.at(-1)?.date,config]),asOf:snapshot.asOf,config,seasonality:unknown('Otevři detail pro načtení 5/10/15leté historie stejného zdroje.')});
   }catch(e){errors.push({key,error:e.message});}
  }
  rows.sort((a,b)=>(a.daily||a.weekly).distancePct-(b.daily||b.weekly).distancePct||a.key.localeCompare(b.key)||a.weekly.type.localeCompare(b.weekly.type));return {version,config,rows,errors,scanned};
 }
 function seasonality(prices,asOf,type,days=30){
  options({days});if(!['demand','supply'].includes(type))throw Error('Neplatný směr.');
  const as=day(asOf),rows=prices.filter(p=>/^\d{4}-\d{2}-\d{2}$/.test(p.date)&&Number.isFinite(p.close)&&p.close>0&&day(p.date)<as).sort((a,b)=>a.date.localeCompare(b.date));
  if(new Set(rows.map(p=>p.date)).size!==rows.length)return unknown('Duplicitní datum cenové historie.');
  const year=new Date(as).getUTCFullYear(),month=new Date(as).getUTCMonth(),dom=new Date(as).getUTCDate(),sign=type==='demand'?1:-1;
  const nearest=t=>{let lo=0,hi=rows.length;while(lo<hi){const m=(lo+hi)>>1;if(day(rows[m].date)<t)lo=m+1;else hi=m;}return [rows[lo-1],rows[lo]].filter(p=>p&&Math.abs(day(p.date)-t)<=3*ms).sort((a,b)=>Math.abs(day(a.date)-t)-Math.abs(day(b.date)-t)||a.date.localeCompare(b.date))[0];};
  const samples=[];
  for(let n=1;n<=15;n++){const start=Date.UTC(year-n,month,dom);if(new Date(start).getUTCMonth()!==month){samples.push(null);continue;}const end=start+days*ms,a=nearest(start),b=nearest(end);samples.push(a&&b&&b.date>a.date?{year:year-n,start:a.date,end:b.date,returnPct:(b.close/a.close-1)*100}:null);}
  const windows=[5,10,15].map(years=>{const sample=samples.slice(0,years).filter(Boolean),aligned=sample.filter(p=>p.returnPct*sign>0).length,sorted=sample.map(p=>p.returnPct).sort((a,b)=>a-b),i=sorted.length>>1;return {years,count:sample.length,aligned,alignedPct:sample.length?aligned/sample.length*100:null,medianPct:sample.length?(sorted.length%2?sorted[i]:(sorted[i-1]+sorted[i])/2):null,state:sample.length!==years?'unknown':aligned>years/2?'yes':aligned<years/2?'no':'mixed',samples:sample};});
  return {state:windows.every(w=>w.state==='yes')?'yes':windows.every(w=>w.state==='no')?'no':windows.some(w=>w.state==='unknown')?'unknown':'mixed',start:date(as),end:date(as+days*ms),windows,note:'5/10/15 let samostatně; konce ±3 kalendářní dny. Pracovní většina let ve směru, bez optimalizace okna. Minulé výnosy nejsou vstupní signál.'};
 }
 function plan(row){const d=row.daily,w=row.opposite;if(!d)return unknown('Chybí vnořená D1 zóna.');if(!w)return unknown('Chybí platná protější W1 zóna pro minimální TP.');const long=d.type==='demand',entry=long?d.upper:d.lower,buffer=(d.upper-d.lower)*row.config.bufferPct/100,sl=long?d.lower-buffer:d.upper+buffer,tp=long?w.lower:w.upper,risk=Math.abs(entry-sl),reward=(tp-entry)*(long?1:-1);if(!(risk>0&&reward>0&&sl>0))return unknown('Protější zóna není vhodným cílem vzhledem ke vstupu.');return {state:'draft',entry,sl,tp,rr:reward/risk,note:'Návrh limitního vstupu na D1 hraně; není aktivní příkaz ani obchod. SL buffer je pracovní parametr, brokerové náklady/tick/financování nejsou modelované.'};}
 function evaluate(row,review={}){
  const step=(title,state,note)=>({title,state,note}),p=plan(row),text=v=>typeof v==='string'&&v.trim().length>=3,known=s=>['yes','no'].includes(s),sign=row.weekly.type==='demand'?1:-1;
  const vol=known(review.volume)&&text(review.volumeSource)?review.volume:'unknown';
  const score=typeof review.macro==='string'&&review.macro.trim()!==''?Number(review.macro):NaN,macro=Number.isFinite(score)&&Math.abs(score)<=11&&text(review.macroSource)?score*sign>0?'yes':'no':'unknown';
  const cotValues=['large','retail','oi','both'].map(k=>review[k]),cot=!text(review.cotSource)?'unknown':cotValues.some(s=>s==='no')?'no':cotValues.every(s=>s==='yes')?'yes':'unknown';
  const steps=[step('1 · Weekly supply / demand','yes','První fresh '+row.weekly.type+' na správné straně ceny; pracovní FM detektor.'),step('2 · Daily upřesnění',row.daily?'yes':'unknown',row.daily?'Celá D1 zóna uvnitř W1, původ ne dříve než W1. Kombinace známá až po potvrzení obou: '+row.knownAt: 'Čeká se na platnou vnořenou D1. Zatím ne vstup.'),step('3 · Futures volume profil',vol,vol==='unknown'?'Chybí ruční doložení skutečného futures profilu. Spot/CFD tick volume nepoužíváme.':'Ruční kontrola: '+review.volumeSource),step('4 · Makro',macro,macro==='unknown'?'Chybí skóre obou měn z externího makro zdroje.':'Ručně doložené skóre '+score+'; '+review.macroSource),step('5 · COT velcí / retail / OI / obě strany',cot,cot==='unknown'?'Chybí úplné ruční potvrzení COT checklistu.':'Ruční kontrola: '+review.cotSource),step('6 · Sezonalita',row.seasonality.state,row.seasonality.note),step('7 · Plán obchodu',p.state==='draft'&&review.planReviewed===true?'yes':'unknown',p.state==='draft'?'Pracovní vstup / SL / TP existují; vyžaduje kontrolu brokera, nákladů a Fibonacci.':p.note)];
  if(!row.opposite){steps[0].state='unknown';steps[0].note='Nalezena W1 '+row.weekly.type+', ale chybí platná protější W1. Oba weekly checkboxy z obrázku proto nejsou potvrzené.';}
  const blocked=vol==='no'||macro==='no'||(macro==='no'&&cot==='no'&&row.seasonality.state==='no'),confirmed=steps.every(s=>s.state==='yes');
  return {steps,plan:p,confirmed,verdict:blocked?'Neotevírat · objem nebo makro nesedí':confirmed?'Checklist potvrzen · část bodů ručně, nikoli automatický signál':'Kandidát · část potvrzení chybí',blocked};
 }
 return {version,options,pair,scan,seasonality,plan,evaluate};
});
