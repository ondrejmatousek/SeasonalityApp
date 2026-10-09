(() => {
    const root = document.querySelector('.seasonality-page');
    if (!root) return;
    const byId = id => document.getElementById(id);
    const controls = ['horizon','lookback','direction','minimum','sort','search'].map(key=>byId('screener-'+key));
    const status = byId('screener-status'), body = byId('screener-results'), retry = byId('screener-retry');
    let snapshot, pending;
    const pct = value => value == null ? '—' : `${value > 0 ? '+' : ''}${value.toLocaleString('cs-CZ',{maximumFractionDigits:2,minimumFractionDigits:2})} %`;
    const number = value => value == null ? '—' : value.toLocaleString('cs-CZ',{maximumFractionDigits:1});
    const date = value => new Date(value+'T00:00:00Z').toLocaleDateString('cs-CZ',{timeZone:'UTC'});
    const cell = (row, text, color) => { const td=document.createElement('td');td.textContent=text;if(color)td.className=color;row.append(td);return td; };
    function render() {
        if (!snapshot) return;
        const [horizon,lookback,direction,minimum,sort,search] = controls.map(item=>item.value);
        const term = search.toLocaleLowerCase('cs-CZ').trim();
        const results = snapshot.assets.map(asset=>({asset,stats:asset.windows[`${horizon}:${lookback}`]}))
            .filter(({asset,stats:s})=>s && s.count>=Number(minimum) && s.median!=null
                && (direction==='all' || (direction==='up' ? s.median>0 : s.median<0))
                && (!term || `${asset.key} ${asset.name} ${(asset.aliases || []).join(' ')}`.toLocaleLowerCase('cs-CZ').includes(term)));
        results.sort((a,b)=> (sort==='lowest' ? a.stats.median-b.stats.median : sort==='wins' ? b.stats.winRate-a.stats.winRate
            : sort==='count' ? b.stats.count-a.stats.count : b.stats.median-a.stats.median) || a.asset.key.localeCompare(b.asset.key));
        const fragment=document.createDocumentFragment();
        for (const {asset,stats:s} of results) {
            const tr=document.createElement('tr');
            cell(tr,`${asset.key} · ${asset.name}`);
            cell(tr,`${s.count}${s.count<10 ? ' · malý vzorek' : ''}`,s.count<10?'screener-warning':null);
            cell(tr,pct(s.mean),s.mean>=0?'screener-positive':'screener-negative');
            cell(tr,pct(s.median),s.median>=0?'screener-positive':'screener-negative');
            cell(tr,`${number(s.winRate)} %`);cell(tr,pct(s.medianDrop),'screener-negative');
            const cot=cell(tr,'');
            if (!asset.cot.length) cot.textContent='Není k dispozici';
            for (const market of asset.cot) {
                const item=document.createElement('div');
                const stale = !market.date || (Date.parse(snapshot.asOf)-Date.parse(market.date))/86400000>14;
                item.textContent=`${market.key}: ${number(market.index)} / 100 · Δ ${market.change>0?'+':''}${number(market.change)}`;
                const meta=document.createElement('small');meta.textContent=market.date?`${date(market.date)}${stale?' · starší report':''}`:'Chybí report';
                item.title=asset.cotNote || market.name;item.append(meta);cot.append(item);
            }
            const priceAge = asset.lastDate ? (Date.parse(snapshot.asOf)-Date.parse(asset.lastDate))/86400000 : Infinity;
            if (priceAge>7) { const note=document.createElement('small');note.className='screener-warning';note.textContent=`Starší cenová data: ${asset.lastDate || 'chybí'}`;tr.firstChild.append(note); }
            const action=cell(tr,''),button=document.createElement('button');button.type='button';button.textContent='Otevřít';button.setAttribute('aria-label',`Otevřít ${asset.key} v Seasonality`);
            button.onclick=()=>root.dispatchEvent(new CustomEvent('screener-open',{detail:{key:asset.key,asOf:snapshot.asOf,days:Number(horizon),sampleYears:s.years}}));
            action.append(button);fragment.append(tr);
        }
        body.replaceChildren(fragment);
        status.textContent=`${results.length} instrumentů · od ${date(snapshot.asOf)} · ${horizon} kalendářních dní · data exportována ${new Date(snapshot.exportedAt).toLocaleString('cs-CZ')}.`;
        if (!results.length) status.textContent+=' Žádný výsledek; zkus jiné filtry nebo nižší minimum let.';
    }
    async function load() {
        if (snapshot) { render();return; }
        if (pending) return;
        if (!window.StaticMarketData) {status.textContent='Screener je dostupný ve statické verzi aplikace.';return;}
        status.textContent='Načítám přehled instrumentů…';retry.hidden=true;
        pending=true;
        try {snapshot=await window.StaticMarketData.screener();render();}
        catch {status.textContent='Přehled se nepodařilo načíst. Obnov stránku nebo zkus znovu.';retry.hidden=false;}
        finally {pending=false;}
    }
    controls.forEach(control=>control.addEventListener(control.type==='search'?'input':'change',render));
    root.addEventListener('screener-visible',load);retry.onclick=load;
})();
