# Obchodní zóny — experimental, separate from HTF confluence

User rules: zone first, contextual signals second. Origins and continuation bases
are distinct. BOS requires a close beyond a confirmed swing and is optional.
High source-candle volume is quality, not eligibility. London/NY departure timing
is quality but cannot be inferred from D1 opening timestamps. Context is not a
trade-success probability. Existing HTF detection, ingestion and rankings stay intact.

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

Close-invalidated zones are omitted. Visits and age displayed. W1 excludes incomplete
weeks. Existing truncated OHLC limits coverage; full historical scanning and intraday
session validation are NOT implemented. Refinement only selects a contained same-side
D1 zone whose base lies in the W1 base and is confirmed no later than W1 confirmation.
D1->H4 is unknown without data. Parent boundaries are not rewritten.

This is a read-only browser analysis over existing immutable static snapshots. It
does not add feeds, write SQL, alter scoring, assert validated performance, or execute trades.
