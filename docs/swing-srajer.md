# Swing Honzy Šrajera — working checklist v1

Source: the user-supplied swing checklist image, not an imported Pine strategy or verified official implementation. Separate tab in Seasonality & COT. No changes to existing FM zones, Work schedules, SQL ingestion or automated trading.

## Automatic candidate geometry

Uses current content-addressed `zonePrices` snapshot and the existing FM classic / medium / full-wick detector. FM detection is an explicit working choice because the screenshot does not define a numeric zone detector. FM freshness and its strict `>25%` wick rule are inherited, not attributed to the screenshot author. Uses completed W1 and D1 only; no EMA or lower-timeframe gate.

Select first eligible fresh armed W1 demand at/below current close and supply at/above close. Of all retained valid D1 zones choose nearest same-side zone wholly inside that W1, with origin no earlier than weekly origin. Do NOT substitute a farther W1 just to obtain a nested D1. A combination is known no earlier than the later of both confirmation times. No backtest/lookahead claims: this is an as-of scanner. Existing input history can be only 104 W1 bars, with ATR(96) warm-up; missing old zones cannot be reconstructed without more history.

## Confirmation and missing data

No futures volume-profile dataset or Trading Analyzer macro integration exists in this tab. Never substitute OANDA tick volume, Yahoo volume, candle-volume ratios or a close-bin estimate for futures POC. Manual fields require source notes. Futures price levels must not be applied to spot/CFD without a documented conversion. COT context can be displayed but is NOT equivalent to all four author checklist requirements; USD neutral reference is NOT a DX confirmation. All four COT checks plus source are required for manual confirmation. Gold/silver/platinum require the author's commercials interpretation, currencies non-commercials.

Macro score range −11…+11 is a working input bound for eleven components, not a reconstructed proprietary score. Signed score must match direction; missing is unknown, zero is not confirmation. No volume, or macro against direction, blocks the checklist. All seven points must be yes for a fully confirmed checklist; this remains a partially manual evaluation, not an execution signal.

Manual reviews use browser localStorage, keyed by methodology, snapshot, symbol/feed, selected zone IDs/bounds, latest close/date and parameters. New snapshot or parameter change does not silently carry review forward. No server sync. Source notes are plain text, never HTML. Review timestamp included in downloadable audit.

## Seasonality

Load historical daily closes ONLY after provider/symbol identity matches zone source and contextCompatible is not false. A missing/unmapped source remains unknown. Five, ten, fifteen completed years separately; default 30-calendar-day horizon from snapshot date, selectable 1–120. Historical anchor/exit allow nearest observation within ±3 calendar days, earlier date wins ties; no observations on/after as-of. Full year counts required. Working confirmation is a strict majority of returns in trade direction in each window. Opposite only when all three full windows fail majority; ties/mixed/unknown are not confirmed. Audit includes actual dates/returns and counts. No cherry-picked best interval and no claim of return probability.

## Draft plan

Entry proximal D1 edge, SL beyond distal edge by selectable buffer (default 5% of D1 height), TP proximal edge of nearest opposite W1 beyond current price. Missing D1/opposite/positive reward means no plan. R:R is gross geometric only; no costs, order constraints or brokerage checks. Plan requires explicit manual brokerage/Fibonacci review. No POC price migration, live orders, position sizing or strategy backtest.

## Tests

`node Tools/swing-srajer-checks.cjs`; browser checks `Tools/swing-srajer-browser-checks.cjs <rendered-site-dir>`; canonical dotnet Release build and actual `--render-static-shell` startup. Existing FM pair tests remain unchanged. Production smoke checks tab, genuine snapshot candidates, both chart layers where available, manual save/audit, and 1440/390/320 layouts.
