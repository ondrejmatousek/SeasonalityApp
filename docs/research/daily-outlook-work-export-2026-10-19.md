# Export zadání „Denní trading výhled“ pro SeasonalityApp

Aktivní úloha

Stav k 19. 10. 2026

Toto je export aktuálně uloženého zadání ranní úlohy a pravidel vyhledávání H4 obchodních zón. Vychází z textu existující automatizace „Denní trading výhled“, nikoli z nově navržené strategie.

Žádnou automatizaci, nastavení, plugin ani data jsem neměnil.

## 1. Identifikace úlohy

| Parametr                    | Aktuální hodnota                                  |
| --------------------------- | ------------------------------------------------- |
| Název                       | Denní trading výhled                              |
| ID úlohy                    | `6a799ec174f88191b39d1972a2502734`                |
| Stav                        | Aktivní                                           |
| Periodicita                 | Denně                                             |
| Čas spuštění                | 09:30, Europe/Prague                              |
| Hlavní analytický timeframe | H4                                                |
| Metodika                    | Petr Můčka + Market Structure + Order Blocks [FM] |
| Výstup                      | Ověření H4 kandidáti pro TradeWatcher             |
| M15 refinement              | Neprovádět v ranní úloze                          |
| M5 trigger                  | Neprovádět v ranní úloze                          |
| Automatické obchodování     | Není součástí zadání                              |

## 2. Přesné instrumenty a datové zdroje

| Instrument        | TradingView symbol | Hlavní TF |
| ----------------- | ------------------ | --------- |
| EURUSD            | `OANDA:EURUSD`     | H4        |
| Zlato             | `OANDA:XAUUSD`     | H4        |
| Nasdaq futures    | `CME_MINI:NQZ2026` | H4        |
| Bitcoin perpetual | `BYBIT:BTCUSDT.P`  | H4        |

Pro Nasdaq je nutné ověřit platnost konkrétního futures kontraktu. Bitcoin se analyzuje na Bybit BTCUSDT perpetual, nikoli na původním `BITSTAMP:BTCUSD`. Historické zóny z původního BTCUSD feedu se nesmějí automaticky přenášet na Bybit.

Každá analýza musí použít skutečné uzavřené H4 OHLCV svíčky přesného instrumentu a zdroje. Čas výstupu je v `Europe/Prague`; původní časová razítka zdroje se musejí zachovat pro audit.

Pokud potřebná data nejsou dostupná nebo ověřitelná, status je `UNVERIFIED — NO TRADE`. Není dovoleno doplňovat odhadnuté OHLC, ceny, ATR, BOS ani zóny a vydávat je za ověřené.

## 3. Logika vyhledávání H4 zón

Základní pravidlo je base → impulsivní odchod ceny. BOS je kvalitativní konfluence, nikoli povinná podmínka existence zóny.

Povoleny jsou tři typy původu zóny:

| Typ            | Definice                                                               | Požadovaný důkaz                                         |
| -------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| Base breakout  | Zdrojová base svíčka a následný impulsní průraz její referenční úrovně | OHLCV base, potvrzující svíčka, ATR/displacement         |
| Range breakout | Zdrojová oblast před impulsem, kterým cena opustila konsolidaci        | Konkrétní svíčky range, hranice range, průraz a čas      |
| Base + H4 BOS  | Base před impulsem, který současně potvrdil významný H4 BOS            | Důkazy base, impulsu a potvrzeného strukturálního breaku |

První dva typy mohou být validní i bez BOS. Zóna s potvrzeným hlavním H4 BOS má při jinak srovnatelné kvalitě vyšší prioritu.

### 3.1 Výběr zdrojové svíčky u klasického Pine OB

- Demand: zdrojová base je poslední relevantní medvědí svíčka před potvrzeným růstovým impulsem.
- Supply: zdrojová base je poslední relevantní býčí svíčka před potvrzeným poklesovým impulsem.
- Čekající kandidát je stavový: novější bearish base nahrazuje starší čekající demand kandidát a novější bullish base nahrazuje starší čekající supply kandidát.
- Potvrzení musí nastat nejpozději během následujících 3 H4 svíček (`impulseBars=3`).
- Po potvrzení se čekající kandidát resetuje.

Přesná pravidla vyhledávání base u samostatného detektoru range breakout nejsou v zadání kompletně numericky specifikována. Je proto nutné jeho logiku implementovat odděleně od klasického Pine OB a nezaměňovat výsledky obou detektorů.

