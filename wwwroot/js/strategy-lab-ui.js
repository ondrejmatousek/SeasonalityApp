(()=>{
 const root=document.getElementById('strategy-lab');if(!root)return;
 const by=id=>document.getElementById(id),el=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=String(text);return n;},fmt=v=>Number.isFinite(v)?new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:3}).format(v):'—',time=t=>new Date(t*1000).toISOString().replace('T',' ').replace('.000Z',' UTC');
 const priceFmt=v=>Number.isFinite(v)?new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:8}).format(v):'—';
 const names={'d1-sfp':'D1 → M15 SFP','refined-sfp':'D1 → H4 → M15 SFP','h4-sfp':'H4 → M15 SFP',ema:'Samostatná H4 EMA'};
 let dataset,worker,report;
 const describe=c=>c.model==='ema'?`EMA ${c.fast}/${c.slow} · SL ${c.stopAtr} ATR · TP ${c.rr}R`:`${names[c.model]} · BOS ${c.bos?'povinný':'nepovinný'} · SL ${c.stop==='zone'?'za zónou':'za SFP'} · TP ${c.rr}R`;
 function show(result){
  by('lab-trades').hidden=false;const body=by('lab-trade-rows');body.replaceChildren();
  by('lab-trade-summary').textContent=describe(result.config)+` · ${result.trades.length} uzavřených, ${result.unresolved.length} nedořešených pozic. SFP: ${result.audit.swingFailures}; platné první dotyky: ${result.audit.zoneReturns}; zneplatnění zón: ${result.audit.zoneInvalidations}. Detaily a časové důkazy jsou v JSON auditu.`;
  for(const t of result.trades.slice(0,100)){const tr=el('tr');for(const text of [(t.direction===1?'Long':'Short')+' · '+time(t.enteredAt),`${priceFmt(t.entry)} / ${priceFmt(t.stop)} / ${priceFmt(t.target)}`,time(t.exitedAt),t.exitReason,`${fmt(t.netR)} / ${fmt(t.costR)}`])tr.append(el('td',text));body.append(tr);}
  if(!result.trades.length){const tr=el('tr'),td=el('td','Žádný uzavřený obchod. To není důkaz nulového rizika ani funkční strategie.');td.colSpan=5;tr.append(td);body.append(tr);}
 }
 function showReport(){
  const body=by('lab-results');body.replaceChildren();
  const rows=[...report.results].sort((a,b)=>(b.metrics.meanR??-Infinity)-(a.metrics.meanR??-Infinity));
  for(const r of rows){const tr=el('tr');tr.append(el('td',describe(r.config)));for(const v of [r.metrics.trades,fmt(r.metrics.totalR),fmt(r.metrics.meanR),fmt(r.metrics.profitFactor),fmt(r.metrics.maxDrawdownR),fmt(r.stressMetrics.totalR)])tr.append(el('td',v));const action=el('td'),button=el('button','Obchody');button.type='button';button.onclick=()=>show(r);action.append(button);tr.append(action);body.append(tr);}
  by('lab-report-context').textContent=`${report.symbol} · ${report.first} až ${report.last} · ${names[report.results[0].config.model]} / rodina ${report.family==='zones'?'supply/demand':'EMA'}. Čisté R = po zadaných modelových nákladech. Řazeno podle průměru R na pilotu, nikoli podle ověřené robustnosti. ŽÁDNÝ VÍTĚZ PRO LIVE. SHA-256 M15: ${report.rawSha256}`;
  if(rows.length)show(rows[0]);by('lab-export').disabled=false;
 }
 by('lab-run').onclick=()=>{
  worker?.terminate();by('lab-export').disabled=true;by('lab-trades').hidden=true;by('lab-results').replaceChildren();report=null;by('lab-report-context').textContent='';
  try{
   const costs={spreadBps:Number(by('lab-spread').value),commissionBps:Number(by('lab-commission').value),slippageBps:Number(by('lab-slippage').value),financingBpsPerDay:Number(by('lab-financing').value),entryLagBars:Number(by('lab-delay').value)};
   if(Object.values(costs).some(v=>!Number.isFinite(v)||v<0||v>50))throw Error('Náklady musí být čísla od 0 do 50 bps.');
   worker=new Worker('/js/strategy-lab-worker.js?v='+encodeURIComponent(StrategyLab.version));by('lab-run').disabled=true;by('lab-status').textContent='Připravuji chronologickou simulaci…';
   worker.onmessage=({data})=>{if(data.error){by('lab-status').textContent='Výpočet selhal: '+data.error;by('lab-run').disabled=false;worker.terminate();return;}if(data.done){report=data.report;showReport();by('lab-status').textContent=`Dokončeno ${report.results.length} variant + stresové náklady. Výsledek je pouze diagnostický pilot; žádná automatická aktivace.`;by('lab-run').disabled=false;worker.terminate();}else by('lab-status').textContent=`Počítám ${data.progress} / ${data.total} variant…`;};
   worker.onerror=()=>{by('lab-status').textContent='Výpočet není dostupný; obnov stránku a zkus jej znovu.';by('lab-run').disabled=false;worker.terminate();};
   worker.postMessage({instrument:dataset.instruments.find(x=>x.symbol===by('lab-symbol').value),family:by('lab-family').value,costs,provenance:{sourceSnapshotSha256:dataset.sourceSnapshotSha256,engineSha256:dataset.engineSha256,detectorSha256:dataset.detectorSha256,builtAt:dataset.builtAt}});
  }catch(e){by('lab-status').textContent=e.message;by('lab-run').disabled=false;}
 };
 by('lab-export').onclick=()=>{if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),a=el('a');a.href=url;a.download='strategy-lab-'+report.symbol.replace(':','-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 (async()=>{try{const r=await fetch('/research/strategy-lab-pilot.json',{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);dataset=await r.json();if(dataset.schemaVersion!==1||dataset.selectionEligible!==false||!dataset.instruments?.length)throw Error('Nepodporovaná nebo chybějící výzkumná data.');for(const x of dataset.instruments){const o=el('option',x.symbol.replace('OANDA:','')+` · ${x.m15.length} M15`);o.value=x.symbol;by('lab-symbol').append(o);}by('lab-data-state').textContent=dataset.warning+' Data: '+dataset.instruments.map(x=>x.symbol+' '+x.first.slice(0,10)+'–'+x.last.slice(0,10)).join('; ')+'. U každého páru '+dataset.instruments[0].excluded+' neověřených/nepokrytých svíček vyřazeno.';by('lab-run').disabled=false;}catch(e){by('lab-data-state').textContent='Pilotní data nejsou dostupná: '+e.message;}})();
})();
