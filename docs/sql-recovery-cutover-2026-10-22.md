# SQL recovery cutover — 2026-10-22

Target: `seasonality.database.windows.net / seasonality-free-20261022`.
The former database is preserved and is not read, modified or billed by this cutover.

This is an operator-authorized reconstruction from local price/COT snapshots and original provider captures, not a byte-for-byte SQL restore. Unavailable former SQL receipts and audit events must never be fabricated. New receipts retain real post-cutover timestamps. Recovery evidence records the source hashes, exclusions and observed value revisions separately.

Cutover gates: explicit target identity; verified local file hashes; SQL row readback; source-preserving D1/H4 boundaries; successful build/tests and actual application startup; consistent backend and Actions connection targets. Over-limit billing remains disabled.

## Verified reconstruction, 22 October 2026 13:51 UTC

| Store | Rows / scope |
| --- | --- |
| dbo.SeasonalityPrices | 4,101,713; 496 nonempty registered source series |
| dbo.CotReports | 78,506; 62 contracts; positions/open-interest balance validated |
| market_h4.Bars | 165,326 original historical rows; 165,312 eligible, 14 excluded by D1 parity |
| market_h4.LiveBars | 616 new completed bars, 28 pairs; 2 real accepted receipts |
| market_zones.Bars | 82,351 D1/H4 rows for 11 extra FX pairs and XPTUSD |
| market_recovery.Intraday | 215,343 H4/M15 archival rows; every OHLCV field read back exactly |
| paper_h4 | 72 prospective waiting setups; no invented pre-migration trades or results |

All 39 FX H4 feeds end at 2026-10-22 09:00 UTC (closed 13:00 UTC / 15:00 Prague).
All 50 requested CFD markets can be evaluated in the generated zone snapshot. Crypto remains Yahoo; no TradingView shadow/source mixing. Main D1 sources and AAPL are current through 21 October; the futures provider UTC start date of 20 October denotes the completed 21 October business session, not a missing daily candle.

The local baseline contains 30 pre-existing empty/unregistered market series outside the recovered canonical sources. They remain explicitly unavailable; no replacement provider is silently chosen. Eleven extra FX series have zone-only SQL history, not certified seasonality history. CFTC recent raw capture agrees with the recovered last dates: 58 contracts through 13 October, 004603 through 6 October; 058643 / 138747 / 13874H have older histories and must not be labeled fresh. FirstObservedAt for recovered COT is unknown, not a fabricated publication vintage.

Historical capture freshness is checked at the original recorded time; SQL ReceivedAt is the real recovery time. RecoveryValidatedAt is an operator-only provenance field, not accepted from live MCP input. One malformed historical extra-FX OHLC row is quarantined without changing the raw capture; live MCP continues rejecting malformed batches. Normal freshness, source, holiday and boundary checks are unchanged. Existing stored OHLC wins on immutable overlap; volume differences are audited. The local Yahoo refresh includes provider revisions, with before/after evidence retained; their causes are not asserted.

The old SQL Inbox/ShadowHistory, old receipts, and any unavailable SQL-only history are not restored or claimed complete. Existing file-based daily-health reports remain available. New receipts and paper events begin with actual recovery timestamps. Raw local evidence, source SHA manifests and readback report are retained under the primary workspace's `artifacts/sql-recovery-20261022-v2`.

Build: solution Release, 0 warnings/errors. Actual app startup against the new SQL: `/runs/` HTTP 200; AAPL endpoint 11,557 rows through 21 October. Boundary, CFD admission, exact SQL/raw parity, Prague timezone, publication fence, static export and paper-ledger regressions passed. Existing auxiliary import projects still report their pre-existing transitive Pkcs 9.0.4 advisory; this recovery project explicitly uses 9.0.21.

Allocated SQL data files: 640 MB. Verified full public output: 215.85 MiB after moving obsolete content-addressed JSON outside the publication tree, below the enforced 240 MiB safety limit. Prior generated outputs remain recoverable in local artifacts and Git history.

GitHub `SEASONALITY_CONNECTION_STRING` and local development secret store were securely redirected. Backend deploy updates and reads back both DefaultConnection and its environment override, using existing Azure OIDC authorization. No credentials were rotated and no paid database setting was enabled. D1/H4 schedules and connector authentication are unchanged.
