# TradingView MCP — jednorázový backfill 36 instrumentů

Datum: 12. 10. 2026. **Soukromý canonical/test dataset; produkce nezměněna.**

## Výsledek

- 36/36 požadovaných symbolů úspěšně staženo. **274 117 raw záznamů**, **274 077 přijatých dokončených záznamů**, **4 odmítnuté OHLC**, **36 posledních nepotvrzených/otevřených barů odděleno**. Žádné duplicity v konečných řadách.
- 46 OHLC requestů: 28 FX po jedné stránce, metals po dvou, NDX dvě, SPX čtyři, čtyři futures po dvou. U všech posledních stránek has_more=false. Maximum je historie dostupná přes MCP v této relaci, nikoli záruka existence všech původních exchange dat.
- Nová série používá pouze svůj TradingView provider. Žádné Yahoo hodnoty, provider splice, ruční opravy, zaokrouhlení, tolerance ani syntetické svíčky. Accepted OHLC/timestamp jsou numericky shodné s raw payloadem; test ověřil každou hodnotu.
- Produkční SQL, routing, seasonality, HTF zóny, COT, scoring, tracking ani veřejný web nejsou změněné. Výpočet způsobilých let je pouze coverage diagnostika přes existující seasonalCurve, nikoli rebuild produkční analytiky.

## Uložení

Kořen: `artifacts/tradingview-backfill-36-v1/` (lokální, Git-ignored).

- `requested-universe.json`: explicitní mapa 36 instrumentů.
- `raw/INSTRUMENT/page-NNN.json`: immutable MCP payload, request a observation time, včetně nepoužitého aktuálního baru.
- `identity-evidence.json`, `silver-identity-search.json`: identita přes nástroje TradingView. XAGUSD chyběl v quote screeneru, ale search a OHLC symbol potvrdily; nebyl nahrazen jiným produktem.
- **`validated-v2/series/INSTRUMENT.json`**: konečná oddělená test série, exact provider OHLC/timestamp, date-label metodika, accepted/rejected/excluded, SHA-256 stránek, coverage a mezery.
- `test-source-registry.json`: verzovaná test registry; seasonalitySource a htfSource odkazují na tutéž samostatnou sérii. productionActive=false.
- `production-reference/`: read-only snapshot veřejné produkce po backfillu.
- `validated-v2/audit.json`, `validated-v2/comparison/`, `supplementary-comparison.json`: strojově čitelný audit a srovnání.

První odvozený audit v kořenovém `series/` / `audit.json` je ponechaný jako superseded diagnostika; **používat validated-v2**. V první verzi exceptional 18:00 NY bar metals dostal nesprávný date-label fallback a falešnou duplicate-date značku. Druhá verze opravuje pouze odvozený date label na local start +1, nemění timestamp/OHLC. Metodická session výhrada zůstává viditelná.

## Identity a session

FX/metals: provider **OANDA**, source identity **OANDA_TRADINGVIEW**, transport TradingView MCP. Nejde o nový přímý OANDA API feed. Quote side MCP neurčuje; bid/ask/mid není ověřeno. Metals označené spot/OTC jsou OTC metal quotations pod OANDA symbolem, nikoli potvrzení právní identity fyzického spotu nebo futures.

NDX = NASDAQ:NDX, provider NASDAQ, **cash index**, source identity NASDAQ_TRADINGVIEW. SPX = SP:SPX, provider S&P / TradingView namespace SP, **cash index**, source identity SP_TRADINGVIEW. Žádná NAS100USD / SPX500USD CFD náhrada.

WTI NYMEX:CL1!, Brent ICEEUR:BRN1!, Natural Gas NYMEX:NG1!, Copper COMEX:HG1!: **continuous futures**, samostatné NYMEX_TRADINGVIEW / ICEEUR_TRADINGVIEW / COMEX_TRADINGVIEW identity. Není to přímá contract-level historie a MCP neposkytuje roll kalendář ani back/ratio adjustment pravidlo. Generic notice „split-adjusted only“ roll konstrukci nedokládá.

Všech 28 FX timestampů odpovídá 17:00 America/New_York včetně DST. Date je odvozený session-end label (NY start calendar +1), původní unix t a UTC datum zůstávají vedle něj. Metals mají jeden začátek **28. 11. 2024 v 18:00 NY** místo 17:00, který je flagged a není přeznačen na NY17; next-day label je výslovně odvozený.

Indexy mají NY timestamp 09:30. Futures report používá **UTC calendar date timestampu začátku**, nikoli potvrzený session-end/trading date; poslední label proto může být 8. 10., přestože jde o následující uzavřenou obchodní session. Pro canonical routing futures je nutné ověřit kalendářní mapování. Žádné timestampy neposouváme.

