'use strict';
const fs=require('node:fs'),path=require('node:path');
const dir=path.resolve(process.argv[2]||'artifacts/h4-strategy-study-20261026'),r=JSON.parse(fs.readFileSync(dir+'/report.json')),audit=JSON.parse(fs.readFileSync(dir+'/selected-trades.json')),f=v=>Number.isFinite(v)?v.toLocaleString('cs-CZ',{maximumFractionDigits:3}):'—',esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),csv=v=>'"'+String(v??'').replaceAll('"','""')+'"';
const stop={zone05:'SL 5 % výšky za zónou',zone25:'SL 25 % výšky za zónou',atr25:'SL 0,25 ATR(96) za zónou'},quality={all:'Bez filtru',bos:'Pouze BOS',volume:'Pouze vysoké volume',bos_volume:'BOS + vysoké volume'},days={all:'Všechny FX dny',no_monday:'Bez pondělí',no_friday:'Bez pátku',tue_thu:'Úterý až čtvrtek'},label=v=>`TP ${v.rr}R · ${stop[v.stop.id]} · ${quality[v.quality]} · ${days[v.entryDays]} · ${v.season==='off'?'bez sezónního filtru':'sezónní souhlas 20 D1'}`;
const periods=['discovery','validation','final'],periodLabel={discovery:'Výběr 2023–2024',validation:'Ověření 1–6/2025',final:'Závěr 7/2025–26. 10. 2026'},base=r.candidate?.variant.season==='off'?r.controls.baseline39:r.controls.baseline28;
const table=(headers,rows)=>'| '+headers.join(' | ')+' |\n| '+headers.map(()=> '---').join(' | ')+' |\n'+rows.map(row=>'| '+row.join(' | ')+' |').join('\n');
const comparisonRows=periods.map(p=>[periodLabel[p],base[p].n,f(base[p].netR),r.candidate[p].n,f(r.candidate[p].netR),f(r.candidate[p].meanR),f(r.candidate[p].profitFactor),f(r.candidate[p].drawdownR)]);
const shortRows=r.shortlist.map(t=>[label(t.variant),t.discovery.n,f(t.discovery.netR),f(t.familyAdjustedLower),t.validation.n,f(t.validation.netR),t.validation.mean95.map(f).join(' až ')]);
const selectedFinal=audit.rows.filter(s=>s.registeredAt>=r.plan.final.from+'T00:00:00.000Z'&&s.enteredAt&&['tp','sl'].includes(s.status)&&s.resolvedAt<=r.plan.final.to+'T23:59:59.999Z'),wait=selectedFinal.map(s=>(Date.parse(s.enteredAt)-Date.parse(s.registeredAt))/86400000).sort((a,b)=>a-b),hold=selectedFinal.map(s=>(Date.parse(s.resolvedAt)-Date.parse(s.enteredAt))/86400000).sort((a,b)=>a-b);
const operational={n:selectedFinal.length,waitingDaysMedian:wait[Math.floor(wait.length/2)],waitingDaysP95:wait[Math.floor(wait.length*.95)],waitingDaysMax:wait.at(-1),entriesAfter28Days:wait.filter(x=>x>28).length,holdingDaysMedian:hold[Math.floor(hold.length/2)],holdingDaysP95:hold[Math.floor(hold.length*.95)],holdingDaysMax:hold.at(-1)};fs.writeFileSync(dir+'/operational-diagnostics.json',JSON.stringify(operational,null,2));
const geometry=r.trials.filter(t=>t.variant.season==='off'&&t.variant.quality==='all'&&t.variant.entryDays==='all'),qualities=r.trials.filter(t=>t.variant.season==='off'&&t.variant.rr===2&&t.variant.stop.id==='zone05'&&t.variant.entryDays==='all'),weekdays=r.trials.filter(t=>t.variant.season==='off'&&t.variant.rr===2&&t.variant.stop.id==='zone05'&&t.variant.quality==='all');
const sourcePaper='https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf';
const md=`# Výzkum změn H4 strategie · 26. 10. 2026

## Závěr

**Našel jsem slibný diagnostický kandidát, nikoli statisticky potvrzenou velmi profitabilní strategii. Původní model ani běžící papertrading jsem nezměnil.**

Kandidát vybraný před závěrečným vyhodnocením: **${label(r.candidate.variant)}**. Ve finálním chronologickém období má ${r.candidate.final.n} uzavřených obchodů, **${f(r.candidate.final.netR)} čistého R**, PF ${f(r.candidate.final.profitFactor)} a propad uzavřených obchodů ${f(r.candidate.final.drawdownR)} R. Současný model na stejných 28 párech má ${f(base.final.netR)} R z ${base.final.n} obchodů. Výsledek původního modelu na všech 39 párech je ${f(r.controls.baseline39.final.netR)} R.

Kandidát **neprošel předem stanovenými výzkumnými branami**: v tréninku byl prakticky na nule, jeho rok 2024 byl ztrátový, validace má interval zasahující do záporu a žádný ze 480 pokusů neměl kladnou tréninkovou dolní hranici po společné korekci porovnávání. Další nevýhodou jsou neznámá intrabarová pořadí. Nedoporučuji přepínat skutečné obchodování na základě tohoto výsledku.

## Přesná pravidla kandidáta

1. Stejný FM/Pine detektor jako základní strategie: classic/medium, celé high–low, ATR(96), potvrzení impulzu během 1–3 svíček, nejbližší fresh + armed supply a demand.
2. Vstup při prvním budoucím dotyku hrany; žádný EMA, LTF či dodatečný svíčkový trigger. Long na horní hraně demand, short na spodní hraně supply.
3. Stop-loss za vnější hranou o **25 % výšky zóny**, nikoli 25 % ceny nebo účtu. TP přesně **1R** od vstupu. Hrubá výhra 1R; čistá je nižší o náklady.
4. Objem původní OB svíčky musí být alespoň **1,5× medián předchozích 20 svíček**. Jde o provider/tick volume OANDA, nikoli futures volume profil nebo POC.
5. Při registraci musí souhlasit nový testovaný sezónní filtr: předchozích 10 dokončených kalendářních let, stejný den v roce, první dostupná D1 od tohoto dne a close o 20 obchodních svíček později. Alespoň 8 platných let, medián ve směru obchodu a alespoň 60 % let ve stejném směru. Výstup historického vzorku musí být v daném minulém roce a před registrací. Tento filtr **není totožný s dnešním hotovým sezónním oknem aplikace**.
6. Jen původních 28 párů s ověřeným D1 stejného OANDA zdroje; žádné vybrání párů podle dosaženého zisku. Z dalších 11 neodvozujeme neexistující sezónní historii.
7. Všechny FX obchodní dny; nevynechává pondělí ani pátky. Jeden otevřený obchod na instrument, protější čekající scénáře OCO. Žádný re-entry stejné zóny ani expirace čekajícího setupu.
8. **Sezónní podmínka se zmrazí při registraci, neověřuje se znovu při vstupu.** ${operational.entriesAfter28Days} z ${operational.n} finálních obchodů vstoupilo více než 28 dní poté; maximum čekání je ${f(operational.waitingDaysMax)} dne. To omezuje obchodní interpretaci sezónního souhlasu. Změna na filtr v den vstupu/expiraci by byla nová strategie, zde zpětně nepřidávaná.

## Oddělená období a férový benchmark

${table(['Období','Základ: obchody','Základ: čisté R','Kandidát: obchody','Kandidát: čisté R','Kandidát: průměr R','PF','Propad R'],comparisonRows)}

V tabulce se obě strategie porovnávají na **stejném předem daném univerzu 28 párů**. Zisk R není procentní výnos účtu. Strategie mají odlišné vstupy, dobu držení a OCO, proto se jejich seznamy obchodů správně liší. Nejde o post-hoc vymazání ztrát z původního modelu.

Počty obsahují jen uzavřené obchody registrované i vstoupené v dané části a uzavřené do jejího konce. Přeshraniční obchody jsou uvedené v auditu a nezapočítávají se do starších výsledků; nejsou uměle uzavřené. Stav strategie se chronologicky přenáší. Rozdílný začátek historie proto dává jiná čísla než dřívější krátký backtest začínající v roce 2025.

Část souhrnných výsledků základního modelu z let 2025–2026 jsme už viděli v minulých úlohách. Závěr je oddělený od této volby parametrů, **není to zcela nedotčený historický holdout**. Živá dopředná replikace stále chybí.

## Co jsem prohledal

480 předem uložených kombinací = 5 TP (1 / 1,5 / 2 / 2,5 / 3 R) × 3 SL (5 % výšky zóny / 25 % výšky / 0,25 ATR za hranou) × 4 kvality (vše / BOS / vysoké volume / obojí) × 4 režimy dnů (vše / bez pondělí / bez pátku / út–čt) × 2 sezónní režimy. Modely bez sezónnosti mají 39 párů, se sezónností pevně 28; každý závěrečný benchmark používá shodné univerzum.

Plan byl uložen před výpočtem: SHA-256 **${r.provenance.planSha256}**. Zdroj **${r.provenance.totalBars.toLocaleString('cs-CZ')} ověřených H4**, od ledna 2023 do 26. 10. 2026, 39 párů. SQL se během výzkumu pouze četlo. Nedokončené a neověřené sváteční hranice se nedoplňují; po mezeře se indikátory znovu zahřívají 200 svíček. ATR a pivoty závisejí na dostupném začátku úseku.

Nejprve se připravily výhradně svíčky do konce 2024. Z ${r.adjustment.family} kombinací mělo ${r.adjustment.eligible} minimální vzorek (100 uzavření, 25 vstupních týdnů, 10 párů, nejvýše 35 % obchodů na jeden pár). Použil jsem přibližný společný **max-T wild bootstrap po vstupních UTC týdnech**, 2 000 společných přehrání; kritická hodnota ${f(r.adjustment.critical)}. Po korekci **žádná tréninková dolní hranice nebyla kladná**. Tento odhad není PBO/CSCV a neřeší dokonale změny režimu, závislost FX párů ani selekci.

Osm nejlepších podle tréninkové upravené dolní hranice bylo uloženo před validací. Pouze těchto osm se hodnotilo na 1–6/2025. Jeden diagnostický kandidát byl uložen před použitím závěrečných cen. Na poslední části se testoval pouze on a dva předem definované benchmarky; neproběhlo hledání dalšího vítěze podle posledního výsledku. Tuto opatrnost motivuje riziko [přizpůsobení backtestu minulosti](${sourcePaper}); nejde o implementaci celé metodiky PBO.

## Užší seznam — nic z neúspěšných pokusů neskrývám

${table(['Kombinace','Trénink n','Trénink R','Upravená dolní mez průměru','Validace n','Validace R','Validace: přibližný 95% interval průměru R'],shortRows)}

Kompletních 480 výsledků výběrové části je v **discovery-trials.csv** a report.json. U nevybraných modelů záměrně není poslední období: jeho dodatečné prohledání by z něj udělalo další výběrový vzorek.

## Co říkají jednotlivé změny — pouze výběrová část 2023–2024

Následující tabulky jsou již proběhlé, nezávisle simulované varianty z pevné mřížky. Nejsou důkazem příčiny a nebyly po pohledu na konečný výsledek přidávané.

### Samotná změna TP/SL, bez filtrů, 39 párů

${table(['TP','SL','Obchody','Čisté R','Průměr R','2× náklady: R'],geometry.map(t=>[t.variant.rr+'R',stop[t.variant.stop.id],t.discovery.n,f(t.discovery.netR),f(t.discovery.meanR),f(t.discovery.stress2)]))}

### Kvalita při původním 2R a SL 5 %, 39 párů

${table(['Filtr','Obchody','Čisté R','2× náklady: R'],qualities.map(t=>[quality[t.variant.quality],t.discovery.n,f(t.discovery.netR),f(t.discovery.stress2)]))}

Samotný BOS měl v této části kladné R, ale už při dvojnásobných pracovních nákladech byl záporný. Vysoký bodový počet není ověřená pravděpodobnost výhry. Volume samo nezaručilo výhodu.

### Omezení dnů při původním 2R a SL 5 %, 39 párů

${table(['Dny','Obchody','Čisté R','Průměr R'],weekdays.map(t=>[days[t.variant.entryDays],t.discovery.n,f(t.discovery.netR),f(t.discovery.meanR)]))}

Samotné vynechání pondělí/pátku nevytvořilo u základního modelu v této části ziskovou strategii. Den se vyhodnocuje při prvním dotyku podle OANDA NY17 obchodního dne; nedělní večer patří pondělí. Nepovolený dotyk ruší setup, nevyrábí odložený vstup.

## Pevně vybraný kandidát — závěrečný test

${table(['Metrika','Hodnota'],[['Období',periodLabel.final],['Jednoznačně uzavřeno',r.candidate.final.n],['TP / SL',r.candidate.final.tp+' / '+r.candidate.final.sl],['Podíl TP',f(r.candidate.final.winRate)+' %'],['Čisté R',f(r.candidate.final.netR)],['Průměr R',f(r.candidate.final.meanR)],['Profit factor',f(r.candidate.final.profitFactor)],['Propad pouze uzavřených R',f(r.candidate.final.drawdownR)],['2× náklady',f(r.candidate.final.stress2)+' R'],['3× náklady',f(r.candidate.final.stress3)+' R'],['Orientační 95% interval průměru R',r.candidate.final.mean95.map(f).join(' až ')],['Nejednoznačné scénáře',r.candidate.final.ambiguous],['Nedořešené scénáře na konci',r.candidate.final.unresolved],['Páry s uzavřeným obchodem',r.candidate.final.symbols],['Vstupní týdny',r.candidate.final.entryWeeks],['Medián držení dle důkazních H4',f(operational.holdingDaysMedian)+' dne'],['95. percentil držení',f(operational.holdingDaysP95)+' dne']])}

Rozdíl proti shodnému benchmarku je **${f(r.comparison.netRDifference)} R**, ale orientační párový týdenní interval tohoto rozdílu je **${r.comparison.totalDifference95.map(f).join(' až ')} R** a protíná nulu. Nelze tvrdit, že převaha je prokázaná. Interval samotného průměru kandidáta je jen těsně nad nulou a není novým povolením zapomenout na selhaný výběr z mnoha možností.

### Rozložení kandidáta v čase

${table(['Část','Obchody','Čisté R'],Object.entries(r.candidate.discovery.byYear).map(([y,v])=>[y,v.n,f(v.r)]).concat([['1–6/2025',r.candidate.validation.n,f(r.candidate.validation.netR)]],Object.entries(r.candidate.final.byYear).map(([y,v])=>[y==='2025'?'7–12/2025':'2026 do 26. 10.',v.n,f(v.r)])))}

### Finální výsledek po párech — žádný pár podle této tabulky nevyřazuji

${table(['Pár','Obchody','Čisté R'],Object.entries(r.candidate.final.bySymbol).sort((a,b)=>b[1].r-a[1].r).map(([key,v])=>[key,v.n,f(v.r)]))}

Po vynechání kteréhokoli jednoho páru je nejnižší zbývající zisk ${f(Math.min(...r.leaveOneSymbolOut.map(s=>s.netR)))} R. To je příznivá kontrola koncentrace, nikoli důkaz nezávislých obchodů. Automatický výběr pouze ziskových párů by byl další optimalizace a nedělám jej.

## Největší slabina: H4 neukazuje pořadí pohybu uvnitř svíčky

Kandidát má vedle ${r.candidate.final.n} TP/SL také **${r.candidate.final.ambiguous} nejednoznačných scénářů**. Například mohl být zasažen vstup a TP ve stejné H4, aniž OHLC dokazuje jejich pořadí. Nejsou započítány jako výhra ani ztráta. Při pomocném stresu, kdy každému nejednoznačnému scénáři přiřadíme -1R a pracovní náklady, vyjde součet **${f(r.candidate.final.netRAmbiguityLossStress)} R**. Je to záměrně konzervativní citlivost, ne zjištěný výsledek ani matematická dolní mez gapových ztrát; může dvojitě penalizovat OCO dvojici.

Proto je větší prioritou než další optimalizování čísel získat stejnozdrojové M15/M5 pro nejasné případy. H4 do M15 nerozděluji a nevymýšlím chybějící intrabarovou trajektorii.

## Náklady a omezení

- Pracovní spread 1 bps, skluz 0,5 bps na každé straně, komise 0. Nejde o ceník brokera; 2× a 3× jsou jen násobky těchto předpokladů.
- Financování, konkrétní bid/ask, tick size, minimální odstup příkazů, fronta limitů a margin nejsou zahrnuté. Nejdelší držení kandidáta je ${f(operational.holdingDaysMax)} dne, tedy financování nelze obecně zanedbat.
- Vše je v jednotkách původního risku R, ne ve výnosech účtu. Neexistuje zde peněžní portfolio s limity korelovaných FX expozic. Propad vychází jen z uzavřených obchodů, ne z mark-to-market equity.
- Jde o nynější historické ceny, které provider mohl revidovat, nikoli archiv toho, co v každém okamžiku viděl živý Work.
- Vzorek zóny ATR závisí na dostupné historii a znovuzahřátí po nepokrytých svátečních seancích. Všechny modely mají stejné zacházení s datovými mezerami.
- Poměr výher s TP1R nelze porovnávat samostatně s TP2R. Rozhodují náklady, průměr R, nejasné obchody a stabilita na dalších datech.

## Doporučený další postup

1. Původní živý 2R model ponechat jako benchmark. Zdejší test ho nepřepsal.
2. Kandidáta případně nejprve uzamknout jako **samostatný experimentální paper model**, nikoli aktivovat skutečné obchody. Žádné automatické spuštění v této úloze neproběhlo.
3. Doplnit skutečné M15/M5 důkazy a reálné náklady brokera, zejména u nejasných výsledků.
4. Nově a předem stanovit pravidlo expirace/přehodnocení sezónnosti při vstupu; současná historická varianta ji zmrazuje při registraci. Tuto změnu ověřovat odděleně, nikoli dál dolaďovat na již prohlédnutém závěru.
5. Vyhodnotit nejméně dalších 100 nových uzavřených obchodů včetně všech vynechaných/nejasných případů a nákladů. Ani 100 samo o sobě není záruka; rozhoduje nejistota a výsledek.

**Závěr zůstává: zajímavý směr TP1R + vysoké volume + sezónní souhlas, ale žádný potvrzený ziskový vítěz.**

## Audit a reprodukce

Soubory ve stejné složce: report.json, discovery-trials.csv, selected-trades.csv, selected-trades.json, baseline-trades.json, operational-diagnostics.json, plan.frozen.json, input-provenance.frozen.json, shortlist.frozen.json a candidate.frozen.json. Obsahují přesná pravidla, zdrojové a implementační SHA-256, nezměněnou volbu před poslední částí i důkazy setupů.

Testy ověřily přesnou shodu rychlého modelu s původním replayem na celé historii EURUSD i USDHKD, shodu každého testovaného prefixu detektoru, nepoužití budoucích cen/sezónních let, vlastní OCO filtrů, kalendářní hranice, vyloučení přeshraničních obchodů, reprodukovatelnost korekce a neměnnost kandidáta. Žádná data nebyla zveřejněna, změněna v SQL nebo odeslána do Worku.
`;
fs.writeFileSync(dir+'/report.md',md);
const trialHeaders=['id','season','rr','stop','quality','days','training_n','training_netR','training_meanR','training_PF','training_DD','training_2xcostR','training_ambiguous','eligible','family_adjusted_lower'];
const trialData=r.trials.map(t=>[t.variant.id,t.variant.season,t.variant.rr,t.variant.stop.id,t.variant.quality,t.variant.entryDays,t.discovery.n,t.discovery.netR,t.discovery.meanR,t.discovery.profitFactor,t.discovery.drawdownR,t.discovery.stress2,t.discovery.ambiguous,t.trainingEligible,t.familyAdjustedLower]);fs.writeFileSync(dir+'/discovery-trials.csv','\uFEFF'+[trialHeaders,...trialData].map(row=>row.map(csv).join(';')).join('\r\n'));
const tradeHeaders=['id','symbol','side','registered_UTC','entry_proof_UTC','exit_proof_UTC','zone_origin_UTC','zone_confirmed_UTC','lower','upper','entry','SL','TP','risk','status','reason','grossR','costR','netR','volume_ratio','BOS','season_samples','season_median','season_long_rate','season_short_rate','last_season_evidence'];const tradeData=audit.rows.map(s=>[s.id,s.key,s.side,s.registeredAt,s.enteredAt,s.resolvedAt,s.zone.baseDate,s.zone.confirmedAt,s.zone.lower,s.zone.upper,s.entry,s.sl,s.tp,s.risk,s.status,s.reason,s.grossR,s.costR,s.netR,s.zone.volumeRatio,s.zone.bos,s.season?.samples,s.season?.median,s.season?.longRate,s.season?.shortRate,s.season?.lastEvidence]);fs.writeFileSync(dir+'/selected-trades.csv','\uFEFF'+[tradeHeaders,...tradeData].map(row=>row.map(csv).join(';')).join('\r\n'));
// Offline, self-contained report; it never fetches or publishes OHLCV.
const htmlTable=(heads,data,id='')=>`<div class="scroll"><table ${id?'id="'+id+'"':''}><thead><tr>${heads.map(h=>'<th><button type="button">'+esc(h)+'</button></th>').join('')}</tr></thead><tbody>${data.map(row=>'<tr>'+row.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')}</tbody></table></div>`;
const html=`<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Výzkum H4 · 480 variant</title><style>body{font:16px/1.6 system-ui;background:#111719;color:#e0e9ed;margin:0}main{max-width:1280px;margin:auto;padding:24px}h1,h2{line-height:1.25}a{color:#42d9c4}.notice{border-left:4px solid #f4bd5d;padding:16px;background:#29271f}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.cards article{background:#202b2d;border:1px solid #415052;padding:18px;border-radius:8px}.cards strong{display:block;font-size:26px;color:#45d9bf}.scroll{max-width:100%;overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:10px;border-bottom:1px solid #394849;text-align:left;vertical-align:top;white-space:nowrap}th{background:#202b2d}button,input{font:inherit;color:inherit;background:#263436;border:1px solid #526164;border-radius:5px;padding:7px}button{cursor:pointer}p,li{overflow-wrap:anywhere}details{margin:24px 0}summary{cursor:pointer;font-weight:600}input{max-width:100%;box-sizing:border-box}.muted{color:#a9bac0}.links{display:flex;flex-wrap:wrap;gap:18px}</style><main>
<p class="muted">26. 10. 2026 · soukromý výzkumný report · ${r.provenance.totalBars.toLocaleString('cs-CZ')} H4 · 39 párů</p><h1>480 kombinací H4 strategie</h1><p class="notice"><b>Slibný kandidát, žádný potvrzený vítěz.</b> Přísnými výzkumnými branami neprošla žádná kombinace. Živý model 2R ani SQL deníky se nezměnily.</p><h2>Diagnostický kandidát</h2><p>${esc(label(r.candidate.variant))}. Vstup na první dotyk. Sezónní filtr se zmrazí při registraci, ne v den vstupu.</p><div class="cards"><article>Finální čisté R<strong>${f(r.candidate.final.netR)}</strong></article><article>Uzavřených obchodů<strong>${r.candidate.final.n}</strong></article><article>Profit factor<strong>${f(r.candidate.final.profitFactor)}</strong></article><article>Propad uzavřených R<strong>${f(r.candidate.final.drawdownR)}</strong></article></div>
<h2>Porovnání na stejných 28 párech</h2>${htmlTable(['Období','Základ n','Základ R','Kandidát n','Kandidát R','Průměr R','PF','Propad R'],comparisonRows)}<p>Pracovní náklady: spread 1 bp + skluz 0,5 bp na každé straně. Financování a brokerové limity chybí. R není procentní výnos účtu.</p><p class="notice">${r.candidate.final.ambiguous} nejednoznačných scénářů není v TP/SL statistice. Při citlivosti -1R + náklady za každý takový scénář vyjde ${f(r.candidate.final.netRAmbiguityLossStress)} R. Rozdíl proti benchmarku má týdenní interval ${r.comparison.totalDifference95.map(f).join(' až ')} R, tedy zahrnuje nulu.</p>
<h2>Čas a ověřitelnost</h2><p>Výběr 2023–2024 → osm předem zmrazených variant → validace 1–6/2025 → jeden zmrazený kandidát → závěrečná část 7/2025–26. 10. 2026. Některé starší souhrny z poslední části jsme již viděli; není to nedotčená historie. Je nutný budoucí paper test.</p><p>Volba je auditovaná v candidate.frozen.json. ${operational.entriesAfter28Days} finálních obchodů vstoupilo více než 28 dní po sezónním filtru; maximum čekání ${f(operational.waitingDaysMax)} dne. Nová expirace či přehodnocení sezónnosti by znamenaly nový, dosud neověřený model.</p>
<h2>Osm variant vybraných pouze v tréninku</h2>${htmlTable(['Pravidla','Trénink n','Trénink R','Upravená dolní mez','Validace n','Validace R','Validace 95% průměr R'],shortRows)}
<details><summary>Všech 480 výsledků výběrové části · kliknutím na sloupec řadit</summary><p>Úmyslně neobsahuje konečné výsledky všech variant: ty by umožnily další výběr podle posledního období.</p><label>Filtr <input id="filter" type="search" placeholder="např. bos nebo aligned_20d"></label>${htmlTable(trialHeaders,trialData.map(row=>row.map(v=>typeof v==='number'?Number(v.toFixed(6)):v)),'trials')}</details>
<h2>Výstupy ke stažení a úplná metodika</h2><div class="links"><a href="report.md">Úplný report a omezení</a><a href="discovery-trials.csv">480 variant CSV</a><a href="selected-trades.csv">Setupy a obchody CSV</a><a href="selected-trades.json">Časový audit kandidáta</a><a href="report.json">Výsledky JSON</a><a href="plan.frozen.json">Předem uložený plán</a></div><p class="muted">Žádné automatické obchodování, změna Worku nebo zveřejnění cenové databáze. Zdroj a implementace jsou ověřené SHA-256. <a href="${sourcePaper}">Výzkum rizika přizpůsobení backtestu</a>.</p></main><script>document.querySelectorAll('th button').forEach(b=>{b.onclick=()=>{const th=b.parentElement,t=th.closest('table'),i=[...th.parentElement.children].indexOf(th),direction=b.dataset.dir==='asc'?'desc':'asc';b.dataset.dir=direction;const rows=[...t.tBodies[0].rows];rows.sort((a,b)=>{const x=a.cells[i].textContent,y=b.cells[i].textContent,nx=Number(x),ny=Number(y),d=x!==''&&y!==''&&Number.isFinite(nx)&&Number.isFinite(ny)?nx-ny:x.localeCompare(y,'cs',{numeric:true});return direction==='asc'?d:-d;});rows.forEach(r=>t.tBodies[0].append(r));};});document.querySelector('#filter').oninput=e=>{for(const r of document.querySelectorAll('#trials tbody tr'))r.hidden=!r.textContent.toLowerCase().includes(e.target.value.toLowerCase());};</script></html>`;
fs.writeFileSync(dir+'/report.html',html);console.log(JSON.stringify({report:dir+'/report.md',html:dir+'/report.html',trials:trialData.length,tradeScenarios:tradeData.length,operational}));
