# Nearest FM pair in Obchodní zóny

The tab now calls the same `FmOrderBlocks.run` as Denní výhled. Classic,
medium, ATR RMA(96), body break within 1–3 bars, full high/low, default Pine
caps and pivots. Only retained fresh **and armed** zones are eligible.
No second legacy/base detector, no EMA, no strategy-lab/backtest changes.

`fm-nearest-pair-v1` selects by proximity, not quality or proven trading edge:
for each exact provider instrument and timeframe choose at most one supply and
one demand. Prefer lower percentage price distance, then newer confirmation,
then stable ID. BOS, displacement/ATR, volume, range proxy, COT and seasonality
are descriptive only: a farther better-quality zone cannot displace a nearer
eligible zone. The graph labels both zones with BOS status and displacement.
A dedicated two-row table below the graph describes bounds/origin, distance,
BOS, displacement, source volume, lifecycle and context for both sides, including
explicit missing-side rows. Filters operate after selection, not as fallback
searches. The chart always shows the selected pair independent of table filters;
a missing valid side is reported, never synthesized. Sorting/paging remain.

Lifecycle deliberately changes from the old >=25% rule to Pine's **>25% after
arming**, and close invalidation even before arming. Exact 25% remains fresh.
W1 now uses W1 lifecycle, not the old D1 intrabar invalidation. D1/W1 retain the
existing completed, date-labelled source snapshot. UTC day/week ends are axis
conventions, not independently verified exchange session close timestamps.
H4 retains existing provider-boundary admission. No new data sources or SQL writes.
The original H4 pilot's provider bars and audit evidence remain unchanged;
its generated engine hash is refreshed for the timeframe input extension.

Charts include both bands in autoscale/reset and all four right-axis prices,
manual drawing tools and seasonal interval when available. If only one side is
available only that band is drawn. No live data, entry, SL/TP or order is invented.
