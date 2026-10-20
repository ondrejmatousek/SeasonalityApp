(()=>{
 'use strict';
 const root=document.querySelector('.seasonality-page'),panel=document.getElementById('market-zones-view');if(!root||!panel)return;
 const by=id=>document.getElementById(id),el=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=String(text);return n;};
 const num=v=>new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:5}).format(v),labels={yes:'BOS close potvrzen',no:'Bez BOS',unknown:'Neověřeno',high:'Vysoké volume',normal:'Běžné volume',supports:'Podporuje',against:'Proti směru',confirms:'Potvrzuje',neutral:'Neutrální',insufficient:'Málo dat'},kind=z=>(z.kinds||[z.kind]).map(k=>k==='origin'?'Původ impulzu':'Konsolidační základna').join(' + ');
 const badge=s=>{const b=el('span',labels[s]||'Neověřeno');b.className='tz-badge '+s;return b;};
 const navigable=new Set(JSON.parse(by('seasonality-assets').textContent).map(a=>a.key));
 let snapshot,opps,all=[],list=[],selected,chart,loading=false,page=1;
 const config=()=>({volumeWindow:Number(by('tz-volume-window').value),volumeRatio:Number(by('tz-volume-ratio').value)});
 const liquidityConfig=()=>({rangeBars:Number(by('tz-range-bars').value),toleranceAtr:Number(by('tz-liquidity-tolerance').value),maxGapAtr:Number(by('tz-liquidity-gap').value)});
 const profile=(price,tf,at)=>{const bars=window.TradeZones.sourceBars(price,tf,at);return window.FmTradeZones.detect(price,tf,at,config()).map(zone=>({...zone,liquiditySetup:window.TradeZones.rangeLiquidity(zone,bars,liquidityConfig())}));};
 function calculate(){
  const sourceAssets=new Map(opps?.asOf===snapshot.asOf?opps.assets.map(a=>[a.key,a]):[]);all=[];
  for(const [key,price]of Object.entries(snapshot.prices))if(price.status==='ready'){
   const contextAsset=price.contextCompatible===false?null:sourceAssets.get(key);
   const asset=(price.contextCompatible===false?null:sourceAssets.get(key))||snapshot.assets.find(a=>a.key===key&&a.mapping.executionKind!=='futures-profile');
   const daily=profile(price,'D1',snapshot.asOf),weekly=profile(price,'W1',snapshot.asOf);
   for(const zone of [...daily,...weekly])all.push({key,asset,price,zone,distancePct:window.TradeZones.distancePercent(price.latestClose,zone.lower,zone.upper),children:window.TradeZones.refine(zone,daily),context:window.TradeZones.context(zone,contextAsset,snapshot.asOf)});
   if(price.h4?.status==='ready')for(const zone of profile(price.h4,'H4',price.h4.asOfUtc))all.push({key,asset,price:price.h4,zone,distancePct:window.TradeZones.distancePercent(price.h4.latestClose,zone.lower,zone.upper),children:[],context:window.TradeZones.context(zone,contextAsset,price.h4.asOfUtc)});
  }page=1;render();
 }
 function render(){
  const search=window.CfdInstruments.resolve(by('tz-search').value.trim().toUpperCase()),scope=by('tz-scope').value;list=all.filter(r=>(scope==='all'||scope==='cfd'&&window.CfdInstruments.keys.includes(r.key)||scope==='core'&&r.asset?.mapping?.scope==='core'||scope==='research'&&r.asset?.mapping?.scope!=='core')&&(!search||(r.key+' '+(r.asset?.name||'')).toUpperCase().includes(search))&&(by('tz-tf').value==='all'||r.zone.timeframe===by('tz-tf').value)&&(by('tz-kind').value==='all'||(r.zone.kinds||[r.zone.kind]).includes(by('tz-kind').value))&&(by('tz-side').value==='all'||r.zone.type===by('tz-side').value)&&(by('tz-bos').value==='all'||r.zone.bos.state==='yes'));
  list=list.filter(r=>(by('tz-max-distance').value===''||(Number.isFinite(r.distancePct)&&r.distancePct<=Number(by('tz-max-distance').value)))&&r.zone.qualityPoints>=Number(by('tz-quality').value)&&(by('tz-volume').value==='all'||r.zone.volume.state===by('tz-volume').value)&&(by('tz-seasonal').value==='all'||r.context.seasonal===by('tz-seasonal').value)&&(by('tz-cot').value==='all'||r.context.cot===by('tz-cot').value));
  list=list.filter(r=>by('tz-setup').value==='all'||r.zone.liquiditySetup.state===by('tz-setup').value);
  const sort=by('tz-sort').value,direction=by('tz-sort-direction').value;
  list=window.TradeZoneTable.sort(list,sort,direction);
  const slice=window.TradeZoneTable.paginate(list,page,by('tz-page-size').value);page=slice.page;
  by('tz-page-prev').disabled=page===1;by('tz-page-next').disabled=page===slice.pages;
  by('tz-page-info').textContent=`${slice.start}–${slice.end} z ${slice.total} · Strana ${page} / ${slice.pages}`;
  for(const button of panel.querySelectorAll('[data-tz-sort]')){const active=button.dataset.tzSort===sort;button.closest('th').setAttribute('aria-sort',active?(direction==='asc'?'ascending':'descending'):'none');button.querySelector('span').textContent=active?(direction==='asc'?'▲':'▼'):'';}
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague'}).format(new Date()),stale=Date.parse(today)-Date.parse(snapshot.asOf)>86400000;
  by('tz-status').textContent=`Snapshot ${snapshot.asOf} · ${list.length} FM zón; nejbližší platná supply + demand na instrument/timeframe. Výběr pouze podle vzdálenosti od posledního dokončeného close; při shodě novější potvrzení. Kvalita zóny pořadí výběru nemění. Filtry vybírají z této dvojice, nehledají náhradní zóny. Řazení tabulky: ${window.TradeZoneTable.labels[sort]}, ${direction==='asc'?'vzestupně':'sestupně'}; neověřené hodnoty poslední. ${stale?'STARŠÍ DATA — nehodnoť jako aktuální setup. ':''}${opps?.asOf!==snapshot.asOf?'Sezonní/COT kontext nedostupný nebo má jiné datum. ':''}Session a makro neověřeny. Nejde o backtestem ověřenou pravděpodobnost.`;by('tz-status').classList.toggle('is-error',stale);
  const body=by('tz-results');body.replaceChildren();
  for(const r of slice.rows){const z=r.zone,tr=el('tr');tr.dataset.zoneId=z.id;tr.dataset.symbol=r.key;tr.dataset.timeframe=z.timeframe;tr.dataset.setup=z.liquiditySetup.state;tr.dataset.distancePct=r.distancePct??'';tr.dataset.quality=z.qualityPoints;tr.dataset.volume=z.volume.state;tr.dataset.seasonal=r.context.seasonal;tr.dataset.cot=r.context.cot;tr.dataset.confirmedAt=z.confirmedAt;
   const instrument=el('td',`${r.key} · ${z.timeframe} ${z.type}`);instrument.append(el('small','FM · klasický order block'),el('small',r.asset?.mapping?.scope==='core'?'Core zdroj':'Research / review'));tr.append(instrument);
   const info=el('td',`${num(z.lower)}–${num(z.upper)}`);info.append(el('small',`Původ ${z.baseDate} · potvrzení ${z.confirmedAt}`),el('small',`${num(z.distanceAtr)} ATR od ceny · ${z.visits} návratů`));tr.append(info);
   const proximity=el('td',r.distancePct==null?'Neověřeno':`${num(r.distancePct)} %`);proximity.className='tz-distance';proximity.append(el('small',z.priceState==='inside'?'Cena uvnitř zóny':'K nejbližší hraně'),el('small',`Close ${num(r.price.latestClose)} · ${window.MarketCandles.latestDateLabel(r.price)}`));tr.append(proximity);
   const quality=el('td',`${z.qualityPoints} doložených bodů · ${z.knownCriteria}/3 ukazatelů ověřeno`);quality.append(el('small',`Impulz ${num(z.impulseAtr)} ATR / ${z.departureCount} svíček`),badge(z.bos.state),badge(z.volume.state),el('small','Session: neověřeno'));tr.append(quality);
   if(z.liquiditySetup.state==='ready'){const tag=el('span','Range + likvidita před OB');tag.className='tz-badge confirms';quality.append(tag);}
   const seasonal=el('td');seasonal.append(badge(r.context.seasonal));if(r.context.candidate)seasonal.append(el('small',r.context.candidate.startDate+' – '+r.context.candidate.endDate));tr.append(seasonal);
   const cot=el('td');cot.append(badge(r.context.cot),el('small','Makro: neintegrováno'));tr.append(cot);
   const action=el('td'),button=el('button','Ukázat zónu');button.type='button';button.onclick=()=>{select(r);by('tz-detail').scrollIntoView({behavior:'smooth',block:'start'});};action.append(button);tr.append(action);body.append(tr);
  }
  if(!list.length){const tr=el('tr'),td=el('td','Žádná platná zóna pro tento výběr. Kontext nevytváří náhradní zóny.');td.colSpan=7;tr.append(td);body.append(tr);}
  selected=slice.rows.find(r=>r.key===selected?.key&&r.zone.id===selected?.zone.id)||slice.rows[0];
  if(selected)select(selected);else{by('tz-detail').hidden=true;chart?.destroy();chart=null;}
  by('tz-coverage').replaceChildren();for(const [key,p]of Object.entries(snapshot.prices))by('tz-coverage').append(el('p',p.status==='ready'?`${key}: ${p.provider} ${p.symbol} · D1 ${p.bars.length} / W1 ${p.weekly.length} dostupných svíček · poslední ${window.MarketCandles.latestDateLabel(p)}`:`${key}: nedostupné — ${p.error}`));
  for(const [key,p]of Object.entries(snapshot.prices))if(p.h4?.status==='ready')by('tz-coverage').append(el('p',`${key} H4: ${p.h4.bars.length} svíček pro detekci / ${p.h4.validatedBarCount} přijatých · ${p.h4.excludedBarCount} vyřazeno při historické validaci · poslední začátek ${p.h4.latestDate} · historie: ${p.h4.validation} · ${p.h4.liveRule?`; inkrement ${p.h4.liveBarCount} barů: ${p.h4.liveRule}, hranice providera, ne úplný burzovní kalendář`:''}. Snapshot není živá kotace.`));
 }
 function select(r){
  selected=r;const z=r.zone;by('tz-detail').hidden=false;by('tz-title').textContent=`${r.key} · ${z.timeframe} · nejbližší supply + demand`;
  by('tz-evidence').textContent=`${z.qualityPoints} doložených bodů kvality; ${z.knownCriteria}/3 ukazatelů ověřeno. ${labels[z.bos.state]}${z.bos.price?' za swingem '+z.bos.date+' / '+num(z.bos.price):''}. Volume: ${labels[z.volume.state]||'Neověřeno'}${z.volume.ratio!=null?' · '+num(z.volume.ratio)+'× medián':''} · vzorek ${z.volume.sample.join(', ')}. Session: neověřeno.`;
  by('tz-evidence').textContent=`Detail řádku ${z.type}: `+by('tz-evidence').textContent+` FM: ATR(96) na potvrzující svíčce, close za tělem poslední protisměrné svíčky během 1–3 svíček, celé high–low. Armed od ${new Date(z.fm.armedAt*1000).toISOString()}. Nejhlubší zásah po odchodu: ${num(z.maxPenetration*100)} %. Fresh končí při zásahu > 25 % nebo close za vnější hranou; přesných 25 % zůstává fresh. Výběr ${z.selectionPolicy}: nejmenší vzdálenost od ceny, při shodě novější potvrzení. BOS, síla odchodu, objem a sezonní/COT kontext jsou popis kvality, nikoli filtr výběru nejbližší zóny.`;
  const pair=all.filter(a=>a.key===r.key&&a.zone.timeframe===z.timeframe);
  const pairBody=by('tz-pair-results');pairBody.replaceChildren();
  for(const side of ['supply','demand']){const row=el('tr'),item=pair.find(a=>a.zone.type===side);row.dataset.pairSide=side;const name=el('td',side==='supply'?'Supply':'Demand');name.className='tz-pair-'+side;row.append(name);
   if(!item){const missing=el('td','Platná fresh + armed zóna nebyla nalezena. Žádnou náhradní zónu nevytváříme.');missing.colSpan=6;row.append(missing);pairBody.append(row);continue;}
   const a=item.zone;row.dataset.pairZoneId=a.id;
   const bounds=el('td',`${num(a.lower)}–${num(a.upper)}`);bounds.append(el('small',`Původ ${a.baseDate}`),el('small',`Potvrzení ${a.confirmedAt}`));row.append(bounds);
   const distance=el('td',`${num(item.distancePct)} %`);distance.append(el('small',a.priceState==='inside'?'Cena uvnitř zóny':'K nejbližší hraně'));row.append(distance);
   const quality=el('td');quality.append(badge(a.bos.state),el('small',`${num(a.impulseAtr)}× ATR(96) / ${a.departureCount} svíček`),el('small',`${a.qualityPoints} doplňkových bodů; ${a.knownCriteria}/3 ukazatelů ověřeno`),el('small','Session: neověřeno'));row.append(quality);
   const volume=el('td');volume.append(badge(a.volume.state),el('small',a.volume.ratio==null?'Chybí srovnatelný objem':`${num(a.volume.ratio)}× medián`),el('small',a.volume.sample.join(', ')));row.append(volume);
   const life=el('td','Fresh · armed');life.append(el('small',`Odchod ${new Date(a.fm.armedAt*1000).toISOString()}`),el('small',`Zásah ${num(a.maxPenetration*100)} %; ${a.visits} návratů`));row.append(life);
   const context=el('td');context.append(el('small','Sezonalita'),badge(item.context.seasonal),el('small','COT'),badge(item.context.cot));row.append(context);pairBody.append(row);
  }
  by('tz-structure').textContent=['supply','demand'].map(side=>{const a=pair.find(a=>a.zone.type===side);return a?`${side}: ${num(a.zone.lower)}–${num(a.zone.upper)}`:`${side}: platná fresh + armed zóna nebyla nalezena`;}).join(' · ')+'. Graf ukazuje tuto dvojici i při filtrování tabulky; neplatné ani nedokončené zóny nedoplňujeme.';
  const structure=z.liquiditySetup;by('tz-structure').textContent+=structure.state==='ready'?` Doplňkový Range + likvidita: ${num(structure.range.lower)}–${num(structure.range.upper)}, průraz close známý ${structure.breakout.knownAt}; ${structure.pool.swings.length} potvrzených swingů před OB. Nejde o změřené příkazy a nemění to výběr dvojice.`:` Doplňkový range setup nepotvrzen: ${structure.reason}`;
  const refinement=by('tz-refinement');refinement.replaceChildren();const parent=el('option','FM dvojice');parent.value='parent';refinement.append(parent);refinement.disabled=true;
  by('tz-refine-note').textContent='Graf H4 zobrazuje Europe/Prague včetně letního/zimního času; uložené timestampy zůstávají UTC. Stejný FM algoritmus jako v denním výhledu; classic / medium / full range. Změnu timeframe proveď filtrem tabulky. D1/W1 zachovává datovanou osu; konce UTC dne/týdne nejsou přesné časy zavření burzy.';
  for(const option of by('tz-resolution').options)option.disabled=option.value!==z.timeframe;
  by('tz-resolution').value=z.timeframe;
  if(z.detections?.length>1)by('tz-evidence').textContent+=` Sloučeno ${z.detections.length} nálezů stejné zóny. Body se nesčítají; důkazy jsou z ${z.kind==='origin'?'původu impulzu':'nejkratší poslední základny'}.`;
  const seasonal=r.context.candidate;
  const seasonButton=by('tz-open-seasonality'),cotButton=by('tz-open-cot');
  seasonButton.disabled=!navigable.has(r.key)||!seasonal||seasonal.startDate.slice(0,4)!==seasonal.endDate.slice(0,4);
  seasonButton.title=!seasonal?'Sezónní interval není dostupný.':seasonal.startDate.slice(0,4)!==seasonal.endDate.slice(0,4)?'Roční sezónní graf zatím neumí interval přes přelom roku.':'';
  seasonButton.dataset.startDate=seasonal?.startDate||'';seasonButton.dataset.endDate=seasonal?.endDate||'';seasonButton.dataset.symbol=r.key;
  cotButton.disabled=!navigable.has(r.key);
  by('tz-caption').textContent=`${r.price.provider} ${r.price.symbol} · ${r.price.timezone} · poslední dokončený close ${num(r.price.latestClose)} (${r.price.latestDate}). Objem: provider volume${r.asset?.mapping?.exposureFamily==='FX'?' / spot FX — není centralizovaný obchodovaný objem':''}. Vodorovné pásmo = vybraná zóna. ${seasonal?`Svislé sezonní okno ${seasonal.startDate}–${seasonal.endDate}: ${seasonal.direction==='up'?'zelené pro růst':'červené pro pokles'}, i pokud jde proti směru zóny. Je to kontext, ne předpověď.`:'Sezonní okno není dostupné; žádné nevytváříme.'} Cena není živá.`;
  if(z.timeframe==='H4')by('tz-caption').textContent+=` H4 z Azure SQL, historická validace ${r.price.validation}${r.price.liveRule?'; průběžná '+r.price.liveRule+' ('+r.price.liveBarCount+' barů); časové hranice providera, nikoli nezávislý burzovní kalendář':''}; potvrzení zóny je až konec impulzní svíčky ${z.confirmedAt}. H4 nevstupuje do sezonality ani COT. Aktuálnost posuzuj podle poslední svíčky; samotný uložený snapshot nepotvrzuje běh plánovače.`;
  const dates=window.MarketCandles.dateInfo(r.price,r.price.bars.find(b=>b.date===r.price.latestDate));
  if(dates.sessionDate)by('tz-caption').textContent+=` Datum svíčky na ose ${dates.barDate} = datum začátku v UTC (${dates.providerTimestamp}); odvozený den session ${dates.sessionDate}. ${dates.sessionDateBasis} Původní data ani výpočty neposouváme.`;
  const context=by('tz-context');context.replaceChildren();const c=r.context.candidate,s=c?.histories?.[20]?.seasonal;
  for(const [name,value,note]of [['Sezonalita',labels[r.context.seasonal],c?`${c.direction==='up'?'Růst':'Pokles'} ${c.startDate}–${c.endDate}; ${s?.count??'—'} historických období; rate ${s?.rate??'—'} %, medián ${s?.median??'—'} %. Nejde o úspěšnost obchodu ze zóny.`:'Bez sezonního intervalu v příštích 30 dnech.'],['Historická COT shoda',labels[r.context.cot],c?.cotReference?'Převzato z historického COT kontextu existujícího snapshotu; není to validovaný výsledek strategie zón.':'Nedostatek odpovídajících dat.'],['Makro','Neintegrováno','Zatím bez ověřeného makro zdroje; nepřidává body.']]){const box=el('div');box.append(el('small',name),el('strong',value||'Neověřeno'),el('small',note));context.append(box);}
  for(const tr of by('tz-results').querySelectorAll('tr'))tr.classList.toggle('is-selected',tr.dataset.symbol===r.key&&tr.dataset.zoneId===z.id);draw();
 }
 function draw(){if(!selected||panel.hidden)return;chart?.destroy();const pair=all.filter(r=>r.key===selected.key&&r.zone.timeframe===selected.zone.timeframe).map(r=>r.zone);chart=window.ZonePriceChart.create(by('tz-chart'),by('tz-tip'),{price:selected.price,zone:selected.zone,zones:pair,candidate:selected.context.candidate,resolution:selected.zone.timeframe});}
 async function load(){if(loading)return;loading=true;by('tz-status').textContent='Načítám původní snapshot; nové zóny počítám odděleně…';try{snapshot=await window.StaticMarketData.zonePrices();opps=null;try{opps=await window.StaticMarketData.opportunities();}catch{}calculate();}catch(e){snapshot=null;all=[];selected=null;by('tz-status').textContent='Obchodní zóny nedostupné: '+e.message;by('tz-detail').hidden=true;by('tz-results').replaceChildren();chart?.destroy();chart=null;}finally{loading=false;}}
 const resetPage=()=>{page=1;if(snapshot)render();};
 for(const id of ['tz-tf','tz-kind','tz-side','tz-bos','tz-scope','tz-quality','tz-volume','tz-seasonal','tz-cot','tz-setup','tz-sort-direction','tz-page-size'])by(id).onchange=resetPage;by('tz-search').oninput=resetPage;by('tz-max-distance').oninput=resetPage;
 by('tz-sort').onchange=()=>{by('tz-sort-direction').value=window.TradeZoneTable.defaults[by('tz-sort').value];resetPage();};
 for(const button of panel.querySelectorAll('[data-tz-sort]'))button.onclick=()=>{const key=button.dataset.tzSort;by('tz-sort-direction').value=by('tz-sort').value===key?(by('tz-sort-direction').value==='asc'?'desc':'asc'):window.TradeZoneTable.defaults[key];by('tz-sort').value=key;resetPage();};
 by('tz-page-prev').onclick=()=>{page--;if(snapshot)render();};by('tz-page-next').onclick=()=>{page++;if(snapshot)render();};
 by('tz-clear-filters').onclick=()=>{for(const [id,value]of Object.entries({'tz-search':'','tz-max-distance':'','tz-tf':'all','tz-kind':'all','tz-side':'all','tz-bos':'all','tz-scope':'cfd','tz-quality':'0','tz-volume':'all','tz-seasonal':'all','tz-cot':'all','tz-sort':'distance','tz-sort-direction':'asc','tz-setup':'all'}))by(id).value=value;resetPage();};
 for(const id of ['tz-volume-window','tz-volume-ratio','tz-range-bars','tz-liquidity-tolerance','tz-liquidity-gap'])by(id).onchange=()=>snapshot&&calculate();
 by('tz-resolution').onchange=draw;by('tz-refinement').onchange=()=>{if(by('tz-refinement').value!=='parent')by('tz-resolution').value='D1';draw();};by('tz-reset').onclick=()=>chart?.reset();by('tz-reload').onclick=load;
 for(const [id,target]of [['tz-open-seasonality','seasonality'],['tz-open-cot','cot']])by(id).onclick=()=>{
  if(!selected||by(id).disabled)return;
  const c=selected.context.candidate;
  root.dispatchEvent(new CustomEvent('zones-context-open',{detail:{key:selected.key,target,startDate:c?.startDate,endDate:c?.endDate}}));
  root.querySelector('[data-market-tab="'+target+'"]').scrollIntoView({block:'start'});
 };
 root.addEventListener('zones-visible',()=>snapshot?render():load());
})();
