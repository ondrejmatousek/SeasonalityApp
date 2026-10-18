(()=>{
 'use strict';
 const root=document.querySelector('.seasonality-page'),panel=document.getElementById('market-zones-view');if(!root||!panel)return;
 const by=id=>document.getElementById(id),el=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=String(text);return n;};
 const num=v=>new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:5}).format(v),labels={yes:'BOS close potvrzen',no:'Bez BOS',unknown:'Neověřeno',high:'Vysoké volume',normal:'Běžné volume',supports:'Podporuje',against:'Proti směru',confirms:'Potvrzuje',neutral:'Neutrální',insufficient:'Málo dat'},kind=z=>(z.kinds||[z.kind]).map(k=>k==='origin'?'Původ impulzu':'Konsolidační základna').join(' + ');
 const badge=s=>{const b=el('span',labels[s]||'Neověřeno');b.className='tz-badge '+s;return b;};
 const navigable=new Set(JSON.parse(by('seasonality-assets').textContent).map(a=>a.key));
 let snapshot,opps,all=[],list=[],selected,chart,loading=false;
 const config=()=>({impulseAtr:Number(by('tz-impulse').value),volumeWindow:Number(by('tz-volume-window').value),volumeRatio:Number(by('tz-volume-ratio').value),bounds:by('tz-bounds').value});
 const liquidityConfig=()=>({rangeBars:Number(by('tz-range-bars').value),toleranceAtr:Number(by('tz-liquidity-tolerance').value),maxGapAtr:Number(by('tz-liquidity-gap').value)});
 const profile=(price,tf,at)=>{const bars=window.TradeZones.sourceBars(price,tf,at);return window.TradeZones.detect(price,tf,at,config()).map(zone=>({...zone,liquiditySetup:window.TradeZones.rangeLiquidity(zone,bars,liquidityConfig())}));};
 function calculate(){
  const sourceAssets=new Map(opps?.asOf===snapshot.asOf?opps.assets.map(a=>[a.key,a]):[]);all=[];
  for(const [key,price]of Object.entries(snapshot.prices))if(price.status==='ready'){
   const contextAsset=price.contextCompatible===false?null:sourceAssets.get(key);
   const asset=(price.contextCompatible===false?null:sourceAssets.get(key))||snapshot.assets.find(a=>a.key===key&&a.mapping.executionKind!=='futures-profile');
   const daily=profile(price,'D1',snapshot.asOf),weekly=profile(price,'W1',snapshot.asOf);
   for(const zone of [...daily,...weekly])all.push({key,asset,price,zone,distancePct:window.TradeZones.distancePercent(price.latestClose,zone.lower,zone.upper),children:window.TradeZones.refine(zone,daily),context:window.TradeZones.context(zone,contextAsset,snapshot.asOf)});
   if(price.h4?.status==='ready')for(const zone of profile(price.h4,'H4',price.h4.asOfUtc))all.push({key,asset,price:price.h4,zone,distancePct:window.TradeZones.distancePercent(price.h4.latestClose,zone.lower,zone.upper),children:[],context:window.TradeZones.context(zone,contextAsset,price.h4.asOfUtc)});
  }all.sort((a,b)=>Number(b.zone.liquiditySetup.state==='ready')-Number(a.zone.liquiditySetup.state==='ready')||b.zone.qualityPoints-a.zone.qualityPoints||a.zone.distanceAtr-b.zone.distanceAtr||b.zone.confirmedAt.localeCompare(a.zone.confirmedAt)||a.key.localeCompare(b.key));render();
 }
 function render(){
  const search=window.CfdInstruments.resolve(by('tz-search').value.trim().toUpperCase()),scope=by('tz-scope').value;list=all.filter(r=>(scope==='all'||scope==='cfd'&&window.CfdInstruments.keys.includes(r.key)||scope==='core'&&r.asset?.mapping?.scope==='core'||scope==='research'&&r.asset?.mapping?.scope!=='core')&&(!search||(r.key+' '+(r.asset?.name||'')).toUpperCase().includes(search))&&(by('tz-tf').value==='all'||r.zone.timeframe===by('tz-tf').value)&&(by('tz-kind').value==='all'||(r.zone.kinds||[r.zone.kind]).includes(by('tz-kind').value))&&(by('tz-side').value==='all'||r.zone.type===by('tz-side').value)&&(by('tz-bos').value==='all'||r.zone.bos.state==='yes'));
  list=list.filter(r=>(by('tz-max-distance').value===''||(Number.isFinite(r.distancePct)&&r.distancePct<=Number(by('tz-max-distance').value)))&&r.zone.qualityPoints>=Number(by('tz-quality').value)&&(by('tz-volume').value==='all'||r.zone.volume.state===by('tz-volume').value)&&(by('tz-seasonal').value==='all'||r.context.seasonal===by('tz-seasonal').value)&&(by('tz-cot').value==='all'||r.context.cot===by('tz-cot').value));
  list=list.filter(r=>by('tz-setup').value==='all'||r.zone.liquiditySetup.state===by('tz-setup').value);
  const sort=by('tz-sort').value,distance=r=>r.distancePct??Infinity;
  if(sort==='distance')list.sort((a,b)=>distance(a)-distance(b)||b.zone.qualityPoints-a.zone.qualityPoints||a.key.localeCompare(b.key)||a.zone.id.localeCompare(b.zone.id));
  if(sort==='newest')list.sort((a,b)=>b.zone.confirmedAt.localeCompare(a.zone.confirmedAt)||distance(a)-distance(b)||a.key.localeCompare(b.key)||a.zone.id.localeCompare(b.zone.id));
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague'}).format(new Date()),stale=Date.parse(today)-Date.parse(snapshot.asOf)>86400000;
  by('tz-status').textContent=`Snapshot ${snapshot.asOf} · ${list.length} unikátních zón · řazení: ${sort==='distance'?'cena nejblíž zóně (%)':sort==='newest'?'nejnovější potvrzení':'nejprve range + likvidita před OB, potom body kvality, vzdálenost ceny a stáří'}. ${stale?'STARŠÍ DATA — nehodnoť jako aktuální setup. ':''}${opps?.asOf!==snapshot.asOf?'Sezonní/COT kontext nedostupný nebo má jiné datum. ':''}Session a makro neověřeny. Nejde o nezávislé obchody ani pravděpodobnosti.`;by('tz-status').classList.toggle('is-error',stale);
  const body=by('tz-results');body.replaceChildren();
  for(const r of list){const z=r.zone,tr=el('tr');tr.dataset.zoneId=z.id;tr.dataset.symbol=r.key;tr.dataset.timeframe=z.timeframe;tr.dataset.setup=z.liquiditySetup.state;tr.dataset.distancePct=r.distancePct??'';tr.dataset.quality=z.qualityPoints;tr.dataset.volume=z.volume.state;tr.dataset.seasonal=r.context.seasonal;tr.dataset.cot=r.context.cot;tr.dataset.confirmedAt=z.confirmedAt;
   const instrument=el('td',`${r.key} · ${z.timeframe} ${z.type}`);instrument.append(el('small',kind(z)),el('small',r.asset?.mapping?.scope==='core'?'Core zdroj':'Research / review'));tr.append(instrument);
   const info=el('td',`${num(z.lower)}–${num(z.upper)}`);info.append(el('small',`Původ ${z.baseDate} · potvrzení ${z.confirmedAt}`),el('small',`${num(z.distanceAtr)} ATR od ceny · ${z.visits} návratů`));tr.append(info);
   const proximity=el('td',r.distancePct==null?'Neověřeno':`${num(r.distancePct)} %`);proximity.className='tz-distance';proximity.append(el('small',z.priceState==='inside'?'Cena uvnitř zóny':'K nejbližší hraně'),el('small',`Close ${num(r.price.latestClose)} · ${window.MarketCandles.latestDateLabel(r.price)}`));tr.append(proximity);
   const quality=el('td',`${z.qualityPoints} doložených bodů · ${z.knownCriteria}/3 ukazatelů ověřeno`);quality.append(el('small',`Impulz ${num(z.impulseAtr)} ATR / ${z.departureCount} svíček`),badge(z.bos.state),badge(z.volume.state),el('small','Session: neověřeno'));tr.append(quality);
   if(z.liquiditySetup.state==='ready'){const tag=el('span','Range + likvidita před OB');tag.className='tz-badge confirms';quality.append(tag);}
   const seasonal=el('td');seasonal.append(badge(r.context.seasonal));if(r.context.candidate)seasonal.append(el('small',r.context.candidate.startDate+' – '+r.context.candidate.endDate));tr.append(seasonal);
   const cot=el('td');cot.append(badge(r.context.cot),el('small','Makro: neintegrováno'));tr.append(cot);
   const action=el('td'),button=el('button','Ukázat zónu');button.type='button';button.onclick=()=>{select(r);by('tz-detail').scrollIntoView({behavior:'smooth',block:'start'});};action.append(button);tr.append(action);body.append(tr);
  }
  if(!list.length){const tr=el('tr'),td=el('td','Žádná platná zóna pro tento výběr. Kontext nevytváří náhradní zóny.');td.colSpan=7;tr.append(td);body.append(tr);}
  if(!selected||!list.some(r=>r.key===selected.key&&r.zone.id===selected.zone.id))selected=list[0];else selected=list.find(r=>r.key===selected.key&&r.zone.id===selected.zone.id);
  if(selected)select(selected);else{by('tz-detail').hidden=true;chart?.destroy();chart=null;}
  by('tz-coverage').replaceChildren();for(const [key,p]of Object.entries(snapshot.prices))by('tz-coverage').append(el('p',p.status==='ready'?`${key}: ${p.provider} ${p.symbol} · D1 ${p.bars.length} / W1 ${p.weekly.length} dostupných svíček · poslední ${window.MarketCandles.latestDateLabel(p)}`:`${key}: nedostupné — ${p.error}`));
  for(const [key,p]of Object.entries(snapshot.prices))if(p.h4?.status==='ready')by('tz-coverage').append(el('p',`${key} H4: ${p.h4.bars.length} svíček pro detekci / ${p.h4.validatedBarCount} přijatých · ${p.h4.excludedBarCount} vyřazeno při historické validaci · poslední začátek ${p.h4.latestDate} · historie: ${p.h4.validation} · ${p.h4.liveRule?`; inkrement ${p.h4.liveBarCount} barů: ${p.h4.liveRule}, hranice providera, ne úplný burzovní kalendář`:''}. Snapshot není živá kotace.`));
 }
 function select(r){
  selected=r;const z=r.zone;by('tz-detail').hidden=false;by('tz-title').textContent=`${r.key} · ${z.timeframe} ${z.type} · ${kind(z)}`;
  by('tz-evidence').textContent=`${z.qualityPoints} doložených bodů kvality; ${z.knownCriteria}/3 ukazatelů ověřeno. ${labels[z.bos.state]}${z.bos.price?' za swingem '+z.bos.date+' / '+num(z.bos.price):''}. Volume: ${labels[z.volume.state]||'Neověřeno'}${z.volume.ratio!=null?' · '+num(z.volume.ratio)+'× medián':''} · vzorek ${z.volume.sample.join(', ')}. Session: neověřeno.`;
  by('tz-evidence').textContent+=` Nejhlubší pozdější zásah: ${num(z.maxPenetration*100)} % výšky zóny (limit neplatnosti ≥ 25 % včetně knotu).`;
  const structure=z.liquiditySetup;by('tz-structure').textContent=structure.state==='ready'?`Range + likvidita před OB: range ${num(structure.range.lower)}–${num(structure.range.upper)} (${structure.range.start} až ${structure.range.end}); průraz close ${num(structure.breakout.price)} známý ${structure.breakout.knownAt}. ${structure.pool.swings.length} potvrzených ${z.type==='demand'?'swing lows nad demand':'swing highs pod supply'}, pásmo ${num(structure.pool.lower)}–${num(structure.pool.upper)}, vzdálenost ${num(structure.pool.gapAtr)} ATR od OB. Celý setup známý až ${structure.knownAt}. Shluk dosud neproražen; očekávaný výběr likvidity není proběhlý sweep ani záruka reakce.`:`Range + likvidita před OB: nepotvrzeno — ${structure.reason}`;
  const refinement=by('tz-refinement');refinement.replaceChildren();const parent=el('option','Původní HTF zóna');parent.value='parent';refinement.append(parent);r.children.forEach((child,i)=>{const o=el('option',`D1 ${child.baseDate} · ${num(child.lower)}–${num(child.upper)}`);o.value=String(i);refinement.append(o);});
  by('tz-refine-note').textContent=z.timeframe==='H4'?'Samostatná H4 zóna z ověřeného historického snapshotu. Hranice a čas grafu jsou v UTC; nižší timeframe zatím není k dispozici.':z.timeframe==='D1'?'H4 zóny jsou dostupné samostatně ve filtru H4; automatické vnořené zpřesnění D1 → H4 zatím neprovádíme.':r.children.length?`${r.children.length} D1 zón uvnitř W1, známých nejpozději při jejím potvrzení. Žádná nová umělá hranice.`:'Uvnitř této W1 zóny není doložená platná D1 zóna v dostupné historii.';
  for(const option of by('tz-resolution').options)option.disabled=z.timeframe==='H4'?option.value!=='H4':option.value==='H4';
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
 function draw(){if(!selected||panel.hidden)return;chart?.destroy();const child=by('tz-refinement').value==='parent'?null:selected.children[Number(by('tz-refinement').value)];chart=window.ZonePriceChart.create(by('tz-chart'),by('tz-tip'),{price:selected.price,zone:child||selected.zone,candidate:selected.context.candidate,resolution:by('tz-resolution').value});}
 async function load(){if(loading)return;loading=true;by('tz-status').textContent='Načítám původní snapshot; nové zóny počítám odděleně…';try{snapshot=await window.StaticMarketData.zonePrices();opps=null;try{opps=await window.StaticMarketData.opportunities();}catch{}calculate();}catch(e){snapshot=null;all=[];selected=null;by('tz-status').textContent='Obchodní zóny nedostupné: '+e.message;by('tz-detail').hidden=true;by('tz-results').replaceChildren();chart?.destroy();chart=null;}finally{loading=false;}}
 for(const id of ['tz-tf','tz-kind','tz-side','tz-bos','tz-scope','tz-quality','tz-volume','tz-seasonal','tz-cot','tz-sort','tz-setup'])by(id).onchange=()=>snapshot&&render();by('tz-search').oninput=()=>snapshot&&render();by('tz-max-distance').oninput=()=>snapshot&&render();
 by('tz-clear-filters').onclick=()=>{for(const [id,value]of Object.entries({'tz-search':'','tz-max-distance':'','tz-tf':'all','tz-kind':'all','tz-side':'all','tz-bos':'all','tz-scope':'cfd','tz-quality':'0','tz-volume':'all','tz-seasonal':'all','tz-cot':'all','tz-sort':'quality','tz-setup':'all'}))by(id).value=value;if(snapshot)render();};
 for(const id of ['tz-impulse','tz-bounds','tz-volume-window','tz-volume-ratio','tz-range-bars','tz-liquidity-tolerance','tz-liquidity-gap'])by(id).onchange=()=>snapshot&&calculate();
 by('tz-resolution').onchange=draw;by('tz-refinement').onchange=()=>{if(by('tz-refinement').value!=='parent')by('tz-resolution').value='D1';draw();};by('tz-reset').onclick=()=>chart?.reset();by('tz-reload').onclick=load;
 for(const [id,target]of [['tz-open-seasonality','seasonality'],['tz-open-cot','cot']])by(id).onclick=()=>{
  if(!selected||by(id).disabled)return;
  const c=selected.context.candidate;
  root.dispatchEvent(new CustomEvent('zones-context-open',{detail:{key:selected.key,target,startDate:c?.startDate,endDate:c?.endDate}}));
  root.querySelector('[data-market-tab="'+target+'"]').scrollIntoView({block:'start'});
 };
 root.addEventListener('zones-visible',()=>snapshot?render():load());
})();
