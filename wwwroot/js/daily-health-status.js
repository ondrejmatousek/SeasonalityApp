(function(root){
 'use strict';
 function displayState(report,now=Date.now()){
  if(!report||report.status==='failed')return 'failed';
  if(!['ok','warning'].includes(report.status))return 'warning';
  // Freshness is based on the saved run, never page-load time or presumed success.
  if(!Number.isFinite(Date.parse(report.staleAfter))||now>Date.parse(report.staleAfter))return 'failed';
  return report.status;
 }
 if(typeof module==='object'&&module.exports){module.exports={displayState};return;}
 const button=document.getElementById('daily-health-toggle'),panel=document.getElementById('daily-health-panel'),content=document.getElementById('daily-health-content'),dot=document.getElementById('daily-health-dot');
 if(!button)return;
 const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
 const time=value=>value?new Date(value).toLocaleString('cs-CZ',{timeZone:'Europe/Prague'}):'—';
 const labels={ok:'V pořádku',warning:'Upozornění',failed:'Selhalo',pending:'Neprovedeno',running:'Probíhá','snapshot-only':'Pouze testovací snapshot'};
 function render(h,history){
  const state=displayState(h);dot.className='health-dot is-'+state;button.setAttribute('aria-label','Data & analytics status: '+labels[state]);content.replaceChildren();
  content.append(el('p',time(h.runFinishedAt)+' · '+(labels[h.status]||h.status)));
  if(state==='failed'&&h.status!=='failed')content.append(el('p','Health report je neaktuální.','health-error'));
  if(h.mode==='safe-rehearsal')content.append(el('p','Testovací běh — nic nebylo publikováno.','health-warning'));
  const dl=el('dl');
  for(const [label,key]of [['Market ingestion','market'],['Stocks / Yahoo','stocks'],['COT','cot'],['Seasonality','seasonality'],['HTF','htf'],['Scoring / ranking','scoring'],['Static export','staticExport']]){dl.append(el('dt',label),el('dd',labels[h[key]?.status]||h[key]?.status||'—'));}
  const counts=[['Received / inserted / failed',`${h.market?.received??0} / ${h.market?.inserted??0} / ${h.market?.failed??0}`],['Duplicitní bary',h.market?.duplicates??0],['Failed symbols',(h.market?.failedSymbols||[]).join(', ')||'—'],['Warnings',(h.warnings||[]).length],['Screener candidates',h.screenerRows??0],['HTF zones',h.htfZones??0],...['EURUSD','AAPL'].map(k=>[k+' · poslední bar',h.instrumentChecks?.find(c=>c.symbol===k)?.lastBarDate||'—'])];
  for(const [k,v]of counts)dl.append(el('dt',k),el('dd',String(v)));content.append(dl);
  const messages=[...(h.errors||[]).map(x=>['health-error',x]),...(h.warnings||[]).map(x=>['health-warning',x])];
  if(messages.length){content.append(el('p',messages[0][1],messages[0][0]));if(messages.length>1){const details=el('details');details.append(el('summary','Další zprávy ('+(messages.length-1)+')'));const list=el('ul');for(const [cls,text]of messages.slice(1))list.append(el('li',text,cls));details.append(list);content.append(details);}}
  content.append(el('strong','Recent runs'));
  const table=el('table'),head=el('tr');for(const t of ['Datum','Status','s','Vloženo','Chyby','Warn'])head.append(el('th',t));table.append(head);
  for(const r of history.runs||[]){const tr=el('tr');for(const t of [r.runDate,labels[r.status]||r.status,r.durationSeconds,r.market?.inserted,r.market?.failed,r.warnings?.length])tr.append(el('td',String(t??'—')));table.append(tr);}content.append(table);
 }
 function close(){panel.hidden=true;button.setAttribute('aria-expanded','false');}
 button.addEventListener('click',()=>{panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));});
 document.addEventListener('click',e=>{if(!button.parentElement.contains(e.target))close();});document.addEventListener('keydown',e=>{if(e.key==='Escape'){close();button.focus();}});
 async function load(){try{
  const latest=await fetch('/artifacts/daily-health/latest.json',{cache:'no-store'});if(!latest.ok)throw Error('Health report není k dispozici');
  const h=await latest.json();if(h.schemaVersion!==1)throw Error('Nepodporovaný health report');
  let history={runs:[]};try{const response=await fetch('/artifacts/daily-health/history.json',{cache:'no-store'});if(response.ok)history=await response.json();}catch{/* Latest status remains authoritative. */}
  render(h,history);
 }catch(e){dot.className='health-dot is-failed';content.replaceChildren(el('p',e.message,'health-error'));}}
 load();setInterval(load,300000);
})(typeof window!=='undefined'?window:globalThis);