Completion gate: každý accepted historický bar má pozdější provider D1 start již pozorovaný; nejnovější bar konzervativně vyloučen u všech 36 instrumentů. Neodvozujeme burzovní zavírací čas pouhým fixním UTC offsetem.

## Coverage všech 36 sérií

| Instrument | Provider symbol | Typ | První label | Poslední label | Bary | Rejected | Duplicity | Mezery / >7 dní | Kompletní roky* |
|---|---|---|---|---|---:|---:|---:|---:|---:|
| EURUSD | OANDA:EURUSD | spot/OTC | 2002-05-06 | 2026-10-09 | 6346 | 0 | 0 | 1290 / 0 | 23 |
| GBPUSD | OANDA:GBPUSD | spot/OTC | 2002-05-06 | 2026-10-09 | 6347 | 0 | 0 | 1290 / 0 | 23 |
| USDJPY | OANDA:USDJPY | spot/OTC | 2002-05-06 | 2026-10-09 | 6346 | 0 | 0 | 1290 / 0 | 23 |
| USDCHF | OANDA:USDCHF | spot/OTC | 2002-05-06 | 2026-10-09 | 6343 | 0 | 0 | 1290 / 0 | 23 |
| AUDUSD | OANDA:AUDUSD | spot/OTC | 2002-05-06 | 2026-10-09 | 6344 | 0 | 0 | 1290 / 0 | 23 |
| NZDUSD | OANDA:NZDUSD | spot/OTC | 2002-09-23 | 2026-10-09 | 6247 | 0 | 0 | 1269 / 0 | 23 |
| USDCAD | OANDA:USDCAD | spot/OTC | 2002-05-07 | 2026-10-09 | 6343 | 0 | 0 | 1290 / 0 | 23 |
| EURGBP | OANDA:EURGBP | spot/OTC | 2002-05-07 | 2026-10-09 | 6344 | 0 | 0 | 1290 / 0 | 23 |
| EURJPY | OANDA:EURJPY | spot/OTC | 2002-05-06 | 2026-10-09 | 6346 | 0 | 0 | 1290 / 0 | 23 |
| EURCHF | OANDA:EURCHF | spot/OTC | 2002-05-06 | 2026-10-09 | 6346 | 0 | 0 | 1290 / 0 | 23 |
| EURAUD | OANDA:EURAUD | spot/OTC | 2004-05-31 | 2026-10-09 | 5807 | 1 | 0 | 1181 / 0 | 21 |
| EURCAD | OANDA:EURCAD | spot/OTC | 2004-05-31 | 2026-10-09 | 5810 | 0 | 0 | 1180 / 0 | 21 |
| EURNZD | OANDA:EURNZD | spot/OTC | 2004-05-31 | 2026-10-09 | 5809 | 0 | 0 | 1180 / 0 | 21 |
| GBPJPY | OANDA:GBPJPY | spot/OTC | 2002-05-07 | 2026-10-09 | 6344 | 0 | 0 | 1290 / 0 | 23 |
| GBPCHF | OANDA:GBPCHF | spot/OTC | 2002-05-07 | 2026-10-09 | 6344 | 0 | 0 | 1290 / 0 | 23 |
| GBPAUD | OANDA:GBPAUD | spot/OTC | 2004-05-31 | 2026-10-09 | 5810 | 0 | 0 | 1180 / 0 | 21 |
| GBPCAD | OANDA:GBPCAD | spot/OTC | 2004-05-31 | 2026-10-09 | 5809 | 0 | 0 | 1180 / 0 | 21 |
| GBPNZD | OANDA:GBPNZD | spot/OTC | 2004-05-31 | 2026-10-09 | 5812 | 0 | 0 | 1180 / 0 | 21 |
| AUDJPY | OANDA:AUDJPY | spot/OTC | 2004-05-31 | 2026-10-09 | 5808 | 0 | 0 | 1180 / 0 | 21 |
| AUDNZD | OANDA:AUDNZD | spot/OTC | 2004-05-03 | 2026-10-09 | 5831 | 0 | 0 | 1184 / 0 | 21 |
| AUDCAD | OANDA:AUDCAD | spot/OTC | 2004-05-31 | 2026-10-09 | 5809 | 0 | 0 | 1180 / 0 | 21 |
| AUDCHF | OANDA:AUDCHF | spot/OTC | 2004-05-31 | 2026-10-09 | 5808 | 0 | 0 | 1180 / 0 | 21 |
| NZDJPY | OANDA:NZDJPY | spot/OTC | 2004-05-31 | 2026-10-09 | 5809 | 0 | 0 | 1180 / 0 | 21 |
| NZDCAD | OANDA:NZDCAD | spot/OTC | 2004-05-31 | 2026-10-09 | 5810 | 0 | 0 | 1180 / 0 | 21 |
| NZDCHF | OANDA:NZDCHF | spot/OTC | 2004-05-31 | 2026-10-09 | 5809 | 1 | 0 | 1181 / 0 | 21 |
| CADJPY | OANDA:CADJPY | spot/OTC | 2004-05-31 | 2026-10-09 | 5809 | 1 | 0 | 1181 / 0 | 21 |
| CADCHF | OANDA:CADCHF | spot/OTC | 2004-05-31 | 2026-10-09 | 5809 | 1 | 0 | 1180 / 0 | 21 |
| CHFJPY | OANDA:CHFJPY | spot/OTC | 2004-05-31 | 2026-10-09 | 5807 | 0 | 0 | 1180 / 0 | 21 |
| XAUUSD | OANDA:XAUUSD | spot/OTC | 1833-01-07 | 2026-10-09 | 14868 | 0 | 0 | 3680 / 674 | 54 |
| XAGUSD | OANDA:XAGUSD | spot/OTC | 1802-01-04 | 2026-10-09 | 15020 | 0 | 0 | 3776 / 762 | 54 |
| NDX | NASDAQ:NDX | cash index | 1985-01-31 | 2026-10-09 | 10504 | 0 | 0 | 2275 / 0 | 40 |
| SPX | SP:SPX | cash index | 1871-02-01 | 2026-10-09 | 25333 | 0 | 0 | 5999 / 490 | 97 |
| WTI | NYMEX:CL1! | continuous futures | 1983-03-29 | 2026-10-08 | 10943 | 0 | 0 | 2400 / 0 | 41 |
| BRENT | ICEEUR:BRN1! | continuous futures | 1989-03-01 | 2026-10-09 | 9618 | 0 | 0 | 3844 / 0 | 36 |
| NATGAS | NYMEX:NG1! | continuous futures | 1990-04-02 | 2026-10-08 | 9179 | 0 | 0 | 2028 / 0 | 35 |
| COPPER | COMEX:HG1! | continuous futures | 1988-07-28 | 2026-10-08 | 9606 | 0 | 0 | 2116 / 0 | 37 |

