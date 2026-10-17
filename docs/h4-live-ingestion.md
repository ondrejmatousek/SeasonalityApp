# Průběžný H4 tok (jen Obchodní zóny)

## Kontrakt

Stejný OAuth resource a owner/client kontrola jako denní Seasonality MCP.
`get_market_h4_status` a `submit_market_h4` vyžadují `market.ingest`.
Stávající `submit_market_daily` ani jeho plán se nemění.

H4 JSON je přesný text `{schemaVersion:1,fetchedAt:UTC ISO,captures:[
{capturedAt:UTC ISO,rawJson:EXACT PROVIDER JSON STRING}]}`. Capture obsahuje
úplnou původní odpověď `success`, `symbol=OANDA:<FX>`, `interval=4h`,
`format=columns`, `count`, `bars.t/o/h/l/c/v`. Zachovat i dosud otevřené bary;
server je vyřadí. 1–28 jedinečných registrovaných FX symbolů, 2–96 barů/symbol,
256 KiB celkem, capture nejvýše 30 minut starý. Chybějící volume zůstává null.
Chyby jednotlivých sběrů lze přidat do envelope `errors`; nesmí být vydávány
za úspěšně načtené symboly. Částečný submit je možný a počet captures je vrácen.

`market_h4.LiveReceipts`: přesné UTF-8 bajty, SHA-256 ID, serverový čas,
výsledek včetně cenového konfliktu. `market_h4.LiveBars`: jedinečný
symbol+UTC start; provider OANDA a timeframe H4 jsou pevné v tomto kontraktu.
Existující historické ceny i nové hodnoty se při překryvu porovnávají přesně,
včetně volume. Konflikt odmítá celý přírůstek, ale jeho raw evidence zůstává.
Duplicitní hodnoty se nepřepisují. D1/COT tabulek se tok nedotýká.

## Výslovná hranice validace

`oanda-h4-boundary-v1` není nezávislý burzovní/sváteční kalendář:

- OANDA NY17 nominální H4 slot, kontrola America/New_York včetně DST,
  pracovní obchodní týden, platná původní OHLCV a chronologie.
- Alespoň 60 sekund po konci nominálního slotu A SOUČASNĚ následující
  providerový bar přesně o 4 hodiny později.
- Výjimka je běžný páteční 13:00 NY slot, který je přijat až po 17:01 NY
  podle zveřejněného pravidelného konce obchodování v 16:59 NY.
- Období 24. prosince až 2. ledna je konzervativně vyřazené. Toto není
  úplný seznam výjimečných svátků a samotná data necertifikují kalendář.
- Bez následující hranice se poslední běžný bar nepřijme. Work posílá
  překryv a další běh jej může doložit. Mezery se nedoplňují.

OANDA pravidelné hodiny a odchylky:
https://www.oanda.com/us-en/trading/hours-of-operation/

Receipt proto vrací `providerBoundaryValidated`, ale vždy
`completionValidated:false`, `exchangeCalendarValidated:false`.
Historické `h4-d1-parity-v1` zůstává samostatně zachované. UI obě evidence
odlišuje. Nový tok neopravňuje tvrdit úplnou session nebo úplnou historii.

## Publikace

Po SQL COMMIT nových barů server požádá pevně o `static-hosting.yml` na master.
Nikoli o Morning analytics. Použije existující GitHub App s Actions:write,
bez nových secrets. Requested není dokončená publikace. Při nejasném výsledku
lze opakovat přesný payload do 30 minut; později použít stavový nástroj.
Duplicitní receipt s původně vloženými bary může znovu požádat o publikaci.

SQL export vrací posledních 2200 inkrementálních barů na symbol a jejich
referencované raw receipts jen do soukromých staging artifacts. Statický build
znovu ověří SHA, časovou evidenci a přesnou raw/SQL shodu, potom přidá H4 do
zone snapshotu. D1/W1, seasonality assets a daily SQL provenance se nemění.
Na veřejný web nepatří původní raw response texty ani credentials.

## Plán Worku

Samostatný sběr 28 FX každé čtyři hodiny s překryvem (výchozí count 12,
nejvýše 96 při dohnání mezery), checkpointy a nejvýše 3 pokusy/symbol.
Nový H4 plán zapnout teprve po ověření skutečného MCP statusu a submitu.
Denní sběr 39 trhů denně 03:00 Europe/Prague zůstává beze změny.
Reautorizaci reportovat, nikdy neobcházet. Stav Work plánu ověřit jeho
zpětným načtením; existence tohoto dokumentu neznamená jeho zapnutí.

## Ověření

H4SqlImport `--h4-live-checks`: skutečné oddělené LocalDB SQL, které test sám
vytvoří a odstraní. `--h4-live-validation`: stejné časové/identitní testy bez SQL.
MarketMcpChecks `--h4-discovery`: skutečný SDK host, discovery a scope před SQL.
MarketTriggerChecks: H4 dispatch nemá daily analytics inputs.
`h4-zone-live-checks.cjs`: SQL/raw hash, cenová shoda a časové hranice.
