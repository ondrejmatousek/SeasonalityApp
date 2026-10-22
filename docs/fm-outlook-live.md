# Průběžný Denní výhled FM

Denní výhled načítá `/data/manifest.json` a jeho content-addressed `zonePrices` snímek. Používá stejné SQL H4 řady a nezměněný `FmOrderBlocks` engine jako Obchodní zóny. Pravidelný Work, jeho prompt, přihlašování, intervaly ani backendová validace se nemění. Existující publikace po nových H4 barech zpřístupní nový snímek oběma záložkám současně.

Aktuální rozsah je 39 OANDA FX párů. Původní XAUUSD, NQZ2026 a BYBIT:BTCUSDT.P pilot není náhradou pravidelného H4 zdroje. Tyto tři feedy nejsou připojené k pravidelnému SQL H4 příjmu a záměrně nejsou nabízené jako živé. Žádné míchání BTC spot/perpetual nebo index/konkrétní futures kontrakt.

Stránka kontroluje publikovaný manifest každých 60 sekund a po návratu do viditelné záložky. Data se mění až po sběru a úspěšné publikaci, nikoli každou minutu na burze. Čas publikace a posledního dokončeného H4 baru jsou odlišné údaje. Neukazujeme rozpracovanou svíčku. Časy grafu jsou Europe/Prague, audit zůstává UTC. Výpadek zachová poslední snímek s výstrahou; při prvním neúspěchu jsou výpočty zakázané. Otevřený detail drží svůj původní dataset; nová publikace se aplikuje po jeho zavření.

Před výpočtem se ověřuje hash zdrojového souboru, provider/symbol, validační pravidlo, skutečný as-of, uzavření, chronologie a OHLC. Audit obsahuje hash přesných publikovaných zdrojových bytes a jejich cestu. SQL metadata nepředstavují nezávislou certifikaci burzovního kalendáře ani úplnou TradingView runtime paritu. Zóny nejsou automatické obchodní příkazy.

Kontroly: Release build; skutečný ASP.NET start; `fm-outlook-live-checks.cjs` (39 zdrojů a odmítnutí neplatných vstupů); `fm-outlook-live-browser-checks.cjs` (Edge, engine parity, 320/390 px, přírůstek dokončeného baru, stabilita detailu, hash auditu, výpadek); existující FM engine a nearest-pair regrese. Testy přehrávají novou publikaci bez změny produkčních cen, plánů nebo příkazů.
