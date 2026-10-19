# Strategy laboratory v1 — research pilot, not a live strategy

## Approved amendment

EMA is a completely separate experiment, never a filter in a zone model.
Zone family: D1 → M15 SFP; D1 → nested H4 → M15 SFP; H4 → M15 SFP.
Three models × optional/mandatory BOS × SFP/zone stop × 2R/3R = 24 variants.
Separate H4 EMA pullback: EMA 20/50 or 50/200 × 1.5/2 ATR stop × 2R/3R = 8.
No COT, seasonality or macro in either family. No broker orders or new scheduler.

## Delivered first stage

- Pure shared chronological simulator (`wwwroot/js/strategy-lab.js`) with
  browser-worker execution, plus test/CLI usage. Same rules can later be reused
  for paper signals, but no paper/live activation is implemented now.
- Separate `/strategy-lab/` view: instrument/family, explicit model costs,
  execution lag, all combinations, doubled-cost stress results, individual
  trades and full reproducibility JSON. No "winner" or automatic promotion.
- Provider M15 pilot EURUSD, GBPUSD, USDJPY. Raw exact responses archived under
  local ignored `artifacts/strategy-lab-m15/`, not substituted for production SQL.
  Three provider responses each contain 5,326 bars; `has_more:false`.
  Provider first bar 2026-08-02 21:00 UTC, last start 2026-10-19 08:15 UTC.
- Each admitted M15 group must have exactly 16 consecutive bars with aggregate
  OHLC **exactly equal** to an already accepted same-provider H4 candle. Each
  pair has 5,280 eligible bars through 2026-10-16 21:00 UTC. 46 newer rows per
  pair lack an accepted H4 parent and are excluded. No synthetic candles.
- D1 bars retain the existing accepted provider timestamps/completion evidence.
  Where legacy D1 lacks explicit sessionEnd, use its regular NY17 start +24h;
  builder asserts NY17 on both ends. This is not independent holiday evidence.
- Input source snapshot, M15 raw, engine and detector hashes are recorded.
  Data cutoff is fixed, displayed, and independent of today's wall-clock date.

## Causality and exact experiment definition

`TradeZones.formations` shares the normal detector's formation/BOS/volume rules
but does **not** filter with future lifecycle or current price. It emits only
formation-time fields. Production `detect` behavior remains unchanged.
Replay activates each formation only at its actual source-bar close. D1 close
availability comes from the accepted NY17 session, not local midnight.

Only the first touch of a still-valid zone is eligible, and the M15 SFP must
occur on that same candle. Pivot: strict 2-left/2-right extremum, confirmation
fully available before the SFP bar starts. Swept pivots are consumed. Long
sweeps below the last confirmed low and closes above; short is the inverse.
At least 25% penetration permanently invalidates the zone, INCLUDING the
signal candle and any pending-entry waiting bars. No exemption to rescue trades.
For refinement both parent and child must survive and overlap rules must hold;
the child must be inside the parent and begin no earlier than the parent base.
An earlier parent first touch cannot become a later refined first-touch entry.
Historical zones without complete demonstrable pre-pilot H4 first-touch history
are conservatively excluded. BOS flag applies to the selected entry zone.

One position per instrument per variant, no pyramiding. Other first-touch
opportunities while a position/pending order exists are consumed, not queued.
Default entry is next M15 open **15 minutes after** the signal close (not the
already elapsed immediate open). Zero lag is a separate explicitly idealized
setting, not a promise for a collector that arrives late. Invalid quote/stop
geometry or prior pending-zone invalidation cancels the entry.

Zone stop: chosen SFP extreme or outer zone boundary, plus 0.05 × M15 ATR(14).
EMA signal is H4-only: fast above slow for long, low touches previous fast EMA,
bullish close above current fast; short symmetric. SL is signal H4 close ±
1.5/2 H4 ATR. EMA seeded with first-N SMA; ATR is 14-period SMA of true ranges.
Indicators reset warmup across unexpected gaps; no price filling.

Simulated adverse stop gaps fill at worse open; favorable target gaps are capped
at target. SL/TP both in a candle means SL first. Exit timestamp is the end of
the observed exit candle, not an independently known intrabar execution instant.
Time exit: 480 observed M15 candles. Open-at-end and data-gap positions are
explicitly unresolved and excluded from realized metrics, not made profitable.
Only regular Friday NY17 → Sunday NY17 gaps are accepted as scheduled closure;
other gaps reset signal state and break positions into unresolved evidence.

Costs are model assumptions, not historical bid/ask or a broker fee schedule:
roundtrip spread + roundtrip commission + twice one-side slippage, charged in
price bps and divided by initial stop risk. Financing is bps per calendar day.
Default financing zero is NOT evidence of no financing costs. No equity curve,
leverage, simultaneous cross-pair exposure or account-return claims are made.

## Research gates / still to do

The short M15 sample is insufficient to rank a deployable strategy. Three
preselected pairs are a technical pilot, not all 28 FX. There is no untouched
holdout or calibrated broker cost model. The UI sorts diagnostic mean R only.
`selectionEligible:false` stays explicit even if one variant looks profitable.

Next stages: approved separate M15 SQL admission/backfill with raw hashes,
expanded universe and longer history where the provider permits; coverage and
cost audit; frozen train/validation/holdout and walk-forward protocol; portfolio
risk/currency concentration; only then paper trading on the same signal engine.
An every-four-hour collector is not sufficient for timely M15 signals. Any
new 15-minute collection schedule requires separate setup/verification; the
existing daily/H4 jobs and credentials are not changed by this pilot.

## Verification

`node Tools/strategy-lab-checks.cjs wwwroot/research/strategy-lab-pilot.json`
tests strict mitigation, confirmed pivots, no prior-zone survival bias, gap and
same-bar fill policies, cost accounting, delayed entries, unknown parameters,
family separation, immutable inputs and full-vs-prefix causal replay.

`node Tools/strategy-lab-pilot.cjs <raw-dir> <accepted-static-site> <new-output>`
rebuilds the pilot from locally archived original responses; no SQL access.

Execution assumptions reference: [TradingView strategy emulator documentation](https://www.tradingview.com/pine-script-docs/concepts/strategies/).
Drawdown in this first pilot is the cumulative CLOSED-trade R drawdown, not
mark-to-market account drawdown. Once an entry has occurred, subsequent zone
invalidation cannot retroactively delete the trade; SL/TP/time rules govern it.
# Trade audit chart

The explicit “Obchody” button opens a native modal dialog (never automatically after a calculation). It contains the selected variant's trades or a clear zero-trade state. A trade opens its evidence and chart inside the dialog, with a back-to-list button. Close/Escape dispose the chart and return focus through native dialog behavior; the background is inert. On mobile the dialog fills the viewport; the trade table scrolls inside its own container.

Each variant opens its complete closed-trade list. Each trade opens the exact simulated entry/SL/TP/exit, costs and textual entry evidence from the unchanged engine reference and frozen source candles. The chart uses bundled TradingView Lightweight Charts, not the full TradingView platform. It provides M15/H4/D1, pan/zoom, crosshair OHLC, keyboard controls, trade/context/history framing, two-point ruler and PNG export. Zone/parent boundaries, swept M15 swing, signal, entry, exit, risk and reward are drawn. Separate EMA trades show their causal H4 EMA values only after the H4 close.

Higher-timeframe markers are positioned on their containing candle; the text retains exact UTC times. Exit time is the end of the exit candle, not a claimed intrabar fill timestamp. Risk/target and zones participate in autoscale even when outside the visible candle prices. No backtest rules, fills, data, scheduling or trading activation change.
