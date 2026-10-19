# FM H4 Pine port — isolated research implementation

Source: user-supplied `market-structure-order-blocks-fm.pine`, SHA256 `70a1e979dd7480787f17849b30cc67524198d9d08d89974948083c408e9d4489`. The earlier Work export is preserved verbatim separately. Source comments/instructions are documentation, never executed host commands. No original TradingView script/chart was modified.

## Scope and exact source behavior

`wwwroot/js/fm-order-blocks.js` is a pure closed-bar H4 state machine, independent of `TradeZones` and the strategy laboratory. Defaults match Pine inputs: classic, medium 1.5 ATR96 RMA, body break, full high–low, impulseBars3, strict OB pivots5/5, main20/20/internal5/5, mitigation25, lookback10000, freshCap50, maxMitKeep10, maxPerSide5. It does not implement MTF `request.security` tables, shadows, UI object limits, alerts, broker orders or runtime Pine execution.

- True range includes previous close and uses high–low on the first loaded bar; ATR RMA seeds with the first N true ranges. The displacement gate uses **confirmation-bar ATR**, not base ATR.
- New opposing classic candidates replace prior candidates **before** confirmation; non-opposing bars increment age, including dojis. A confirming candle need not itself be bullish/bearish; source only tests close vs reference, displacement and optional strict swing.
- OB strict mode tests close beyond the latest confirmed 5/5 pivot; it does not require a new MS BOS event. Swing pivots confirmed on the current bar are available for the close test on that same bar. Main structure preserves the exact trend/bias/one-shot level state machine, including first-event BOS and neutral states after CHoCH.
- Series/CISD source is now available: series bounds use the selected full/body extrema; level uses extreme-open or first-open. Dojis neither extend nor reset a directional series. A new completed series replaces a pending level. Pending levels have no three-bar expiry; classic ATR/strict BOS never filter series. `both` retains overlapping classic/series as separate detections, as Pine does.
- New zones undergo lifecycle update **on the confirmation candle**, so they can arm immediately if fully departed. Before armed a deep wick alone does not remove freshness. Close outside removes it even before armed. After armed the tracked deepest wick must be **strictly greater than** mitigation percentage. No epsilon is added at this boundary. Exact25% is not mitigated.
- Lifecycle stops after first freshness loss, as source `if ob.fresh` does. Audit differentiates close-invalidated and wick-mitigated at that first bar; it does not invent later state updates.
- Pruning computes fresh/mitigated excess counts **before** lookback/hide filters and then drops in insertion order, like Pine. Lookback is measured from origin index, not days. Nearest-five visibility is per side and uses strict distance ranking; equal-distance ties can produce more than five visible boxes. It is not quality scoring.
- Formation records are immutable causal evidence, separate from final retained states and final visibility. State/trace comparisons rerun historical prefixes and never select only today's survivors.

## Explicit limits / remaining parity work

`pineParityVerified:false`, `researchOnly:true`, `tradeSignals:false`, `entryModel:null` are hard-coded. Equal-value pivot handling uses rightmost-equal extremes; native TradingView output must still verify this and numerical rounding. Source-history first bar affects ATR initialization, structure and caps, even with the same later candles. Default inputs are not proof of actual saved user overrides.

Work's general range-breakout algorithm, qualitative liquidity/session/volume scoring and ranking are not defined by this Pine and are not invented. Source-code lookback/CISD details supersede earlier statements that those inputs were unspecified, but do not add a range detector. Entry/SL/TP/M15/M5 remain outside scope. No existing >=25% invalidation rule is changed.

## Frozen data and first diagnostic comparison

Four real read-only TradingView captures were archived locally under ignored `artifacts/daily-outlook-rules/` for OANDA:EURUSD, OANDA:XAUUSD, CME_MINI:NQZ2026 and BYBIT:BTCUSDT.P. The metadata records archival time 2026-10-19T19:45:51Z, not an independent exchange completion attestation. Each provider last/forming bar is excluded. Remaining bars use nominal four-hour end or an earlier adjacent provider start. No invented bars, provider mixing, contract rolls or SQL price imports. RTH/calendar completeness and NQ expiry identity are not independently validated. Source notices/hashes, full loaded-history start and completion assumptions accompany the pilot.

1199 closed-by-policy rows each for EURUSD/XAUUSD/BYBIT;719 for NQ. `Tools/fm-outlook-pilot.cjs` produces a new immutable research artifact and normalized `/research/fm-outlook-pilot.json`; it refuses to overwrite an existing artifact. Current UI is **not** a scheduled daily report and does not update itself every four hours.

Reference A: XAUUSD source candle 2026-09-25T09:00Z exactly matches 4289.610–4315.795. Default port produces 2.319808563647659 ATR, rounding to the Work's2.32. Confirmation candle **starts**2026-09-27T21:00Z and **closes**2026-09-28T01:00Z; zone information is known only at close. This is a diagnostic match, not a qualified full parity test: original exact as-of, OHLC hash/history start and confirmation timestamp semantics are absent.

Reference B is BITSTAMP:BTCUSD, not current BYBIT:BTCUSDT.P; its levels are never copied. Reference C is a range-breakout label unsupported by this source. Both are reported **not comparable**, never counted as misses or matches of the classic detector. No strategy winner/profitability inference is made.

## Reproduction and native Pine comparison

`node Tools/fm-order-blocks-checks.cjs wwwroot/research/fm-outlook-pilot.json` tests source order, current ATR, dojis, classic/series isolation, exact mitigation boundary, close invalidation, caps, pivots, main structure and all four real-data prefixes.

`node Tools/fm-outlook-browser-checks.cjs artifacts/cfd-zones-preview` runs the actual rendered page over HTTP, compares complete browser/CLI state, opens XAU evidence/markers and tests mobile charts. Existing zone and lab browser regressions remain required.

`node Tools/fm-pine-parity.cjs instrument docs/research/market-structure-order-blocks-fm.pine artifacts/daily-outlook-rules/fm-tradingview-audit.pine` creates a **new copy** with data-window plots appended; original logic/defaults remain byte-for-byte above them. Nothing is installed into TradingView. CSV from that copy on H4 with matching inputs can be compared:

`node Tools/fm-pine-parity.cjs compare TradingView.csv wwwroot/research/fm-outlook-pilot.json OANDA:XAUUSD`

Comparator requires exact provider symbol selection, identical history length/first bar/timestamps/OHLC, and explicit-offset or Unix timestamps; a different loaded history cannot be silently accepted. Native CSV plot columns `FM_AUDIT_*` compare ATR, pivots, structure, new classic/series bands and retained/fresh counts. Numerical absolute tolerance1e-8 is declared; event/state counts are exact. Synthetic CSV unit tests only validate comparator plumbing, never claim TradingView runtime parity. Original provider data and native Pine CSV must be preserved for an actual qualified run.

## Operational isolation

Route `/daily-outlook/` is a distinct research view. Prior unshipped import prototype is recoverable at local branch `codex/daily-outlook-import-archive` commit `a9479ab`; it is not deployed or merged here. Its empty additive `trading_outlook.Reports` SQL table already exists but this research implementation neither reads nor writes it. No MCP permission, daily/H4 schedule or Work09:30 task is changed.