### 3.2 Hranice zóny

Výchozí nastavení Pine je:

`zoneSrc = Full range (high–low)`

Z toho plyne:

\\[ \text{zoneBottom}=\text{base.low} \\]

\\[ \text{zoneTop}=\text{base.high} \\]

Platí pro klasickou zónu odvozenou z jedné base svíčky.

U zóny odvozené z více svíček konsolidace není v uloženém zadání určen jednotný algoritmus, který by vybíral její finální horní a dolní hranici. Musí se doložit konkrétní použité range svíčky a hranice; nelze automaticky předpokládat totožný výpočet jako u jednosvíčkového Pine OB.

### 3.3 Potvrzení impulsem

Výchozí parametry klasického Pine OB:

| Parametr                          | Hodnota                          |
| --------------------------------- | -------------------------------- |
| `atrLen`                          | 96                               |
| ATR timeframe                     | H4                               |
| ATR metoda                        | RMA                              |
| `impulseBars`                     | 3                                |
| Výchozí strictness                | Střední                          |
| Minimální displacement ve Střední | 1,5 × ATR(96)                    |
| Minimální displacement ve Volné   | Bez ATR filtru                   |
| Minimální displacement v Přísné   | 2,5 × ATR(96) + break swingu 5/5 |

Demand potvrzení:

\\[ C\_{\text{confirm}}>\max(O\_{\text{base}},C\_{\text{base}}) \\]

\\[ D\_{\text{demand}}=C\_{\text{confirm}}-L\_{\text{base}} \\]

Pro výchozí režim Střední musí platit:

\\[ D\_{\text{demand}}\geq1{,}5\times ATR(96) \\]

Supply potvrzení:

\\[ C\_{\text{confirm}}<\min(O\_{\text{base}},C\_{\text{base}}) \\]

\\[ D\_{\text{supply}}=H\_{\text{base}}-C\_{\text{confirm}} \\]

Pro výchozí režim Střední musí platit:

\\[ D\_{\text{supply}}\geq1{,}5\times ATR(96) \\]

Displacement ratio:

\\[ \text{ratio}=\frac{D}{ATR(96)} \\]

Tyto vzorce platí pro klasický Pine OB. V zadání existuje také odlišný detektor „Orderblock série/CISD“, který nemá automatický ATR ani BOS filtr. Jeho úplná samostatná implementační specifikace není v textu ranní úlohy uvedena.

## 4. Market structure: BOS a CHoCH

| Parametr                | Pravidlo                                                  |
| ----------------------- | --------------------------------------------------------- |
| Hlavní H4 swing         | Pivot 20 svíček vlevo / 20 vpravo                         |
| Interní swing           | Pivot 5 vlevo / 5 vpravo                                  |
| Použité svíčky          | Pouze uzavřené                                            |
| Look-ahead              | Zakázán                                                   |
| BOS                     | Potvrzený break relevantního swingu podle stavu struktury |
| CHoCH                   | Odlišit od BOS podle předchozího strukturálního trendu    |
| BOS povinný pro H4 zónu | Ne                                                        |

Pivot 20/20 smí být znám až po uzavření požadovaných 20 pravých svíček. Nesmí se zpětně použít jako informace, která v okamžiku vzniku impulzu ještě nebyla dostupná.

V případě absence potvrzeného BOS má být v auditu uvedeno `BOS: ne`, nikoli automaticky `NO TRADE`.

## 5. Likvidita a konfluence

Zadání vyžaduje samostatně hodnotit:

- Sílu odchodu z base, včetně displacement/ATR.
- Průraz konsolidace nebo range.
- Potvrzený hlavní H4 BOS, pokud existuje.
- Likviditu v okolí zóny.
- London/NY session.
- Freshness, předchozí retesty a mitigaci.

Časové oblasti zvýšeného zájmu jsou 09:00–11:00 a 13:30–17:00 v časové zóně Europe/Prague.

Neurčené parametry likvidity: přesná maximální vzdálenost od swing high/low, minimální velikost liquidity poolu, počet požadovaných equal highs/lows, tolerance rovnosti vrcholů, povinný liquidity sweep a číselné bodování konfluencí nejsou v současném zadání definovány.

Likvidita a session jsou tedy kvalitativní hodnoticí faktory, nikoli samostatné pevné numerické validační brány.

