# Historická COT shoda — přepočet core screeneru

Přepočítáno 11. 10. 2026 nad nezměněným exportem s asOf **2026-10-10**. Nová cenová ani CFTC data se nestahovala, SQL se neměnilo.

## Metoda

Současný oficiální historický CFTC dataset je pracovním historickým zdrojem. Výběr bere poslední positions date nejpozději k výročí dne snapshotu (stejný předstih před vstupem), nikoli historické availableAt nebo vintage. Zůstává stáří nejvýše 21 dní, 52reportový lookback a původní tolerance. FX cross vyžaduje synchronní base/quote, USD u=0, žádný base-only fallback. Dnešní reference nadále používá doloženou dostupnost v současném exportu. Jde o **Historickou COT shodu**, nikoli strict PIT validation; archiv může obsahovat pozdější revize.

C vzorec se nezměnil: size = min(nSimilar, nOther); λ = size/(size+8); C = clamp(0.5 + λ × (pSimilar − pOther), 0, 1). Pokud některá skupina nemá případy, C=0.5. Raw = 10 × (0.30 S + 0.25 R + 0.25 M + 0.20 C).

## Výsledek a invariance

55 kandidátních období včetně execution profilů; profilové duplikáty nejsou nezávislé příležitosti. Automatické porovnání potvrdilo nezměněné S, R, M, váhy, směry a hranice období u všech core kandidátů. Pouze C a návazný raw/relativní ranking reagují na doplněné historické případy. Universe, cenové série, tolerance a confidence formule se neměnily. Původní metadata dostupnosti se nepřepisují ani nevyrábějí.

Počty níže používají pevný 20letý scoringový kontext 2006–2025. „Ostatní“ znamená použitelné COT případy mimo toleranci, nikoli chybějící reporty. Před změnou měly tyto core kandidáty 0 podobných a 0 ostatních případů, C=0.5.

