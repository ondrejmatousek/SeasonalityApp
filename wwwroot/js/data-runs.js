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
 function auditRuns(latest,history,audit,frame){
  const daily=frame==='D1'?mergeRuns(latest,history).map(h=>({...h,id:h.runDate,kind:'analytics'})):[];
  const receipts=(audit?.ready===true?audit.runs||[]:[]).filter(r=>r.timeframes?.includes(frame)).map(r=>({...r,id:r.source+':'+r.id,receiptId:r.id,kind:'receipt',runFinishedAt:r.receivedAt,status:r.status==='Accepted'?(r.volumeWarnings?'warning':'ok'):'failed'}));
  return [...daily,...receipts].sort((a,b)=>(Date.parse(b.runFinishedAt)||0)-(Date.parse(a.runFinishedAt)||0)||a.id.localeCompare(b.id));
 }
 function paginate(items,page,size=8){const pages=Math.max(1,Math.ceil(items.length/size)),current=Math.max(1,Math.min(pages,page));return {page:current,pages,items:items.slice((current-1)*size,current*size)};}
 if(typeof module==='object'&&module.exports){module.exports={displayState,steps,mergeRuns,auditRuns,paginate};return;}
 const root=document.getElementById('data-runs');if(!root)return;
 const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=String(text);if(cls)e.className=cls;return e;};
 const badge=status=>el('span',labels[status]||'Nedoloženo','run-badge is-'+(Object.hasOwn(labels,status)?status:'unknown'));
 const state=document.getElementById('runs-state'),history=document.getElementById('runs-history'),detail=document.getElementById('runs-detail'),refresh=document.getElementById('runs-refresh');
 const auditState=document.getElementById('runs-audit-state'),prev=document.getElementById('runs-prev'),next=document.getElementById('runs-next'),pageLabel=document.getElementById('runs-page');
 let runs=[],manifest=null,selected=null,frame='D1',latest=null,saved={runs:[]},audit=null;
 const views={D1:{page:1,selected:null},H4:{page:1,selected:null}};
 function receiptDetail(h){
  detail.append(el('h3',frame+' · '+time(h.receivedAt)),badge(h.status),el('p',h.source==='market_h4'?'Příjem H4 · původní forexové páry':'Příjem rozšíření · CFD / porovnávací krypto'));
  const meta=el('dl',null,'runs-meta');
  for(const [k,v]of [['Čas přijetí do SQL',time(h.receivedAt)],['Timeframe dávky',h.timeframes.join(' + ')],['Symboly',h.symbols],['Vstupní bary',h.receivedBars],['Nově vloženo',h.inserted],['Duplicity',h.duplicates],['Vyřazeno',h.excluded],['Volume upozornění',h.volumeWarnings],['Typ',h.historical?'Historické doplnění':'SQL příjem'],['Receipt ID',h.receiptId]])meta.append(el('dt',k),el('dd',v));
  detail.append(meta,el('p','Počty platí pro celou SQL dávku. Jedna úloha Work může odeslat více samostatných dávek.','runs-note'));
  if(h.source==='market_h4'){meta.querySelector('dt').textContent='Uložený čas kolekce';detail.append(el('p','Starší H4 příjem ukládal do časového údaje čas kolekce z obálky. Nejde o nezávisle změřený začátek nebo konec úlohy Work.'));}
  detail.append(el('p',h.status==='failed'?'Dávka obsahovala konflikt; přijetí nových svíček není potvrzené.':h.inserted===0?'Dávka neobsahovala žádné nové uložené svíčky. Duplicity nejsou chyba.':'Nové svíčky byly uloženy do SQL.'));
  detail.append(el('p','Tento záznam potvrzuje pouze výsledek SQL příjmu, nikoli dokončení celé úlohy Work, výpočtů nebo publikace. Neodeslaný či přeskočený běh zde nemá receipt. H4 se používá pouze pro obchodní zóny; porovnávací krypto nenahrazuje Yahoo.','runs-note'));
 }
 function show(day){
  selected=day;views[frame].selected=day;const h=runs.find(r=>r.id===day);if(!h)return;detail.replaceChildren();
  for(const b of history.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.day===day));
  if(h.kind==='receipt'){receiptDetail(h);return;}
  detail.append(el('h3',h.runDate),el('p','Výsledek analytiky: '+(labels[h.status]||'Nedoloženo')),badge(h.status));
  if(h.mode==='safe-rehearsal')detail.append(el('p','Testovací běh — nejde o produkční aktualizaci.','runs-warning'));
  const meta=el('dl',null,'runs-meta');
  for(const [k,v]of [['Začátek',time(h.runStartedAt)],['Dokončení',time(h.runFinishedAt)],['Trvání',h.durationSeconds!=null?h.durationSeconds+' s':'—'],['Režim',h.mode||'Starší report'],['Screener kandidáti',h.screenerRows??'—'],['Obchodní zóny',h.zoneCandidates??'—'],['EURUSD / poslední bar',h.instrumentChecks?.find(x=>x.symbol==='EURUSD')?.lastBarDate||'—'],['AAPL / poslední bar',h.instrumentChecks?.find(x=>x.symbol==='AAPL')?.lastBarDate||'—']])meta.append(el('dt',k),el('dd',v));detail.append(meta);
  const wti=h.instrumentChecks?.find(x=>x.symbol==='WTI');
  if(wti){meta.append(el('dt','WTI / datum svíčky (UTC začátek)'),el('dd',wti.lastBarDate||'—'),el('dt','WTI / den session (odvozený)'),el('dd',wti.lastSessionDate||'Ve starším reportu nedoloženo'));if(wti.sessionDateBasis)detail.append(el('p','WTI: '+wti.sessionDateBasis));}
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
 function render(){
  runs=auditRuns(latest,saved,audit,frame);const page=paginate(runs,views[frame].page);views[frame].page=page.page;
  history.replaceChildren();detail.replaceChildren();
  document.getElementById('runs-history-heading').textContent='Historie '+frame;
  for(const f of ['D1','H4'])document.getElementById('runs-'+f.toLowerCase()).setAttribute('aria-pressed',String(f===frame));
  for(const h of page.items){const b=el('button',null,'run-day');b.type='button';b.dataset.day=h.id;b.append(el('strong',h.kind==='receipt'?time(h.receivedAt):h.runDate),badge(h.status),el('small',h.kind==='receipt'?(h.source==='market_h4'?'H4 · původní FX':'Rozšíření · '+h.timeframes.join(' / ')):'D1 · analytika · '+time(h.runFinishedAt)));b.addEventListener('click',()=>show(h.id));history.append(b);}
  prev.disabled=page.page===1;next.disabled=page.page===page.pages;pageLabel.textContent=page.page+' / '+page.pages+' · '+runs.length+' záznamů';
  selected=views[frame].selected;
  if(page.items.length)show(page.items.some(h=>h.id===selected)?selected:page.items[0].id);
  else detail.append(el('p',frame==='H4'&&audit?.ready!==true?'Audit H4 není dostupný. Nelze z toho vyvozovat, zda sběr proběhl.':'Pro tento timeframe zatím nejsou uložené záznamy.'));
 }
 async function json(url){const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(35000)});if(!r.ok)throw Error('Nelze načíst '+url+' (HTTP '+r.status+').');return r.json();}
 async function load(){refresh.disabled=true;try{
  const results=await Promise.allSettled([json('/artifacts/daily-health/latest.json'),json('/artifacts/daily-health/history.json'),json('/data/manifest.json'),json(root.dataset.auditUrl)]);
  const value=i=>results[i].status==='fulfilled'?results[i].value:null;
  latest=value(0);saved=value(1)||{runs:[]};manifest=value(2);audit=value(3);const warnings=[];
  if(latest?.schemaVersion!==1){latest=null;warnings.push(results[0].reason?.message||'Nepodporovaný formát reportu.');}
  if(!value(1))warnings.push('Historie není dostupná.');if(!manifest)warnings.push('Dostupnost publikované generace nelze ověřit.');
  auditState.textContent=audit?.schemaVersion===1&&audit.ready?'SQL audit k '+time(audit.asOf)+' · nejvýše '+audit.limitPerSource+' posledních dávek z každého SQL zdroje. Údaje se obnovují i bez publikace nových cen.':'SQL audit D1/H4 není dostupný. Stav sběru není ověřený.';
  if(audit?.schemaVersion!==1)audit=null;
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague'}).format(new Date());
  state.textContent=(latest?(latest.runDate!==today?'Pro dnešní den zatím není uložený report analytiky. ':'')+(displayState(latest)==='failed'&&latest.status!=='failed'?'Pozor: poslední report je neaktuální. ':'')+'Poslední D1 analytika: '+time(latest.runFinishedAt)+'. ':'')+warnings.join(' ');
  render();
 }catch(e){state.textContent=e.message;history.replaceChildren();detail.replaceChildren();}finally{refresh.disabled=false;}}
 for(const f of ['D1','H4'])document.getElementById('runs-'+f.toLowerCase()).addEventListener('click',()=>{frame=f;render();});
 prev.addEventListener('click',()=>{views[frame].page--;render();});next.addEventListener('click',()=>{views[frame].page++;render();});
 refresh.addEventListener('click',load);load();setInterval(load,300000);
})();