## 6. Freshness, mitigace a invalidace

Nejdříve musí být prokázán úplný odchod ceny ze zóny (departure).

| Stav             | Demand                                                 | Supply                                                 |
| ---------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| Armed po odchodu | Uzavřená H4 svíčka s `low > zoneTop`                   | Uzavřená H4 svíčka s `high < zoneBottom`               |
| Mitigace         | Následný průnik více než 25 % hloubky od horní hranice | Následný průnik více než 25 % hloubky od dolní hranice |
| Invalidace       | H4 `close < zoneBottom`                                | H4 `close > zoneTop`                                   |

Pro hloubku zóny:

\\[ W=\text{zoneTop}-\text{zoneBottom} \\]

Demand je mitigovaná při návratu:

\\[ L<\text{zoneTop}-0{,}25W \\]

Supply je mitigovaná při návratu:

\\[ H>\text{zoneBottom}+0{,}25W \\]

Mitigace je striktně více než 25 %, nikoli větší nebo rovno 25 %. Zóna se nemá označit jako fresh, pokud již byla mitigována.

Invalidace je stanovena uzavřením H4 svíčky za vnější hranicí zóny, nikoli samotným knotem.

Časová expirace H4 zóny, maximální počet retestů a automatické mazání podle stáří jsou neurčené.

## 7. Pravidla vstupu, SL, TP a RRR

Současné ranní zadání tyto hodnoty záměrně nepočítá. Ranní analýza vybírá pouze H4 kandidáty; zpřesnění a potvrzení obchodů má na starosti samostatný TradeWatcher.

| Parametr                      | Stav v ranní úloze            |
| ----------------------------- | ----------------------------- |
| Entry cena                    | Neurčena                      |
| Entry trigger                 | Neurčen, předán TradeWatcheru |
| M15 refinement                | Mimo rozsah                   |
| M5 trigger                    | Mimo rozsah                   |
| Stop-loss                     | Neurčen                       |
| Take-profit                   | Neurčen                       |
| Minimální RRR                 | Neurčeno                      |
| Povinný sweep/FVG/retest      | Neurčeno                      |
| Risk na obchod                | Neurčen                       |
| Maximální čas čekání na entry | Neurčen                       |

Ranní výstup tedy nesmí prezentovat H4 kandidáta jako `VERIFIED TRADE` ani vymýšlet vstup, SL, TP nebo RRR.

Vizualizace Long Position / Short Position se smí doplnit pouze tehdy, když konkrétní vstup, SL a TP pocházejí z doloženého obchodního plánu nebo TradeWatcheru. Barvy jsou:

- LONG: zelený obdélník nad vstupem (TP), červený pod vstupem (SL).
- SHORT: červený obdélník nad vstupem (SL), zelený pod vstupem (TP).

## 8. Požadovaný formát výstupu

První tabulka ranního reportu má mít sloupce:

`Instrument | HTF bias | VERIFIED H4 candidate zone | typ originu (base/range/BOS) | BOS konfluence ano/ne | freshness | status/předat TradeWatcheru`

Každý kandidát musí obsahovat auditní důkazy: přesný symbol a feed, timeframe, čas poslední uzavřené H4 svíčky, hranice zóny, base OHLCV a čas, impulsní svíčky, ATR, displacement ratio, detektor, případný BOS, likviditu, session a stav freshness.

Statusy:

- `VERIFIED H4 CANDIDATE` — reprodukovatelný z ověřených uzavřených H4 dat.
- `ESTIMATED` — pouze nezávazná reference.
- `UNVERIFIED — NO TRADE` — chybějí potřebné důkazy.
- `NO TRADE` — nebyl nalezen validní kandidát.

K reportu patří samostatný skutečný H4 svíčkový graf pro každý instrument: tmavé TradingView-style pozadí, časová a cenová osa, průhledné supply/demand zóny, base, impuls, případný BOS/CHoCH a status zóny. Žádné syntetické svíčky vydávané za tržní data.

Závěrečná sekce se jmenuje „Co předat TradeWatcheru“ a obsahuje symbol, směr, H4 hranice, důkazy a expiraci pouze tehdy, pokud je doložitelná.

## 9. Tři původní historické příklady

Níže jsou tři konkrétní příklady z dřívějšího ranního reportu z 19. 10. 2026. Zachovávám jejich původně uvedené ceny a časy.

