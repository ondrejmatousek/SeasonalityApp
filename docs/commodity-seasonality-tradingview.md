# TradingView commodity seasonality — research extension, 2026-10-13

Three existing catalog instruments now have independent TradingView histories. The previous 36-source backfill and daily ingestion registry are unchanged. No Yahoo fallback or CFD proxy was restored.

| App key | Provider symbol | Raw historical start | Seasonality start | Last bar | Accepted / rejected | Complete years before 2026 |
|---|---|---|---|---|---|---|
| WHEAT | CBOT:ZW1! | 1970-01-05 | 1970 | 2026-10-12 | 14,308 / 0 | 56 |
| LIVECATTLE | CME:LE1! | 1976-02-23 | 1977 | 2026-10-12 | 12,751 / 0 | 49 |
| SOYBEANS | CBOT:ZS1! | 1968-12-05 | 1969 | 2026-10-12 | 14,569 / 0 | 57 |

Each source was resolved through TradingView MCP, then fetched as 1D columns in two pages (8,000 maximum per page), following next_date_to until has_more=false. Original provider timestamps and OHLC are preserved. Incomplete first years are excluded from the seasonality price projection but retained in immutable evidence. No manual price correction, synthetic bars or provider splicing. The bounded historical request excludes the current 2026-10-13 calendar day. Coverage means available under the connected feed/plan, not an assertion of all history ever traded.

Registry: `data/commodity-research/source-registry.json`; complete raw pages in `raw/`; checked sources in `validated/`; quality/gaps/outliers in `audit.json`. SHA-256 binds each source and raw page. Existing market preparation incorporates these supplemental sources on every rebuild, so future morning exports retain them.

All three are **Research only / unsupported for validated ranking** continuous futures. Roll schedules, back/ratio-adjustment settings and contract-level identity have not been independently established; roll gaps can affect percentage seasonality. Passing OHLC validation does not validate the economic return series. Core weights, formulas, COT and universe are unchanged. Existing optional research screening can describe these histories; they are not admitted to core rankings. HTF activation is deliberately disabled for the supplement.

**Daily updates are not configured for these three series.** The external Work collector still covers the original 36 instruments. The UI labels the historical snapshot and health reports warn about historical-only research data. Adding them to the external JSON alone is not enough: their identities/completion rules must also be added to daily ingestion in a separate follow-up. No recurring automation was changed in this extension.

Find them in Seasonality by `WHEAT` / Wheat, `LIVECATTLE` / Live Cattle, or `SOYBEANS` / Soybeans. The core screener intentionally remains restricted to its existing validated-ranking-ready universe.
