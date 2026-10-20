(()=>{
 const root=document.getElementById('strategy-lab');if(!root)return;
 const by=id=>document.getElementById(id),el=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=String(text);return n;},fmt=v=>Number.isFinite(v)?new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:3}).format(v):'—',time=t=>new Date(t*1000).toISOString().replace('T',' ').replace('.000Z',' UTC');
 const priceFmt=v=>Number.isFinite(v)?new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:8}).format(v):'—';
 const names={'d1-sfp':'D1 → M15 SFP','refined-sfp':'D1 → H4 → M15 SFP','h4-sfp':'H4 → M15 SFP',ema:'Samostatná H4 EMA'};
 let dataset,worker,report,chart,prepared,selectedTrade,selectedResult;
 const describe=c=>c.model==='ema'?`EMA ${c.fast}/${c.slow} · SL ${c.stopAtr} ATR · TP ${c.rr}R`:`${names[c.model]} · BOS ${c.bos?'povinný':'nepovinný'} · SL ${c.stop==='zone'?'za zónou':'za SFP'} · TP ${c.rr}R`;
 const modal=by('lab-trade-modal');let tradeButton;
 by('lab-modal-close').onclick=()=>modal.close();
 modal.addEventListener('close',()=>{closeDetail();});
 by('lab-trade-back').onclick=()=>{closeDetail();by('lab-trades').hidden=false;modal.scrollTop=0;tradeButton?.focus();};
 function closeDetail(){chart?.destroy();chart=null;selectedTrade=null;by('lab-trade-detail').hidden=true;by('lab-trade-chart').replaceChildren();}
 function draw(){
  chart?.destroy();chart=null;by('lab-trade-chart').replaceChildren();by('lab-chart-ruler').setAttribute('aria-pressed','false');
  try{chart=StrategyTradeChart.create(by('lab-trade-chart'),by('lab-chart-readout'),{prepared,trade:selectedTrade,config:selectedResult.config,resolution:by('lab-chart-timeframe').value});by('lab-chart-readout').textContent='Časy grafu jsou Europe/Prague; audit obchodů zůstává UTC. Najetím na svíčku zobrazíš OHLC.';}catch(e){by('lab-chart-readout').textContent='Graf není dostupný: '+e.message;}
 }
 function detail(t,result){
  tradeButton=document.activeElement;by('lab-trades').hidden=true;
  selectedTrade=t;selectedResult=result;prepared??=StrategyLab.prepare(dataset.instruments.find(x=>x.symbol===report.symbol));
  by('lab-trade-detail').hidden=false;by('lab-detail-title').textContent=`${report.symbol} · ${t.direction===1?'Long':'Short'} · ${time(t.enteredAt)}`;
  by('lab-detail-result').textContent=`Vstup ${priceFmt(t.entry)} · SL ${priceFmt(t.stop)} · TP ${priceFmt(t.target)} · výstup ${priceFmt(t.exit)} (${t.exitReason}), konec svíčky ${time(t.exitedAt)}. Čisté ${fmt(t.netR)} R, náklady ${fmt(t.costR)} R.`;
  const c=result.config,ref=t.reference||{},reasons=by('lab-entry-reasons');reasons.replaceChildren();const add=text=>reasons.append(el('li',text));
  if(c.model==='ema'){
   const j=prepared.h4.findIndex(b=>b.end===t.signalAt),h=prepared.h4[j];
   add(`Samostatná EMA strategie bez zón: H4 EMA ${c.fast}/${c.slow}.`);
   if(h){const f=prepared.emas[c.fast][j],s=prepared.emas[c.slow][j],prev=prepared.emas[c.fast][j-1];add(`Po uzavření H4 v ${time(h.end)} byla rychlá EMA ${priceFmt(f)} ${t.direction===1?'nad':'pod'} pomalou EMA ${priceFmt(s)}. ${t.direction===1?'Low':'High'} ${priceFmt(t.direction===1?h.low:h.high)} dosáhlo předchozí rychlé EMA ${priceFmt(prev)}; směrová svíčka uzavřela na ${priceFmt(h.close)} zpět za rychlou EMA.`);}
   add(`SL je od close signální H4 vzdálen ${c.stopAtr} × H4 ATR(14).`);
  }else{
   const z=prepared.zones.find(x=>x.id===ref.zoneId),parent=prepared.zones.find(x=>x.id===ref.parentId),signal=prepared.data.m15.find(b=>b.end===t.signalAt);
   if(z){add(`${z.timeframe} ${z.type}, hranice včetně knotů ${priceFmt(z.lower)}–${priceFmt(z.upper)}. Zóna potvrzena ${time(z.known)}, tedy před vstupním signálem.`);add(`První platný návrat do zóny a M15 SFP v téže svíčce. Zásah v signální svíčce ${fmt(signal?StrategyLab.penetration(z,signal)*100:null)} %; model vyřazuje zónu už při zásahu ≥ 25 %. BOS ${z.bos.state==='yes'?'potvrzen close':'nepotvrzen'}; v této variantě ${c.bos?'povinný':'nepovinný'}.`);}
   if(parent)add(`Zpřesnění: H4 zóna uvnitř platné D1 ${priceFmt(parent.lower)}–${priceFmt(parent.upper)}; potvrzení D1 ${time(parent.known)}.`);
   add(`M15 swing ${priceFmt(ref.swingPrice)} byl potvrzen ${ref.swingKnownAt}. Knot signálu šel ${t.direction===1?'pod swing low':'nad swing high'} a close ${priceFmt(signal?.close)} zpět ${t.direction===1?'nad':'pod'} swing. Signál znám až ${time(t.signalAt)}.`);
   add(`SL ${c.stop==='zone'?'za vnější hranou zóny':'za knotem SFP'} + buffer ${c.bufferAtr} × M15 ATR(14).`);
  }
  add(`Vstup na open ${time(t.enteredAt)}, ${c.entryLagBars*15} min po uzavření signálu. Původní risk ${priceFmt(t.risk)}; TP ${c.rr}R od skutečného modelového vstupu.`);
  add(`Modelové náklady: spread ${c.spreadBps} bps, komise ${c.commissionBps} bps za celý obchod, skluz ${c.slippageBps} bps na stranu, financování ${c.financingBpsPerDay} bps/den. SL/TP ve stejné svíčce: SL první. Nejde o doložené brokerové plnění.`);
  draw();by('lab-detail-title').focus({preventScroll:true});by('lab-trade-detail').scrollIntoView({block:'start'});
 }
 by('lab-chart-timeframe').onchange=()=>{if(selectedTrade)draw();};
 for(const [id,action]of [['reset',()=>chart?.focus()],['context',()=>chart?.context()],['all',()=>chart?.all()],['in',()=>chart?.zoom(.8)],['out',()=>chart?.zoom(1.25)],['clear',()=>chart?.clear()]])by('lab-chart-'+id).onclick=action;
 by('lab-chart-ruler').onclick=()=>{const b=by('lab-chart-ruler'),value=b.getAttribute('aria-pressed')!=='true';b.setAttribute('aria-pressed',String(value));chart?.setRuler(value);by('lab-chart-readout').textContent=value?'Pravítko: vyber dva body grafu.':'Pravítko vypnuto.';};
 by('lab-chart-image').onclick=()=>{if(chart){const a=el('a');a.href=chart.image();a.download='obchod-'+report.symbol.replace(':','-')+'-'+selectedTrade.enteredAt+'.png';a.click();}};
 function show(result,open=true){
  closeDetail();selectedResult=result;
  by('lab-trades').hidden=false;const body=by('lab-trade-rows');body.replaceChildren();
  by('lab-trade-summary').textContent=describe(result.config)+` · ${result.trades.length} uzavřených, ${result.unresolved.length} nedořešených pozic. SFP: ${result.audit.swingFailures}; platné první dotyky: ${result.audit.zoneReturns}; zneplatnění zón: ${result.audit.zoneInvalidations}. Detaily a časové důkazy jsou v JSON auditu.`;
  for(const t of result.trades){const tr=el('tr');for(const text of [(t.direction===1?'Long':'Short')+' · '+time(t.enteredAt),`${priceFmt(t.entry)} / ${priceFmt(t.stop)} / ${priceFmt(t.target)}`,time(t.exitedAt),t.exitReason,`${fmt(t.netR)} / ${fmt(t.costR)}`])tr.append(el('td',text));const cell=el('td'),button=el('button','Graf a důvody');button.type='button';button.onclick=()=>detail(t,result);cell.append(button);tr.append(cell);body.append(tr);}
  if(!result.trades.length){const tr=el('tr'),td=el('td','Žádný uzavřený obchod. To není důkaz nulového rizika ani funkční strategie.');td.colSpan=6;tr.append(td);body.append(tr);}
  if(open){by('lab-modal-title').textContent='Obchody · '+report.symbol;if(!modal.open)modal.showModal();modal.scrollTop=0;by('lab-modal-close').focus();}
 }
 function showReport(){
  const body=by('lab-results');body.replaceChildren();
  const rows=[...report.results].sort((a,b)=>(b.metrics.meanR??-Infinity)-(a.metrics.meanR??-Infinity));
  for(const r of rows){const tr=el('tr');tr.append(el('td',describe(r.config)));for(const v of [r.metrics.trades,fmt(r.metrics.totalR),fmt(r.metrics.meanR),fmt(r.metrics.profitFactor),fmt(r.metrics.maxDrawdownR),fmt(r.stressMetrics.totalR)])tr.append(el('td',v));const action=el('td'),button=el('button','Obchody');button.type='button';button.onclick=()=>show(r);action.append(button);tr.append(action);body.append(tr);}
  by('lab-report-context').textContent=`${report.symbol} · ${report.first} až ${report.last} · ${names[report.results[0].config.model]} / rodina ${report.family==='zones'?'supply/demand':'EMA'}. Čisté R = po zadaných modelových nákladech. Řazeno podle průměru R na pilotu, nikoli podle ověřené robustnosti. ŽÁDNÝ VÍTĚZ PRO LIVE. SHA-256 M15: ${report.rawSha256}`;
  if(rows.length)show(rows[0],false);by('lab-export').disabled=false;
 }
 by('lab-run').onclick=()=>{
  worker?.terminate();if(modal.open)modal.close();closeDetail();prepared=null;by('lab-export').disabled=true;by('lab-trades').hidden=true;by('lab-results').replaceChildren();report=null;by('lab-report-context').textContent='';
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
