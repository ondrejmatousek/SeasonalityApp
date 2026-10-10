# SeasonalityApp

Seasonality a COT bez přihlašování. Podporuje čistě statický frontend (HTML/CSS/JS + JSON snapshot) i původní MVC web. Azure SQL je u statické varianty pouze zdrojem pro build-time aktualizaci a export, nikoli pro návštěvy webu.

## Statický frontend

Vygenerovaný web nepotřebuje běžící .NET, App Service, API ani SQL. Razor se používá pouze při exportu k vytvoření `index.html`, aby se statická a původní verze vizuálně nerozcházely. Stávající JavaScript, grafy, filtry, hover body a PNG export jsou sdílené.

- `index.html` obsahuje katalog instrumentů a metadata jednoho snapshotu, nikoli celou historii.
- Ceny jsou kompaktní JSON soubory po tickeru a načítají se až při jeho výběru.
- COT je exportován jednou pro každý futures kontrakt a lookback 26 / 52 / 156; více tickerů sdílí tentýž soubor i prohlížečovou cache. Odpovídá původnímu výpočtu v `CotService.BuildPoints`.
- JSON má hash obsahu v názvu a dlouhou immutable cache. HTML/manifest se revalidují; po nasazení nové verze je u už otevřené staré záložky vhodné obnovit stránku, pokud žádá již nahrazený snapshot.
- Export čte pouze tabulky cen a COT. Neprovádí inicializaci schématu ani zápisy. Neukládá připojovací řetězec, konfiguraci serveru ani binárky do veřejného výstupu.
- Chybějící historie výchozího instrumentu/COT kontraktu, nevalidní export nebo překročení 240 MiB / 15 000 souborů zablokuje publikaci. Jednotlivé tickery bez cen se označí jako prázdné.

### Ovládání Screeneru

Screener podporuje řazení kliknutím na hlavičky a kombinované filtry sloupců (číselné minimum/maximum, hledání instrumentu, dostupnost COT). COT se řadí podle dostupnosti, nikoli podle nesrovnatelných indexů různých měn. Fotoaparát uloží PNG s obdobím, filtry a prvními 20 výsledky v aktuálním řazení; počet zachycených výsledků je uvedený v obrázku.

Výchozí filtr Screeneru je „S COT daty“; volba „Vše“ zpřístupní i čistě sezonální instrumenty. Jde o dostupnost dat, ne vyhodnocení shody COT a sezonality.

### Stabilita sezonálního intervalu

Po výběru intervalu v Seasonality se zobrazí medián, 25./75. percentil výsledků, průměr bez právě jednoho nejlepšího a nejhoršího roku, extrémy a nezávislé porovnání posledních 5/10/20 kalendářních let. Hlavní souhrn respektuje vybrané roky/filtry; srovnávací okna ne. U všech intervalových statistik se vyřazuje aktuální rok snapshotu, neúplná období, neplatné ceny a mezery nebo chybějící okraje nad 7 dní. Vstup je první dostupná cena uvnitř období a konec poslední cena nejpozději v konci. Výsledky tak nekončí až za uživatelem vybranou hranicí a interval bez dat se nenahrazuje celoročními výsledky.

Slovní hodnocení je transparentní heuristika, nikoli statistický test, předpověď nebo doporučení: minimum 8 případů, shoda znaménka průměru/mediánu/ořezaného průměru, shoda mediánů porovnávacích oken (min. 4 období v každém) a alespoň 70 % výsledků ve směru mediánu. Pásmo prostředních 50 % není predikční interval. COT není součástí hodnocení. Výpočet běží lokálně jen z historie vybraného instrumentu a výsledky intervalů se cachují; hover nic nepřepočítává.

`node Tools/reliability-checks.cjs` ověřuje výpočty a je součástí CI.

### Souběh sezonality a podobného COT

Po výběru intervalu je v Seasonality karta „Pomáhá COT v tomto období?“. Uživatel zvolí růst/pokles závěrečné ceny, skupinu a toleranci k poslednímu odhadovaně dostupnému COT indexu. Rozšířené volby obsahují report (u FX jen jeden měnový kontrakt), lookback 26/52/156 a celou nebo posledních 10/20 let historie. Výběr roků a pokročilé filtry grafu se nepřenášejí, aby zejména zpětný Bullish/Bearish výběr nezkresloval interpretaci.