| Instrument | Směr | Období | Podobné | Ostatní | C (0–1) | Původní raw | Nové raw |
|---|---|---|---:|---:|---:|---:|---:|
| USDCAD | růst | 2026-11-06 → 2026-11-21 | 6 | 14 | 0.5204 | 7.1090 | 7.1498 |
| AUDNZD | pokles | 2026-11-16 → 2026-12-16 | 0 | 20 | 0.5000 | 6.8342 | 6.8342 |
| EURUSD | pokles | 2026-10-18 → 2026-11-15 | 6 | 14 | 0.5510 | 6.6760 | 6.7780 |
| GBPNZD | pokles | 2026-11-28 → 2027-01-12 | 1 | 19 | 0.5234 | 6.6853 | 6.7321 |
| SPY | růst | 2026-11-12 → 2026-12-08 | 5 | 15 | 0.4487 | 6.7893 | 6.6867 |
| NZDCAD | růst | 2026-11-25 → 2026-12-15 | 7 | 13 | 0.3359 | 6.9578 | 6.6296 |
| GBPNZD | růst | 2026-11-06 → 2026-11-28 | 1 | 19 | 0.5351 | 6.4955 | 6.5656 |
| NZDUSD | růst | 2026-11-23 → 2026-12-13 | 9 | 11 | 0.4198 | 6.7010 | 6.5406 |
| QQQ | růst | 2026-11-12 → 2026-12-08 | 3 | 17 | 0.5642 | 6.2587 | 6.3870 |
| GBPAUD | růst | 2026-11-16 → 2026-12-17 | 9 | 11 | 0.6230 | 6.0373 | 6.2833 |
| USDCHF | růst | 2026-10-18 → 2026-11-19 | 8 | 12 | 0.3958 | 6.4767 | 6.2684 |
| EURCAD | růst | 2026-11-10 → 2026-12-16 | 4 | 16 | 0.6042 | 6.0359 | 6.2443 |
| USDCHF | pokles | 2026-11-19 → 2027-01-01 | 8 | 12 | 0.5417 | 6.0547 | 6.1380 |
| SPX | růst | 2026-11-12 → 2026-12-08 | 5 | 15 | 0.3718 | 6.3850 | 6.1286 |
| ES | růst | 2026-11-12 → 2026-12-08 | 5 | 15 | 0.3718 | 6.3850 | 6.1286 |
| MES | růst | 2026-11-12 → 2026-12-08 | 5 | 15 | 0.3718 | 6.3850 | 6.1286 |
| CHFJPY | růst | 2026-11-11 → 2026-12-31 | 10 | 10 | 0.7222 | 5.6264 | 6.0708 |
| NZDJPY | růst | 2026-11-24 → 2026-12-13 | 9 | 11 | 0.2540 | 6.5041 | 6.0122 |
| NZDCHF | pokles | 2026-11-06 → 2026-11-25 | 11 | 9 | 0.6979 | 5.5730 | 5.9687 |
| EURGBP | pokles | 2026-10-10 → 2026-11-10 | 10 | 10 | 0.6111 | 5.6936 | 5.9159 |
| AUDUSD | pokles | 2026-10-18 → 2026-11-27 | 6 | 14 | 0.5102 | 5.8419 | 5.8623 |
| NZDCHF | růst | 2026-11-25 → 2026-12-12 | 11 | 9 | 0.4840 | 5.7511 | 5.7191 |
| NDX | růst | 2026-11-11 → 2026-12-09 | 3 | 17 | 0.5802 | 5.5299 | 5.6903 |
| NQ | růst | 2026-11-11 → 2026-12-09 | 3 | 17 | 0.5802 | 5.5299 | 5.6903 |
| MNQ | růst | 2026-11-11 → 2026-12-09 | 3 | 17 | 0.5802 | 5.5299 | 5.6903 |
| GBPCAD | růst | 2026-11-13 → 2026-12-14 | 3 | 17 | 0.5053 | 5.6696 | 5.6803 |
| CADCHF | pokles | 2026-11-06 → 2026-12-20 | 4 | 16 | 0.3125 | 6.0126 | 5.6376 |
| AUDUSD | růst | 2026-11-27 → 2027-01-03 | 6 | 14 | 0.4796 | 5.6762 | 5.6354 |
| AUDCHF | pokles | 2026-12-05 → 2026-12-26 | 0 | 20 | 0.5000 | 5.4680 | 5.4680 |
| GBPUSD | růst | 2026-11-18 → 2026-12-04 | 8 | 12 | 0.2708 | 5.8067 | 5.3484 |
| GBPCHF | růst | 2026-11-26 → 2026-12-11 | 2 | 18 | 0.5889 | 5.1098 | 5.2876 |
| AUDCAD | růst | 2026-11-27 → 2027-01-24 | 4 | 16 | 0.5833 | 5.0484 | 5.2151 |
| GBPCAD | pokles | 2026-10-28 → 2026-11-13 | 3 | 17 | 0.4144 | 5.3178 | 5.1467 |
| EURAUD | pokles | 2026-11-27 → 2027-01-09 | 10 | 10 | 0.5556 | 5.0179 | 5.1290 |
| NZDUSD | pokles | 2026-10-17 → 2026-11-23 | 9 | 11 | 0.4572 | 5.2054 | 5.1198 |
| GBPAUD | pokles | 2026-11-29 → 2027-01-13 | 9 | 11 | 0.2540 | 5.6100 | 5.1181 |
| AUDJPY | růst | 2026-10-26 → 2026-12-06 | 2 | 18 | 0.5778 | 4.9047 | 5.0602 |
| GBPUSD | pokles | 2026-12-04 → 2027-01-20 | 8 | 12 | 0.6667 | 4.6594 | 4.9928 |
| EURGBP | růst | 2026-11-10 → 2026-12-07 | 10 | 10 | 0.5000 | 4.9903 | 4.9903 |
| EURJPY | pokles | 2026-10-24 → 2026-11-11 | 1 | 19 | 0.4298 | 5.1072 | 4.9669 |
| AUDCAD | pokles | 2026-10-28 → 2026-11-27 | 4 | 16 | 0.4583 | 4.9865 | 4.9032 |
| GBPJPY | růst | 2026-11-17 → 2026-12-13 | 2 | 18 | 0.3556 | 5.1756 | 4.8867 |
| EURCHF | pokles | 2026-10-29 → 2026-11-12 | 0 | 20 | 0.5000 | 4.6482 | 4.6482 |
| EURAUD | růst | 2026-11-07 → 2026-11-27 | 10 | 10 | 0.3333 | 4.9799 | 4.6466 |
| EURJPY | růst | 2026-11-11 → 2026-12-11 | 1 | 19 | 0.5468 | 4.4570 | 4.5506 |
| NZDCAD | pokles | 2026-10-20 → 2026-11-13 | 7 | 13 | 0.5513 | 4.0869 | 4.1894 |
| EURUSD | růst | 2026-11-15 → 2026-12-05 | 6 | 14 | 0.3673 | 4.4446 | 4.1793 |
| CADJPY | pokles | 2026-12-07 → 2027-01-23 | 4 | 16 | 0.3958 | 4.1988 | 3.9905 |
| GBPCHF | pokles | 2026-11-05 → 2026-11-26 | 2 | 18 | 0.6111 | 3.5521 | 3.7743 |
| AUDJPY | pokles | 2026-12-06 → 2027-01-23 | 2 | 18 | 0.5222 | 3.7003 | 3.7447 |
| NZDJPY | pokles | 2026-10-17 → 2026-11-24 | 9 | 11 | 0.6016 | 3.4886 | 3.6918 |
| EURCHF | růst | 2026-11-12 → 2026-12-09 | 0 | 20 | 0.5000 | 3.6454 | 3.6454 |
| AUDCHF | růst | 2026-11-27 → 2027-01-09 | 0 | 20 | 0.5000 | 3.4441 | 3.4441 |
| CADJPY | růst | 2026-10-26 → 2026-12-07 | 4 | 16 | 0.6250 | 3.0582 | 3.3082 |
| EURNZD | růst | 2026-10-19 → 2026-11-24 | 0 | 20 | 0.5000 | 3.0388 | 3.0388 |

## Ověření

Testy: positions-date cutoff, nezávislost historického výběru na metadata availableAt, minimum 52 reportů, žádné budoucí positions dates, USD reference, znaménko invertovaného páru, chybějící quote a synchronní report dates. Strict availability helper pro ostatní funkce zůstává beze změny. Seasonality detail explicitně používá stejný descriptive historical mode jako screener.

