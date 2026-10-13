# Morning analytics

The `Morning analytics` workflow (`.github/workflows/seasonality-update.yml`) runs at `0 4 * * *` and `0 5 * * *` UTC. A Europe/Prague DST gate selects exactly the matching 06:00 cron; a delayed GitHub runner is not discarded just because it starts after 07:00. GitHub scheduling is best-effort, not a guaranteed execution time. Manual workflow_dispatch bypasses only the scheduling gate, not data freshness or quality gates.

## Sources and persistent state

- Stocks/ETF: existing Yahoo refresh command and SQL snapshot. No TradingView stock migration. AAPL SQL provider provenance and latest price date are checked. Existing price parser/formulas remain unchanged; this change does not certify historical corporate-action adjustment policy.
- FX: audited standalone OANDA/TradingView NY17 bars; identical canonical series for seasonality and HTF.
- NDX: NASDAQ:NDX; SPX: SP:SPX. SPX HTF excludes pre-1962 close-only history.
- Gold/silver: OANDA:XAUUSD / OANDA:XAGUSD; research/review restrictions retained.
- WTI/Brent/NatGas/Copper: original exchange continuous futures, not CFDs; research/review restrictions retained.

`data/market-history/tradingview-backfill-36-v1.json.gz` contains the exact accepted backfill JSON, pinned by SHA-256. `Tools/market-history-seed.cjs` restores it under the original artifacts path without rewriting any prices. Cumulative same-provider daily overlays live in `data/market-state`; no expiring artifact is required to reconstruct price state. Raw original audit evidence stays in the original backfill workspace.

The external 03:00 task supplies `data/market-daily/latest.json`. FetchedAt must be valid, not future-dated and at most 24 hours old. All 28 FX plus NDX and SPX must be present. Exact duplicates are no-ops; OHLC conflicts fail an entire instrument. Research errors are audited warnings; core errors prevent analytics publication. New non-FX timestamps require either a completed `sessionEnd`, or `completed: true` / `status: ok` with a matching producer audit in `data/market-daily/audit/YYYY-MM-DD.json` (Prague collection date). The audit must match fetchedAt, original symbol, providerSymbol, timestamp and bar date, include the documented session/calendar sources and successful completion evidence. Conservative symbol-specific acceptance windows are checked in New York, Chicago or London with DST; these windows are NOT asserted as exact provider candle close times. Missing/ambiguous/mismatched audit evidence or an unelapsed window fails closed. The full audit is saved as hashed ingestion evidence. Existing OANDA NY17 completion checks and duplicate backfill evidence remain unchanged. Neither `close` nor a bare completion flag proves completion.

## Execution / publication

`node Tools/morning-run.cjs` prepares the market bundle, invokes existing Yahoo stocks and CFTC refresh, exports fresh SQL stock/COT data, rebuilds existing seasonality/scoring/HTF builders and verifies their static outputs. The existing stock updater writes an optional audit of Yahoo successes, failures, empty responses and fallback outcomes; swallowed per-ticker failures no longer masquerade as a successful refresh. AAPL Yahoo failure or empty response blocks publication. Candidate discovery necessarily precedes HTF confluence matching; this is an existing dependency, not a scoring change. All formulas, weights, relative COT, universe and tracking definitions are unchanged.

`node Tools/morning-run.cjs --snapshot=artifacts/htf-preview --output=artifacts/NEW-SAFE-OUTPUT --feed=artifacts/htf-ohlc --health-dir=artifacts/safe-health` is an offline rehearsal: no SQL writes, source refresh, deployment or publication. It truthfully reports snapshot freshness; stale stock snapshots fail rather than being relabelled fresh.

Only a successful live run can stage `data/generated/site` and cumulative overlays. The workflow commits only those paths and `artifacts/daily-health`. Failed runs commit health only; last good analytic files remain untouched. Git push is non-forcing: a concurrent repo writer causes an explicit failure rather than overwriting the external market JSON. Data staging is not a claim of successful hosting publication.

Hosting is separate (`Publish verified static output`, `.github/workflows/static-hosting.yml`). The existing Azure static upload action only assembles already checked static bytes; no SQL or analytics in hosting. It reacts via workflow_run because pushes made with GITHUB_TOKEN do not trigger further push workflows. Morning analytics contains **no deploy step**. An initial successful live run is required to create `data/generated/site`; hosting fails closed if it is absent. Existing ASP.NET hosting ignores data-only commits.

## Health and frontend

- `artifacts/daily-health/latest.json`
- `artifacts/daily-health/YYYY-MM-DD.json`
- `artifacts/daily-health/history.json` (last 7 daily reports; another run the same day replaces that day's archived summary)

Job Summary includes all phase statuses, errors, counts and AAPL/EURUSD dates. Health files are hosted at their same `/artifacts/daily-health/` paths. The compact top navigation indicator reads these reports, not a successful-page-load assumption; staleAfter is computed by the job (36 hours). It displays stored statuses/counts/history and never builds analytics.

The web reads `/data/manifest.json`, immutable `/data/prices/*.json`, `/data/cot/*.json`, `/data/screener/summary.*.json`, `/data/screener/opportunities.*.json`, `/data/screener/htf-confluence.*.json`, and unchanged V3 tracking JSON. Automatic V1 (all three history choices), V2 raw, V3 relative ranking and HTF outputs are precomputed. Existing interactive chart rendering, manual interval analysis and display sorting/filtering remain client-side; this task does not remove those features or claim the entire frontend contains no calculations. Old snapshots may still use the compatibility V1 evaluator; new morning outputs include its precomputed results.

Rollback: retain/revert the last generated-data commit and its immutable seed/state; never splice legacy Yahoo prices into a TradingView series. A failed health report does not delete the last usable public analytics.