Porovnává stejné kalendářní období v jednotlivých dokončených rocích: baseline zahrnuje všechny cenově validní roky s použitelným tehdejším COT, podmíněná skupina jen ty s podobným indexem. Baseline a souběh tedy používají stejnou dostupnou historii. Celá cenová sezonalita je uvedená zvlášť. Před vstupním denním close se volí poslední report odhadovaně dostupný (datum pozic + 7 kalendářních dní), nejvýše 21 dní starý podle data pozic; chybějící index se nenahrazuje starším. Stejný odhad dostupnosti a stáří platí pro dnešní referenci. Aktuální rok, neúplné cenové okraje a mezery přes 7 dní se vyřazují. Skutečná historická publikace není dostupná: jde o průzkumnou analýzu, ne přesný point-in-time backtest.

Výstup obsahuje počet/četnost závěrečného pohybu ve zvoleném směru, orientační 95% Wilsonovo pásmo, rozdíl četností v procentních bodech, medián/kvartily výnosů a medián/maximum nepříznivého pohybu denních close vůči vstupu. Nulový výnos není úspěchem pro žádný směr. Při méně než 8 soubězích je hlavní procento i rozdíl potlačený; tabulka zachovává přesné popisné počty a četnost. Prahy 8 a 20 jsou transparentní upozornění na velikost vzorku, nikoli test spolehlivosti. Wilsonovo pásmo předpokládá nezávislé případy se stálou pravděpodobností, což tržní data nemusí splňovat; nezahrnuje změny režimu, hledání mnoha nastavení ani publikační chyby. Souběh je podmnožinou baseline, takže rozdíl není důkaz statistické významnosti/přínosu COT.

Rozbalovací časová kontrola porovná starší část s posledními 5 dokončenými kalendářními roky při stejném dnešním nastavení. Není to nedotčený holdout test. Všechny jednotlivé roky lze dohledat s datem vstupu/výstupu, použitým COT a indexem. Žádný údaj není pravděpodobností zisku konkrétního obchodu ani doporučením vstupu/stop-lossu. Intradenní pohyby, obchodní náklady a samostatný dividendový model chybí; nezávislé ověření zůstává dalším krokem.

Výpočet běží lokálně pouze pro vybraný instrument nad sdílenou lazy cache JSON. Prázdný interval nenačítá COT; resize/hover nevynucují opakovaný výpočet. Testy: `node Tools/confluence-checks.cjs`.

### Lokální export a spuštění

Použij stávající SQL konfiguraci a **nový** podadresář `artifacts/` (existující export se nikdy nepřepisuje):

```powershell
dotnet build SeasonalityApp.slnx -c Release
dotnet run --project SeasonalityApp.csproj -c Release --no-build -- --export-static --output artifacts/static-site
node Tools/build-screener.cjs artifacts/static-site
node Tools/build-opportunities.cjs artifacts/static-site
node Tools/static-site-checks.cjs artifacts/static-site
node Tools/serve-static.cjs artifacts/static-site 54129
```

Otevři `http://127.0.0.1:54129/`. Poslední příkaz pouze servíruje soubory, nečte SQL a nevyžaduje .NET. Vygenerovaná data jsou ignorovaná Gitem, nikoli commitovaná do historie repozitáře. Pro nasazení se přenáší obsah exportu, ne ASP.NET aplikace.

### Aktualizace a Azure Static Web Apps Free

`.github/workflows/seasonality-update.yml` po pushi na `master`, denně v 05:15 UTC a ručně:

1. Aktualizuje ceny a COT ve SQL.
2. Až obě aktualizace uspějí, vytvoří statický export a ověří všechny tickery, hashe a COT výpočty.
3. Nahraje artifact `seasonality-static-site` s jednodenní retencí a publikuje na Azure Static Web Apps, pokud je nastaven deployment token.

