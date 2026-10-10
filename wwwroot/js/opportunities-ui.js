(() => {
    const byId=id=>document.getElementById(id),root=document.querySelector('.seasonality-page');
    if(!root||!byId('screener-auto-view'))return;
    const auto=byId('screener-auto-view'),manual=byId('screener-manual-view'),body=byId('opportunity-results');
    const status=byId('opportunity-status'),retry=byId('opportunity-retry'),detail=byId('opportunity-detail');
    let snapshot,pending=false,selected=null,returnFocus=null,lockedScroll=[];
    function closeDetail(){if(detail.open)detail.close();}
    detail.addEventListener('close',()=>{
        selected=null;
        for(const {node,overflow,top,left} of lockedScroll){node.style.overflow=overflow;node.scrollTop=top;node.scrollLeft=left;}
        lockedScroll=[];
        if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
        returnFocus=null;
    });
    // Only a press AND release outside the card dismiss it; dragging text out does not.
    let backdropPress=false;
    const outside=e=>{const r=detail.getBoundingClientRect();return e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom;};
    detail.addEventListener('pointerdown',e=>{backdropPress=e.target===detail&&outside(e);});
    detail.addEventListener('click',e=>{if(backdropPress&&e.target===detail&&outside(e))closeDetail();backdropPress=false;});
    detail.addEventListener('pointercancel',()=>{backdropPress=false;});
    const number=n=>Number.isFinite(n)?n.toLocaleString('cs-CZ',{maximumFractionDigits:1}):'—';
    const pct=n=>Number.isFinite(n)?`${number(n)} %`:'—';
    const move=n=>Number.isFinite(n)?`${n>0?'+':''}${number(n)} %`:'—';
    const date=s=>s?new Date(s+'T00:00:00Z').toLocaleDateString('cs-CZ',{timeZone:'UTC'}):'—';
    const band=s=>s.uncertainty?`${pct(s.uncertainty[0])} až ${pct(s.uncertainty[1])}`:'—';
    const element=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
    const cell=(tr,text,cls)=>{const td=element('td',text,cls);tr.append(td);return td;};
    const priceStale=a=>!a.lastDate||(Date.parse(snapshot.asOf)-Date.parse(a.lastDate))/86400000>7;
    const fresh=s=>s.count===8&&s.rate>=62.5&&s.median!==0;
    const history=()=>Number(byId('opportunity-history').value);
    const display=c=>c.histories?.[history()];
    const rangeText=h=>`${h.from}–${h.to}`;
    const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague'}).format(new Date());
    const ranking=(a,c)=>window.OpportunityRanking.rank(a,c,{history:history(),asOf:snapshot.asOf,today:today()});
    const limitTexts={
        'no-seasonal-sample':'Bez použitelné cenové historie: strop 1.',
        'short-seasonal-sample':'Méně než 5 cenových let: strop 5.',
        'limited-seasonal-sample':'Méně než 8 cenových let: strop 7.',
        'short-validation':'Méně než 5 novějších kontrolních let: strop 6.',
        'validation-disagrees':'Novější kontrola nepotvrzuje směr četností nebo mediánem: strop 5,5.',
        'seasonal-disagrees':'Zvolená cenová historie nepotvrzuje směr četností nebo mediánem: strop 5,5.',
        'limited-cot-sample':'Méně než 8 podobných COT případů: postupný strop 6 + počet / 8 (nejvýše 7). COT je jen omezený podklad.',
        'no-current-cot':'Chybí použitelný současný COT: strop 6. COT nemůže potvrdit směr.',
        'cot-disagrees':'COT s alespoň 8 případy nepotvrzuje směr četností nebo mediánem: strop 6,5.',
        'stale-prices':'Ceny jsou starší než 7 dní nebo nejsou platné: strop 5.',
        'stale-snapshot':'Přehled je starší než 2 dny nebo má budoucí datum: strop 5.'
    };
    const limitedCot=n=>n===0?'Žádný podobný případ':`Jen ${n} podobn${n===1?'ý případ':n<5?'é případy':'ých případů'}`;
    function note(a,c){
        if(priceStale(a))return 'Starší ceny · před vstupem ověřit';
        if(c.warnings.includes('validation-disagrees'))return 'Novější roky nepotvrzují směr';
        if(c.warnings.includes('incomplete-validation'))return 'Neúplná novější historie';
        if(c.warnings.includes('no-current-cot'))return 'Chybí použitelný dnešní COT';
        if(display(c)?.cot.count<8)return 'COT: málo případů ve zvolené historii';
        if(display(c)?.cot.rate<=50)return 'Podobný COT nepotvrzuje směr';
        return 'Historická shoda · nikoli signál';
    }
    function frequency(td,s,suppress,context='období ve směru'){
        td.append(element('strong',suppress&&s.count<8?(context.startsWith('podobných COT')?limitedCot(s.count):'Málo dat'):pct(s.rate)));
        td.append(element('small',`${s.successes} z ${s.count} ${context}`));
        if(s.count>=8){const uncertainty=element('small',`Nejistota četnosti: ${band(s)}`);
            uncertainty.title='95% interval spolehlivosti (Wilson): orientační statistická nejistota historické četnosti. Neznamená 95% šanci zisku ani rozsah budoucího výnosu.';td.append(uncertainty);}
    }
    function render(){
        if(!snapshot)return;
        const direction=byId('opportunity-direction').value,horizon=Number(byId('opportunity-horizon').value);
        const quality=byId('opportunity-quality').value,sort=byId('opportunity-sort').value,query=byId('opportunity-search').value.trim().toLocaleLowerCase('cs');
        const minimum=Number(byId('opportunity-min-score').value);
        let rows=snapshot.assets.flatMap(a=>a.candidates.filter(c=>display(c)).map(c=>({a,c,r:ranking(a,c)})));
        rows=rows.filter(({a,c,r})=>r.value>=minimum&&(direction==='all'||c.direction===direction)&&c.startsIn<=horizon&&
            (!query||[a.key,a.name,...(a.aliases||[])].join(' ').toLocaleLowerCase('cs').includes(query))&&
            (quality==='all'||(!priceStale(a)&&fresh(c.validation)&&!c.warnings.includes('validation-disagrees')&&
                (quality!=='cot'||(c.cotReference&&display(c).cot.count>=8&&display(c).cot.rate>50)))));
        const score=({c,r})=>sort==='score'?r.value:sort==='date'?-c.startsIn:sort==='validation'?(display(c).seasonal.rate??-1):sort==='cot'?(display(c).cot.count>=8?display(c).cot.uncertainty[0]:-1):c.score;
        rows.sort((x,y)=>score(y)-score(x)||(sort==='score'?y.r.uncapped-x.r.uncapped:0)||x.c.startsIn-y.c.startsIn||x.a.key.localeCompare(y.a.key)||x.c.direction.localeCompare(y.c.direction));
        const fragment=document.createDocumentFragment();
        for(const {a,c,r} of rows){
            const h=display(c);
            const tr=element('tr'),instrument=cell(tr,'');instrument.append(element('strong',a.key),element('small',a.name));
            if(priceStale(a))instrument.append(element('small',`Ceny k ${date(a.lastDate)}`,'screener-warning'));
            const rating=cell(tr,'');rating.append(element('strong',`${number(r.value)} / 10`,`opportunity-score ${r.value>=8?'is-strong':r.value>=7?'is-supported':'is-limited'}`),element('small',r.label));
            if(!r.currentCot)rating.append(element('small','Bez dnešního COT','screener-warning'));
            else if(h.cot.count<8)rating.append(element('small','COT omezený','screener-warning'));
            const interval=cell(tr,`${date(c.startDate)} – ${date(c.endDate)}`);
            interval.append(element('small',`Vstup ${c.startsIn===0?'dnes':`za ${c.startsIn} dní`} · délka ${c.days} dní`));
            cell(tr,c.direction==='up'?'↑ Růst':'↓ Pokles',c.direction==='up'?'screener-positive':'screener-negative');
            frequency(cell(tr,''),h.seasonal,true,`dokončených ročních období ve směru · ${rangeText(h)}`);
            const cot=cell(tr,'');
            if(c.cotReference)frequency(cot,h.cot,true,`podobných COT případů ve směru · ${rangeText(h)}`);else cot.append(element('strong','Chybí COT'));
            cot.append(element('small',`Podobný COT v ${h.cot.count} z ${h.baseline.count} let s dostupným reportem`));
            cot.append(element('small',`${a.market.key} · pozice ${date(c.cotReference?.date)}`));
            cell(tr,pct(h.seasonal.medianAdverse));
            const caution=cell(tr,note(a,c),c.warnings.length||priceStale(a)?'screener-warning':'');
            caution.append(element('small','Cena na konci období, bez nákladů'));
            const button=element('button','Detail');button.type='button';button.setAttribute('aria-label',`Detail ${a.key} ${c.direction==='up'?'růst':'pokles'} od ${date(c.startDate)}`);
            button.onclick=()=>showDetail(a,c,button);cell(tr,'').append(button);fragment.append(tr);
        }
        if(!rows.length){const tr=element('tr');const td=cell(tr,'Žádná příležitost pro tyto filtry. Sniž minimum skóre nebo zvol „Vše · včetně upozornění“.');td.colSpan=9;fragment.append(tr);}
        body.replaceChildren(fragment);
        const short=snapshot.assets.filter(a=>a.reason==='short-history').length,none=snapshot.assets.filter(a=>a.reason==='no-window').length;
        status.textContent=`Přepočet ${date(snapshot.asOf)} · posledních ${history()} dokončených let (${Number(snapshot.asOf.slice(0,4))-history()}–${Number(snapshot.asOf.slice(0,4))-1}) pro oba sloupce · ${rows.length} období · ${snapshot.assets.length} instrumentů s COT. ${short} nemá dost starší historie, ${none} nemá vhodný extrém. ${sort==='score'?'Řazeno podle skóre podkladů, nikoli pravděpodobnosti zisku.':'Jiné řazení než podle skóre.'}`;
        const now=today();
        if((Date.parse(now)-Date.parse(snapshot.asOf))/86400000>2)status.textContent+=' Upozornění: přehled je starší než 2 dny; aktuální data ověř.';
        byId('screener-export').disabled=false;
        if(selected&&!rows.some(r=>r.a.key===selected.a.key&&r.c.startDate===selected.c.startDate&&r.c.direction===selected.c.direction))closeDetail();
    }
    function scoreDetail(a,c,h){
        const r=ranking(a,c),section=element('section',undefined,'opportunity-score-detail');
        const heading=element('div',undefined,'opportunity-score-heading');
        heading.append(element('span','Skóre podkladů','opportunity-rank-title'),element('strong',`${number(r.value)} / 10`,'opportunity-score'),element('span',r.label));section.append(heading);
        section.append(element('p','Pořadí pro další průzkum — ne procento úspěchu obchodu. Pevné váhy nejsou statisticky kalibrované.'));
        const table=element('table',undefined,'opportunity-score-table'),thead=element('thead'),tr=element('tr');
        ['Složka a skutečné podklady','Váha','Příspěvek ze 100'].forEach(label=>tr.append(element('th',label)));thead.append(tr);table.append(thead);
        const labels={seasonal:[`Sezonalita · posledních ${history()} let`,`${h.seasonal.successes} z ${h.seasonal.count} ve směru (${pct(h.seasonal.rate)}) · ${rangeText(h)}`],
            validation:['Oddělená kontrola · posledních 8 let',`${c.validation.successes} z ${c.validation.count} ve směru (${pct(c.validation.rate)})`],
            cot:['Podobný COT · stejná historie',r.currentCot?`${h.cot.successes} z ${h.cot.count} podobných případů ve směru${h.cot.count<8?' · omezený vzorek':''}`:'Chybí použitelný dnešní report · neutrální příspěvek, nikoli potvrzení'],
            quality:['Kvalita dat',`Ceny ${h.seasonal.count} / ${history()} let · kontrola ${c.validation.count} / 8 · COT pokrytí ${h.baseline.count} / ${h.seasonal.count} let · ${r.pricesFresh&&r.currentCot&&r.snapshotFresh?'aktuální data':'část dat není aktuální'}`]};
        const tbody=element('tbody');
        for(const part of r.components){const row=element('tr'),label=cell(row,'');label.append(element('span',labels[part.key][0],'opportunity-rank-title'),element('small',labels[part.key][1]));
            cell(row,`${part.weight} %`);cell(row,`${number(part.contribution)} / ${part.weight}`);tbody.append(row);}
        table.append(tbody);section.append(table);
        if(r.limits.length){const list=element('ul',undefined,'opportunity-score-limits');r.limits.forEach(l=>list.append(element('li',l.code==='limited-cot-sample'?`${limitTexts[l.code]} Zde ${h.cot.count} případů: ${number(l.max)} bodu.`:limitTexts[l.code])));section.append(list);}
        section.append(element('p',`Vážený součet převedený na škálu 1–10: ${number(r.uncapped)}. ${r.capped?`Po uplatnění stropu ${number(r.ceiling)}: ${number(r.value)}.`:'Žádný strop výsledné číslo nesnížil.'}`));
        const method=element('details');method.append(element('summary','Jak skóre počítáme a co nehodnotí?'),element('p','Četnosti tlumíme neutrálními přídavky: sezonalita a kontrola (úspěchy +2) / (případy +4), COT (úspěchy +4) / (případy +8). Přídavky nejsou skutečné roky. Medián proti směru omezuje příslušnou podporu na 50 ze 100. Chybějící COT nepřesouvá váhu do jiné složky. Kvalita je průměr pokrytí cen, kontrolních let, historického COT a čerstvosti. Součet příspěvků 0–100 převádíme jako 1 + 9 × součet / 100, poté uplatníme stropy a zaokrouhlíme.'));
        method.append(element('p','Složky se překrývají a nejsou nezávislé. COT sleduje výnosy při podobném komerčním reportu, ne počet shodných křivek. Skóre nehodnotí náklady, poměr zisku k riziku, vstup, stop-loss ani ziskovost. Typický pohyb proti směru a rozptyl zkontroluj zvlášť. Nezvyšuj číslo přepínáním historie a filtrů; to může zvýhodnit náhodu.'));section.append(method);return section;
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
    function showDetail(a,c,trigger){
        if(detail.open)return;
        selected={a,c};detail.replaceChildren();
        const h=display(c);
        const head=element('div',undefined,'confluence-heading'),title=element('h3',`${a.key} · ${c.direction==='up'?'růst':'pokles'} · ${date(c.startDate)} – ${date(c.endDate)}`);
        title.id='opportunity-detail-title';
        const close=element('button','×');close.type='button';close.className='opportunity-dialog-close';close.setAttribute('aria-label','Zavřít detail');close.autofocus=true;close.onclick=closeDetail;head.append(title,close);detail.append(head);
        detail.append(element('p',note(a,c),'confluence-caution'));
        detail.append(scoreDetail(a,c,h));
        detail.append(element('p',`Křivka pouze ze starších let ${a.trainingYears.join(', ')}. Tyrkysový výřez: ${c.direction==='up'?'od minima k prvnímu následujícímu maximu':'od maxima k prvnímu následujícímu minimu'} · ${c.days} dní. Vyhlazení jen pro výběr období; všechny výsledky níže jsou z původních cen.`,`opportunity-context`),curve(a,c));
        const cards=element('div',undefined,'opportunity-metrics');
        for(const [label,s,description] of [
            [`Sezonalita · posledních ${history()} let (${rangeText(h)})`,h.seasonal,'Dokončená roční období ve vybrané historii.'],
            [`Podobný COT · stejných ${history()} let (${rangeText(h)})`,h.cot,'Jen roky z této historie, kdy byl COT podobný dnešnímu.'],
            ['Oddělená kontrola · posledních 8 let',c.validation,`${snapshot.asOf.slice(0,4)-8}–${snapshot.asOf.slice(0,4)-1}: tyto roky neměnily interval ani směr. Výše zvolená historie může částečně obsahovat výběrové roky; není nezávislým testem.`]]){
            const card=element('div',undefined,'opportunity-metric');card.append(element('span',label));
            frequency(card,s,true,label.startsWith('Podobný COT')?'podobných COT případů ve směru':'dokončených ročních období ve směru');card.append(element('small',description));cards.append(card);
        }
        detail.append(cards);
        const reference=c.cotReference?`index ${number(c.cotReference.index)}, pozice k ${date(c.cotReference.date)}, podobnost ${number(c.cotRange[0])}–${number(c.cotRange[1])} / 100`:'bez použitelné současné reference';
        detail.append(element('p',`COT ${a.market.key} / ${a.market.name} · komerční index 52 · ${reference}. Historický COT kontrolujeme k ${snapshot.asOf.slice(8,10)}. ${Number(snapshot.asOf.slice(5,7))}. v daném roce, tedy přibližně ${c.startsIn} dní před vstupem. Dostupnost je odhadovaná: pozice +7 dní.`,`opportunity-context`));
        if(a.cotNote)detail.append(element('p',a.cotNote,'opportunity-context'));
        const table=element('table',undefined,'screener-table'),thead=element('thead'),header=element('tr');
        ['Vzorek','Ve směru · počet / četnost','Medián ceny','Prostředních 50 % výnosů','Typicky proti směru'].forEach(t=>header.append(element('th',t)));thead.append(header);table.append(thead);
        const tbody=element('tbody');
        for(const [label,s] of [[`Sezonalita · ${rangeText(h)}`,h.seasonal],[`Stejné roky s dostupným COT · ${rangeText(h)}`,h.baseline],['Z toho podobný COT',h.cot],['Starší výběrová historie · ne nezávislý test',c.training],['Oddělená kontrola · posledních 8 let',c.validation]]){
            const tr=element('tr');cell(tr,label);cell(tr,`${s.successes} / ${s.count}${s.count>=8?` · ${pct(s.rate)}`:' · málo dat'}`);cell(tr,move(s.median));cell(tr,`${move(s.q25)} až ${move(s.q75)}`);cell(tr,pct(s.medianAdverse));tbody.append(tr);
        }
        table.append(tbody);const wrap=element('div',undefined,'seasonality-table-wrap');wrap.append(table);detail.append(wrap);
        detail.append(element('p',`COT je podobný v ${h.cot.count} z ${h.baseline.count} let s dostupným reportem v období ${rangeText(h)}. ${h.cot.successes} z těchto ${h.cot.count} případů drželo směr. Pro přínos COT porovnávej se stejnými roky s dostupným reportem, ne s jiným vzorkem. Nejistota četnosti je 95% interval spolehlivosti: ne 95% šance zisku ani rozsah budoucího výnosu. Ani shoda procent není důkaz obchodní výhody.`,`opportunity-context`));
        const cases=element('details'),summary=element('summary',`Jednotlivé roky a tehdejší COT · ${rangeText(h)} (${h.cases.length})`);cases.append(summary);
        const ct=element('table',undefined,'screener-table'),ch=element('thead'),cr=element('tr');
        ['Rok · část historie','COT posouzen k','Vstup → výstup','Změna ceny','Pohyb proti směru','COT pozice · index','Podobný COT'].forEach(t=>cr.append(element('th',t)));ch.append(cr);ct.append(ch);
        const cb=element('tbody');
        for(const s of [...h.cases].sort((x,y)=>y.year-x.year)){
            const tr=element('tr');cell(tr,`${s.year} · ${s.year>=a.validationStart?'oddělená kontrola':'výběrová historie'}`);cell(tr,date(s.signalDate));cell(tr,`${date(s.start)} → ${date(s.end)}`);
            cell(tr,move(s.returnPct));cell(tr,pct(c.direction==='up'?-s.maxDrop:s.maxRise));cell(tr,s.reportDate?`${date(s.reportDate)} · ${number(s.index)}`:'Chybí použitelný report');cell(tr,s.index===null?'—':s.matched?'Ano':'Ne');cb.append(tr);
        }
        ct.append(cb);const cw=element('div',undefined,'seasonality-table-wrap');cw.append(ct);cases.append(cw);detail.append(cases);
        detail.append(element('p','Co s tím: sleduj navržené datum, zkontroluj novější roky a dostatek COT případů. Před vstupem znovu ověř aktuální COT a cenu. Tato analýza neurčuje vstupní cenu ani stop-loss a nepředstavuje pravděpodobnost zisku obchodu. Bez nákladů a bez nezávislého ověření na budoucích datech.','confluence-caution'));
        returnFocus=trigger;
        lockedScroll=[...new Set([document.scrollingElement,document.querySelector('.app-workspace-main')].filter(Boolean))]
            .map(node=>({node,overflow:node.style.overflow,top:node.scrollTop,left:node.scrollLeft}));
        lockedScroll.forEach(({node})=>{node.style.overflow='hidden';});
        detail.showModal();detail.scrollTop=0;
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
        closeDetail();
        auto.hidden=!automatic;manual.hidden=automatic;
        for(const [id,active] of [['screener-mode-auto',automatic],['screener-mode-manual',!automatic]]){byId(id).classList.toggle('is-active',active);byId(id).setAttribute('aria-pressed',String(active));}
        byId('screener-export').disabled=true;root.dispatchEvent(new CustomEvent('screener-visible'));
    }
    byId('screener-mode-auto').onclick=()=>mode(true);byId('screener-mode-manual').onclick=()=>mode(false);
    byId('opportunity-best').onclick=()=>{
        for(const [key,value] of Object.entries({history:'10',direction:'all',horizon:'60',quality:'all',sort:'score','min-score':'6',search:''}))byId('opportunity-'+key).value=value;
        byId('opportunity-history').dispatchEvent(new Event('change'));
    };
    ['direction','horizon','quality','sort','search','history','min-score'].forEach(id=>byId('opportunity-'+id).addEventListener(id==='search'?'input':'change',render));
    // One calendar lookback across the main chart, confluence and automatic screener.
    for(const id of ['seasonality-years','opportunity-history','confluence-history'])byId(id).addEventListener('change',()=>{
        const value=byId(id).value;
        for(const other of ['seasonality-years','opportunity-history','confluence-history']){
            if(other===id||!Array.from(byId(other).options).some(o=>o.value===value))continue;
            byId(other).value=value;
        }
        if(id!=='seasonality-years')byId('seasonality-years').dispatchEvent(new Event('change'));
        closeDetail();render();
    });
    root.addEventListener('screener-visible',load);retry.onclick=load;
})();
