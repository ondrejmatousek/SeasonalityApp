# SeasonalityApp

Samostatná MVC aplikace bez přihlašování. Historické ceny čte z Azure SQL a používá převzatou logiku sezonnosti z TradingJournal.

## Spuštění

Nastav `ConnectionStrings__DefaultConnection` na připojovací řetězec k Azure SQL (nebo jej pro lokální vývoj ulož do ignorovaného `appsettings.Development.json`) a spusť:

```powershell
dotnet run --project SeasonalityApp.csproj
```

Aplikace sama nestahuje historické ceny při spuštění. Azure SQL musí obsahovat tabulku `SeasonalityPrices`. Denní aktualizace se spouští plánovaným GitHub Actions workflow, případně ručně přes `workflow_dispatch`; spuštění webu ani push ji nespouštějí.

## Azure SQL Free

V Azure Portal vytvoř SQL Database na SQL serveru s nejnižší dostupnou bezplatnou konfigurací pro svůj subscription/region, povol přístup z hostingu a nastav secret `ConnectionStrings__DefaultConnection`. Ceny Azure Free/DTU se mění podle regionu a nabídky, proto se nefixují v kódu.
