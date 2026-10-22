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
    const columnFilters=[];
    const headers=[...root.querySelectorAll('[data-screener-field]')];
    const columnSearch=document.createElement('input');columnSearch.type='search';columnSearch.placeholder='Ticker / název';columnSearch.setAttribute('aria-label','Filtr sloupce Instrument');
    const cotFilter=document.createElement('select');cotFilter.setAttribute('aria-label','Filtr dostupnosti COT');
    for (const [value,label] of [['all','Vše'],['yes','S COT daty'],['no','Bez COT dat']]) {const option=document.createElement('option');option.value=value;option.textContent=label;cotFilter.append(option);}
    cotFilter.value='yes';
    for (const header of headers) {
        const field=header.dataset.screenerField,label=header.textContent;
        header.dataset.label=label;
        const button=document.createElement('button');button.type='button';button.className='screener-sort-button';button.textContent=label;header.replaceChildren(button);
        for (const direction of ['asc','desc']) {
            const option=document.createElement('option');option.value=`${field}:${direction}`;
            option.textContent=`${label}: ${field==='cot' ? (direction==='desc'?'s daty první':'bez dat první') : direction==='asc'?'vzestupně':'sestupně'}`;byId('screener-sort').append(option);
        }
        button.onclick=()=> {byId('screener-sort').value=`${field}:${header.getAttribute('aria-sort')==='descending'?'asc':'desc'}`;render();};
        const filters=document.createElement('div');filters.className='screener-column-filter';header.append(filters);
        if (field==='instrument') filters.append(columnSearch);
        else if (field==='cot') filters.append(cotFilter);
        else {
            for (const [bound,placeholder] of [['min','Od'],['max','Do']]) {
                const input=document.createElement('input');input.type='number';input.step=field==='count'?'1':'any';input.placeholder=placeholder;
                input.setAttribute('aria-label',`${label} ${bound==='min'?'minimum':'maximum'}`);
                if (field==='count'||field==='winRate') input.min='0';if(field==='winRate')input.max='100';
                filters.append(input);columnFilters.push({field,bound,input});input.addEventListener('input',render);
            }
        }
    }
    columnSearch.addEventListener('input',()=>{byId('screener-search').value=columnSearch.value;render();});
    byId('screener-search').addEventListener('input',()=>{columnSearch.value=byId('screener-search').value;});
    cotFilter.addEventListener('change',render);
    byId('screener-clear-columns').onclick=()=>{columnFilters.forEach(({input})=>{input.value='';});cotFilter.value='all';columnSearch.value='';byId('screener-search').value='';render();};
    function render() {
        if (!snapshot || document.getElementById('screener-manual-view')?.hidden) return;
        const [horizon,lookback,direction,minimum,sort,search] = controls.map(item=>item.value);
        const term = search.toLocaleLowerCase('cs-CZ').trim();
        const assetClass=byId('screener-asset-class').value,commodityGroup=byId('screener-commodity-group').value;
        const results = snapshot.assets.map(asset=>({asset,stats:asset.windows[`${horizon}:${lookback}`]}))
            .filter(({asset,stats:s})=>s && s.count>=Number(minimum) && s.median!=null
                && window.AssetCategories.matches(asset,assetClass,commodityGroup)
                && (direction==='all' || (direction==='up' ? s.median>0 : s.median<0))
                && (cotFilter.value==='all' || (cotFilter.value==='yes'?asset.cot.length>0:asset.cot.length===0))
                && columnFilters.every(({field,bound,input})=>!Number.isFinite(input.valueAsNumber) || (bound==='min'?s[field]>=input.valueAsNumber:s[field]<=input.valueAsNumber))
                && (!term || `${asset.key} ${asset.name} ${(asset.aliases || []).join(' ')}`.toLocaleLowerCase('cs-CZ').includes(term)));
        const [sortField,sortDirection]=(sort.includes(':')?sort:sort==='lowest'?'median:asc':sort==='wins'?'winRate:desc':sort==='count'?'count:desc':'median:desc').split(':');
        results.sort((a,b)=> {
            const compare=sortField==='instrument'?a.asset.key.localeCompare(b.asset.key):sortField==='cot'?Number(a.asset.cot.length>0)-Number(b.asset.cot.length>0):a.stats[sortField]-b.stats[sortField];
            return compare*(sortDirection==='asc'?1:-1) || a.asset.key.localeCompare(b.asset.key);
        });
        for (const header of headers) {
            const active=header.dataset.screenerField===sortField;
            header.setAttribute('aria-sort',active?(sortDirection==='asc'?'ascending':'descending'):'none');
            header.querySelector('button').textContent=header.dataset.label+(active?(sortDirection==='asc'?' ↑':' ↓'):' ↕');
        }
        const fragment=document.createDocumentFragment();
        for (const {asset,stats:s} of results) {
            const tr=document.createElement('tr');
            cell(tr,`${asset.key} · ${asset.name}`);
            cell(tr,`${s.count}${s.count<10 ? ' · malý vzorek' : ''}`,s.count<10?'screener-warning':null);
            cell(tr,pct(s.mean),s.mean>=0?'screener-positive':'screener-negative');
            cell(tr,pct(s.median),s.median>=0?'screener-positive':'screener-negative');
            const wins=cell(tr,`${number(s.winRate)} %`);
            const winsDetail=document.createElement('small');winsDetail.textContent=` · ${Math.round(s.winRate*s.count/100)} z ${s.count} let`;wins.append(winsDetail);
            cell(tr,pct(s.medianDrop),'screener-negative');
            const cot=cell(tr,'');
            if (!asset.cot.length) cot.textContent='Není k dispozici';
            for (const market of asset.cot) {
                const item=document.createElement('div');
                const stale = !market.date || (Date.parse(snapshot.asOf)-Date.parse(market.date))/86400000>14;
                item.textContent=`${market.key}: ${number(market.index)} / 100 · Δ ${market.change>0?'+':''}${number(market.change)}`;
                const meta=document.createElement('small');meta.textContent=market.date?` · Pozice k ${date(market.date)}${stale?' · starší report':''}`:' · Chybí report';
                item.title=asset.cotNote || market.name;item.append(meta);cot.append(item);
            }
            const priceAge = asset.lastDate ? (Date.parse(snapshot.asOf)-Date.parse(asset.lastDate))/86400000 : Infinity;
            if (priceAge>7) { const note=document.createElement('small');note.className='screener-warning';note.textContent=`Starší cenová data: ${asset.lastDate || 'chybí'}`;tr.firstChild.append(note); }
            const action=cell(tr,''),button=document.createElement('button');button.type='button';button.textContent='Prozkoumat';button.setAttribute('aria-label',`Prozkoumat ${asset.key} v Seasonality`);
            button.onclick=()=>root.dispatchEvent(new CustomEvent('screener-open',{detail:{key:asset.key,asOf:snapshot.asOf,days:Number(horizon),sampleYears:s.years}}));
            action.append(button);fragment.append(tr);
        }
        body.replaceChildren(fragment);
        const end=new Date(snapshot.asOf+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+Number(horizon));
        byId('screener-period').textContent=`Sledované období: ${date(snapshot.asOf)} – ${date(end.toISOString().slice(0,10))}. Tabulka porovnává stejné kalendářní období v minulých letech; letošní výsledek není zahrnutý.`;
        byId('screener-export').disabled=false;
        status.textContent=`${window.AssetCategories.label(assetClass,commodityGroup)} · ${results.length} instrumentů · od ${date(snapshot.asOf)} · ${horizon} kalendářních dní · data exportována ${new Date(snapshot.exportedAt).toLocaleString('cs-CZ')}.`;
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
    root.addEventListener('screener-market-filter-change',render);
    root.addEventListener('screener-visible',()=>{if(!document.getElementById('screener-manual-view')?.hidden)load();});retry.onclick=load;
})();
