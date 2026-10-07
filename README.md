# SeasonalityApp

Samostatná MVC aplikace bez přihlašování. Historické ceny čte z Azure SQL a používá převzatou logiku sezonnosti z TradingJournal.

## Grafy a export PNG

Hlavní sezónní křivka při přejetí ukazuje tyrkysový bod a přerušovanou svislici na nejbližší hodnotě křivky. Tooltip uvádí datum a index a zůstává mimo kurzor. Výběr intervalu tažením zůstává zachovaný; pohyb myši nepřepočítává data ani statistiky. Bod a svislice se nezahrnují do PNG exportu.

COT index má vizuální rezervu nad 100 / pod 0 a vyšší graf, takže se krajní hodnoty neořezávají. Samotné hodnoty indexu zůstávají 0–100 a nevyhlazují se. Ve výchozím stavu se zobrazují všechny tři skupiny tenkými souvislými čarami odlišenými barvou; kliknutím na skupiny v legendě lze volitelně některé skrýt. Alespoň jedna skupina zůstává zapnutá. Tooltip se umisťuje nad / vedle kurzoru a u pravého okraje překlápí doleva; přerušovaná svislice a bod označují vybraný report.

Na obou hlavních záložkách je tlačítko fotoaparátu pro stažení PNG aktuální analýzy: vybraný instrument, filtry, grafy a viditelné statistiky. Seasonality zahrnuje sezónní křivku i spodní grafy (nebo právě otevřený měsíční přehled); COT zahrnuje všechny čtyři grafy vybraného futures kontraktu a nastavené skupiny indexu. Export není omezen na viditelnou výšku obrazovky. Neobsahuje navigaci aplikace, vyhledávání, tooltipy ani dlouhé historické tabulky. Název souboru obsahuje ticker, pohled a datum. Export běží lokálně v prohlížeči s vendorizovaným MIT balíčkem html2canvas 1.4.1 (`wwwroot/lib/html2canvas`, licence přiložena); knihovna se načítá až při prvním exportu. Nevyžaduje externí screenshot službu ani další SQL dotaz. Prohlížeč používá vlastní grafovou SVG ikonu.

Kontrola geometrie, umístění tooltipu a limitů PNG:

```powershell
node Tools/chart-ui-checks.cjs
```

## Spuštění

Nastav `ConnectionStrings__DefaultConnection` na připojovací řetězec k Azure SQL (nebo jej pro lokální vývoj ulož do ignorovaného `appsettings.Development.json`) a spusť:

```powershell
dotnet run --project SeasonalityApp.csproj
```

Aplikace sama nestahuje historické ceny při spuštění. Azure SQL musí obsahovat tabulku `SeasonalityPrices`. Aktualizace dat se spouští GitHub Actions workflow `Update seasonality data` po každém pushi na `master`, jednou denně v 05:15 UTC nebo ručně přes `workflow_dispatch`. Po pushi běží aktualizace dat souběžně s nasazením webu. Běhy aktualizace dat se navzájem nepřekrývají a probíhající aktualizace se novým pushem neruší. Workflow používá secret `SEASONALITY_CONNECTION_STRING`.

## Azure SQL Free

V Azure Portal vytvoř SQL Database na SQL serveru s nejnižší dostupnou bezplatnou konfigurací pro svůj subscription/region, povol přístup z hostingu a nastav secret `ConnectionStrings__DefaultConnection`. Ceny Azure Free/DTU se mění podle regionu a nabídky, proto se nefixují v kódu.

## COT

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
