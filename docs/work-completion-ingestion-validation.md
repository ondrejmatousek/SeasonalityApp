# Work completion evidence ingestion — 2026-10-13

Input: `data/market-daily/latest.json`, collected at `2026-10-13T05:31:41.620Z`, with matching producer audit `data/market-daily/audit/2026-10-13.json`. The producer reports 36 successful symbols, explicitly excludes current-session candidates and documents its session/calendar evidence. Exact provider time_close is not available for most symbols.

The ingestion accepts new non-FX bars without sessionEnd only when the exact producer audit matches collection time, original symbol, providerSymbol, timestamp, trading date and successful completion flags. Documented sources and reason are required. Symbol-specific conservative elapsed-window checks are timezone/DST-aware and do not manufacture an exact sessionEnd. The original raw JSON and full audit are stored as hashed evidence. Existing OANDA NY17 rules, strict OHLC, immutable backfill, provider identity, per-instrument conflict rollback and research restrictions are unchanged.

Isolated root `artifacts/work-completion-preview`:

| Run | Inserted | Exact duplicates | Failed |
|---|---:|---:|---:|
| First | 36 | 0 | 0 |
| Second | 0 | 36 | 0 |

Safe analytics output `artifacts/work-completion-analytics` rebuilt seasonality, COT context from the existing snapshot, HTF and all existing scoring formulas. 113 candidate windows, 116 HTF zones, all 38 HTF references available. EURUSD, NDX, SPX and XAUUSD latest session label: 2026-10-12. AAPL remains Yahoo, snapshot last date 2026-10-12. WTI retains the provider-timestamp UTC date label 2026-10-11 for the session traded on 2026-10-12; no timestamp/date re-labelling or price repair was performed.

This rehearsal does not refresh production SQL or publish outputs. Its overall warning is intentional (`snapshot-only` stocks/COT), not an ingestion failure. Production publication must still pass the normal live workflow. Negative tests cover missing/mismatched audit, wrong timestamp, unelapsed completion window, unfinished bar, provider splice and OHLC conflicts.
