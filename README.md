# SeasonalityApp

Samostatná MVC aplikace bez přihlašování. Historické ceny čte z Azure SQL a používá převzatou logiku sezonnosti z TradingJournal.

## Spuštění

Nastav `ConnectionStrings__DefaultConnection` na připojovací řetězec k Azure SQL (nebo jej pro lokální vývoj ulož do ignorovaného `appsettings.Development.json`) a spusť:

```powershell
dotnet run --project SeasonalityApp.csproj
```

Aplikace sama nestahuje historické ceny při spuštění. Azure SQL musí obsahovat tabulku `SeasonalityPrices`. Aktualizace dat se spouští GitHub Actions workflow `Update seasonality data` po každém pushi na `master`, jednou denně v 05:15 UTC nebo ručně přes `workflow_dispatch`. Po pushi běží aktualizace dat souběžně s nasazením webu. Běhy aktualizace dat se navzájem nepřekrývají a probíhající aktualizace se novým pushem neruší. Workflow používá secret `SEASONALITY_CONNECTION_STRING`.

## Azure SQL Free

V Azure Portal vytvoř SQL Database na SQL serveru s nejnižší dostupnou bezplatnou konfigurací pro svůj subscription/region, povol přístup z hostingu a nastav secret `ConnectionStrings__DefaultConnection`. Ceny Azure Free/DTU se mění podle regionu a nabídky, proto se nefixují v kódu.

## COT

Společné vyhledávání instrumentu ovládá záložky Seasonality a COT. COT podporuje 28 hlavních forexových párů (USD, EUR, GBP, JPY, CHF, CAD, AUD, NZD) a DXY. Cross pár zobrazuje reporty jednotlivých měn; USD používá explicitně označený proxy report US Dollar Index. COT není reportem o celém spotovém páru. Pro ostatní instrumenty se zobrazí informace o chybějícím mapování.

Zdroj: [CFTC Legacy – Futures Only](https://publicreporting.cftc.gov/Legacy-Reports/Legacy-Futures-Only/6dca-aqww). Import načítá dostupnou historii od roku 1986, po prvním běhu stahuje posledních pět týdnů. Při startu se bezpečně přidá tabulka `CotReports` i do existující databáze; tabulka cen se nemění. Web čte pouze uložené reporty. Datum v grafu označuje datum pozic, nikoli zveřejnění. CFTC obvykle publikuje v pátek úterní stav; denní aktualizace tak nemusí přinést nový report.

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
