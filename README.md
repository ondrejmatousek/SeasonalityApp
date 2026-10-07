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
