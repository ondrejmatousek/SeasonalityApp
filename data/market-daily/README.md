# Single daily TradingView collection

The collector writes exactly ONE complete 39-instrument collection:

- `data/market-daily/latest.json`
- `data/market-daily/YYYY-MM-DD.json` (the SAME bytes; archive date is collection date in Europe/Prague)
- `data/market-daily/audit/YYYY-MM-DD.json` (all 39 instruments and original completion evidence)

Do not write an active `commodity-extension` feed. All 39 instruments are now registered in application ingestion. Preserve each bar's original Unix-seconds timestamp, OHLC, provider/providerSymbol and canonical identity. The existing 36 plus WHEAT `CBOT:ZW1!`, LIVECATTLE `CME:LE1!`, SOYBEANS `CBOT:ZS1!` belong in the same bars array. Research restrictions are per instrument, not separate files. Stocks still use the separate Yahoo stock refresh.

Envelope: schemaVersion 1, timeframe `1D`, fetchedAt (one collection timestamp), runDate, bars. Completion audit run.checkedAt must equal fetchedAt and audit entries must match each providerSymbol/timestamp. Keep independent documented session/calendar evidence or a verified elapsed sessionEnd. No fabricated close timestamp, no provider splice, no synthetic prices.

Validate all results and stage the archive and audit BEFORE publishing latest.json. Commit the three together, so the application never sees partial collections. Never overwrite valid history with conflicting OHLC. Record failed symbols honestly; do not report 39 successful if one failed. The application isolates research failures and blocks critical failures.

Continuous futures remain research-only. No scoring, COT, SQL or stock source changes are authorized by this collector contract. Historical legacy archives and migration evidence are retained separately, not read as active inputs.
