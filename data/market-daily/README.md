# Archived GitHub collection — live intake is SQL/MCP

GitHub collection writes are retired. Do NOT update `latest.json`, dated archives
or audits here. Preserve existing files as historical evidence/test fixtures.
The active collector sends one unchanged 39-instrument daily JSON AND its common
completion audit through the authenticated `submit_market_daily` Seasonality tool.
Keep the 03:00 Europe/Prague schedule. On a failed submission report the error;
never silently fall back to GitHub, fabricate bars or rewrite `fetchedAt`.
The server returns a durable SQL receipt; Actions validate/process the SQL queue.
The collector must not invoke workers, deploys or analytics itself.
See `docs/market-daily-sql-rollout.md` for processing/publication and recovery.

## Historical repository format (not an active writer instruction)

The former collector stored exactly ONE complete 39-instrument collection:

- `data/market-daily/latest.json`
- `data/market-daily/YYYY-MM-DD.json` (the SAME bytes; archive date is collection date in Europe/Prague)
- `data/market-daily/audit/YYYY-MM-DD.json` (all 39 instruments and original completion evidence)

Do not write an active `commodity-extension` feed. All 39 instruments are now registered in application ingestion. Preserve each bar's original Unix-seconds timestamp, OHLC, provider/providerSymbol and canonical identity. The existing 36 plus WHEAT `CBOT:ZW1!`, LIVECATTLE `CME:LE1!`, SOYBEANS `CBOT:ZS1!` belong in the same bars array. Research restrictions are per instrument, not separate files. Stocks still use the separate Yahoo stock refresh.

Envelope: schemaVersion 1, timeframe `1D`, fetchedAt (one collection timestamp), runDate, bars. Completion audit run.checkedAt must equal fetchedAt and audit entries must match each providerSymbol/timestamp. Keep independent documented session/calendar evidence or a verified elapsed sessionEnd. No fabricated close timestamp, no provider splice, no synthetic prices.

Validate all results and stage the archive and audit BEFORE publishing latest.json. Commit the three together, so the application never sees partial collections. Never overwrite valid history with conflicting OHLC. Record failed symbols honestly; do not report 39 successful if one failed. The application isolates research failures and blocks critical failures.

Continuous futures remain research-only. No scoring, COT, SQL or stock source changes are authorized by this collector contract. Historical legacy archives and migration evidence are retained separately, not read as active inputs.
