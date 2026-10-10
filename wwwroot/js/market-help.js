(function(root,factory){
    const help=factory();
    if(typeof module==='object'&&module.exports)module.exports=help;
    else help.mount(root.document);
}(typeof globalThis==='object'?globalThis:this,function(){
    const texts={
        history:'Posledních 5, 10 nebo 20 dokončených kalendářních let. Letošní rok a neúplná období se vynechávají. Chybějící roky nenahrazujeme staršími. Sezonalita a COT mají stejný rozsah historie, ale podobný COT může být jen v některých letech.',
        frequency:'Historická četnost: počet období, která skončila ve zvoleném směru, dělený počtem dokončených období. Například 7 z 10 = 70 %. Nulová změna se nepočítá jako úspěch. Nejde o ověřenou pravděpodobnost budoucího zisku.',
        uncertainty:'95% interval spolehlivosti (Wilson) ukazuje orientační statistickou nejistotu historické četnosti. Například 70 % z deseti let má velmi široké pásmo. Čím méně případů, tím méně jistý výsledek. Není to 95% šance zisku ani rozpětí budoucího výnosu; tržní roky navíc nemusí být nezávislé.',
        cot:'COT je týdenní přehled pozic ve futures, nikoli přímý report o spotovém forexovém páru. V souběhu vybereme jen roky, kdy byl index vybrané skupiny podobný dnešnímu. Například 4 ze 6 znamená čtyři výsledky ve směru ze šesti podobných případů nalezených ve zvolené historii, ne šest posledních let.',
        index:'COT index 0–100: čisté pozice vzhledem k vlastnímu minimu a maximu za zvolený počet reportů. 0 = nejnižší a 100 = nejvyšší pozice v tomto okně. Není to procento obchodníků ani pravděpodobnost růstu ceny.',
        lookback:'Počet týdenních COT reportů použitých pro výpočet indexu 0–100. Například 52 reportů je přibližně rok. To je jiné nastavení než počet historických let použitých pro porovnání výnosů.',
        tolerance:'Rozsah podobnosti dnešnímu COT indexu v bodech, ne procentech. Při indexu 81 a toleranci ±10 vybereme historické indexy 71–91. Širší rozsah přidá případy, ale budou méně podobné. Ve Screeneru používáme komerční index 52 a ±10 bodů.',
        validation:'Oddělená kontrola posledních 8 dokončených let. Tyto roky se nepoužily k nalezení intervalu ani jeho směru. Hlavní zvolená historie 10 nebo 20 let může částečně obsahovat výběrové roky. Ani tato kontrola není ověřením na budoucích datech.',
        selection:'Interval a směr se hledají pouze ve starších letech, aby následná kontrola nebyla zvýhodněná stejnými daty. Tyrkysová křivka v detailu ukazuje tuto výběrovou historii, nikoli letošní cenu. Výsledky ve zvolené novější historii čti zvlášť.',
        adverse:'Medián největšího pohybu proti zvolenému směru od vstupu do konce období: u růstu pokles, u poklesu růst. Počítáme denní závěrečné ceny, ne intradenní extrémy. Nejhorší případ může být mnohem horší; číslo není doporučený stop-loss.',
        median:'Prostřední historický výsledek po seřazení výnosů. Polovina výsledků je pod ním a polovina nad ním. Je méně citlivý na jeden výjimečný rok než průměr. Není to předpověď výnosu.',
        mean:'Součet historických výnosů dělený počtem období. Jeden výjimečně silný rok může průměr výrazně posunout. Porovnej jej s mediánem a jednotlivými roky.',
        middle:'Rozsah mezi 25. a 75. percentilem: prostřední polovina historických výsledků. Zbývající čtvrtina je níže a čtvrtina výše. Nejde o 50% pravděpodobnost budoucího výnosu ani o 95% interval četnosti.',
        baseline:'Stejné kalendářní období v letech s dostupným COT, ale bez podmínky podobnosti indexu. S touto základnou porovnávej podmnožinu podobného COT. Jiný počet let může sám změnit procenta.',
        net:'Čisté pozice = long kontrakty minus short kontrakty dané skupiny. Kladné číslo znamená více long, záporné více short. Počet kontraktů sám neříká, kam půjde cena.',
        delta:'Týdenní změna čistých pozic proti předchozímu reportu, v kontraktech. Kladná změna znamená posun k více long / méně short, ne automatický růst ceny. Přes chybějící report změnu nezobrazujeme.',
        groups:'Komerční obchodníci zpravidla zajišťují obchodní riziko; velcí spekulanti jsou reportovaní nekomerční účastníci; malí jsou nehlášené pozice. Poslední skupina není přesné měření retailu. Jejich motivace se liší a pozice nejsou samy o sobě vstupním signálem.',
        bullish:'Bullish/Bearish vybírá historické roky podle výsledku celého roku. Je to zpětný filtr pro průzkum: tehdy na začátku roku nebyl konečný výsledek znám. Nelze jej použít jako tehdy dostupný obchodní signál.',
        cycle:'Filtr vybere sudé nebo liché kalendářní roky. Mění vzorek i počet výsledků; kontroluj, zda dobrý výsledek nestojí jen na několika letech.',
        election:'Filtr podle čtyřletého cyklu amerických prezidentských voleb: Election = volební rok, Pre-election = rok před ním, Post-election = rok po něm, Midterm = druhý rok po volbách. Vzorek může být velmi malý.',
        date:'Navržené kalendářní období, ne pokyn k okamžitému vstupu. Historicky používáme první dostupnou závěrečnou cenu od začátku a poslední nejpozději v konci. Před budoucím vstupem znovu ověř cenu a COT.',
        forecast:'Datum, ke kterému byl historický COT posouzen. U budoucího období používáme výročí dne snapshotu, tedy stejný předstih jako dnes; ne až report známý při budoucím vstupu. Dostupnost reportu odhadujeme jako datum pozic +7 dní.',
        quality:'Filtr podkladů, nikoli záruka úspěchu. Oddělená kontrola vyžaduje všech 8 let, alespoň 62,5 % ve směru a souhlas mediánu. COT volba navíc požaduje alespoň 8 podobných případů ve zvolené historii a více než polovinu ve směru.',
        sort:'Výchozí pořadí vychází ze starší výběrové historie, nikoli nejvyššího nového procenta. Řazení podle četnosti zvýhodňuje také náhodně silné malé vzorky. Dolní mez COT používá nejistotu četnosti; není to hodnocení ziskovosti.',
        small:'Méně než 8 použitelných případů: velké procento by působilo přesněji, než data dovolují. Ukazujeme skutečné počty, ale procento nezvýrazňujeme. Tři úspěchy ze tří nejsou důkaz 100% šance příštího obchodu.',
        normalized:'Grafový index má základ 100 na začátku historického roku. Ukazuje relativní sezonální průběh, nikoli cenu instrumentu. Hodnota 101 znamená přibližně +1 % oproti základně. Není to COT index 0–100.',
        trimmed:'Průměr po odstranění právě jednoho nejlepšího a jednoho nejhoršího roku. Pomáhá poznat, zda výsledek nevytváří několik extrémů. Neodstraňuje všechny mimořádné situace ani negarantuje opakování.',
        difference:'Rozdíl četnosti podobného COT a základny se stejnými dostupnými roky, v procentních bodech. Například 70 % minus 60 % = +10 p. b. Popisný rozdíl není důkaz, že COT přidává obchodní výhodu.',
        long:'Počet futures kontraktů na růst držených danou skupinou. U měnových futures směr nemusí být stejný jako směr spotového páru; například JPY futures jsou obráceně než USD/JPY.',
        short:'Počet futures kontraktů na pokles držených danou skupinou. Nezaměňuj short futures jednotlivé měny se shortem celého měnového páru.',
        spread:'Reportované současné long a short pozice v různých futures kontraktech. Spread není další směrová sázka a není to rozdíl nákupní a prodejní ceny.',
        extremes:'Nejnižší a nejvyšší historický výsledek ve vzorku. Nejsou hranicemi budoucího rizika — další výsledek může být ještě horší nebo lepší.',
        direction:'Růst/pokles znamená vyšší/nižší cenu na konci období proti začátku. Cena může během období výrazně kolísat. Četnost směru není úspěšnost strategie se stop-lossem, náklady nebo pákou.'
        ,chartHistory:'Délka zobrazené historie COT grafů. Mění jen rozsah grafu, nikoli počet reportů pro výpočet indexu ani historii v analýze podobných situací.'
        ,count:'Počet skutečně použitelných dokončených období, ne počet všech dostupných reportů. Letošní rok, neúplné ceny a dlouhé mezery vynecháváme. U podobného COT zbývají jen roky nebo situace s odpovídajícím indexem.'
        ,rise:'Největší růst denní závěrečné ceny od vstupní ceny během období. U poklesového směru je to pohyb proti směru; u růstu příznivý pohyb. Nezachycuje intradenní maxima.'
        ,fall:'Největší pokles denní závěrečné ceny od vstupní ceny během období. U růstu jde o pohyb proti směru. Není to největší propad od libovolného průběžného vrcholu ani intradenní minimum.'
        ,positionDate:'Datum, ke kterému byly pozice evidované, nikoli okamžik zveřejnění. Report vychází se zpožděním; pro historické porovnání odhadujeme dostupnost jako datum pozic +7 dní.'
        ,analogMode:'Vybere podobnost poslednímu reportu nebo historické extrémy indexu 0–20 / 80–100. Následné výnosy za 2, 4 a 8 týdnů používají celý dostupný souběh cen a COT, ne pouze roky zobrazené v grafu. Extrém sám není nákupní ani prodejní signál.'
    };
    const rules=[
        [/nejistot|95%/, 'uncertainty'],[/oddělená kontrola/,'validation'],[/podobný cot|podobnost|souběh/,'cot'],
        [/sezonalita ·|ve směru|četnost|win rate|kladné (roky|období|případy)|podíl kladných/,'frequency'],
        [/prostředních 50/,'middle'],[/medián/,'median'],[/bez nejlepšího/,'trimmed'],[/průměr/,'mean'],
        [/proti směru|typický max|typicky proti/,'adverse'],[/nejhorší|nejlepší|minimum.*maximum/,'extremes'],
        [/výběrová historie|starší výběrová/,'selection'],[/dostupným cot|baseline/,'baseline'],
        [/cot posouzen/,'forecast'],[/cot index|cot pozice · index/,'index'],[/čisté pozice| net$/,'net'],
        [/δ|Δ týdně/,'delta'],[/^long$/,'long'],[/^short$/,'short'],[/^spread$/,'spread'],
        [/komerční obchodníci|malí obchodníci|velcí spekulanti/,'groups'],[/market trend/,'bullish'],
        [/2-year cycle/,'cycle'],[/us election cycle/,'election'],[/maximální index/,'normalized'],
        [/navržené období|vstup.*výstup/,'date'],[/málo dat/,'small'],[/počet (let|období)|^let$|^případů$|vybraných let/,'count'],
        [/^max růst$/,'rise'],[/^max pokles$/,'fall'],[/^pozice k$|datum pozic/,'positionDate'],[/^výnos$|změna ceny/,'direction'],[/^cot komerční/,'index']
    ];
    const controls={
        'seasonality-years':'history','opportunity-history':'history','confluence-history':'history',
        'opportunity-direction':'direction','opportunity-horizon':'date','opportunity-quality':'quality','opportunity-sort':'sort',
        'confluence-direction':'direction','confluence-group':'groups','confluence-tolerance':'tolerance','confluence-lookback':'lookback',
        'confluence-market':'cot','cot-lookback':'lookback','cot-history':'chartHistory','cot-analog-group':'groups','cot-analog-mode':'analogMode',
        'cot-analog-tolerance':'tolerance','screener-lookback':'history','screener-minimum':'small','screener-sort':'sort'
    };
    function describe(label){return texts[rules.find(([pattern])=>pattern.test(label.toLocaleLowerCase('cs')))?.[1]]||null;}
    function mount(doc){
        const page=doc.querySelector('.seasonality-page');if(!page)return;
        const tip=doc.createElement('div');tip.id='market-help-tooltip';tip.className='market-help-tooltip';
        tip.setAttribute('role','tooltip');tip.setAttribute('data-export-omit','');tip.setAttribute('popover','manual');tip.hidden=true;
        doc.body.append(tip);
        let active=null,pinned=false,timer,scheduled=false;
        const attached=new WeakSet();
        function hide(){
            clearTimeout(timer);if(!active)return;
            active.removeAttribute('aria-describedby');active.setAttribute('aria-expanded','false');
            if(tip.matches(':popover-open'))tip.hidePopover();tip.hidden=true;active=null;pinned=false;
        }
        function show(button,pin=false){
            clearTimeout(timer);if(active!==button)hide();active=button;pinned=pin||pinned;
            const parent=button.closest('dialog[open]')||doc.body;
            if(tip.parentElement!==parent)parent.append(tip);
            tip.textContent=button.dataset.helpText;tip.hidden=false;
            if(tip.showPopover&&!tip.matches(':popover-open'))tip.showPopover();
            button.setAttribute('aria-describedby',tip.id);button.setAttribute('aria-expanded','true');
            const r=button.getBoundingClientRect(),box=tip.getBoundingClientRect(),width=doc.documentElement.clientWidth,height=innerHeight;
            tip.style.left=Math.max(12,Math.min(r.left,width-box.width-12))+'px';
            tip.style.top=Math.max(12,r.bottom+10+box.height<=height-12?r.bottom+10:r.top-box.height-10)+'px';
        }
        function attach(node,text,label){
            if(!text||attached.has(node))return;attached.add(node);
            if(label.startsWith('Nejistota četnosti'))node.removeAttribute('title');
            const button=doc.createElement('button');button.type='button';button.className='market-help-button';
            button.textContent='ⓘ';button.dataset.helpText=text;button.setAttribute('data-export-omit','');
            button.setAttribute('aria-label','Vysvětlit: '+label);button.setAttribute('aria-expanded','false');
            button.setAttribute('aria-controls',tip.id);
            const input=node.matches('label')?node.querySelector('select,input'):null;
            if(input){if(!input.hasAttribute('aria-label'))input.setAttribute('aria-label',label);node.insertBefore(button,input);}
            else node.append(button);
        }
        function decorate(){
            scheduled=false;
            for(const [id,key] of Object.entries(controls)){
                const control=doc.getElementById(id),label=control?.closest('label');
                if(label){const name=Array.from(label.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim();attach(label,texts[key],name);}
            }
            page.querySelectorAll('thead th,.opportunity-metric>span,.opportunity-metric>small,.confluence-tile>span,.seasonality-stats span,.reliability-metrics span,.seasonality-filter-group>span,#cot-summary dt,#cot-summary h3').forEach(node=>{
                const label=node.dataset.label||node.textContent.trim();attach(node,describe(label),label);
            });
            page.querySelectorAll('#opportunity-results td small,#opportunity-results td strong,.opportunity-metric>strong,.confluence-tile>strong').forEach(node=>{
                const label=node.textContent.trim();
                if(label.startsWith('Nejistota četnosti')||label==='Málo dat')attach(node,describe(label),label);
            });
            if(active&&!active.isConnected)hide();
        }
        decorate();
        new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(decorate);}}).observe(page,{childList:true,subtree:true});
        doc.addEventListener('pointerover',event=>{const b=event.target.closest('.market-help-button');if(b&&!pinned)show(b);else if(event.target===tip)clearTimeout(timer);});
        doc.addEventListener('pointerout',event=>{if(active&&!pinned&&!active.contains(event.relatedTarget)&&!tip.contains(event.relatedTarget))timer=setTimeout(hide,250);});
        doc.addEventListener('focusin',event=>{if(event.target.matches('.market-help-button'))show(event.target);else hide();});
        doc.addEventListener('click',event=>{
            const button=event.target.closest('.market-help-button');
            if(button){event.preventDefault();event.stopPropagation();if(active===button&&pinned)hide();else show(button,true);}
            else if(!tip.contains(event.target))hide();
        },true);
        doc.addEventListener('keydown',event=>{if(event.key==='Escape'&&active){event.preventDefault();event.stopPropagation();hide();}},true);
        doc.addEventListener('scroll',event=>{if(event.target!==tip)hide();},true);
        addEventListener('resize',hide);
        page.addEventListener('close',hide,true);
    }
    return {describe,texts,mount};
}));
