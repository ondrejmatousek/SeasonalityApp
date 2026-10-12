# Asset-class market routing and morning rebuild

## Implemented locally; no scheduling or deployment performed

The existing Yahoo stock/ETF updater remains the stock ingestion path. Its universe and price parsing were not changed. It now skips FX, cash indices and commodity catalog entries: none of those are refreshed through Yahoo/Stooq SQL. Existing legacy rows are retained for rollback, not consumed for routed market analysis.

`MarketPriceSources` is the application's read-only market price router. Both `SeasonalityService.LoadCachedPricesAsync` and `StaticSiteExporter` use its market files, rather than market SQL rows. Stock/ETF reads still query the existing SQL prices; no stock rows are inserted, rewritten or migrated by this change. Unregistered cash indices/commodities are explicitly unavailable, not silently fed from Yahoo. The 526-entry catalog remains intact.

## Source verification

| Instrument | Historical analytical source | Daily source | Identity / restrictions |
|---|---|---|---|
| AAPL | Existing Yahoo stock history in SQL | Existing Yahoo --update-once → SQL → fresh read-only export | No TradingView routing; stock parsing unchanged |
| EURUSD | validated-v2/series/EURUSD.json | market-daily/latest.json → daily-ingestion/EURUSD.json | OANDA / OANDA:EURUSD / OANDA_TRADINGVIEW:EURUSD:D1:backfill-test-v1 |
| NDX | validated-v2/series/NDX.json | Same daily JSON and same-series overlay | NASDAQ / NASDAQ:NDX / NASDAQ_TRADINGVIEW; cash index, not CFD |
| SPX | validated-v2/series/SPX.json | Same daily JSON and same-series overlay | S&P (TradingView namespace SP) / SP:SPX / SP_TRADINGVIEW; HTF from 1962-01-01 only |
| XAUUSD | validated-v2/series/XAUUSD.json | Same daily JSON and same-series overlay | OANDA / OANDA:XAUUSD / OANDA_TRADINGVIEW; review/research retained |
| WTI | validated-v2/series/WTI.json | Same daily JSON and same-series overlay | NYMEX / NYMEX:CL1! / NYMEX_TRADINGVIEW; continuous futures, research/review retained |

All 28 FX pairs route to OANDA. XAGUSD is explicitly mapped to the existing app catalog key **SILVER** without changing its underlying source ID or providerSymbol. Brent uses ICEEUR:BRN1!, Natural Gas NYMEX:NG1!, Copper COMEX:HG1!. No CFD substitutes. QQQ and SPY remain Yahoo ETF series, not cash-index/futures proxies. NQ/MNQ still inherit NDX; ES/MES inherit SPX.

The exact backfill remains immutable. `prepare-market-sources.cjs` uses the existing ingestion implementation with all 36 identities enabled for storage, keeps instrument-level failures independent, and materializes a hashed `analytics-sources-v1` bundle. Its manifest and per-series files carry provenance, source ID, historical SHA-256, daily audit status and limitations. Metals' sparse pre-1970 records are not presented as daily analytical OHLC; the full raw history remains in validated-v2. SPX's close-only prehistory is excluded from HTF. Continuous construction and negative WTI limitations are retained, not "fixed" to improve a score.

Seasonality close arrays and HTF arrays derive from the **same combined series**. HTF uses valid completed modern OHLC and a 1500-bar detection/warmup window; the existing D1/W1 formulas and max-age rules are unchanged. WTI's original negative historical prices remain evidence and retain the model's existing limitations; no price repair or synthetic bars.

## Manual commands

Prepare ingestion/routing only:

```text
node Tools/prepare-market-sources.cjs
```

One morning analytical command, consuming the fresh stock/COT SQL snapshot after the existing stock refresh:

```text
node Tools/morning-analytics.cjs --output=artifacts/morning-YYYY-MM-DD
```

This runs market ingestion, prepares the router, performs **read-only** SQL export for stock/ETF/COT context, builds seasonal screener metrics, discovers intervals, rebuilds unchanged V1/V2/V3 scoring/ranking, and builds routed HTF structure/confluence. No SQL mutation, source download, scheduling or hosting deployment is initiated by this command. ETF HTF inputs can be supplied by the existing fetch-htf-ohlc script, now limited to QQQ/SPY; FX/NDX/SPX are never fetched from Yahoo there.

`--snapshot=<existing static export>` is an explicit offline rehearsal. It does not claim to fetch current stock prices. `--prepared` is for a job that already performed the ingestion stage once. The workflow continues to run the existing stock update before export; export uses fresh AsNoTracking SQL reads, not an old derived summary. The --reuse_snapshot mode still means old stock/COT snapshot by choice.

## Existing workflow integration and persistence