Selhání aktualizace/exportu zabrání novému deploymentu; dosud publikovaný web se nepřepíše. Ruční volba `export_only=true` přeskočí aktualizaci zdrojů a publikuje aktuální SQL snapshot. V Actions používáme existující secret `SEASONALITY_CONNECTION_STRING`; do frontendu se nikdy nepřenese. Aktualizační/exportní úlohy stále spotřebovávají SQL prostředky a GitHub Actions kvóty; návštěvy statického webu ne.

Jednorázová konfigurace:

1. V Azure vytvoř **Static Web App**, plán **Free**, deployment source **Other** (nevytvářej druhé automatické GitHub workflow).
2. V její správě zkopíruj deployment token a ulož jej do GitHub repo secrets jako `AZURE_STATIC_WEB_APPS_API_TOKEN`. Token neposílej do chatu ani necommituj.
3. Spusť workflow `Update data and publish static seasonality`; lze zvolit `export_only=true`.
4. Ověř URL nové Static Web App, obě záložky a data. Až poté samostatně rozhodni o vypnutí původního App Service. SQL zatím zůstává pro aktualizace.

Bez tokenu workflow export ověří a uloží artifact, ale **statický web není publikován**; tuto skutečnost uvede v souhrnu běhu. Původní App Service deployment v `master_seasonality.yml` zůstává během přechodu beze změny.

