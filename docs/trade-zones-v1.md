# Obchodní zóny — experimental

HTF shoda was retired on 2026-10-14 at the user's request. The dedicated
zonePrices snapshot contains OHLC only; old detection/matching results, tab,
scripts, tests and CSS were removed. Shared candles and chart now belong to
Obchodní zóny; the historical COT context formula remains unchanged.

User rules: zone first, contextual signals second. Origins and continuation bases
are distinct. BOS requires a close beyond a confirmed swing and is optional.
High source-candle volume is quality, not eligibility. London/NY departure timing
is quality but cannot be inferred from D1 opening timestamps. Context is not a
trade-success probability. Ingestion and seasonal rankings stay intact; only the
new zone-first detector remains active.

Provisional exposed parameters: ATR(14); departure close >=1.5 ATR beyond full
zone range within three bars; full wick bounds by default; body-to-outer-wick is
optional. Small bases have <=3 bars, <=1 ATR range and bodies <=half bar range.
Origin is one opposite candle immediately before directional departure. No BOS
filter by default. Strict 2+2 pivots must be known before the base. Only departure
closes qualify as BOS. Future bars do not manufacture the reference swing.

Volume uses average of 1–3 source/preceding bars versus median of 20 preceding
non-overlapping bars, >=1.5x default. Unknown/zero/partial volume is unknown, never
filled. W1 volume requires full available D1 coverage and exact OHLC alignment.
Provider volume is explicitly distinguished from centrally traded volume in FX.

Prototype quality weights (not calibrated): BOS 2, high volume 1, session 1.
Session is currently unknown and never scores. Report evidence coverage separately,
do not renormalize missing fields into 100%. Macro is unintegrated. Context comes
from the same-date existing opportunities snapshot and never gates zone existence.
Nearest active/upcoming interval within 30 days is selected without maximizing its
score. Historical rates describe seasonal periods, not trades entered in zones.
The chart shades that same contextual interval using the existing HTF renderer:
green for seasonal up, red for seasonal down, including counter-zone direction.
No context means no seasonal window. Refinement preserves the parent's context.

Version `trade-zones-v2-experimental` invalidates a zone permanently on its first
post-confirmation penetration of >=25% of its height, including a wick. Demand is
measured down from the upper boundary; supply up from the lower boundary. The deepest
single penetration counts, not the sum of separate shallow visits. Formation and
confirmation bars are excluded. Both D1 and W1 zones are checked against completed
D1 highs/lows, not just weekly closes; the current unfinished day remains excluded.
CADJPY demand 110.604–111.401 from 2025-12-04, confirmed 2025-12-09, is invalidated
by the 2026-08-03 wick. Invalid zones are omitted; valid zones show deepest penetration.
Visits and age are displayed. W1 excludes incomplete
weeks. Existing truncated OHLC limits coverage; full historical scanning and intraday
session validation are NOT implemented. Refinement only selects a contained same-side
D1 zone whose base lies in the W1 base and is confirmed no later than W1 confirmation.
D1->H4 is unknown without data. Parent boundaries are not rewritten.

Detail buttons open the same pair in Seasonality (exact contextual start/end dates,
last 20 completed years, reset unrelated year filters) or COT. No seasonal context
means no seasonal navigation. Year-crossing windows are explicitly disabled because
the existing within-year curve must not silently invert them. Unsupported instruments
are never replaced with another pair. Returning to zones retains the selection.

Core and research/review candidates are separated by an explicit scope selector;
default is core, research never enters its list. Neither list is validated performance.
This is a read-only browser analysis over existing immutable static snapshots. It
deduplicates per source instrument + timeframe + side + exact bounds + confirmation.
Origin and base classifications share one physical zone, including refinement lists.
Both type filters include it. Prefer origin evidence, otherwise latest/shortest base;
do not sum scores or combine strongest components from competing detections.
Distinct bounds, sides, confirmations and timeframes remain separate, not rounded.
The analysis
does not add feeds, write SQL, alter scoring, assert validated performance, or execute trades.