The current stock updater job and COT updater job remain in place. The export stage restores `tradingview-price-state-v1`, ingests the daily JSON, exports read-only stock/COT data, and invokes the shared morning command before its existing checks/tracking/publication. The existing schedule **15 5 * * *** is byte-for-byte unchanged; no 06:00 cron or external Work task was created/modified.

The cumulative state artifact contains the test registry, immutable validated series and daily overlay/evidence/run logs. This is essential: a fresh runner must not lose yesterday's appended bars. App Service publication also restores/prepares the bundle, and the project explicitly includes the materialized read-only bundle in publish output. Raw backfill is not packaged into the public static frontend.

**GitHub prerequisite not fulfilled by this local task:** the historical dataset is ignored under artifacts/, not present in checkout. Before the first remote run a real seed artifact named `tradingview-price-state-v1` must be provisioned through an approved bootstrap. This task did not upload data, run GitHub Actions, push commits or deploy. The workflows deliberately stop if that state is missing. No implicit Yahoo fallback or fabricated empty history.

## Completion evidence prerequisite

The existing ingestion's strict completion logic is preserved. NY17 FX/metal completion is derived with America/New_York DST and checked against fetchedAt/current time. Existing index/futures timestamps can reuse the backfill's proven later-bar completion evidence.

**The present daily JSON lacks sessionEnd for a new index/futures bar.** Those new bars will fail closed until the external producer provides verified `sessionEnd` (ISO with timezone) and completed/ok status. This task did not infer a futures close from UTC date or loosen validation. Current JSON is sufficient for the tested duplicate timestamps; a future all-asset unattended append is not claimed as verified. Updating this producer evidence is required before asserting all-asset daily readiness.

## Actual local verification, 2026-10-12

Executed morning command with `--snapshot=artifacts/htf-preview --output=artifacts/morning-market-routing-v1 --feed=artifacts/htf-ohlc`. This is an isolated full-catalog rehearsal, not a fresh SQL stock run or production update.

- Daily ingestion: **0 inserted, 36 exact duplicates, 0 failed**. Current JSON still contains 2026-10-09 backfill-tail bars.
- EURUSD: 6346 analytical rows, OANDA:EURUSD; source filename/ID matches HTF, no legacy Yahoo path.
- NDX: 10504 rows, NASDAQ:NDX.
- SPX: 25333 seasonality rows, SP:SPX; HTF prehistory guard verified.
- XAUUSD: 12472 analytical rows after sparse-prehistory boundary, OANDA:XAUUSD; research only.
- WTI: 10943 rows, NYMEX:CL1!; provider UTC-start date labels match the backfill (last label Oct 8 corresponds to the completed Friday session); research only.
- AAPL: 11549 rows, last date 2026-10-09, original stock price file byte-identical and used by newly rebuilt metrics.
- 526 catalog entries, 103 core/research analysis entries, 114 seasonal windows, 38 HTF price identities, 47 confluence matches. Unsupported non-stock markets retain empty/unavailable analytical arrays, not Yahoo.
- All stock/ETF input files remained byte-identical to the input snapshot. A controlled unit-level stock price revision changes next metrics, proving builders use supplied prices rather than cached summary. All 62 COT contract files remained byte-identical; no COT formulas or weights changed.
- Actual C# service routing checks passed for EURUSD, NDX, SPX, XAUUSD and WTI without HTTP/SQL fallback; AAPL/QQQ remain on their SQL stock/ETF path.
- Ingestion, core registry, V1/V2/V3, historical COT, HTF, raw curve parity and static snapshot checks passed.
- Release build passed: zero errors/warnings. PriceImportChecks passed with NU1900 vulnerability-feed network warnings; no dependencies were weakened or changed.
- Skill verify-build-run: actual new static application preview started on localhost and passed browser chart/tooltip/tab/filter/mobile checks. No fake database was introduced and no production SQL startup/update was attempted.

`artifacts/morning-market-routing-v1/morning-analytics-report.json` contains representative provenance and actual exported paths.

## Stock adjustment caveat

Stock ingestion was deliberately not redesigned: the existing parser consumes Yahoo's quote.close field rather than explicitly selecting the separate adjclose field. This task preserves that policy and verifies routing/recalculation, **not** a dividend-adjusted total-return claim. No stock adjustment correction or corporate-action reimport was performed. A live successful GitHub stock run was not triggered; its dependency/read path was checked in code and the stock-input consumption was verified offline.

## Next steps, not executed

Provision the immutable historical seed/cumulative state for remote jobs; add verified completion evidence to the external index/futures JSON producer; then perform one fresh-session morning run and verify genuine append. Only after those gates and a fresh stock SQL export should remote deployment be approved. No additional scoring, universe or unrelated refactor is needed for those steps.