\* Kompletní roky = nezměněná seasonalCurve hranice roku + maximální mezera sedm dní + validní pozitivní close. **Není to záruka, že stará OHLC jsou autentické denní svíčky.** Mezery počítají intervaly delší než jeden kalendářní den, tedy i běžné víkendy/svátky, nikoli jen chybné sessions. Počty missing weekdays, annual bars a všechny konkrétní gapy jsou v JSON. Odmítnutý bar není doplněn; rok s jednou dírou může nadále splnit existující coverage pravidlo.

## Přísně odmítnuté FX bary

| Pár | Odvozené datum | Problém |
|---|---|---|
| EURAUD | 2017-09-20 | close 1.480815 < low 1.48082 |
| NZDCHF | 2017-11-14 | close 0.680155 < low 0.68016 |
| CADJPY | 2018-02-27 | close 84.0095 < low 84.01 |
| CADCHF | 2016-04-04 | close 0.732675 < low 0.73268 |

Odchylky vypadají jako rounding/midpoint precision, ale aktuální zadání vyžaduje strict inequalities. Žádnou toleranci zde nepovolujeme a žádné high/low nerozšiřujeme. Tyto čtyři série jsou conditional, jednotlivé bary v rejected karanténě, exact raw evidence zachována.

## Prehistory a výrazné anomálie

- Gold začíná labely 1833, Silver 1802: nejstarší řada má řídké roční/měsíční O=H=L=C záznamy. **Není to několik století daily OANDA obchodních svíček.** Konstrukce původní prehistory není z MCP známa. Coverage rule nachází 54 způsobilých let od 1970, s výpadky 1997–1998; nic nepředstíráme a roční body neinterpolujeme do svíček.
- SPX začíná 1871 řídkými měsíčními body, pozdější historická daily část je dlouho close-only O=H=L=C. První kompletní rok bez flat OHLC je v tomto payloadu **1962**; to je naměřená diagnóza, nikoli potvrzení autentičnosti všech OHLC od tohoto roku. Celou 1871 historii nelze dát HTF detektoru jako skutečné daily ranges. Moderní cash index segment je vhodný test kandidát.
- WTI obsahuje skutečně vrácený negative-price bar: timestamp **2020-04-19T22:00:00Z**, OHLC 17.73 / 17.85 / -40.32 / -37.63. Záporná futures cena sama o sobě není nevalidní OHLC, proto ji nemažeme ani neopravujeme. Není ale kompatibilní s nynějším pozitivním procentním seasonality předpokladem; WTI zůstává research-only a 2020 nesplňuje pozitivní-close year rule.
- Close změny >5 % jsou diagnostika, ne automatický reject. AUDJPY má 21 takových pohybů (např. +12.66 % 28. 10. 2008), AUDCHF 10 (např. -16.93 % 15. 1. 2015), NZDJPY 10. Koincidence s krizovými obdobími není nezávislé potvrzení každého ticku. Silver prehistory má i +127.9 % přes tříletou mezeru: to **není denní return**. Každý outlier ukládá skutečný gapDays.

