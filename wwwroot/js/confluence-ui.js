(() => {
    const root=document.querySelector('.seasonality-page');
    if(!root)return;
    const byId=id=>document.getElementById(id),panel=byId('seasonality-confluence');
    const controls=['direction','group','tolerance','market','lookback','history'];
    const results=byId('confluence-results'),status=byId('confluence-status');
    const number=(value,digits=1)=>value==null?'—':new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:digits}).format(value);
    const pct=value=>value==null?'—':`${number(value)} %`;
    const signed=value=>value==null?'—':`${value>0?'+':''}${number(value,2)} %`;
    const date=value=>new Date(value+'T00:00:00Z').toLocaleDateString('cs-CZ',{timeZone:'UTC'});
    const period=interval=>[interval.startDay,interval.endDay].map(d=>new Date(Date.UTC(2001,0,1+d)).toLocaleDateString('cs-CZ',{day:'numeric',month:'numeric',timeZone:'UTC'})).join(' – ');
    const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(className)n.className=className;return n;};
    let state=null,signature='',lastPrices=null,version=0,timer=null,marketAsset=null;
    const cache=new Map();

    function schedule(force=false){
        if(!state)return;
        const key=JSON.stringify([state.asset?.key,state.interval,state.asOf,state.historyYears,state.selectedYears,...controls.map(k=>byId('confluence-'+k).value)]);
        if(!force&&key===signature&&lastPrices===state.prices)return;
        signature=key;lastPrices=state.prices;version++;clearTimeout(timer);
        panel.setAttribute('aria-busy','false');
        results.replaceChildren();status.textContent='';
        const valid=!!state.interval&&state.interval.startDay<state.interval.endDay;
        byId('confluence-body').hidden=!valid;byId('confluence-placeholder').hidden=valid;
        if(!valid)return;
        status.textContent=state.prices.length?'Porovnávám stejné období v minulých letech…':'Čekám na ceny vybraného instrumentu…';
        if(state.prices.length)timer=setTimeout(()=>render(version),120);
    }

    async function loadCot(key,lookback){
        const cacheKey=`${key}:${lookback}`;
        if(!cache.has(cacheKey)){
            const pending=(async()=>{
                if(window.StaticMarketData)return window.StaticMarketData.cot(key,lookback);
                const url=new URL(root.dataset.cotUrl,location.href);
                url.searchParams.set('assetKey',key);url.searchParams.set('lookbackWeeks',lookback);
                const response=await fetch(url,{headers:{Accept:'application/json'}});
                if(!response.ok)throw new Error(`HTTP ${response.status}`);
                return response.json();
            })();
            cache.set(cacheKey,pending);
            pending.catch(()=>{if(cache.get(cacheKey)===pending)cache.delete(cacheKey);});
        }
        return cache.get(cacheKey);
    }

    function table(headers,rows,caption){
        const wrap=el('div',null,'seasonality-table-wrap'),node=el('table',null,'reliability-table');
        if(caption)node.append(el('caption',caption));
        const head=el('thead'),tr=el('tr');headers.forEach(s=>tr.append(el('th',s)));head.append(tr);node.append(head);
        const body=el('tbody');rows.forEach(row=>{const tr=el('tr');row.forEach(s=>tr.append(el('td',s)));body.append(tr);});
        node.append(body);wrap.append(node);return wrap;
    }
    const rate=s=>s.count?`${s.successes} / ${s.count} · ${pct(s.rate)}`:'Žádné případy';
    const band=s=>s.uncertainty?`${pct(s.uncertainty[0])} – ${pct(s.uncertainty[1])}`:'—';
    function probabilityTile(title,s,primary){
        const tile=el('div',null,`confluence-tile${primary?' is-primary':''}${primary&&s.count<8?' is-small-sample':''}`);
        tile.append(el('span',title),el('strong',primary&&s.count<8?'Málo dat':pct(s.rate)),
            el('p',s.count?`${s.successes} z ${s.count} období ve zvoleném směru`:'Žádné dokončené případy'),
            el('small',primary&&s.count<8?'Méně než 8 podobných případů v této historii: procento nezvýrazňujeme.':`Nejistota historické četnosti: ${band(s)} (95% interval spolehlivosti)`));
        return tile;
    }

    async function render(currentVersion){
        const captured=state,key=captured.asset.key,lookback=Number(byId('confluence-lookback').value);
        const group=byId('confluence-group').value,direction=byId('confluence-direction').value;
        const tolerance=Number(byId('confluence-tolerance').value),history=byId('confluence-history').value;
        panel.setAttribute('aria-busy','true');
        try{
            const payload=await loadCot(key,lookback);
            if(currentVersion!==version)return;
            const selector=byId('confluence-market');
            const previous=marketAsset===key?selector.value:null;
            selector.replaceChildren();
            for(const m of payload.markets)selector.append(new Option(`${m.isDollarIndex?'DXY / USD':m.key} · ${m.name}`,m.key));
            selector.value=payload.markets.some(m=>m.key===previous)?previous:(payload.markets.find(m=>!m.isDollarIndex)||payload.markets[0])?.key||'';
            marketAsset=key;
            // Avoid a redundant resize-driven request after populating the market select.
            signature=JSON.stringify([captured.asset.key,captured.interval,captured.asOf,captured.historyYears,captured.selectedYears,...controls.map(k=>byId('confluence-'+k).value)]);
            const market=payload.markets.find(m=>m.key===selector.value);
            if(!market){status.textContent='Pro tento instrument nemáme odpovídající COT. Společné srovnání nelze spočítat; sezonální analýza nad tím zůstává dostupná.';return;}
            const r=window.SeasonalityConfluence.analyze(market.reports,captured.prices,{...captured.interval,asOf:captured.asOf,
                group,direction,tolerance,historyYears:captured.historyYears,selectedYears:captured.selectedYears,comparison:'snapshot'});
            if(!r.referenceUsable){
                status.textContent=!r.reference?'Chybí odhadovaně dostupný referenční COT report.':r.reference.ageDays>21
                    ?`Poslední odhadovaně dostupný report je z ${date(r.reference.date)} (${number(r.reference.ageDays,0)} dní). Je příliš starý pro srovnání s dneškem.`
                    :'Poslední odhadovaně dostupný report nemá index této skupiny. Zkus jinou skupinu nebo kratší lookback.';
                return;
            }
            const year=Number(captured.asOf.slice(0,4)),yearsLabel=captured.historyYears?`${year-captured.historyYears}–${year-1}`:'vybrané dokončené roky';
            status.textContent=`${captured.asset.name} · ${period(captured.interval)} · historie ${yearsLabel}, stejný výběr roků jako v grafu. COT ${market.name} / ${byId('confluence-group').selectedOptions[0].textContent}. Reference: pozice k ${date(r.reference.date)}, index ${number(r.reference.index,2)}, podobnost ${number(r.range[0],2)}–${number(r.range[1],2)} / 100; lookback ${lookback} reportů. COT v historii posuzujeme k výročí ${date(captured.asOf)}, stejně jako Screener (nikoli až k budoucímu vstupu).`;
            if(payload.note)results.append(el('p',payload.note,'cot-market-note'));
            results.append(el('h3',`Jak často byla cena ${captured.asset.name} na konci období ${direction==='up'?'výše':'níže'}?`));
            const caution=r.conditional.count<8?'Málo společných případů. Pro rozhodování zatím nemáme dost podkladů.':r.conditional.count<20
                ?'Malý společný vzorek. Procento ber jako nejistou historickou četnost, ne obchodní signál.'
                :'Historická četnost, nikoli ověřená pravděpodobnost budoucího obchodu.';
            results.append(el('p',caution,'confluence-caution'));
            const tiles=el('div',null,'confluence-tiles');
            tiles.append(probabilityTile(`Podobný COT · ${yearsLabel}`,r.conditional,true),probabilityTile(`Sezonalita · ${yearsLabel}`,r.seasonal,false));
            const delta=el('div',null,'confluence-tile');
            delta.append(el('span','Rozdíl historických četností'),el('strong',r.conditional.count<8||r.delta==null?'—':`${r.delta>0?'+':''}${number(r.delta)} p. b.`),
                el('p',r.conditional.count<8?'Vzorek je příliš malý pro zvýraznění rozdílu.':'Souběh minus sezonalita na stejné dostupné historii.'),
                el('small','Popisný rozdíl. Není důkazem, že COT přidává obchodní výhodu.'));
            tiles.append(delta);results.append(tiles);
            results.append(el('p',`V letech ${yearsLabel} byl COT podobný v ${r.conditional.count} z ${r.baseline.count} let s použitelným reportem. ${r.conditional.successes} z ${r.conditional.count} podobných případů skončilo ve směru. Sezonalita: ${rate(r.seasonal)}. Vyřazené COT roky: bez reportu ${r.missing}, starý report ${r.stale}, chybějící index ${r.missingIndex}. Výběr roků a filtry grafu se používají i zde. Nejistota četnosti je 95% interval spolehlivosti, ne 95% šance zisku ani rozsah budoucího výnosu.`,'confluence-context'));
            const row=(name,s)=>[name,rate(s),band(s),signed(s.median),`${signed(s.q25)} až ${signed(s.q75)}`,pct(s.medianAdverse)];
            results.append(table(['Výběr','Zvolený směr · počet / četnost','95% pásmo četnosti','Medián výnosu ceny','Prostředních 50 % výnosů','Typický pohyb proti směru'],
                [row('Sezonalita + podobný COT',r.conditional),row('Sezonalita · stejná COT historie',r.baseline)],
                'Velikost pohybu je stejně důležitá jako četnost. Výnos ceny není P&L shortu; nepříznivý pohyb vychází jen z denních close.'));
            results.append(el('p',`Největší zaznamenaný pohyb proti zvolenému směru v souběhu: ${pct(r.conditional.worstAdverse)}. Beze změny skončilo ${r.conditional.flat} společných období; nepočítají se jako úspěch.`,'confluence-context'));
            const temporal=el('details',null,'confluence-time-check');
            temporal.append(el('summary','Drží výsledek i v posledních letech?'));
            temporal.append(table(['Souběh','Počet / četnost','Medián výnosu ceny'],[
                [`Starší roky · před ${r.recentYear}`,rate(r.older),signed(r.older.median)],
                [`Posledních 5 dokončených let · ${r.recentYear}–${Number(captured.asOf.slice(0,4))-1}`,rate(r.recent),signed(r.recent.median)]
            ]));
            temporal.append(el('p','Jde jen o časovou kontrolu při stejném dnešním nastavení, ne nezávislé ověření. Malé počty mohou výsledek výrazně měnit.'));
            results.append(temporal);
            const cases=el('details',null,'confluence-cases');
            cases.append(el('summary',`Ukázat jednotlivé roky a použité COT (${r.cases.length})`));
            cases.append(table(['Rok','Vstup · close','Výstup · close','Pozice k','Tehdejší index','Podobný COT?','Výnos ceny','Pohyb proti směru'],[...r.cases].reverse().map(s=>[
                s.year,date(s.start),date(s.end),date(s.reportDate),number(s.index,2),s.matched?'Ano':'Ne',signed(s.returnPct),pct(direction==='up'?-s.maxDrop:s.maxRise)
            ])));
            results.append(cases);
            results.append(el('p','Zatím bez nezávislého ověření na nedotčených datech. Dostupnost COT je odhadnutá jako datum pozic + 7 dní; obchodní náklady nejsou započtené.','confluence-footnote'));
        }catch(error){
            if(currentVersion!==version)return;
            status.textContent='Společnou analýzu se nepodařilo načíst. Sezonalita a grafy mohou dál fungovat.';
            const retry=el('button','Zkusit znovu','cot-retry');retry.type='button';retry.onclick=()=>schedule(true);results.append(retry);
        }finally{if(currentVersion===version)panel.setAttribute('aria-busy','false');}
    }
    controls.forEach(k=>byId('confluence-'+k).addEventListener('change',()=>schedule(true)));
    root.addEventListener('seasonality-interval-change',event=>{state=event.detail;schedule();});
})();
