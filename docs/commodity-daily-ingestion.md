# Daily ingestion: Wheat, Live Cattle, Soybeans

The immutable `data/commodity-research/source-registry.json` remains the historical authority. The three SHA-pinned TradingView histories are never rewritten. The existing morning pipeline accepts their exact identities in `data/market-daily/latest.json`, or optionally reads `data/market-daily/commodity-extension/latest.json` with the same schemaVersion 1 envelope and bars dialect. Extension freshness is checked independently (24 hours). Its adjacent `audit/YYYY-MM-DD.json` is read using Prague collection date.

| Logical symbol | Provider | Provider symbol | Canonical ID |
|---|---|---|---|
| WHEAT | CBOT | CBOT:ZW1! | commodity:WHEAT:CBOT:ZW1!:tv-research:v1 |
| LIVECATTLE | CME | CME:LE1! | commodity:LIVECATTLE:CME:LE1!:tv-research:v1 |
| SOYBEANS | CBOT | CBOT:ZS1! | commodity:SOYBEANS:CBOT:ZS1!:tv-research:v1 |

Bar fields: symbol, provider, providerSymbol, timeframe `1D`, original Unix-seconds timestamp, original open/high/low/close, completed true, status ok, date matching the provider UTC timestamp date. Optional sourceIdentity must match `{provider}_TRADINGVIEW_RESEARCH`. New bars require explicit elapsed sessionEnd OR the existing documented-session/calendar completion audit tied to the exact bar and fetchedAt. The Chicago 17:00 conservative acceptance window is not a claimed provider candle cutoff. No new completion evidence is inferred from close or fetch time. Known accepted historical duplicates retain their original completion evidence.

Append-only overlays use `daily-ingestion/<SYMBOL>.json` and persist through the existing `data/market-state` publication/restore flow. Identical OHLC is a no-op; conflicts, date collisions, provider changes, invalid/unfinished bars and historical-hole repairs fail the entire instrument without rewriting it. Other instruments continue. Supplemental failures are audited research warnings, not core ranking changes.

Seasonality materialization joins immutable history and the same-source overlay, preserving the first-complete-year filter. HTF remains disabled and these markets remain research-only. Scoring/COT definitions and schedules are unchanged.

UI distinguishes awaiting first validated JSON, successful daily connection and failed daily ingestion. Merely implementing support does not label an absent feed connected. The morning report warns when missing/stale. Daily collection is performed by the external Work task, not this code.

Work's audit dialect (`selectedDate`, `completionMethod`, `completionEvidence`, `sourceEvidence`, `rawResponse`) is also supported for independent `documented_session_and_bar_timestamp` evidence. Raw response symbol/interval/timestamp/OHLC must match. `documented_session_and_bar_timestamp_with_existing_validated_history` is NOT sufficient for a new bar: it describes a duplicate, not independent completion proof. Do not relabel it without actually verifying exchange session/calendar completion.

Verification: `node Tools/commodity-daily-ingest-checks.cjs`, existing ingestion/health/research checks, Release build, safe morning rebuild, commodity browser checks. Append fixtures are synthetic and must never be published. Actual Work commit `7d448b5c2af3964d554564426d79c386c6830218` supplies three exact historical duplicates (2026-10-12); rehearsal reads 39 bars, skips 39 and fails 0, with 118 windows and 116 HTF zones. No genuinely new commodity bar has yet been supplied; live future append must retain independent completion evidence.
