(() => {
    const byId=id=>document.getElementById(id),root=document.querySelector('.seasonality-page');
    if(!root||!byId('screener-auto-view'))return;
    const auto=byId('screener-auto-view'),manual=byId('screener-manual-view'),body=byId('opportunity-results');
    const status=byId('opportunity-status'),retry=byId('opportunity-retry'),detail=byId('opportunity-detail');
    let snapshot,pending=false,selected=null;
    const number=n=>Number.isFinite(n)?n.toLocaleString('cs-CZ',{maximumFractionDigits:1}):'—';
    const pct=n=>Number.isFinite(n)?`${number(n)} %`:'—';
    const move=n=>Number.isFinite(n)?`${n>0?'+':''}${number(n)} %`:'—';
    const date=s=>s?new Date(s+'T00:00:00Z').toLocaleDateString('cs-CZ',{timeZone:'UTC'}):'—';
    const band=s=>s.uncertainty?`${pct(s.uncertainty[0])} až ${pct(s.uncertainty[1])}`:'—';
    const element=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
    const cell=(tr,text,cls)=>{const td=element('td',text,cls);tr.append(td);return td;};
    const priceStale=a=>!a.lastDate||(Date.parse(snapshot.asOf)-Date.parse(a.lastDate))/86400000>7;
    const fresh=s=>s.count===8&&s.rate>=62.5&&s.median!==0;
    function note(a,c){
        if(priceStale(a))return 'Starší ceny · před vstupem ověřit';
        if(c.warnings.includes('validation-disagrees'))return 'Novější roky nepotvrzují směr';
        if(c.warnings.includes('incomplete-validation'))return 'Neúplná novější historie';
        if(c.warnings.includes('no-current-cot'))return 'Chybí použitelný dnešní COT';
        if(c.warnings.includes('small-cot-sample'))return 'COT: málo společných případů';
        if(c.warnings.includes('cot-disagrees'))return 'Podobný COT nepotvrzuje směr';
        return 'Historická shoda · nikoli signál';
    }
    function frequency(td,s,suppress){
        td.append(element('strong',suppress&&s.count<8?'Málo dat':pct(s.rate)));
        td.append(element('small',`${s.successes} z ${s.count} období ve směru`));
        if(s.count>=8)td.append(element('small',`95% pásmo: ${band(s)}`));
    }
    function render(){
        if(!snapshot)return;
        const direction=byId('opportunity-direction').value,horizon=Number(byId('opportunity-horizon').value);
        const quality=byId('opportunity-quality').value,sort=byId('opportunity-sort').value,query=byId('opportunity-search').value.trim().toLocaleLowerCase('cs');
        let rows=snapshot.assets.flatMap(a=>a.candidates.map(c=>({a,c})));
        rows=rows.filter(({a,c})=>(direction==='all'||c.direction===direction)&&c.startsIn<=horizon&&
            (!query||[a.key,a.name,...(a.aliases||[])].join(' ').toLocaleLowerCase('cs').includes(query))&&
            (quality==='all'||(!priceStale(a)&&fresh(c.validation)&&!c.warnings.includes('validation-disagrees')&&
                (quality!=='cot'||(c.cotReference&&c.cot.count>=8&&!c.warnings.includes('cot-disagrees'))))));
        const score=c=>sort==='date'?-c.startsIn:sort==='validation'?(c.validation.rate??-1):sort==='cot'?(c.cot.count>=8?c.cot.uncertainty[0]:-1):c.score;
        rows.sort((x,y)=>score(y.c)-score(x.c)||x.c.startsIn-y.c.startsIn||x.a.key.localeCompare(y.a.key)||x.c.direction.localeCompare(y.c.direction));
        const fragment=document.createDocumentFragment();
        for(const {a,c} of rows){
            const tr=element('tr'),instrument=cell(tr,'');instrument.append(element('strong',a.key),element('small',a.name));
            if(priceStale(a))instrument.append(element('small',`Ceny k ${date(a.lastDate)}`,'screener-warning'));
            const interval=cell(tr,`${date(c.startDate)} – ${date(c.endDate)}`);
            interval.append(element('small',`Vstup ${c.startsIn===0?'dnes':`za ${c.startsIn} dní`} · délka ${c.days} dní`));
            cell(tr,c.direction==='up'?'↑ Růst':'↓ Pokles',c.direction==='up'?'screener-positive':'screener-negative');
            frequency(cell(tr,''),c.validation,true);
            const cot=cell(tr,'');
            if(c.cotReference)frequency(cot,c.cot,true);else cot.append(element('strong','Chybí COT'));
            cot.append(element('small',`${a.market.key} · pozice ${date(c.cotReference?.date)}`));
            cell(tr,pct(c.validation.medianAdverse));
            const caution=cell(tr,note(a,c),c.warnings.length||priceStale(a)?'screener-warning':'');
            caution.append(element('small','Cena na konci období, bez nákladů'));
            const button=element('button','Detail');button.type='button';button.setAttribute('aria-label',`Detail ${a.key} ${c.direction==='up'?'růst':'pokles'} od ${date(c.startDate)}`);
            button.onclick=()=>showDetail(a,c,true);cell(tr,'').append(button);fragment.append(tr);
        }
        if(!rows.length){const tr=element('tr');const td=cell(tr,'Žádná příležitost pro tyto filtry. Zkus delší předstih nebo „Vše · včetně upozornění“.');td.colSpan=8;fragment.append(tr);}
        body.replaceChildren(fragment);
        const short=snapshot.assets.filter(a=>a.reason==='short-history').length,none=snapshot.assets.filter(a=>a.reason==='no-window').length;
        status.textContent=`Přepočet ${date(snapshot.asOf)} · ${rows.length} období · ${snapshot.assets.length} instrumentů s COT. ${short} nemá dost starší historie, ${none} nemá vhodný extrém. Výchozí pořadí vybírá starší historie, ne nejvyšší nové procento.`;
        const now=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague'}).format(new Date());
        if((Date.parse(now)-Date.parse(snapshot.asOf))/86400000>2)status.textContent+=' Upozornění: přehled je starší než 2 dny; aktuální data ověř.';
        byId('screener-export').disabled=false;
        if(selected&&!rows.some(r=>r.a.key===selected.a.key&&r.c.startDate===selected.c.startDate&&r.c.direction===selected.c.direction)){detail.hidden=true;selected=null;}
    }
    function curve(a,c){
        const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
        svg.setAttribute('viewBox','0 0 1000 270');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${a.key}: vyhlazená starší sezonální křivka s vyznačeným obdobím`);
        const add=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;svg.append(e);return e;};
        const low=Math.min(...a.curve),high=Math.max(...a.curve),pad=Math.max((high-low)*.12,.05),min=low-pad,max=high+pad;
        const x=d=>60+d/364*920,y=v=>225-(v-min)/(max-min)*205;
        const shade=(start,end)=>add('rect',{x:x(start),y:20,width:x(end)-x(start),height:205,fill:'#24dfcf',opacity:'.12'});
        if(c.endDay<c.startDay){shade(c.startDay,364);shade(0,c.endDay);}else shade(c.startDay,c.endDay);
        for(let i=0;i<5;i++){const v=min+(max-min)*i/4;add('line',{x1:60,x2:980,y1:y(v),y2:y(v),stroke:'#ffffff14'});add('text',{x:50,y:y(v)+4,'text-anchor':'end',fill:'#9ba8b7','font-size':12},number(v));}
        add('polyline',{points:a.curve.map((v,i)=>`${x(i)},${y(v)}`).join(' '),fill:'none',stroke:'#24dfcf','stroke-width':2});
        for(const d of [c.startDay,c.endDay]){add('line',{x1:x(d),x2:x(d),y1:20,y2:225,stroke:'#c5e5e2','stroke-dasharray':'4 4'});add('circle',{cx:x(d),cy:y(a.curve[d]),r:4,fill:'#24dfcf',stroke:'#0b0f11','stroke-width':2});}
        const months=['Led','Úno','Bře','Dub','Kvě','Čvn','Čvc','Srp','Zář','Říj','Lis','Pro'];
        months.forEach((m,i)=>{const d=(Date.UTC(2001,i,1)-Date.UTC(2001,0,1))/86400000;add('text',{x:x(d),y:252,fill:'#9ba8b7','font-size':12},m);});
        return svg;
    }
    function showDetail(a,c,scroll){
        selected={a,c};detail.replaceChildren();detail.hidden=false;
        const head=element('div',undefined,'confluence-heading'),title=element('h3',`${a.key} · ${c.direction==='up'?'růst':'pokles'} · ${date(c.startDate)} – ${date(c.endDate)}`);
        const close=element('button','Zavřít');close.type='button';close.onclick=()=>{detail.hidden=true;selected=null;};head.append(title,close);detail.append(head);
        detail.append(element('p',note(a,c),'confluence-caution'));
        detail.append(element('p',`Křivka pouze ze starších let ${a.trainingYears.join(', ')}. Tyrkysový výřez: ${c.direction==='up'?'od minima k prvnímu následujícímu maximu':'od maxima k prvnímu následujícímu minimu'} · ${c.days} dní. Vyhlazení jen pro výběr období; všechny výsledky níže jsou z původních cen.`,`opportunity-context`),curve(a,c));
        const cards=element('div',undefined,'opportunity-metrics');
        for(const [label,s,description] of [
            ['1. Starší sezonalita · použita pro výběr',c.training,'Zvýhodněná hledáním období; ne nezávislé ověření.'],
            ['2. Novější sezonalita · pevné období',c.validation,'Tyto roky neměnily interval ani směr. Stále malý vzorek.'],
            ['3. Podobný COT + stejné období',c.cot,'Starší i novější případy; popisné srovnání, ne nová předpověď.']]){
            const card=element('div',undefined,'opportunity-metric');card.append(element('span',label));
            frequency(card,s,true);card.append(element('small',description));cards.append(card);
        }
        detail.append(cards);
        const reference=c.cotReference?`index ${number(c.cotReference.index)}, pozice k ${date(c.cotReference.date)}, podobnost ${number(c.cotRange[0])}–${number(c.cotRange[1])} / 100`:'bez použitelné současné reference';
        detail.append(element('p',`COT ${a.market.key} / ${a.market.name} · komerční index 52 · ${reference}. Historický COT kontrolujeme k ${snapshot.asOf.slice(8,10)}. ${Number(snapshot.asOf.slice(5,7))}. v daném roce, tedy přibližně ${c.startsIn} dní před vstupem. Dostupnost je odhadovaná: pozice +7 dní.`,`opportunity-context`));
        if(a.cotNote)detail.append(element('p',a.cotNote,'opportunity-context'));
        const table=element('table',undefined,'screener-table'),thead=element('thead'),header=element('tr');
        ['Vzorek','Ve směru · počet / četnost','Medián ceny','Prostředních 50 % výnosů','Typicky proti směru'].forEach(t=>header.append(element('th',t)));thead.append(header);table.append(thead);
        const tbody=element('tbody');
        for(const [label,s] of [['Starší výběrová historie',c.training],['Novější roky (kontrola)',c.validation],['Stejné roky s dostupným COT (baseline)',c.cotBaseline],['Z toho podobný COT',c.cot],['Podobný COT · jen novější roky',c.cotValidation]]){
            const tr=element('tr');cell(tr,label);cell(tr,`${s.successes} / ${s.count}${s.count>=8?` · ${pct(s.rate)}`:' · málo dat'}`);cell(tr,move(s.median));cell(tr,`${move(s.q25)} až ${move(s.q75)}`);cell(tr,pct(s.medianAdverse));tbody.append(tr);
        }
        table.append(tbody);const wrap=element('div',undefined,'seasonality-table-wrap');wrap.append(table);detail.append(wrap);
        detail.append(element('p',`Pro kontrolu samotného přínosu COT porovnej „baseline“ s její podmnožinou „podobný COT“, ne s jiným počtem novějších roků. ${c.cotValidation.successes} z ${c.cotValidation.count} novějších případů s podobným COT drželo směr. Ani shoda obou procent není nezávislý důkaz obchodní výhody.`,`opportunity-context`));
        const cases=element('details'),summary=element('summary',`Jednotlivé roky a tehdejší COT (${c.cases.length})`);cases.append(summary);
        const ct=element('table',undefined,'screener-table'),ch=element('thead'),cr=element('tr');
        ['Rok · část historie','COT posouzen k','Vstup → výstup','Změna ceny','Pohyb proti směru','COT pozice · index','Podobný COT'].forEach(t=>cr.append(element('th',t)));ch.append(cr);ct.append(ch);
        const cb=element('tbody');
        for(const s of [...c.cases].sort((x,y)=>y.year-x.year)){
            const tr=element('tr');cell(tr,`${s.year} · ${s.validation?'novější':'výběrová'}`);cell(tr,date(s.signalDate));cell(tr,`${date(s.start)} → ${date(s.end)}`);
            cell(tr,move(s.returnPct));cell(tr,pct(c.direction==='up'?-s.maxDrop:s.maxRise));cell(tr,s.reportDate?`${date(s.reportDate)} · ${number(s.index)}`:'Chybí použitelný report');cell(tr,s.index===null?'—':s.matched?'Ano':'Ne');cb.append(tr);
        }
        ct.append(cb);const cw=element('div',undefined,'seasonality-table-wrap');cw.append(ct);cases.append(cw);detail.append(cases);
        detail.append(element('p','Co s tím: sleduj navržené datum, zkontroluj novější roky a dostatek COT případů. Před vstupem znovu ověř aktuální COT a cenu. Tato analýza neurčuje vstupní cenu ani stop-loss a nepředstavuje pravděpodobnost zisku obchodu. Bez nákladů a bez nezávislého ověření na budoucích datech.','confluence-caution'));
        if(scroll)detail.scrollIntoView({behavior:'smooth',block:'start'});
    }
    async function load(){
        if(auto.hidden)return;
        if(snapshot){render();return;}if(pending)return;
        byId('screener-export').disabled=true;retry.hidden=true;
        if(!window.StaticMarketData){status.textContent='Automatický přehled je dostupný ve statické verzi aplikace.';return;}
        pending=true;status.textContent='Načítám denní výběr sezonálních extrémů…';
        try{snapshot=await window.StaticMarketData.opportunities();if(!auto.hidden)render();}
        catch{status.textContent='Denní přehled se nepodařilo načíst. Zkus znovu nebo obnov stránku.';retry.hidden=false;}
        finally{pending=false;}
    }
    function mode(automatic){
        auto.hidden=!automatic;manual.hidden=automatic;
        for(const [id,active] of [['screener-mode-auto',automatic],['screener-mode-manual',!automatic]]){byId(id).classList.toggle('is-active',active);byId(id).setAttribute('aria-pressed',String(active));}
        byId('screener-export').disabled=true;root.dispatchEvent(new CustomEvent('screener-visible'));
    }
    byId('screener-mode-auto').onclick=()=>mode(true);byId('screener-mode-manual').onclick=()=>mode(false);
    ['direction','horizon','quality','sort','search'].forEach(id=>byId('opportunity-'+id).addEventListener(id==='search'?'input':'change',render));
    root.addEventListener('screener-visible',load);retry.onclick=load;
})();
