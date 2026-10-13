(() => {
    const root=document.querySelector('.seasonality-page'),panel=document.getElementById('market-htf-view');if(!root||!panel)return;
    const by=id=>document.getElementById(id),status=by('htf-status'),tbody=by('htf-results'),canvas=by('htf-price-chart'),tip=by('htf-tooltip');
    const num=v=>new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:4}).format(v),pct=v=>num(v)+' %',date=s=>new Date(s+'T00:00:00Z').toLocaleDateString('cs-CZ'),day=s=>Date.parse(s+'T00:00:00Z');
    const labels={confirms:'Potvrzuje',against:'Proti směru',neutral:'Neutrální',insufficient:'Bez dostatku dat'},priceLabels={inside:'Uvnitř zóny',near:'Poblíž zóny',far:'Cena daleko · čekání'};
    let snapshot,selected,loading=false,chart,chartKey;
    const el=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;return n;};
    function stale(){return !snapshot||day(new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague'}).format(new Date()))-day(snapshot.asOf)>86400000;}
    async function load(){if(loading)return;loading=true;status.textContent='Načítám ranní HTF analýzu…';try{if(!window.StaticMarketData)throw Error('HTF vyžaduje statický export OHLC');snapshot=await window.StaticMarketData.htf();render();}catch(e){status.textContent='HTF data nedostupná: '+e.message;status.classList.add('is-error');}finally{loading=false;}}
    function rows(){return snapshot.assets.filter(a=>a.mapping.scope==='core'&&a.mapping.executionKind!=='futures-profile').flatMap(a=>a.matches.map(m=>({asset:a,match:m,price:snapshot.prices[a.mapping.priceKey],zone:snapshot.prices[a.mapping.priceKey].zones.find(z=>z.id===m.zoneId)}))).filter(r=>r.zone&& (by('htf-timeframe').value==='all'||r.zone.timeframe===by('htf-timeframe').value)&& (by('htf-direction').value==='all'||r.match.candidate.direction===by('htf-direction').value)&& (by('htf-mode').value==='all'||r.match.priceState!=='far')&& (by('htf-mode').value!=='confirmed'||(!stale()&&r.match.cotState==='confirms'))).sort((a,b)=>a.match.distanceAtr-b.match.distanceAtr||b.match.candidate.scoringV2.rawScore-a.match.candidate.scoringV2.rawScore);}
    function render(){if(!snapshot)return;const list=rows(),ready=Object.values(snapshot.prices).filter(p=>p.status==='ready').length;
        status.textContent=`Vyhodnoceno ${date(snapshot.asOf)} · OHLC ${ready}/${Object.keys(snapshot.prices).length} cenových zdrojů · ${list.length} shod zón a období (ne nezávislých obchodů). ${stale()?'STARŠÍ SNAPSHOT — aktuální shodu znovu ověř; COT potvrzení filtr nevrací.':'Cena je poslední dokončený den, nikoli živá kotace.'}`;status.classList.toggle('is-error',stale());
        tbody.replaceChildren();for(const r of list){const tr=el('tr'),c=r.match.candidate,s=c.histories[20].seasonal;tr.dataset.key=r.asset.key;
            const texts=[r.asset.key+' / '+r.asset.mapping.priceKey,`${r.zone.timeframe} ${r.zone.type} · ${num(r.zone.lower)}–${num(r.zone.upper)}`,priceLabels[r.match.priceState],`${date(c.startDate)} – ${date(c.endDate)} · ${r.match.seasonalState==='active'?'probíhá':'teprve přijde'}`,`${pct(s.rate)} · ${s.count} období`,labels[r.match.cotState]];
            texts.forEach((text,i)=>{const td=el('td',text);if(i===0)td.append(el('small',r.asset.mapping.exposureFamily));if(i===1)td.append(el('small',`${r.zone.visits} návratů · vznik ${date(r.zone.confirmedAt)}`));if(i===2)td.append(el('small',`Close ${num(r.price.latestClose)} · ${date(r.price.latestDate)} · vzdálenost ${num(r.match.distanceAtr)} ATR`));if(i===4)td.append(el('small',`Medián ${pct(s.median)} · raw ${num(c.scoringV2.rawScore)}/10`));if(i===5)td.append(el('small',`Podobné ${c.scoringV2.samples.similar} · ostatní ${c.scoringV2.samples.other}`));tr.append(td);});
            const td=el('td'),button=el('button','Ukázat graf');button.type='button';button.onclick=()=>{selected=r;show();by('htf-detail').scrollIntoView({behavior:'smooth',block:'start'});};td.append(button);tr.append(td);tbody.append(tr);}
        if(!list.length){const td=el('td','Žádná shoda pro tento výběr. Přepni na všechny shody pro čekající vzdálené zóny; nevytváříme potvrzení násilně.');td.colSpan=7;const tr=el('tr');tr.append(td);tbody.append(tr);}
        by('htf-coverage').replaceChildren();for(const [key,p]of Object.entries(snapshot.prices))by('htf-coverage').append(el('p',p.status==='ready'?`${key}: ${p.provider} ${p.symbol} · ${p.timezone} · ${p.barCount} OHLC · poslední ${p.latestDate} · ${p.zones.length} zón${p.lastSplit?' · detekce pouze po splitu '+p.lastSplit:''}`:`${key}: NEDOSTUPNÉ — ${p.error}`));
        if(!selected||!list.some(r=>r.asset.key===selected.asset.key&&r.zone.id===selected.zone.id&&r.match.candidate.startDate===selected.match.candidate.startDate))selected=list[0];by('htf-detail').hidden=!selected;if(selected)show();else {chart?.destroy();chart=null;chartKey=null;}
    }
    function show(){const {asset,zone,match,price}=selected,c=match.candidate,s=c.histories[20].seasonal;
        by('htf-detail').hidden=false;by('htf-chart-title').textContent=`${asset.key} · ${zone.timeframe} ${zone.type} · ${c.direction==='up'?'růst':'pokles'}`;
        const key=asset.key+'|'+zone.id+'|'+c.startDate;
        if(chartKey?.split('::')[0]!==key)by('htf-chart-resolution').value=zone.timeframe;
        const profiles=snapshot.assets.filter(a=>a.mapping.priceKey===asset.mapping.priceKey&&a.mapping.executionKind==='futures-profile').map(a=>a.key);
        by('htf-chart-caption').textContent=`Cenová reference ${asset.mapping.priceKey} · ${price.provider} ${price.symbol} · ${price.timezone}. ${profiles.length?'Profily '+profiles.join('/')+': úrovně zóny jsou ceny indexu, ne futures. ':''}Svislý výřez je sezonní období: zelený pro růst, červený pro pokles. Vodorovné pásmo je HTF zóna. Vpravo za poslední svíčkou není předpověď.`;
        const metrics=by('htf-metrics');metrics.replaceChildren();for(const [title,value,note]of [
            ['Cena vs zóna',priceLabels[match.priceState],`Poslední dokončený close ${num(price.latestClose)} z ${date(price.latestDate)}.`],
            ['Sezonalita',pct(s.rate),`${s.count} dokončených období / posledních 20 let; medián ${pct(s.median)}. Výběr intervalu z maximální dokončené historie.`],
            ['Historická COT shoda',labels[match.cotState],`C = ${num(c.scoringV2.components.C)}; ${c.scoringV2.samples.similar} podobných / ${c.scoringV2.samples.other} ostatních případů. ${asset.mapping.cotSources.map(v=>v.name||v.key).join(' + ')}.`],
            ['Co teď',stale()?'Starší data · znovu ověř':match.priceState==='far'?'Čekat na návrat ceny':match.seasonalState==='upcoming'?'Čekat na sezonní období':'Hledat setup · ne automatický vstup','Denní close v zóně není potvrzení obratu. Aktuální strukturu, cenu a risk ověř v trading grafu.']]){const box=el('div');box.append(el('small',title),el('strong',value),el('small',note));metrics.append(box);}draw();
    }
    function draw(){
        if(!selected||panel.hidden)return;
        const {zone,price,match,asset}=selected,resolution=by('htf-chart-resolution').value;
        const key=asset.key+'|'+zone.id+'|'+match.candidate.startDate+'::'+resolution;
        if(chartKey===key&&chart)return;
        chart?.destroy();chartKey=key;
        chart=window.HtfPriceChart.create(canvas,tip,{zone,price,candidate:match.candidate,resolution});
    }
    by('htf-chart-resolution').onchange=draw;
    by('htf-chart-zoom-in').onclick=()=>chart?.zoom(.8);
    by('htf-chart-zoom-out').onclick=()=>chart?.zoom(1.25);
    by('htf-chart-reset').onclick=()=>chart?.reset();
    by('htf-chart-fit').onclick=()=>chart?.fit();
    for(const id of['htf-mode','htf-timeframe','htf-direction'])by(id).onchange=render;
    by('htf-retry').onclick=load;root.addEventListener('htf-visible',()=>snapshot?render():load());new ResizeObserver(()=>{if(selected&&!panel.hidden)draw();}).observe(canvas);
})();