Důležité: jde o historicky reportované kandidáty, nikoli o nově nezávisle přepočítané a ověřené H4 zóny. Jsou vhodné jako referenční příklady pro SeasonalityApp, ale ne jako potvrzená produkční testovací data.

Příklad A — XAUUSD, supply

| Položka           | Původní údaj                            |
| ----------------- | --------------------------------------- |
| Symbol            | `OANDA:XAUUSD`                          |
| Směr              | SHORT / supply                          |
| H4 zóna           | 4289,610–4315,795                       |
| Base svíčka       | 25. 9. 2026, 09:00 UTC                  |
| Potvrzení impulzu | 27. 9. 2026, 21:00 UTC                  |
| Displacement      | 2,32 × ATR                              |
| BOS               | Původně uveden bearish BOS pod 4235,165 |
| Freshness         | Původně označeno fresh                  |
| Entry / SL / TP   | Neurčeno                                |

Příklad B — BTCUSD, supply z range breakoutu

| Položka           | Původní údaj            |
| ----------------- | ----------------------- |
| Původní symbol    | `BITSTAMP:BTCUSD`       |
| Směr              | SHORT / supply          |
| H4 zóna           | 83 093,57–83 879,98     |
| Base svíčka       | 14. 10. 2026, 00:00 UTC |
| Potvrzení impulzu | 14. 10. 2026, 12:00 UTC |
| Displacement      | 2,91 × ATR              |
| Origin            | Range breakout          |
| Freshness         | Původně označeno fresh  |
| Entry / SL / TP   | Neurčeno                |

Tento příklad pochází ze starého feedu BITSTAMP:BTCUSD. Pro aktuální `BYBIT:BTCUSDT.P` se jeho cenové hranice nesmějí použít bez nového výpočtu.

Příklad C — Nasdaq futures, supply z range breakoutu

| Položka           | Původní údaj            |
| ----------------- | ----------------------- |
| Symbol            | `CME_MINI:NQZ2026`      |
| Směr              | SHORT / supply          |
| H4 zóna           | 30 705,25–30 861,75     |
| Base svíčka       | 14. 10. 2026, 06:00 UTC |
| Potvrzení impulzu | 14. 10. 2026, 10:00 UTC |
| Displacement      | 2,27 × ATR              |
| Origin            | Range breakout          |
| Freshness         | Původně označeno fresh  |
| Entry / SL / TP   | Neurčeno                |

U těchto příkladů nejsou v dostupném původním souhrnu doloženy kompletní OHLCV všech base a potvrzujících svíček, hodnoty ATR ani celé časové řady potřebné k přepočtu freshness. Proto je nelze označit za reprodukované testy.

## 10. Co musí SeasonalityApp ještě specifikovat

Pro přesnou implementaci bez domýšlení pravidel zbývají následující otevřené parametry:

| Oblast                   | Dosud neurčeno                                                  |
| ------------------------ | --------------------------------------------------------------- |
| Vícesvíčková base        | Maximální počet svíček a přesný výběr hranic                    |
| Konsolidace/range        | Minimální délka, maximální šířka a pravidlo potvrzení breakoutu |
| Impuls u range detektoru | Samostatný numerický práh a časové okno                         |
| Likvidita                | Tolerance equal highs/lows, vzdálenosti, povinný sweep          |
| Scoring                  | Váhy BOS, displacement, freshness, session a likvidity          |
| Entry                    | Pravidlo limitního nebo potvrzeného vstupu                      |
| SL                       | Přesný buffer a způsob strukturální invalidace obchodu          |
| TP                       | Výběr cílové likvidity a pravidlo více targetů                  |
| RRR                      | Minimální požadovaná hodnota                                    |
| Expirace                 | Maximální stáří zóny a počet retestů                            |

### Implementační závěr

SeasonalityApp může podle tohoto zadání implementovat a auditovat klasický jednosvíčkový H4 Pine OB detektor, H4 strukturu 20/20 a 5/5, pravidla departure, mitigace a invalidace.

Detektory vícesvíčkové base, range breakoutu a Orderblock série/CISD je potřeba držet odděleně, dokud nebudou jejich kompletní algoritmy doloženy. Entry, SL a TP nepatří do současného ranního H4 výběru a nesmějí se automaticky odvozovat pouze z hranic zóny.

Tento export zachycuje aktuální zadání a tři historické referenční příklady. Žádné nastavení ani pravidlo nebylo změněno.