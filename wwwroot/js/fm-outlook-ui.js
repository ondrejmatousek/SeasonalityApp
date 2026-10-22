(()=>{
 'use strict';const root=document.getElementById('fm-outlook');if(!root)return;
 const by=id=>document.getElementById('fm-'+id),el=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=String(text);return n;},time=t=>window.MarketChartTime.format(t),num=n=>Number.isFinite(n)?new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:8}).format(n):'—';
 let data,result,instrument,view;const modal=by('modal');by('close').onclick=()=>modal.close();modal.addEventListener('close',()=>{view?.destroy();view=null;});
 function detail(z){
  by('title').textContent=instrument.symbol+' · H4 '+z.type+' · '+z.kind;by('meta').textContent=`${num(z.bot)}–${num(z.top)} · původ ${time(z.originTime)} · známé od ${time(z.confirmedAt)}.`;
  const list=by('reasons');list.replaceChildren();const add=text=>list.append(el('li',text));
  add(`Zdroj ${instrument.symbol}, pouze H4 uzavřené do snímku ${time(result.asOf)}. Zdrojová svíčka O ${num(z.base.open)}, H ${num(z.base.high)}, L ${num(z.base.low)}, C ${num(z.base.close)}; volume ${num(z.base.volume)} není vstupní filtr.`);
  add(z.kind==='classic'?`Poslední protisměrná svíčka; close ${num(z.confirmation.close)} ${z.type==='demand'?'nad':'pod'} referencí ${num(z.breakLevel)} po ${z.confirmIndex-z.startIdx} svíčkách. Displacement ${num(z.displacementRatio)}× ATR ${num(z.atr)} na potvrzující svíčce. Režim ${result.settings.strictness}.`:`Série směrových svíček; close ${num(z.confirmation.close)} překonal pending open level ${num(z.breakLevel)}. Klasický ATR a strict BOS filtr se nepoužily.`);
  add(`Hlavní struktura v potvrzující svíčce: ${z.mainEvent===0?'bez události':Math.abs(z.mainEvent)===1?'BOS':'CHoCH'}. Interní: ${z.internalEvent===0?'bez události':Math.abs(z.internalEvent)===1?'BOS':'CHoCH'}. Struktura používá potvrzené pivoty 20/20 a 5/5; není zpětně známá od jejich vrcholu.`);
  add(z.armed?`Úplný odchod doložen v ${time(z.armedAt)}.`:'Úplný odchod dosud nenastal; Pine ji sice vede jako fresh, ale ještě není armed.');
  add(z.fresh?'Fresh podle Pine: po armed nebyl doložen průnik více než 25 % ani close za hranou. Přesných 25 % není mitigace.':`První ztráta freshness: ${z.endReason} v ${time(z.endedAt)}. Pozdější stavy Pine po tomto zásahu nesleduje.`);
  add('Nejde o vstupní signál. Entry, SL, TP, liquidity scoring a London/NY konfluence se neodhadují. Čas začátku H4 neurčuje okamžik intradenního odchodu.');
  if(!modal.open)modal.showModal();modal.scrollTop=0;view?.destroy();
  const chart=by('chart'),tip=by('tip');for(const n of [...chart.children])if(n!==tip)n.remove();
  const bars=instrument.bars.map(b=>({...b,timestamp:b.t,date:new Date(b.t*1000).toISOString(),endDate:new Date(b.end*1000).toISOString()}));
  const annotations=[{time:z.originTime,position:z.type==='demand'?'belowBar':'aboveBar',shape:'circle',color:'#e7b759',text:'Původ '+z.kind},{time:z.confirmation.t,position:z.type==='demand'?'aboveBar':'belowBar',shape:z.type==='demand'?'arrowUp':'arrowDown',color:'#81d1ee',text:'Potvrzení'}];
  for(const e of result.events.filter(e=>e.scale==='swing'&&e.barTime>=z.originTime&&e.knownAt<=z.confirmedAt))annotations.push({time:e.barTime,position:e.direction===1?'belowBar':'aboveBar',shape:'circle',color:'#b0a7ef',text:e.kind});
  annotations.sort((a,b)=>a.time-b.time);
  try{view=ZonePriceChart.create(chart,tip,{price:{bars,symbol:instrument.symbol,provider:instrument.symbol.split(':')[0],latestClose:bars.at(-1).close,timeframe:'H4'},zone:{lower:z.bot,upper:z.top,baseDate:new Date(z.originTime*1000).toISOString(),timeframe:'H4',type:z.type},candidate:null,resolution:'H4',annotations});}catch(e){by('meta').textContent+=' Graf není dostupný: '+e.message;}
 }
 function render(){
  view?.destroy();view=null;instrument=data.instruments.find(i=>i.symbol===by('symbol').value);by('rows').replaceChildren();
  if(!instrument?.bars){by('result').textContent='UNVERIFIED — NO TRADE: chybí ověřitelný snímek tohoto feedu.';return;}
  result=FmOrderBlocks.run(instrument,{mode:by('mode').value,strictness:by('strict').value});
  const rows=result.zones.filter(z=>by('filter').value==='retained'||z.fresh&&(by('filter').value==='fresh'||z.visible));
  by('result').textContent=`${instrument.symbol} · ${result.bars} H4 · poslední close ${time(result.lastClosedAt)} · nalezeno ${result.formations.length} historických vzniků; ponecháno ${result.zones.length} boxů po Pine limitech, zobrazeno ${rows.length}. První načtená svíčka ${time(result.firstBar)}. Dosud neověřeno proti TradingView runtime.`;
  for(const z of rows){const tr=el('tr');for(const text of [`${z.type} · ${z.kind}\n${time(z.originTime)}`,`${num(z.bot)}–${num(z.top)}`,time(z.confirmedAt),`${num(z.displacementRatio)}× · ${z.armed?'armed':'bez departure'}`,z.fresh?'Fresh':z.endReason+' · '+time(z.endedAt)])tr.append(el('td',text));const td=el('td'),button=el('button','Graf a důvody');button.type='button';button.onclick=()=>detail(z);td.append(button);tr.append(td);by('rows').append(tr);}
  if(!rows.length){const tr=el('tr'),td=el('td','Podle tohoto režimu a filtru nebyla nalezena žádná ponechaná zóna.');td.colSpan=6;tr.append(td);by('rows').append(tr);}by('export').disabled=false;
 }
 by('run').onclick=()=>{try{render();}catch(e){by('state').textContent='Výpočet selhal: '+e.message;by('export').disabled=true;}};
 by('export').onclick=()=>{if(!result)return;const blob=new Blob([JSON.stringify({provenance:{mode:data.mode,sourceSnapshotPath:data.sourceSnapshotPath,sourceSnapshotSha256:data.sourceSnapshotSha256,validation:instrument.validation,sourceBatchId:instrument.sourceBatchId,engineVersion:FmOrderBlocks.version,completionPolicy:data.completionPolicy},assumptions:data.assumptions,result},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='fm-audit-'+result.symbol.replace(':','-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 by('fit').onclick=()=>view?.reset();by('all').onclick=()=>view?.fit();by('in').onclick=()=>view?.zoom(.8);by('out').onclick=()=>view?.zoom(1.25);
 let loadedPath=null,busy=false,pending=null;
 async function refresh(){if(busy||document.hidden)return;busy=true;const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),20000);try{
  const options={cache:'no-store',signal:abort.signal},m=await fetch('/data/manifest.json',options);if(!m.ok)throw Error('Manifest HTTP '+m.status);const manifest=await m.json(),path=manifest.zonePrices?.path;
  if(typeof path!=='string'||!/^\/data\/screener\/zone-prices\.[a-f0-9]{20}\.json$/.test(path))throw Error('Neplatná cesta H4 snímku.');
  if(path===loadedPath&&!pending){by('state').textContent=`Průběžný SQL H4 snímek · ${data.instruments.length} párů · publikováno ${time(data.asOf)}. Kontrola aktualizací každou minutu; nové svíčky po sběru a publikaci. Nejde o tickový stream.`;return;}
  if(!pending||pending.sourceSnapshotPath!==path){const r=await fetch(path,options);if(!r.ok)throw Error('H4 HTTP '+r.status);const text=await r.text(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');if(!path.includes(hash.slice(0,20)))throw Error('H4 hash nesouhlasí.');pending=FmOutlookSource.build(JSON.parse(text),{path,sha256:hash});}
  if(modal.open){by('state').textContent='Jsou dostupná nová H4 data. Promítnou se po zavření detailu.';return;}
  const selected=by('symbol').value;data=pending;pending=null;loadedPath=path;by('symbol').replaceChildren();for(const i of data.instruments){const o=el('option',i.symbol);o.value=i.symbol;by('symbol').append(o);}if(data.instruments.some(i=>i.symbol===selected))by('symbol').value=selected;else if(data.instruments.some(i=>i.symbol==='OANDA:EURUSD'))by('symbol').value='OANDA:EURUSD';
  by('run').disabled=false;render();by('state').textContent=`Průběžný SQL H4 snímek · ${data.instruments.length} párů · publikováno ${time(data.asOf)}. Kontrola aktualizací každou minutu; nové svíčky po sběru a publikaci. Nejde o tickový stream.`;
 }catch(e){by('state').textContent=(data?'Aktualizace se nezdařila; zůstává poslední načtený snímek. ':'H4 výhled nelze načíst: ')+e.message;}finally{clearTimeout(timer);busy=false;}}
 modal.addEventListener('close',()=>refresh());document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});setInterval(refresh,60000);refresh();
})();
