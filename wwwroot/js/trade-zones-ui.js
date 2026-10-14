(()=>{
 'use strict';
 const root=document.querySelector('.seasonality-page'),panel=document.getElementById('market-zones-view');if(!root||!panel)return;
 const by=id=>document.getElementById(id),el=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=String(text);return n;};
 const num=v=>new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:5}).format(v),labels={yes:'BOS close potvrzen',no:'Bez BOS',unknown:'Neověřeno',high:'Vysoké volume',normal:'Běžné volume',supports:'Podporuje',against:'Proti směru',confirms:'Potvrzuje',neutral:'Neutrální',insufficient:'Málo dat'},kind=z=>z.kind==='origin'?'Původ impulzu':'Konsolidační základna';
 const badge=s=>{const b=el('span',labels[s]||'Neověřeno');b.className='tz-badge '+s;return b;};
 let snapshot,opps,all=[],list=[],selected,chart,loading=false;
 const config=()=>({impulseAtr:Number(by('tz-impulse').value),volumeWindow:Number(by('tz-volume-window').value),volumeRatio:Number(by('tz-volume-ratio').value),bounds:by('tz-bounds').value});
 function calculate(){
  const sourceAssets=new Map(opps?.asOf===snapshot.asOf?opps.assets.map(a=>[a.key,a]):[]);all=[];
  for(const [key,price]of Object.entries(snapshot.prices))if(price.status==='ready'){
   const asset=sourceAssets.get(key)||snapshot.assets.find(a=>a.key===key&&a.mapping.executionKind!=='futures-profile');
   const daily=window.TradeZones.detect(price,'D1',snapshot.asOf,config()),weekly=window.TradeZones.detect(price,'W1',snapshot.asOf,config());
   for(const zone of [...daily,...weekly])all.push({key,asset,price,zone,children:window.TradeZones.refine(zone,daily),context:window.TradeZones.context(zone,sourceAssets.get(key),snapshot.asOf)});
  }all.sort((a,b)=>b.zone.qualityPoints-a.zone.qualityPoints||a.zone.distanceAtr-b.zone.distanceAtr||b.zone.confirmedAt.localeCompare(a.zone.confirmedAt)||a.key.localeCompare(b.key));render();
 }
 function render(){
  const search=by('tz-search').value.trim().toUpperCase();list=all.filter(r=>(!search||(r.key+' '+(r.asset?.name||'')).toUpperCase().includes(search))&&(by('tz-tf').value==='all'||r.zone.timeframe===by('tz-tf').value)&&(by('tz-kind').value==='all'||r.zone.kind===by('tz-kind').value)&&(by('tz-side').value==='all'||r.zone.type===by('tz-side').value)&&(by('tz-bos').value==='all'||r.zone.bos.state==='yes'));
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague'}).format(new Date()),stale=Date.parse(today)-Date.parse(snapshot.asOf)>86400000;
  by('tz-status').textContent=`Snapshot ${snapshot.asOf} · ${list.length} kandidátů zón · řazení: doložené body kvality, vzdálenost ceny, stáří. ${stale?'STARŠÍ DATA — nehodnoť jako aktuální setup. ':''}${opps?.asOf!==snapshot.asOf?'Sezonní/COT kontext nedostupný nebo má jiné datum. ':''}Session a makro neověřeny. Nejde o nezávislé obchody ani pravděpodobnosti.`;by('tz-status').classList.toggle('is-error',stale);
  const body=by('tz-results');body.replaceChildren();
  for(const r of list){const z=r.zone,tr=el('tr');tr.dataset.zoneId=z.id;tr.dataset.symbol=r.key;
   const instrument=el('td',`${r.key} · ${z.timeframe} ${z.type}`);instrument.append(el('small',kind(z)),el('small',r.asset?.mapping?.scope==='core'?'Core zdroj':'Research / review'));tr.append(instrument);
   const info=el('td',`${num(z.lower)}–${num(z.upper)}`);info.append(el('small',`Původ ${z.baseDate} · potvrzení ${z.confirmedAt}`),el('small',`${num(z.distanceAtr)} ATR od ceny · ${z.visits} návratů`));tr.append(info);
   const quality=el('td',`${z.qualityPoints} doložených bodů · ${z.knownCriteria}/3 ukazatelů ověřeno`);quality.append(el('small',`Impulz ${num(z.impulseAtr)} ATR / ${z.departureCount} svíček`),badge(z.bos.state),badge(z.volume.state),el('small','Session: neověřeno'));tr.append(quality);
   const seasonal=el('td');seasonal.append(badge(r.context.seasonal));if(r.context.candidate)seasonal.append(el('small',r.context.candidate.startDate+' – '+r.context.candidate.endDate));tr.append(seasonal);
   const cot=el('td');cot.append(badge(r.context.cot),el('small','Makro: neintegrováno'));tr.append(cot);
   const action=el('td'),button=el('button','Ukázat zónu');button.type='button';button.onclick=()=>{select(r);by('tz-detail').scrollIntoView({behavior:'smooth',block:'start'});};action.append(button);tr.append(action);body.append(tr);
  }
  if(!list.length){const tr=el('tr'),td=el('td','Žádná platná zóna pro tento výběr. Kontext nevytváří náhradní zóny.');td.colSpan=6;tr.append(td);body.append(tr);}
  if(!selected||!list.some(r=>r.key===selected.key&&r.zone.id===selected.zone.id))selected=list[0];else selected=list.find(r=>r.key===selected.key&&r.zone.id===selected.zone.id);
  if(selected)select(selected);else{by('tz-detail').hidden=true;chart?.destroy();chart=null;}
  by('tz-coverage').replaceChildren();for(const [key,p]of Object.entries(snapshot.prices))by('tz-coverage').append(el('p',p.status==='ready'?`${key}: ${p.provider} ${p.symbol} · D1 ${p.bars.length} / W1 ${p.weekly.length} dostupných svíček · poslední ${p.latestDate}`:`${key}: nedostupné — ${p.error}`));
 }
 function select(r){
  selected=r;const z=r.zone;by('tz-detail').hidden=false;by('tz-title').textContent=`${r.key} · ${z.timeframe} ${z.type} · ${kind(z)}`;
  by('tz-evidence').textContent=`${z.qualityPoints} doložených bodů kvality; ${z.knownCriteria}/3 ukazatelů ověřeno. ${labels[z.bos.state]}${z.bos.price?' za swingem '+z.bos.date+' / '+num(z.bos.price):''}. Volume: ${labels[z.volume.state]||'Neověřeno'}${z.volume.ratio!=null?' · '+num(z.volume.ratio)+'× medián':''} · vzorek ${z.volume.sample.join(', ')}. Session: neověřeno.`;
  const refinement=by('tz-refinement');refinement.replaceChildren();const parent=el('option','Původní HTF zóna');parent.value='parent';refinement.append(parent);r.children.forEach((child,i)=>{const o=el('option',`D1 ${child.baseDate} · ${num(child.lower)}–${num(child.upper)}`);o.value=String(i);refinement.append(o);});
  by('tz-refine-note').textContent=z.timeframe==='D1'?'D1 → H4: chybí intradenní OHLC, zpřesnění neprovádíme.':r.children.length?`${r.children.length} D1 zón uvnitř W1, známých nejpozději při jejím potvrzení. Žádná nová umělá hranice.`:'Uvnitř této W1 zóny není doložená platná D1 zóna v dostupné historii.';
  by('tz-resolution').value=z.timeframe;
  by('tz-caption').textContent=`${r.price.provider} ${r.price.symbol} · ${r.price.timezone} · poslední dokončený close ${num(r.price.latestClose)} (${r.price.latestDate}). Objem: provider volume${r.asset?.mapping?.exposureFamily==='FX'?' / spot FX — není centralizovaný obchodovaný objem':''}. Pásmo = vybraná zóna; cena není živá.`;
  const context=by('tz-context');context.replaceChildren();const c=r.context.candidate,s=c?.histories?.[20]?.seasonal;
  for(const [name,value,note]of [['Sezonalita',labels[r.context.seasonal],c?`${c.direction==='up'?'Růst':'Pokles'} ${c.startDate}–${c.endDate}; ${s?.count??'—'} historických období; rate ${s?.rate??'—'} %, medián ${s?.median??'—'} %. Nejde o úspěšnost obchodu ze zóny.`:'Bez sezonního intervalu v příštích 30 dnech.'],['Historická COT shoda',labels[r.context.cot],c?.cotReference?'Převzato z historického COT kontextu existujícího snapshotu; není to validovaný výsledek strategie zón.':'Nedostatek odpovídajících dat.'],['Makro','Neintegrováno','Zatím bez ověřeného makro zdroje; nepřidává body.']]){const box=el('div');box.append(el('small',name),el('strong',value||'Neověřeno'),el('small',note));context.append(box);}
  for(const tr of by('tz-results').querySelectorAll('tr'))tr.classList.toggle('is-selected',tr.dataset.symbol===r.key&&tr.dataset.zoneId===z.id);draw();
 }
 function draw(){if(!selected||panel.hidden)return;chart?.destroy();const child=by('tz-refinement').value==='parent'?null:selected.children[Number(by('tz-refinement').value)];chart=window.HtfPriceChart.create(by('tz-chart'),by('tz-tip'),{price:selected.price,zone:child||selected.zone,candidate:null,resolution:by('tz-resolution').value});}
 async function load(){if(loading)return;loading=true;by('tz-status').textContent='Načítám původní snapshot; nové zóny počítám odděleně…';try{snapshot=await window.StaticMarketData.htf();opps=null;try{opps=await window.StaticMarketData.opportunities();}catch{}calculate();}catch(e){by('tz-status').textContent='Obchodní zóny nedostupné: '+e.message;by('tz-detail').hidden=true;by('tz-results').replaceChildren();chart?.destroy();chart=null;}finally{loading=false;}}
 for(const id of ['tz-tf','tz-kind','tz-side','tz-bos'])by(id).onchange=()=>snapshot&&render();by('tz-search').oninput=()=>snapshot&&render();
 for(const id of ['tz-impulse','tz-bounds','tz-volume-window','tz-volume-ratio'])by(id).onchange=()=>snapshot&&calculate();
 by('tz-resolution').onchange=draw;by('tz-refinement').onchange=()=>{if(by('tz-refinement').value!=='parent')by('tz-resolution').value='D1';draw();};by('tz-reset').onclick=()=>chart?.reset();by('tz-reload').onclick=load;
 root.addEventListener('zones-visible',()=>snapshot?render():load());
})();
