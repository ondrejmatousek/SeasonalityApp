# Daily JSON ingestion — manual test only

## Scope and storage

Manual command: `node Tools/market-daily-ingest.cjs`. Default input: `data/market-daily/latest.json`. Registry: `artifacts/tradingview-backfill-36-v1/test-source-registry.json`.

No endpoint, schedule, workflow, production routing, SQL, web deployment or analytics rebuild is added. Existing backfill files remain immutable. New bars are appended in `artifacts/tradingview-backfill-36-v1/daily-ingestion/<SYMBOL>.json` with **the same canonicalTestId, provider, providerSymbol and sourceIdentity**. `loadSeries(root, entry, overlay)` exposes historical + daily rows together for future isolated consumers; nothing in production calls it.

The default ingestion enablement is 24 strict-clean FX + NDX (25 identities). `--include-review` explicitly enables the remaining conditional/test/research identities **only for private storage**, never for production ranking. EURAUD, NZDCHF, CADJPY and CADCHF remain conditional. SPX has an explicit overlay HTF policy prohibiting use of the old close-only segment; no HTF consumer or historical range is activated here. XAUUSD, XAGUSD, WTI, BRENT, NATGAS and COPPER remain research-test.

## Input contract and mapping

The actual repository JSON has `schemaVersion: 1`, `timeframe: "1D"`, `fetchedAt` (ISO timestamp with timezone) and `bars`. Each bar supplies symbol, providerSymbol, provider, assetClass, date, Unix-seconds timestamp, numeric open/high/low/close, timeframe and `status: "ok"`.

Explicit aliases: NASDAQ100 → NDX, SP500 → SPX, NATURALGAS → NATGAS. `SP` provider maps to the backfill's `S&P` label **only for SPX with exact SP:SPX providerSymbol**: these are two names for the same TradingView namespace, not different feeds. Absent sourceIdentity is resolved from the registry after validating provider + providerSymbol + instrument; an explicitly supplied conflicting identity fails. No fuzzy matching or provider fallback.

Validation includes schema/timeframe, envelope timestamp, logical symbol, provider, providerSymbol, optional assetClass/sourceIdentity, Unix seconds, date consistency, finite/nonzero OHLC and strict inequalities. No rounding correction. Negative prices are permitted only for commodity futures, matching the backfill's treatment of historical negative WTI prices.

Completion:

- FX use timestamp-derived America/New_York 17:00 start/end, with timezone DST, and require that session end has elapsed by both fetchedAt and ingestion time. Incoming date must match the derived end date. Status ok alone cannot admit an open session.
- Metals use the same end-date/cutoff checks but retain their review scope and exceptional-start labels.
- Already stored index/futures timestamps can use the backfill's observed-later-bar completion evidence. This does not override conflicting OHLC.
- **A new index/futures bar without explicit sessionEnd completion evidence fails closed.** The current JSON dialect is sufficient for existing duplicate bars but must carry that evidence before new non-FX sessions can be appended. A declared sessionEnd must be later than the bar start and no later than fetchedAt/current time; completion evidence is stored rather than silently labelling this NY17.
- `completed: false`, non-ok status, future timestamps and date inconsistencies are rejected.

## Idempotency, conflicts and evidence

Key: sourceIdentity + canonical instrument + 1D + provider timestamp. Exact OHLC equality at an existing timestamp is a no-op; no epsilon, price repair or silent revision. Different OHLC fails the **whole instrument**, with existing/incoming values and timestamp in its run log. Other instruments may succeed independently. Incoming duplicate timestamps, colliding dates, historical quarantine timestamps and attempts to insert new rows before the existing tail fail. This is daily append ingestion, not historical hole repair.

An exclusive directory lock prevents simultaneous writers. Per-instrument overlay writes use temporary-file + rename. A stale lock fails closed rather than being auto-deleted. The overlay records the immutable history SHA-256, checked on subsequent loads. Input bytes are preserved by SHA-256 under `daily-ingestion/evidence/`; every run produces a separate JSON audit under `daily-ingestion/runs/`. Exact duplicate bars do not modify price-series files.

## One real manual run — 2026-10-12

Fetched `origin/master` without merging/resetting the dirty working tree. Git's default TLS backend failed issuer verification; the successful retry used the Windows certificate store (`http.sslBackend=schannel`), **not disabled certificate validation**. Only the requested JSON was materialized in the working tree using apply_patch.

- Source commit: `249ce0354dd05b190eae21f2a9fd461df8872f18`.
- Git blob SHA-1 (remote and local match): `08e7539edcd5280e609fec45b0a6b9444598118e`.
- Input SHA-256: `0d69c291e9dbc61c754d0ec79eff8d996086f91d73733b86e0500983f2cd1561`.
- Input fetchedAt: `2026-10-12T16:08:31.353Z`.
- Command executed exactly once against the real input: `node Tools/market-daily-ingest.cjs`.
- Run ID: `16907524-3f96-4ef0-bccf-d7b0cce52bc1`.
- Audit: `artifacts/tradingview-backfill-36-v1/daily-ingestion/runs/16907524-3f96-4ef0-bccf-d7b0cce52bc1.json`.

| Outcome | Bars |
|---|---:|
| Received | 36 |
| Inserted | 0 |
| Exact duplicate / idempotent | 25 |
| Failed | 0 |
| Supported but outside first enabled test | 11 |

No failed symbols. Disabled symbols: EURAUD, NZDCHF, CADJPY, CADCHF, SPX, XAUUSD, XAGUSD, WTI, BRENT, NATGAS, COPPER. They were mapped/validated but not committed in this initial 25-identity run. They are not counted as failures or idempotent commits. No second real run with --include-review was performed.

EURUSD maps to `OANDA_TRADINGVIEW:EURUSD:D1:backfill-test-v1`. Input timestamp 1791493200 is **exactly the existing last backfill bar**, NY17 end date 2026-10-09, OHLC 1.12144 / 1.12428 / 1.11876 / 1.12015. Its tail stayed unchanged. Therefore the real run proves mapping and duplicate/no-overwrite behaviour, **not an append after history**. No provider splice or production change occurred.

## Verification

- `node Tools/market-daily-ingest-checks.cjs`: passed isolated synthetic tests for append, unchanged idempotent series, OHLC conflict, instrument transaction isolation, provider-splice rejection, NY17 DST, schema versions, alias mapping, conditional/research gating and SPX restriction. All fixture histories remain byte-identical to the original backfill. These tests are not presented as real daily-feed appends.
- `node Tools/tradingview-backfill-checks.cjs artifacts/tradingview-backfill-36-v1`: passed; 274077 historical records remain exact.
- `dotnet build SeasonalityApp.slnx -c Release --no-restore`: passed, zero errors/warnings.
- Skill verify-build-run: existing isolated OANDA preview started through the static server and passed real headless-browser HTF checks, tab switching, chart, tooltip, filters, mobile and unchanged scores. This is a startup regression check, not a rebuild over the new daily store.

## Recommended next step — not executed

After the next completed NY17 session, provide a fresh latest.json and authorize one more manual run for the same 25 identities to demonstrate a real append. For new NDX/SPX/futures bars, first add explicit completed-session end evidence to the producer; do not guess exchange completion from status ok. Only after successful real append/conflict verification decide whether to connect the merged test view to an isolated seasonality/HTF preview. No production activation or 06:00 scheduling is recommended automatically by this run.
