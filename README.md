# SeasonalityApp

Samostatná MVC aplikace bez přihlašování. Používá existující `SeasonalityService`, instrumenty, parsery a updater z TradingJournal.

## Spuštění

Nastav `ConnectionStrings__DefaultConnection` na Azure SQL connection string a spusť:

```powershell
dotnet run --project SeasonalityApp/SeasonalityApp.csproj
```

Aplikace sama neprovádí migrace celé původní databáze. Azure SQL musí obsahovat tabulku `SeasonalityPrices` podle modelu TradingJournal. Denní worker při startu doplní chybějící historii a potom ji obnovuje jednou za 24 hodin.

## Azure SQL Free

V Azure Portal vytvoř SQL Database na SQL serveru s nejnižší dostupnou bezplatnou konfigurací pro svůj subscription/region, povol přístup z hostingu a nastav secret `ConnectionStrings__DefaultConnection`. Ceny Azure Free/DTU se mění podle regionu a nabídky, proto se nefixují v kódu.
