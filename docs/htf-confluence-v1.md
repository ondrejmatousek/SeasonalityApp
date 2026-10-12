# HTF shoda — experimentální v1

Nová samostatná záložka kombinuje **pozici posledního dokončeného close vůči D1/W1 zóně**, existující sezonní interval a existující historickou COT komponentu. Nejde o validovaný obchodní model ani pravděpodobnost zisku. V1/V2, jejich váhy, universe a tracking zůstávají stejné.

## Data a ceny

OHLC: veřejný Yahoo Finance chart endpoint, 5 let denních svíček, symboly explicitně v `core-market-registry.js.chartSource`. 28 FX spot referencí + NDX/QQQ/SPX/SPY; NQ/MNQ používají NDX, ES/MES SPX. Profily jsou v datech, tabulka ukazuje jednu referenci místo duplicit. Gold a research-only commodities jsou mimo tuto záložku.

Datum svíčky určuje poskytovatelova `exchangeTimezoneName`. Bereme pouze obchodní datum před datem vyhodnocení. Není známa přesná politika intradenního cutoffu poskytovatele, proto dnešní svíčku nikdy nepoužijeme. W1 zahrnuje pouze uzavřené pondělní týdny (alespoň 3 denní svíčky). Nejde o přesnou brokerovou feedovou identitu ani point-in-time archiv. Provider může historii revidovat; snapshot obsahuje symbol, URL, observation timestamp, timezone a poslední datum.

Žádné generování OHLC z close, žádný futures fallback, žádný import do SQL. Neplatné svíčky se vyřadí; duplicity, méně než 100 OHLC, poslední datum starší než 7 dní, nedávná mezera >7 dní nebo rozdíl společného close proti existující sezonní ceně >0,5 % zdroj blokují. Split odděluje historii pro detekci: hledáme až po posledním splitu, aby gap nevyrobil zónu. Chybějící feed je unavailable, nikdy cached confirmation. Bezpečnostní kontroly nejsou záruka kompletní historie; chybějící jednotlivé svátky/dny mohou zůstat.

## Pravidla zóny (neoptimalizovaná pracovní heuristika)

- ATR14 z předchozích svíček, nikoli budoucích.
- Základna 1–3 svíčky: celkové rozpětí do 1 ATR, tělo každé do 50 % jejího rozpětí.
- Do 3 svíček po základně close odchází alespoň 1,5 ATR a proráží předchozí 20svíčkové rozpětí.
- Demand: low základny až horní hrana jejích těl. Supply: spodní hrana těl až high základny.
- Zóna je známa až po potvrzovacím close. Stáří maximálně 365 dní, nejvýše jeden denní dotykový návrat (epizoda souvislých dotyků).
- Následný denní close za vzdálenější hranou ruší i W1 zónu, bez čekání na konec týdne.
- Přes mezery >7 dní v D1 / >10 dní ve W1 se základna/odchod nepropojuje.

## Shoda a použití

Sezonní intervaly přebíráme beze změny z maximální dokončené historie. Směr kontrolujeme na existujícím posledním 20letém souboru: >=8 případů, četnost >50 %, medián ve směru. Začátek do 30 dní; konec ještě nenastal. Jde o směr historického intervalu, nikoli měření živého trendu.

Cena v zóně nebo do 0,5 **ATR v okamžiku vzniku zóny** je základní filtr. Vzdálené zóny lze zobrazit jako čekající watchlist. Budoucí interval znamená čekat; nejde o dnešní vstup. COT stav přebírá C: nad 0,5 potvrzuje, pod 0,5 proti, rovno neutrální. Potřebuje aktuální referenci + >=8 podobných i >=8 ostatních případů; jinak bez dostatku dat. FX zůstává relativní base/quote, USD u=0. Nevzniká nové konfluencové skóre.

Graf je skutečný OHLC, horizontální zóna + vertikální sezonní interval. Budoucí část nemá cenovou křivku. Cenové úrovně NDX/SPX se **nesmí přenést přímo na NQ/ES execution ceny**. Více zón či období stejného instrumentu není více nezávislých příležitostí.

## Ranní aktualizace a výpadky

Stávající workflow 05:15 UTC denně (Praha 07:15 CEST / 06:15 CET) obnoví data, stáhne OHLC a vytvoří content-addressed HTF JSON před nasazením. GitHub schedule není garantovaná přesná doba; běh může přijít později. UI vždy uvádí datum analýzy i datum close. Snapshot více než jeden kalendářní den starý je označen; filtr trojité potvrzené shody z něj nic nevrací. Pokud workflow selže, zůstává veřejný poslední snapshot s uvedeným datem. Žádné e-maily ani automatické obchody.

## Ověření

`node Tools/htf-checks.cjs`, `node Tools/htf-export-checks.cjs <export>`, `node Tools/htf-browser-checks.cjs <export-or-url>`. Testy kontrolují orientaci, nekompletní svíčky, invalidace, dotyky, absenci budoucích cen, mapování, neměnnost V2 a skutečný běh záložky. Prediktivní přínos HTF heuristiky zatím nebyl nezávisle validován.