Hosting: [build/deploy konfigurace](https://learn.microsoft.com/en-us/azure/static-web-apps/build-configuration), [cache a routing](https://learn.microsoft.com/en-us/azure/static-web-apps/configuration), [Free limity](https://learn.microsoft.com/en-us/azure/static-web-apps/quotas). Před veřejným publikováním dat na jiném hostingu ověř podmínky jejich poskytovatelů; žádná nová licence na redistribuci tímto exportem nevzniká.

## Grafy a export PNG

Hlavní sezónní křivka při přejetí ukazuje tyrkysový bod a přerušovanou svislici na nejbližší hodnotě křivky. Tooltip uvádí datum a index a zůstává mimo kurzor. Výběr intervalu tažením zůstává zachovaný; pohyb myši nepřepočítává data ani statistiky. Bod a svislice se nezahrnují do PNG exportu.

COT index má vizuální rezervu nad 100 / pod 0 a vyšší graf, takže se krajní hodnoty neořezávají. Samotné hodnoty indexu zůstávají 0–100 a nevyhlazují se. Ve výchozím stavu se zobrazují všechny tři skupiny tenkými souvislými čarami odlišenými barvou; kliknutím na skupiny v legendě lze volitelně některé skrýt. Alespoň jedna skupina zůstává zapnutá. Tooltip se umisťuje nad / vedle kurzoru a u pravého okraje překlápí doleva; přerušovaná svislice a bod označují vybraný report.

Na obou hlavních záložkách je tlačítko fotoaparátu pro stažení PNG aktuální analýzy: vybraný instrument, filtry, grafy a viditelné statistiky. Seasonality zahrnuje sezónní křivku i spodní grafy (nebo právě otevřený měsíční přehled); COT zahrnuje všechny čtyři grafy vybraného futures kontraktu a nastavené skupiny indexu. Export není omezen na viditelnou výšku obrazovky. Neobsahuje navigaci aplikace, vyhledávání, tooltipy ani dlouhé historické tabulky. Název souboru obsahuje ticker, pohled a datum. Export běží lokálně v prohlížeči s vendorizovaným MIT balíčkem html2canvas 1.4.1 (`wwwroot/lib/html2canvas`, licence přiložena); knihovna se načítá až při prvním exportu. Nevyžaduje externí screenshot službu ani další SQL dotaz. Prohlížeč používá vlastní grafovou SVG ikonu.

Kontrola geometrie, umístění tooltipu a limitů PNG:

```powershell
node Tools/chart-ui-checks.cjs
```

## Screener

### Denní automatický výběr od extrémů

Výchozí režim „Automaticky od extrémů“ každé ráno navrhuje období ze sezonálních minim/maxim; původní režim „Pevné období 14 / 30 / 60 dní“ zůstává vedle něj.

`Tools/build-opportunities.cjs` připraví content-addressed JSON pro všechny instrumenty s COT. Je součástí existujícího denního workflow i nasazení po pushi, bez nové služby nebo SQL dotazů návštěvníka. Přehled se načítá až při otevření Screeneru; obsahuje datum přepočtu, filtry směru/předstihu/podkladů, řazení, vyhledávání a PNG prvních 20 výsledků. Detail ukazuje starší křivku, navržený interval, oddělené statistiky a všechny použité roky/COT. Vstup může být až za 60 dní, délka 14–60 dní; podporuje i prosinec–leden.

Výběr má nejvýše 20 úplných starších cenových roků, nejméně 10. Posledních 8 kalendářních roků před datem snapshotu slouží pro kontrolu, nesmějí měnit křivku, koncové body, směr ani skóre. Průměrné roční křivky indexujeme na 100, interpolujeme kalendářní dny a pro hledání lokálních extrémů ±7 dní použijeme 7denní vyhlazení. Konec je první způsobilý opačný extrém, ne nejvýnosnější dodatečně vybraný konec. Roční změnu přeneseme přes přelom roku, nevytváříme falešný extrém resetem indexu. Statistiky používají původní denní ceny. Cenové mezery/okraje přes 7 dní vyřazují vzorek. Výběrové případy nesmějí končit v kontrolní historii. Období musí držet směr podle mediánu i průměru bez nejlepšího/nejhoršího roku. Na instrument vybereme maximálně jedno růstové a jedno poklesové období podle dolní Wilsonovy meze ve starší historii, při shodě medián/nepříznivý pohyb a bližší vstup. COT do výběru nevstupuje.

COT používá pevně první report katalogu mimo DXY, případně samotný DXY. Nikdy nevybíráme report podle nejvyššího výsledku. Komerční index 52, tolerance ±10 bodů, odhad dostupnosti pozice +7 dní, stáří nejvýše 21 dní. Historický COT hodnotíme k výročí **data přepočtu**, tedy ve stejném předstihu před vstupem jako dnes, ne až při budoucím vstupu. To je záměrně odlišné od ruční karty v Seasonality, která hodnotí COT při vstupu. Chybějící čerstvý index nenahrazujeme starším. Podmíněné výsledky zahrnují starší i novější roky; baseline na shodných letech s dostupným COT a novější podmnožina jsou uvedeny zvlášť.

Procenta jsou historické četnosti směru konečné ceny, nikoli kalibrovaná budoucí pravděpodobnost nebo úspěšnost obchodu se stop-lossem. U méně než 8 případů hlavní procento potlačujeme. Wilsonovo 95% pásmo je orientační při předpokladu nezávislých případů se stejnou pravděpodobností. Kontrolní roky nejsou prospektivní ověření na nedotčených datech; hledání mnoha období/instrumentů a změny režimu mohou vést k nadhodnocení. Ani shoda sezonality a COT neprokazuje nezávislou výhodu. Obchodní náklady a intradenní pohyby chybí; vzdálený vstup vyžaduje novou kontrolu COT a ceny. Selhání denního běhu nechává původní snapshot; datum a upozornění na stáří zůstávají viditelné.

Ověření: `node Tools/opportunities-checks.cjs` včetně neměnnosti výběru při změně kontrolních/budoucích dat, publikační prodlevy, stejného předstihu a přelomu roku. Statický checker znovu vypočítá všechny příležitosti z původních cen/COT a ověří shodu.

### Pevné období

Nová záložka porovnává historická období začínající dnešním datem (Europe/Prague) pro 14, 30 a 60 kalendářních dní. Souhrn se předpočítává při exportu (`Tools/build-screener.cjs`); návštěvník stahuje pouze jeden kompaktní soubor, nikoli cenovou historii všech instrumentů. Podporuje historii 10 / 20 / všech let, řazení, hledání, směr mediánu a minimum vzorku. Zobrazuje průměr, medián, podíl kladných roků a medián maximálního poklesu od vstupní ceny.

Výpočty používají jen dokončené historické intervaly, vynechávají aktuální rok, neúplné cenové okraje a vnitřní mezery delší než 7 dní. COT je pouze současný kontext (komerční index 52 reportů a týdenní změna), ne historický obchodní signál. U FX ukazuje oba futures kontrakty zvlášť, bez syntetického párového skóre. Starší ceny/reporty a vzorek pod 10 let jsou označené. Vypočtené statistiky nezahrnují náklady obchodování ani korekci na hledání mnoha patternů.

Tlačítko Otevřít přepne na Seasonality, vybere historické roky vzorku a interval. U intervalu přes konec roku zobrazí celý rok s upozorněním; statistiky přes přelom roku zůstávají ve Screeneru. Souhrn má datum exportu; na další den se přepočítá denním workflow, nikoli při každé návštěvě. Původní MVC režim bez exportu zobrazí informaci, že Screener vyžaduje statickou verzi.

Ověření výpočtů: `node Tools/screener-checks.cjs`. Kontrola statického exportu přepočítává všech devět kombinací pro každý ticker a porovnává COT s původními snapshoty.

## Spuštění

Nastav `ConnectionStrings__DefaultConnection` na připojovací řetězec k Azure SQL (nebo jej pro lokální vývoj ulož do ignorovaného `appsettings.Development.json`) a spusť:

```powershell
dotnet run --project SeasonalityApp.csproj
```

Aplikace sama nestahuje historické ceny při spuštění. Azure SQL musí obsahovat tabulku `SeasonalityPrices`. Aktualizace dat se spouští GitHub Actions workflow `Update seasonality data` po každém pushi na `master`, jednou denně v 05:15 UTC nebo ručně přes `workflow_dispatch`. Po pushi běží aktualizace dat souběžně s nasazením webu. Běhy aktualizace dat se navzájem nepřekrývají a probíhající aktualizace se novým pushem neruší. Workflow používá secret `SEASONALITY_CONNECTION_STRING`.

## Azure SQL Free

V Azure Portal vytvoř SQL Database na SQL serveru s nejnižší dostupnou bezplatnou konfigurací pro svůj subscription/region, povol přístup z hostingu a nastav secret `ConnectionStrings__DefaultConnection`. Ceny Azure Free/DTU se mění podle regionu a nabídky, proto se nefixují v kódu.

## COT

### Podobné historické COT situace

V záložce COT je analýza následných cenových výnosů zvoleného instrumentu za 2/4/8 týdnů. Volby: skupina, podobnost poslednímu indexu ±5/10/15 bodů nebo extrémy 0–20 a 80–100. Používá celý dostupný souběh cen a reportů, historické indexy z vybraného lookbacku a společný vzorek kompletních horizontů. Chronologický výběr vynechává překrývající se 8týdenní okna. Tabulka ukazuje počet případů, medián, průměr, kladné případy, kvartily, minimum/maximum a jednotlivé případy.

Jde o průzkumnou analýzu, ne přesný point-in-time obchodní backtest: skutečná historická data zveřejnění nejsou v snapshotu. Vstupní close je první dostupná cena nejdříve 7 dní po datu pozic; mimořádná zpoždění nejsou garantovaně ošetřená. Cena cíle je první od 14/28/56 dní po vstupu s tolerancí nejvýše 4 dní. Cenové mezery přes 7 dní, neplatné ceny a neúplné horizonty vyřazuje. FX/proxy COT se nepřevádí na syntetický párový signál. Srovnává cenu vybraného instrumentu, ne futures P&L. Nezahrnuje obchodní náklady. Funguje v prohlížeči nad lazy JSON bez SQL dotazů při návštěvě.

Ověření: `node Tools/cot-analogs-checks.cjs` (prodleva, dokončené horizonty, nepřekrývání, mezery a kvartily).

Společné vyhledávání instrumentu ovládá záložky Seasonality a COT. COT podporuje 91 instrumentů prostřednictvím 58 samostatných futures reportů. Vyhledávání přijímá i aliasy NQ → NDX, ES → SPX, YM → DJI, RTY → RUT, XAU / GC → XAUUSD, XAG / SI → SILVER, CL → WTI a NG → NATGAS; nevytváří duplicitní cenové instrumenty.

- 28 hlavních forexových párů a DXY. Cross pár zobrazuje reporty jednotlivých měn; USD používá explicitně označený proxy report US Dollar Index. COT není reportem o celém spotovém páru.
- Všech 26 komodit v katalogu: kovy, energie, zemědělské plodiny, hospodářská zvířata a dřevo. Brent používá NYMEX Brent Last Day (06765T), nikoli jiný ICE kontrakt. Nový Lumber (058644) a historický Random Length Lumber / LBS (058643, poslední report 2023) jsou dvě přepínatelné řady; nespojují se.
- SPX, NDX (NQ), DJI, RUT, VIX a NIKKEI225: uvedené podkladové futures, nikoli hotovostní index. Nepřičítáme micro ani konsolidované kontrakty.
- BTCUSD, ETHUSD, SOLUSD a XRPUSD: futures CME, nikoli pozice na spotových kryptoburzách. BNB nemá odpovídající report v použitém zdroji.
- 26 ETF s jasně označeným proxy: SPY, QQQ, DIA, IWM, EFA, EEM, TLT, IEF, GLD, SLV, USO, UNG, CPER, WEAT, CORNETF, SOYBETF, CANE a devět SPDR sektorů. U sektorů jde o příslušné [S&P Select Sector futures](https://www.cmegroup.com/markets/equities/select-sectors.html), nikoli pozice v samotném ETF; TLT / IEF používají Ultra Treasury Bond / 10Y Note futures s odlišnou durací a splatnostmi. Některé sektorové reporty mají velmi krátkou nebo nepravidelnou historii.

Kódy jsou explicitně ověřené v [oficiálním katalogu CFTC](https://publicreporting.cftc.gov/Legacy-Reports/Legacy-Futures-Only/6dca-aqww) a uložené v `Services/CotCatalog.cs`. Jednotlivé akcie, diverzifikované košové fondy (např. DBC, DBA, VT), DAX, FTSE100, HSI a STOXX50E bez odpovídajícího reportu v tomto zdroji zůstávají bez COT. Nepoužíváme pro ně nesouvisející index a nesyntetizujeme fiktivní agregované pozice.

Zdroj: [CFTC Legacy – Futures Only](https://publicreporting.cftc.gov/Legacy-Reports/Legacy-Futures-Only/6dca-aqww). Import načítá dostupnou historii od roku 1986, po prvním běhu stahuje a z SQL čte jen posledních pět týdnů pro opravy. Každý kontrakt aktualizuje jednou, i když se zobrazuje u více ETF / instrumentů. Při startu se bezpečně přidá tabulka `CotReports` i do existující databáze; tabulka cen se nemění. Web čte pouze uložené reporty vybraného instrumentu. Datum v grafu označuje datum pozic, nikoli zveřejnění. CFTC obvykle publikuje v pátek úterní stav; denní aktualizace tak nemusí přinést nový report.

Workflow `Update seasonality data` obsahuje nezávislé joby pro ceny a COT, oba běží po pushi na `master`, denně i při ručním spuštění. Výpadek CFTC neblokuje aktualizaci cen. První import COT lze spustit samostatně:

```powershell
dotnet run --project SeasonalityApp.csproj -- --update-cot-once
```

Grafy zobrazují long/short, čisté pozice, týdenní změny a COT index pro commercials, non-commercials a non-reportable. COT index je min–max normalizace čistých pozic za 26, 52 nebo 156 reportů včetně aktuálního. Při chybějící historii či nulovém rozsahu je index nezobrazený. Non-reportable není přesné měření retailových pozic.

Import kontroluje nezáporné počty a shodu součtů long/short se zveřejněným open interestem. Neplatné historické řádky vynechá s varováním v logu (např. JPY 15. 3. 1988). Týdenní změna se nezobrazuje přes mezeru v reportech. Jiný kontrakt, typ reportu nebo chybějící API pole import zastaví, aby se nesmíchaly nesouvisející řady.

Ověření parseru a výpočtů (bez databáze a bez dalších testovacích balíčků):

```powershell
dotnet run --project Tools/CotChecks/CotChecks.csproj -c Release
```

Volitelná read-only kontrola všech 91 podporovaných instrumentů proti spuštěné aplikaci a reálně importovaným datům:

```powershell
dotnet run --project Tools/CotChecks/CotChecks.csproj -c Release -- --live-url http://127.0.0.1:54128/
```