## Srovnání s produkcí

Legacy seasonality export obsahuje close, ale ne per-row provider provenance. Importer deklaruje Yahoo/Stooq; nesmíme ho vydávat za prokazatelně čistou Yahoo historii. HTF snapshot naopak explicitně označuje Yahoo Finance. OHLC srovnání je dostupné u 27 FX + NDX + SPX, u USDJPY má snapshot nula barů; metals/commodity nemají produkční HTF OHLC v tomto snapshotu. Pro všechny 36 existuje legacy close řada a její srovnání v supplementary-comparison.json.

Srovnávané datumové labely jsou přesně spárované, bez posouvání pro lepší shodu. Rozdílná session nebo futures/OTC identita může část rozdílu vysvětlit; srovnání není důkaz ekonomické ekvivalence.

| Příklad | Společné OHLC datumy | Open=close Yahoo / nový feed ve společném okně | Medián abs. close rozdílu |
|---|---:|---|---:|
| EURUSD | 400 | 45 % / 0 % | 0.002527 (~25.27 pipu) |
| GBPUSD | 400 | 7.25 % / 0 % | 0.003346 (~33.46 pipu) |
| USDCAD | 400 | 45.5 % / 0 % | viz comparison JSON |
| NDX | 400 | 0 % / viz comparison JSON | 0.002305 index bodu |
| SPX | 400 | 0 % / viz comparison JSON | 0.009961 index bodu |

Celá OANDA FX historie má O=C přibližně 0.08–0.35 %; na 400 společných datech je to 0–0.25 %. Yahoo FX rozdíl není kosmetický: EURUSD 5. 3. 2025 close 1.062699 vs OANDA 1.07896. To odpovídá známé open/close otázce, ale samotná nezávislá shoda nepředstavuje úřední potvrzení správnosti všech OANDA hodnot. Ceny se nemění kvůli hezčím skóre.

NDX/SPX mají proti Yahoo moderní close převážně pouze velmi malé numerické rozdíly. U SPX jsou ale jednotlivé odchylky high/open (max cca 4.57 / 9.85 bodu) větší; nezamlčujeme je. Výčet největších OHLC i close rozdílů je u každého instrumentu v comparison/.

## Doporučení canonical/test

- **25 plných test kandidátů:** 24 FX bez strict rejectu + NDX. Datová identita a konstrukční testy prošly; outliery zůstávají evidence, nikoli nezávisle certifikované market moves.
- **SPX:** vhodný cash index test kandidát, ale pro HTF omezit použití na prokazatelně denní non-close-only část; ne všechny staré body. Specifickou produkční hranici tento úkol nenastavuje.
- **4 FX conditional:** EURAUD, NZDCHF, CADJPY, CADCHF. Neprohlašovat celé raw historie za strict-clean, dokud není výslovně rozhodnuté použití karantény / precision politiky. Přijaté bary v test řadách jsou strict-valid.
- **needs_source_review:** XAUUSD, XAGUSD (prehistory, OTC provenance/session výjimka), WTI, BRENT, NATGAS, COPPER (continuous roll konstrukce, session/trading date; WTI záporná cena).
- Všechny požadované symboly byly jednoznačně routovatelné; žádný instrument nebyl nahrazen CFD proxy. „Needs review“ zde znamená konstrukci/provenienci, ne neúspěšné nalezení tickera.

Jednorázový backfill neřeší právo veřejné redistribuce, unattended API job, market-data entitlement mimo připojenou relaci ani point-in-time původ dat. Nedoporučujeme automaticky aktivovat celý dataset v produkci.

## Ověření

Skill tradingview:market-data určoval přímé MCP čtení, identity a stránkování. Skill verify-build-run používáme pro validaci importních nástrojů. Offline + skutečné raw-evidence testy ověřily všech 274 077 přijatých timestamp/OHLC bez změny, strict inequalities, zero/nonfinite, duplicity, poslední bar exclusion a exhausted pagination. Samostatné odvozené test soubory nepřepisují staré historie.

Release build prošel bez chyb a varování. Prošel také skutečný startup a browser regression existujícího izolovaného OANDA preview (canvas, tooltip, filtry, mobilní layout a neměnnost skóre). Tento runtime test používá již existující preview; nových 36 test sérií nepřipojuje do analytiky a není potvrzením jejich produkčního nasazení. Produkční routing, SQL, seasonality ani HTF nebyly přepočteny.
