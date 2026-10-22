(() => {
    const root = document.querySelector('.seasonality-page');
    if (!root) return;
    const byId = id => document.getElementById(id);
    const panel = byId('market-cot-view');
    const seasonality = byId('market-seasonality-view');
    const status = byId('cot-status');
    const content = byId('cot-content');
    const tooltip = byId('cot-chart-tooltip');
    const history = byId('cot-history');
    const lookback = byId('cot-lookback');
    const retry = byId('cot-retry');
    const exportButton = byId('cot-export');
    const indexGroups = new Set(['commercial', 'nonCommercial', 'nonReportable']);
    const indexButtons = [...root.querySelectorAll('[data-cot-index-group]')];
    const tabs = [...root.querySelectorAll('[data-market-tab]')];
    const groups = [
        { key: 'nonReportable', name: 'Malí obchodníci', color: '#f28aa8', chart: 'cot-small-chart' },
        { key: 'commercial', name: 'Komerční obchodníci', color: '#24dfcf', chart: 'cot-commercial-chart' },
        { key: 'nonCommercial', name: 'Velcí spekulanti', color: '#7098ff', chart: 'cot-large-chart' }
    ];
    const cache = new Map();
    let asset = JSON.parse(byId('seasonality-assets').textContent)[0];
    let payload = null;
    let currency = null;
    let request = null;
    let points = [];
    let analogVersion = 0;
    const analogPriceCache = new Map();
    const number = value => value == null ? '—' : new Intl.NumberFormat('cs-CZ').format(value);
    const signed = value => value == null ? '—' : `${value > 0 ? '+' : ''}${number(value)}`;
    const dateLabel = value => new Date(`${value}T00:00:00Z`).toLocaleDateString('cs-CZ', { timeZone: 'UTC' });
    const element = (tag, text, className) => {
        const node = document.createElement(tag);
        if (text != null) node.textContent = text;
        if (className) node.className = className;
        return node;
    };
    const market = () => payload?.markets.find(item => item.key === currency);

    function switchTab(tab) {
        const cotActive = tab.dataset.marketTab === 'cot';
        const screenerActive = tab.dataset.marketTab === 'screener';
        const zonesActive = tab.dataset.marketTab === 'zones';
        const swingActive = tab.dataset.marketTab === 'swing';
        tabs.forEach(button => {
            const active = button === tab;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-selected', String(active));
            button.tabIndex = active ? 0 : -1;
        });
        panel.hidden = !cotActive;
        seasonality.hidden = cotActive || screenerActive || zonesActive || swingActive;
        byId('market-screener-view').hidden = !screenerActive;
        byId('market-zones-view').hidden = !zonesActive;
        byId('market-swing-view').hidden = !swingActive;
        root.classList.toggle('is-screener', screenerActive || zonesActive || swingActive);
        byId('market-instrument-title').textContent = swingActive ? 'Swing Honzy Šrajera' : zonesActive ? 'Obchodní zóny' : screenerActive ? 'Screener' : asset?.name || 'Instrument';
        tooltip.hidden = true;
        if (cotActive) load();
        else if (screenerActive) root.dispatchEvent(new CustomEvent('screener-visible'));
        else if (zonesActive) root.dispatchEvent(new CustomEvent('zones-visible'));
        else if (swingActive) root.dispatchEvent(new CustomEvent('swing-visible'));
        else root.dispatchEvent(new CustomEvent('seasonality-visible'));
    }
    tabs.forEach(tab => {
        tab.onclick = () => switchTab(tab);
        tab.onkeydown = event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const index = tabs.indexOf(tab);
            const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1]
                : tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
            next.focus();
            switchTab(next);
        };
    });

    async function load(force = false) {
        if (!asset || panel.hidden) return;
        analogVersion++;
        const key = `${asset.key}:${lookback.value}`;
        request?.abort();
        request = new AbortController();
        const currentRequest = request;
        payload = null;
        points = [];
        tooltip.hidden = true;
        byId('cot-asset-title').textContent = `COT · ${asset.name}`;
        byId('cot-report-meta').textContent = 'CFTC Legacy · Futures Only';
        byId('cot-market-switch').replaceChildren();
        byId('cot-market-note').textContent = '';
        byId('cot-market-note').hidden = true;
        content.hidden = true;
        exportButton.disabled = true;
        status.textContent = 'Načítám COT reporty…';
        status.classList.remove('is-error');
        retry.hidden = true;
        panel.setAttribute('aria-busy', 'true');
        try {
            if (!force && cache.has(key)) payload = cache.get(key);
            else {
                let data;
                if (window.StaticMarketData) data = await window.StaticMarketData.cot(asset.key, Number(lookback.value), currentRequest.signal);
                else {
                    const url = new URL(root.dataset.cotUrl, window.location.href);
                    url.searchParams.set('assetKey', asset.key);
                    url.searchParams.set('lookbackWeeks', lookback.value);
                    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: currentRequest.signal });
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    data = await response.json();
                }
                if (currentRequest !== request) return;
                payload = data;
                cache.set(key, data);
            }
            if (!payload.markets.some(item => item.key === currency))
                currency = (payload.markets.find(item => !item.isDollarIndex) || payload.markets[0])?.key;
            render();
        } catch (error) {
            if (error.name === 'AbortError' || currentRequest !== request) return;
            status.textContent = 'COT data se nepodařilo načíst. Zkus to znovu.';
            status.classList.add('is-error');
            retry.hidden = false;
        } finally {
            if (currentRequest === request) panel.setAttribute('aria-busy', 'false');
        }
    }

    function render() {
        if (!payload) return;
        byId('cot-market-note').textContent = payload.markets.some(m=>m.isDollarIndex)&&asset.assetClass==='forex'
            ? 'COT popisuje futures na jednotlivé měny, nikoli celý spotový pár. USD je v relativním COT neutrální reference u=0. DXY je pouze samostatný doplňkový kontext, nikoli COT samotného USD. Long kotované měny působí vůči páru opačně.'
            : payload.note || '';
        byId('cot-market-note').hidden = !payload.note;
        const switcher = byId('cot-market-switch');
        switcher.replaceChildren();
        payload.markets.forEach(item => {
            const button = element('button', `${item.isDollarIndex ? 'DXY · doplňkový kontext' : item.key} · ${item.name}`);
            button.type = 'button';
            button.setAttribute('aria-pressed', String(item.key === currency));
            button.classList.toggle('is-active', item.key === currency);
            button.onclick = () => { currency = item.key; tooltip.hidden = true; render(); };
            switcher.append(button);
        });
        const selectedMarket = market();
        if (!selectedMarket) {
            status.textContent = 'Odpovídající COT report není dostupný. Podporujeme forex, DXY, komodity, vybrané indexy, kryptoměny a ETF s označeným futures proxy.';
            content.hidden = true;
            retry.hidden = true;
            return;
        }
        const reports = selectedMarket.reports;
        if (!reports.length) {
            status.textContent = 'Historie COT zatím není v databázi. Načte ji automatická aktualizace po pushi nebo denní běh. Potom zkus načíst data znovu.';
            content.hidden = true;
            retry.hidden = false;
            return;
        }
        retry.hidden = true;
        const latest = reports[reports.length - 1];
        const ageDays = Math.floor((Date.now() - Date.parse(`${latest.date}T00:00:00Z`)) / 86400000);
        byId('cot-report-meta').textContent = `${payload.reportType} · ${selectedMarket.name} · CFTC ${selectedMarket.contractCode} · pozice k ${dateLabel(latest.date)}`;
        const notices = [];
        if (selectedMarket.key === 'LUMBEROLD') notices.push('Historická řada ukončeného kontraktu; nové reporty zde nepřibývají.');
        else if (ageDays > 14) notices.push(`Poslední report je starý ${ageDays} dní. CFTC nemusí tento trh zveřejňovat každý týden; zkontroluj také aktualizaci dat.`);
        if (latest.commercial.index == null && latest.nonCommercial.index == null && latest.nonReportable.index == null)
            notices.push(`COT index není dostupný: potřebuje ${lookback.value} reportů a nenulový rozsah čistých pozic.`);
        status.textContent = notices.join(' ');
        content.hidden = false;
        exportButton.disabled = false;
        root.dataset.cotMarket = selectedMarket.key;
        indexButtons.forEach(button => {
            const group = groups.find(item => item.key === button.dataset.cotIndexGroup);
            const names = { nonReportable: 'Malí', commercial: 'Komerční', nonCommercial: 'Velcí' };
            button.textContent = `${names[group.key]} · ${number(latest[group.key].index)}`;
        });
        const cutoff = new Date(`${latest.date}T00:00:00Z`);
        cutoff.setUTCFullYear(cutoff.getUTCFullYear() - Number(history.value));
        points = history.value === 'all' ? reports : reports.filter(row => Date.parse(`${row.date}T00:00:00Z`) >= cutoff.getTime());
        renderSummary(latest);
        renderAnalogs();
        draw();
        const table = byId('cot-report-table');
        table.replaceChildren();
        // Keep a long history usable without adding thousands of DOM rows at once.
        [...points].reverse().slice(0, 260).forEach(row => {
            const tr = element('tr');
            [dateLabel(row.date), signed(row.nonReportable.net), signed(row.nonReportable.change),
                signed(row.commercial.net), signed(row.commercial.change), signed(row.nonCommercial.net),
                signed(row.nonCommercial.change), number(row.openInterest)].forEach(value => tr.append(element('td', value)));
            table.append(tr);
        });
    }

    async function renderAnalogs() {
        const mapping=asset?window.CoreMarkets.get(asset.key):null,relative=mapping?.cotMode==='relative-cot-state-v1';
        const selectedMarket=relative?window.CoreCot.market(mapping,payload?.markets||[],window.StaticMarketData?.exportedAt):market();
        if(!selectedMarket||!asset)return;
        byId('cot-analog-group').disabled=relative;
        if(relative)byId('cot-analog-group').value='commercial';
        const version=++analogVersion,key=asset.key,name=asset.name;
        const resultNode=byId('cot-analog-results'),message=byId('cot-analog-status');
        const mode=byId('cot-analog-mode').value;
        byId('cot-analog-tolerance').disabled=mode!=='latest';
        resultNode.replaceChildren();message.textContent='Porovnávám historické COT a ceny…';
        try {
            if(!analogPriceCache.has(key)) {
                const pending=(async()=>{
                    if(window.StaticMarketData)return (await window.StaticMarketData.prices(key)).prices;
                    const url=new URL(root.dataset.dataUrl,window.location.href);url.searchParams.set('assetKey',key);
                    const response=await fetch(url,{headers:{Accept:'application/json'}});
                    if(!response.ok)throw new Error(`HTTP ${response.status}`);
                    return (await response.json()).prices;
                })();
                analogPriceCache.set(key,pending);
                pending.catch(()=>{if(analogPriceCache.get(key)===pending)analogPriceCache.delete(key);});
            }
            const prices=await analogPriceCache.get(key);
            if(version!==analogVersion||panel.hidden)return;
            const asOf=(window.StaticMarketData?.exportedAt||new Date().toISOString()).slice(0,10);
            const result=window.CotAnalogs.analyze(selectedMarket.reports,prices,{group:byId('cot-analog-group').value,
                mode,tolerance:Number(byId('cot-analog-tolerance').value),lookback:relative?52:Number(lookback.value),asOf,
                evaluationAt:window.StaticMarketData?.exportedAt||asOf});
            if(!result.range){message.textContent='Pro poslední report není index této skupiny dostupný. Zkus jinou skupinu nebo historický extrém.';return;}
            const n=result.samples.length;
            if(relative)resultNode.append(element('p',window.CoreMarkets.sourceText(mapping)+'. Relative COT používá vždy 52 reportů; horní lookback ovládá jen grafy jednotlivých měn. Historicky neznámá dostupnost není doplněna zpětně.'));
            message.textContent=`COT ${selectedMarket.name} → výnos ceny ${name}. Index ${number(result.range[0])}–${number(result.range[1])}, lookback ${lookback.value} reportů. Reference ${dateLabel(result.referenceDate)}${mode==='latest'?` · index ${number(result.target)}`:''}. ${n} nepřekrývajících se případů z ${result.candidates} podobných reportů. Ceny ${result.firstPriceDate?dateLabel(result.firstPriceDate):'—'} až ${result.lastPriceDate?dateLabel(result.lastPriceDate):'—'}.`;
            const caution=element('p',n<8?'Malý vzorek: méně než 8 případů. Výsledky mohou být náhodné.':'Historické srovnání, nikoli nákupní / prodejní signál.');
            if(relative)message.textContent=message.textContent.replace(`lookback ${lookback.value} reportů`,'lookback 52 reportů');
            caution.className='cot-analog-caution';resultNode.append(caution);
            if(!n){resultNode.append(element('p','Žádný případ s kompletními cenami pro všechny tři horizonty. Zkus širší toleranci nebo jinou skupinu / situaci.'));return;}
            const pct=value=>value==null?'—':`${value>0?'+':''}${new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:2}).format(value)} %`;
            const wrap=element('div',null,'seasonality-table-wrap'),table=element('table'),head=element('thead'),heading=element('tr');
            ['Po vstupu','Případů','Medián','Průměr','Kladné případy','Prostředních 50 %','Minimum / maximum'].forEach(t=>heading.append(element('th',t)));
            head.append(heading);table.append(head);const body=element('tbody');
            result.horizons.forEach(h=>{const row=element('tr');[`${h.weeks} týdny`,number(h.count),pct(h.median),pct(h.mean),`${number(Math.round(h.positive))} %`,`${pct(h.q25)} až ${pct(h.q75)}`,`${pct(h.min)} / ${pct(h.max)}`].forEach(t=>row.append(element('td',t)));body.append(row);});
            table.append(body);wrap.append(table);resultNode.append(wrap);
            const cases=element('details'),summary=element('summary',`Zobrazit jednotlivé případy (${n})`),caseWrap=element('div',null,'seasonality-table-wrap'),caseTable=element('table'),caseHead=element('thead'),caseHeading=element('tr');
            ['Datum pozic','Index','Vstupní close','Za 2 týdny','Za 4 týdny','Za 8 týdnů','Konec 8 týdnů'].forEach(t=>caseHeading.append(element('th',t)));
            caseHead.append(caseHeading);caseTable.append(caseHead);const caseBody=element('tbody');
            [...result.samples].reverse().forEach(s=>{const row=element('tr');[dateLabel(s.reportDate),number(s.index),dateLabel(s.entryDate),pct(s.outcomes[2].returnPct),pct(s.outcomes[4].returnPct),pct(s.outcomes[8].returnPct),dateLabel(s.outcomes[8].date)].forEach(t=>row.append(element('td',t)));caseBody.append(row);});
            caseTable.append(caseBody);caseWrap.append(caseTable);cases.append(summary,caseWrap);resultNode.append(cases);
        } catch(error) {
            if(version!==analogVersion)return;
            message.textContent='Historické ceny se nepodařilo načíst. Zkus analýzu znovu.';
            const button=element('button','Zkusit znovu');button.type='button';button.onclick=renderAnalogs;resultNode.append(button);
        }
    }

    function renderSummary(latest) {
        const summary = byId('cot-summary');
        summary.replaceChildren();
        const pair=asset.assetClass==='forex'&&/^[A-Z]{6}$/.test(asset.key)?[asset.key.slice(0,3),asset.key.slice(3)]:null;
        summary.classList.toggle('cot-pair-overview',Boolean(pair));
        const heading=summary.closest('details').querySelector('summary');
        heading.textContent=pair?`Společný přehled ${pair.join(' / ')} · aktuální Long / Short`:'Přehled aktuálních pozic · long / short';
        if(!pair){renderPositionCards(latest,summary,currency,false);return;}
        const reportDates=[];
        for(const [index,key]of pair.entries()){
            const item=payload.markets.find(m=>key==='USD'?m.isDollarIndex:m.key===key&&!m.isDollarIndex);
            const section=element('section',null,'cot-pair-panel');section.dataset.currency=key;section.dataset.side=index===0?'base':'quote';
            section.append(element('h3',key==='USD'?'USD · neutrální reference u=0':`COT ${key}${item?' · '+item.name:''}`));
            section.append(element('p',index===0?'Základní měna páru · long jsou nákupní pozice v této měně.':'Kotovaná měna páru · long má opačnou směrovou orientaci vůči páru.','cot-pair-side'));
            if(key==='USD')section.append(element('p','USD nemá vlastní report v tomto modelu. Níže je DXY pouze jako doplňkový kontext; nevstupuje místo USD do relativního COT.','cot-pair-reference'));
            if(!item?.reports.length){section.append(element('p',key==='USD'?'DXY kontext není k dispozici.':'COT této měny není k dispozici. Druhou měnu nenahrazujeme jiným reportem.'));summary.append(section);continue;}
            const report=item.reports.at(-1);reportDates.push(report.date);
            section.append(element('p',`${item.isDollarIndex?'DXY · US Dollar Index · samostatný kontext · ':''}Pozice k ${dateLabel(report.date)} · CFTC ${item.contractCode}`,'cot-pair-meta'));
            const grid=element('div',null,'cot-pair-grid');renderPositionCards(report,grid,`${key}-${item.key}`,true);section.append(grid);
            section.append(element('footer','Zelená: long · růžová: short · šedá: spread. Procenta jsou z long + short + spread dané skupiny, nikoli celého trhu.'));
            summary.append(section);
        }
        const note=element('p',reportDates.length===2&&reportDates[0]!==reportDates[1]
            ? 'Pozor: měny mají různá data reportů. Jde o dva samostatné přehledy, nikoli synchronní potvrzení páru.'
            : 'Obě měny vidíš současně. Pro porovnání používej podíly a kontext; počty kontraktů různých měn nejsou přímo srovnatelné.','cot-pair-notice');
        summary.append(note);
    }

    function renderPositionCards(latest,summary,marketId,paired) {
        groups.forEach(group => {
            const position = latest[group.key];
            const card = element('article', null, 'cot-summary-card');
            card.dataset.group=group.key;
            card.append(element('h3', group.name));
            const values = element('div', null, 'cot-summary-values');
            const donut = element('div', null, 'cot-donut');
            const total = position.long + position.short + position.spread;
            const percent=value=>new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:1}).format(total?100*value/total:0)+' %';
            const segments=[{name:'Long',value:position.long,color:'#24dfcf'},{name:'Short',value:position.short,color:'#f28aa8'},{name:'Spread',value:position.spread,color:'#566575'}];
            donut.setAttribute('role','group');
            donut.setAttribute('aria-label',`${group.name}: ${segments.map(s=>`${s.name} ${percent(s.value)}, ${number(s.value)} kontraktů`).join('; ')}. Podíl z long + short + spread této skupiny.`);
            const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 60 60');
            const bubble=element('div',null,'cot-donut-tooltip');bubble.hidden=true;bubble.id=`cot-position-tooltip-${String(marketId).replace(/[^A-Za-z0-9_-]/g,'')}-${group.key}`;bubble.setAttribute('role','tooltip');
            const hide=()=>{bubble.hidden=true;};
            const show=(s,event)=>{
                root.querySelectorAll('.cot-donut-tooltip').forEach(t=>{if(t!==bubble)t.hidden=true;});
                bubble.replaceChildren();const heading=element('div',null,'cot-donut-tooltip-heading'),dot=element('span',null,'cot-donut-dot');dot.style.background=s.color;
                heading.append(dot,element('b',`${s.name} ${percent(s.value)}`));
                bubble.append(heading,element('div',`${number(s.value)} kontraktů`),element('small','Podíl z long + short + spread této skupiny.'));
                bubble.hidden=false;const box=card.getBoundingClientRect(),ring=donut.getBoundingClientRect();
                const px=event?.clientX??ring.right,py=event?.clientY??ring.top;
                const pos=window.MarketChartUi.tooltipPosition(px-box.left,py-box.top,bubble.offsetWidth,bubble.offsetHeight,box.width,box.height);
                bubble.style.left=pos.left+'px';bubble.style.top=pos.top+'px';
            };
            let offset=0;
            for(const s of segments){
                if(!total||!s.value)continue;
                const share=100*s.value/total,circle=document.createElementNS('http://www.w3.org/2000/svg','circle');
                for(const [key,value]of Object.entries({cx:30,cy:30,r:24,fill:'none',stroke:s.color,'stroke-width':12,pathLength:100,'stroke-dasharray':`${share} ${100-share}`,'stroke-dashoffset':-offset,transform:'rotate(-90 30 30)',tabindex:0,role:'button','aria-label':`${s.name} ${percent(s.value)}; ${number(s.value)} kontraktů`,'aria-describedby':bubble.id,'data-position':s.name}))circle.setAttribute(key,String(value));
                circle.onpointerenter=circle.onpointermove=e=>show(s,e);circle.onpointerleave=hide;
                circle.onfocus=()=>show(s);circle.onblur=hide;circle.onpointerdown=e=>show(s,e);
                circle.onkeydown=e=>{if(e.key==='Escape')hide();if(e.key==='Enter'||e.key===' '){e.preventDefault();show(s);}};
                svg.append(circle);offset+=share;
            }
            if(!total){donut.setAttribute('aria-label',`${group.name}: žádné uvedené pozice`);donut.classList.add('is-empty');}
            donut.append(svg);card.append(bubble);
            const net = element('div');
            net.append(element('strong', signed(position.net)), element('p', 'čisté pozice (kontrakty)'),
                element('p', `Δ týdně ${signed(position.change)}`));
            values.append(donut, net);
            card.append(values);
            const dl = element('dl');
            [['Long', number(position.long)+(paired?' · '+percent(position.long):'')], ['Short', number(position.short)+(paired?' · '+percent(position.short):'')],
                ['COT index', position.index == null ? '—' : `${number(position.index)} / 100`]].forEach(([label, value]) => {
                dl.append(element('dt', label), element('dd', value));
            });
            if (group.key === 'nonCommercial') dl.append(element('dt', 'Spread'), element('dd', number(position.spread)+(paired?' · '+percent(position.spread):'')));
            card.append(dl);
            if(!paired)card.append(element('footer', 'Zelená: long · růžová: short · šedá: spread. Podíly uvedených pozic skupiny, nikoli celého trhu.'));
            summary.append(card);
        });
    }

    root.addEventListener('pointerdown',e=>{if(!e.target.closest('.cot-donut'))root.querySelectorAll('.cot-donut-tooltip').forEach(t=>t.hidden=true);});

    function chart(canvas, indexChart = false, group = null) {
        const width = Math.max(280, canvas.getBoundingClientRect().width);
        const height = canvas.getBoundingClientRect().height || (indexChart ? 340 : 260);
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        const context = canvas.getContext('2d');
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        const pad = { left: width < 500 ? 48 : 62, right: 24, top: 22, bottom: 36 };
        const w = width - pad.left - pad.right, h = height - pad.top - pad.bottom;
        if (!points.length) return;
        const values = indexChart ? [0, 100] : points.flatMap(row => [row[group.key].net, row[group.key].change ?? 0]);
        let min = Math.min(0, ...values), max = Math.max(0, ...values);
        if (min === max) { min -= 1; max += 1; }
        if (indexChart) ({ min, max } = window.MarketChartUi.indexRange);
        else { const margin = (max - min) * .12; min -= margin; max += margin; }
        const first = Date.parse(points[0].date), last = Date.parse(points[points.length - 1].date);
        const x = row => pad.left + (last === first ? .5 : (Date.parse(row.date) - first) / (last - first)) * w;
        const y = value => pad.top + (max - value) / (max - min) * h;
        context.font = '11px sans-serif';
        context.lineWidth = 1;
        const ticks = indexChart ? [0, 20, 40, 60, 80, 100] : Array.from({ length: 5 }, (_, i) => min + (max - min) * i / 4);
        ticks.forEach(value => {
            context.strokeStyle = indexChart && [20, 80].includes(value) ? '#a3b5c066' : '#ffffff13';
            context.setLineDash(indexChart && [20, 80].includes(value) ? [5, 5] : []);
            context.beginPath(); context.moveTo(pad.left, y(value)); context.lineTo(width - pad.right, y(value)); context.stroke();
            context.fillStyle = '#8794a4'; context.textAlign = 'right';
            context.fillText(indexChart ? String(value) : Intl.NumberFormat('cs-CZ', { notation: 'compact', maximumFractionDigits: 1 }).format(value), pad.left - 9, y(value) + 4);
        });
        context.setLineDash([]);
        if (indexChart) {
            context.fillStyle = '#f28aa80b'; context.fillRect(pad.left, y(100), w, y(80) - y(100));
            context.fillStyle = '#24dfcf0b'; context.fillRect(pad.left, y(20), w, y(0) - y(20));
        } else {
            context.strokeStyle = '#ffffff45'; context.beginPath(); context.moveTo(pad.left, y(0)); context.lineTo(width - pad.right, y(0)); context.stroke();
            const barWidth = Math.max(1, Math.min(14, w * 604800000 / Math.max(last - first, 604800000) * .65));
            context.fillStyle = `${group.color}75`;
            points.forEach(row => {
                const change = row[group.key].change;
                if (change == null) return;
                context.fillRect(x(row) - barWidth / 2, Math.min(y(0), y(change)), barWidth, Math.max(1, Math.abs(y(change) - y(0))));
            });
        }
        const line = (field, color, indexed) => {
            context.strokeStyle = color; context.lineWidth = indexed ? 1.5 : 1.7;
            context.setLineDash([]);
            context.lineJoin = 'round'; context.lineCap = 'round'; context.beginPath();
            let started = false;
            let previousDate = null;
            points.forEach(row => {
                const value = row[field][indexed ? 'index' : 'net'];
                const timestamp = Date.parse(row.date);
                if (previousDate != null && timestamp - previousDate > 10 * 86400000) started = false;
                previousDate = timestamp;
                if (value == null) { started = false; return; }
                if (started) context.lineTo(x(row), y(value)); else context.moveTo(x(row), y(value));
                started = true;
            });
            context.stroke();
            context.setLineDash([]);
            // A single report should still be visible.
            if (points.length === 1) {
                const value = points[0][field][indexed ? 'index' : 'net'];
                if (value != null) { context.fillStyle = color; context.beginPath(); context.arc(x(points[0]), y(value), 3, 0, 2 * Math.PI); context.fill(); }
            }
        };
        const visibleGroups = indexChart ? groups.filter(item => indexGroups.has(item.key)) : [group];
        if (indexChart) visibleGroups.forEach(item => line(item.key, item.color, true));
        else line(group.key, group.color, false);
        context.fillStyle = '#8794a4'; context.textAlign = 'center';
        const count = width < 500 ? 3 : 6;
        for (let i = 0; i < count; i++) {
            const position = i / (count - 1);
            const date = new Date(first + (last - first) * position);
            context.fillText(date.toLocaleDateString('cs-CZ', { month: 'short', year: '2-digit', timeZone: 'UTC' }), pad.left + position * w, height - 8);
        }
        // Reuse the drawn chart while hovering; do not rerender the entire history
        // on every pointer movement. The crosshair pinpoints the actual report.
        const base = document.createElement('canvas');
        base.width = canvas.width; base.height = canvas.height;
        base.getContext('2d').drawImage(canvas, 0, 0);
        const restore = () => { context.clearRect(0, 0, width, height); context.drawImage(base, 0, 0, width, height); };
        canvas.onpointermove = event => {
            const rect = canvas.getBoundingClientRect();
            if (!points.length || !market() || event.clientX < rect.left + pad.left || event.clientX > rect.left + width - pad.right
                || event.clientY < rect.top + pad.top || event.clientY > rect.top + height - pad.bottom) {
                restore(); tooltip.hidden = true; return;
            }
            const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left - pad.left) / w));
            const timestamp = first + fraction * (last - first);
            const row = points.reduce((a, b) => Math.abs(Date.parse(a.date) - timestamp) < Math.abs(Date.parse(b.date) - timestamp) ? a : b);
            const text = indexChart
                ? visibleGroups.map(item => `${item.name}: ${row[item.key].index == null ? '—' : number(row[item.key].index)}`).join('\n')
                : `${group.name}\nNet: ${signed(row[group.key].net)} kontraktů\nΔ týdně: ${signed(row[group.key].change)}\nLong: ${number(row[group.key].long)} · Short: ${number(row[group.key].short)}`;
            tooltip.textContent = `${market().key} · pozice k ${dateLabel(row.date)}\n${text}`;
            restore();
            context.save();
            context.strokeStyle = '#cedae080'; context.lineWidth = 1; context.setLineDash([4, 4]);
            context.beginPath(); context.moveTo(x(row), pad.top); context.lineTo(x(row), height - pad.bottom); context.stroke();
            context.setLineDash([]);
            visibleGroups.forEach(item => {
                const value = row[item.key][indexChart ? 'index' : 'net'];
                if (value == null) return;
                context.fillStyle = item.color; context.strokeStyle = '#15191c'; context.lineWidth = 2;
                context.beginPath(); context.arc(x(row), y(value), 4, 0, 2 * Math.PI); context.fill(); context.stroke();
            });
            context.restore();
            tooltip.hidden = false;
            const position = window.MarketChartUi.tooltipPosition(event.clientX, event.clientY,
                tooltip.offsetWidth, tooltip.offsetHeight, window.innerWidth, window.innerHeight);
            tooltip.style.left = `${position.left}px`;
            tooltip.style.top = `${position.top}px`;
        };
        canvas.onpointerleave = () => { restore(); tooltip.hidden = true; };
    }

    function draw() {
        if (panel.hidden || content.hidden) return;
        groups.forEach(group => chart(byId(group.chart), false, group));
        chart(byId('cot-index-chart'), true);
    }
    root.addEventListener('asset-change', event => {
        if (event.detail?.key === asset?.key) return;
        asset = event.detail;
        analogVersion++;
        request?.abort();
        tooltip.hidden = true;
        load();
    });
    history.onchange = render;
    ['cot-analog-group','cot-analog-mode','cot-analog-tolerance'].forEach(id=>byId(id).onchange=renderAnalogs);
    lookback.onchange = () => load();
    retry.onclick = () => load(true);
    indexButtons.forEach(button => {
        button.onclick = () => {
            const key = button.dataset.cotIndexGroup;
            if (indexGroups.has(key)) {
                if (indexGroups.size === 1) return;
                indexGroups.delete(key);
            } else indexGroups.add(key);
            indexButtons.forEach(item => item.setAttribute('aria-pressed', String(indexGroups.has(item.dataset.cotIndexGroup))));
            tooltip.hidden = true;
            draw();
        };
    });
    document.addEventListener('scroll', () => { tooltip.hidden = true; }, true);
    window.addEventListener('resize', () => { tooltip.hidden = true; });
    new ResizeObserver(draw).observe(panel);
})();
