(()=>{
 'use strict';if(!document.getElementById('paper-research'))return;
 const by=id=>document.getElementById('research-'+id),el=(tag,t)=>{const n=document.createElement(tag);if(t!=null)n.textContent=String(t);return n;},num=n=>Number.isFinite(n)?new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:3}).format(n):'—';
 let report,busy=false,seenCheckpoints=0;
 function render(){
  const scope=by('scope').value,rows=report[scope]||[];by('rows').replaceChildren();
  for(const r of rows){const tr=el('tr');tr.dataset.researchVariant=r.id;let evidence=r.n<report.plan.minGroup||r.entryDays<report.plan.minDays?'Málo dat':'Průběžný výsledek, ne ověřená výhoda';
   if(r.id==='sfp15'&&report.availability.sfp15?.status==='missing_data')evidence='Pozastaveno: chybí ověřené M15';
   else if(report.availability[r.id]?.status==='missing_data')evidence='Pozastaveno: chybí použitelné H4';
   const fields=[r.label,r.n,num(r.totalR),num(r.meanR),r.noLosses?'Bez ztrát · PF neurčen':num(r.profitFactor),num(r.drawdownR),r.mean95?r.mean95.map(num).join(' až '):'Málo dnů',r.entryDays,num(r.stressMeanR),`${r.pending} / ${r.open} / ${r.needsData} / ${r.ambiguous}`,evidence];
   for(const v of fields)tr.append(el('td',v));by('rows').append(tr);
  }
  if(!rows.length){const tr=el('tr'),td=el('td','Tento vzorek zatím není dostupný.');td.colSpan=11;tr.append(td);by('rows').append(tr);}
 }
 async function load(){if(busy)return;busy=true;let timer;const controller=new AbortController();try{
  const next=await Promise.race([(async()=>{const response=await fetch('/data/h4-paper/research.json',{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error('HTTP '+response.status);return response.json();})(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Časový limit 15 s'));},15000);})]);
  if(!next.ready||next.model!=='fm-h4-research-v1')throw Error('Samostatný výzkum není nyní dostupný');report=next;
  by('status').textContent=`Samostatná SQL revize ${report.researchRevision} · pravidla registrována ${MarketChartTime.format(report.startedAt)} · poslední kontrola ${MarketChartTime.format(report.lastRunAt)}. Původní deník 2R se tím nemění.`;
  by('progress').textContent=`Kontrolní bod: ${report.progress} / ${report.target} nových uzavřených původních obchodů. Historie před registrací se do této stovky nepočítá.`;
  const first=report.checkpoints.find(c=>c.id==='discovery100'),validation=report.checkpoints.find(c=>c.id==='validation100');
  if(report.checkpoints.length>seenCheckpoints){document.getElementById('paper-research').open=true;seenCheckpoints=report.checkpoints.length;}
  by('notice').setAttribute('role',first?'alert':'status');
  by('notice').textContent=validation?`Ověřovací report uložen ${MarketChartTime.format(validation.createdAt)}. ${validation.passed?'Zmrazený kandidát splnil pracovní ověřovací podmínky.':'Kandidát nepotvrzen, nebo nebyl vybrán.'} Žádná automatická aktivace.`:first?`DOSAŽENO 100 · neměnný report uložen ${MarketChartTime.format(first.createdAt)}. ${first.candidateId?'Průzkumný kandidát: '+report.plan.groups.find(g=>g.id===first.candidateId)?.label+'.':'Žádná skupina nesplnila podmínky kandidáta.'} Jde o průzkum, ne vítěze pro live. Další ověření používá až nově registrované obchody.`:'Pravidla jsou předem zmrazená. Zatím nelze vyhlásit nejprofitabilnější ověřenou variantu. Report se vytvoří na serveru i při zavřeném prohlížeči; upozornění se zobrazí zde, nejde o e-mail ani push zprávu.';
  by('export').disabled=false;render();
 }catch(e){by('status').textContent='Výzkum nedostupný: '+e.message+'. Původní papertrading tím není zastaven.'+(report?' Zobrazený výzkum je poslední dříve načtený stav.':'');}finally{clearTimeout(timer);busy=false;}}
 by('scope').onchange=()=>{if(report)render();};by('export').onclick=()=>{if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),a=el('a');a.href=url;a.download=`h4-research-${report.researchRevision}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};load();setInterval(()=>{if(!document.hidden)load();},60000);
})();
