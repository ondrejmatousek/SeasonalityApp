(function(){
 'use strict';
 const labels={ok:'V pořádku',warning:'Upozornění',failed:'Selhalo',pending:'Neprovedeno',running:'Probíhá','snapshot-only':'Testovací snapshot',unknown:'Nedoloženo',served:'Výstup dostupný'};
 function displayState(report,now=Date.now()){
  if(!report||report.status==='failed')return 'failed';
  if(!['ok','warning'].includes(report.status))return 'warning';
  if(!Number.isFinite(Date.parse(report.staleAfter))||now>Date.parse(report.staleAfter))return 'failed';
  return report.status;
 }
 function steps(h,manifest){
  const sql=h.marketDailySql,live=manifest?.marketDailySql;
  const matches=Boolean(h.published&&h.mode==='live'&&sql&&live&&['generationId','receiptId','payloadSha256','auditSha256','stateSha256'].every(k=>sql[k]!=null&&sql[k]===live[k]));
  return [
   {label:'Sběr Work / TradingView',status:'unknown',detail:h.marketDailyFetchedAt?'Čas kolekce: '+time(h.marketDailyFetchedAt)+'. Samostatný doklad volání TradingView není v tomto reportu.':'Zatím bez dokladu kolekce.'},
   {label:'Přijetí a ověření v SQL',status:sql?.receiptId?'ok':'unknown',detail:sql?.receiptId?'Generace '+sql.generationId+' · receipt '+sql.receiptId:'Starší běh nebo SQL příjem není doložen.'},
   ...[['Market ingestion','market'],['Akcie / Yahoo','stocks'],['COT','cot'],['Sezonalita','seasonality'],['OHLC pro Obchodní zóny','zonePrices'],['Scoring / ranking','scoring'],['Statický export','staticExport']].map(([label,key])=>({label,status:h[key]?.status||'unknown',detail:key==='market'?`${h.market?.received??'—'} přijato · ${h.market?.inserted??'—'} vloženo · ${h.market?.duplicates??'—'} duplicit · ${h.market?.failed??'—'} chyb`:''})),
   {label:'Příprava publikace',status:h.published&&h.mode==='live'?'ok':h.status==='failed'?'failed':'unknown',detail:h.published?'Soubory připravené k publikaci; nejde o potvrzení deploye.':'Publikace není potvrzena.'},
   {label:'Dostupnost na tomto webu',status:matches?'served':'unknown',detail:matches?'Manifest z tohoto webu odpovídá SQL generaci a hashům běhu.':'Pro tento běh není shoda s aktuálně dostupným manifestem. Výsledek deploye ověř v Actions.'}
  ];
 }
 function mergeRuns(latest,history){
  const byDay=new Map();
  for(const h of [...(history?.runs||[]),latest].filter(h=>h?.schemaVersion===1&&/^\d{4}-\d{2}-\d{2}$/.test(h.runDate||''))){
   const old=byDay.get(h.runDate);if(!old||Date.parse(h.runFinishedAt||h.runStartedAt)>=Date.parse(old.runFinishedAt||old.runStartedAt))byDay.set(h.runDate,h);
  }
  return [...byDay.values()].sort((a,b)=>b.runDate.localeCompare(a.runDate));
 }
 function time(value){const n=Date.parse(value);return Number.isFinite(n)?new Date(n).toLocaleString('cs-CZ',{timeZone:'Europe/Prague'}):'—';}
 if(typeof module==='object'&&module.exports){module.exports={displayState,steps,mergeRuns};return;}
 const root=document.getElementById('data-runs');if(!root)return;
 const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=String(text);if(cls)e.className=cls;return e;};
 const badge=status=>el('span',labels[status]||'Nedoloženo','run-badge is-'+(Object.hasOwn(labels,status)?status:'unknown'));
 const state=document.getElementById('runs-state'),history=document.getElementById('runs-history'),detail=document.getElementById('runs-detail'),refresh=document.getElementById('runs-refresh');
 let runs=[],manifest=null,selected=null;
 function show(day){
  selected=day;const h=runs.find(r=>r.runDate===day);if(!h)return;detail.replaceChildren();
  for(const b of history.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.day===day));
  detail.append(el('h3',h.runDate),el('p','Výsledek analytiky: '+(labels[h.status]||'Nedoloženo')),badge(h.status));
  if(h.mode==='safe-rehearsal')detail.append(el('p','Testovací běh — nejde o produkční aktualizaci.','runs-warning'));
  const meta=el('dl',null,'runs-meta');
  for(const [k,v]of [['Začátek',time(h.runStartedAt)],['Dokončení',time(h.runFinishedAt)],['Trvání',h.durationSeconds!=null?h.durationSeconds+' s':'—'],['Režim',h.mode||'Starší report'],['Screener kandidáti',h.screenerRows??'—'],['Obchodní zóny',h.zoneCandidates??'—'],['EURUSD / poslední bar',h.instrumentChecks?.find(x=>x.symbol==='EURUSD')?.lastBarDate||'—'],['AAPL / poslední bar',h.instrumentChecks?.find(x=>x.symbol==='AAPL')?.lastBarDate||'—']])meta.append(el('dt',k),el('dd',v));detail.append(meta);
  const list=el('ol',null,'run-steps');
  for(const step of steps(h,manifest)){const item=el('li'),line=el('div',null,'run-step-title');line.append(el('strong',step.label),badge(step.status));item.append(line);if(step.detail)item.append(el('p',step.detail));list.append(item);}detail.append(list);
  for(const [title,items,cls]of [['Chyby',h.errors,'runs-error'],['Upozornění',h.warnings,'runs-warning']])if(items?.length){detail.append(el('h3',title));const ul=el('ul',null,cls);for(const msg of items)ul.append(el('li',msg));detail.append(ul);}
  if(h.market?.failedSymbols?.length)detail.append(el('p','Chybné symboly: '+h.market.failedSymbols.join(', '),'runs-error'));
  if(h.marketDailySql){const d=el('details');d.append(el('summary','SQL identita a kontrolní součty'));const dl=el('dl',null,'runs-meta');for(const k of ['generationId','receiptId','payloadSha256','auditSha256','stateSha256'])dl.append(el('dt',k),el('dd',h.marketDailySql[k]??'—'));d.append(dl);detail.append(d);}
  const links=el('p');
  const sources=[['Morning analytics','https://github.com/ondrejmatousek/SeasonalityApp/actions/workflows/seasonality-update.yml'],['Nasazení webu','https://github.com/ondrejmatousek/SeasonalityApp/actions/workflows/static-hosting.yml'],['JSON report','/artifacts/daily-health/'+h.runDate+'.json']];
  if(/^https:\/\/github\.com\/ondrejmatousek\/SeasonalityApp\/actions\/runs\/\d+$/.test(h.workflowUrl||''))sources.unshift(['Tento Actions run',h.workflowUrl]);
  for(const [label,url]of sources){const a=el('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';links.append(a,document.createTextNode(' · '));}detail.append(links);
 }
 async function json(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('Nelze načíst '+url+' (HTTP '+r.status+').');return r.json();}
 async function load(){refresh.disabled=true;try{
  const latest=await json('/artifacts/daily-health/latest.json');if(latest.schemaVersion!==1)throw Error('Nepodporovaný formát reportu.');
  let saved={runs:[]},warnings=[];try{saved=await json('/artifacts/daily-health/history.json');}catch{warnings.push('Historie není dostupná.');}
  manifest=null;try{manifest=await json('/data/manifest.json');}catch{warnings.push('Dostupnost publikované generace nelze ověřit.');}
  runs=mergeRuns(latest,saved);history.replaceChildren();detail.replaceChildren();
  for(const h of runs){const b=el('button',null,'run-day');b.type='button';b.dataset.day=h.runDate;b.append(el('strong',h.runDate),badge(h.status),el('small',time(h.runFinishedAt)));b.addEventListener('click',()=>show(h.runDate));history.append(b);}
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague'}).format(new Date());
  state.textContent=(latest.runDate!==today?'Pro dnešní den zatím není uložený report. ':'')+(displayState(latest)==='failed'&&latest.status!=='failed'?'Pozor: poslední report je neaktuální. ':'')+'Poslední uložený běh: '+time(latest.runFinishedAt)+'. '+warnings.join(' ');
  if(runs.length)show(runs.some(h=>h.runDate===selected)?selected:runs[0].runDate);else state.textContent='Zatím není žádný uložený denní běh.';
 }catch(e){state.textContent=e.message;history.replaceChildren();detail.replaceChildren();}finally{refresh.disabled=false;}}
 refresh.addEventListener('click',load);load();setInterval(load,300000);
})();
