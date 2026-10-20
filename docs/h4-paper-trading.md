# Prospective H4 papertrading

Model `fm-h4-touch-2r-v1`, entirely separate from the W1/D1 Srajer checklist and Strategy Lab backtests. Public read-only dashboard `/paper-trading/`. No broker connectivity, orders, money positions or credentials in the browser.

## Frozen admission

Current OANDA H4 SQL sidecars, FM classic medium full-range nearest fresh armed supply/demand. Initial admission requires last completed candle no older than 6 hours, price outside entry zone (a marketable limit at registration is not a prospective first touch), valid positive 2R geometry. Long entry at demand upper edge, short entry supply lower edge, SL 5% of zone height beyond distal edge. Buffer is a working assumption announced to the user, not a broker price-step rule. No macro, COT, POC or volume-profile gate in this direct-touch model.

Each identical zone/feed/model/config receives a stable SHA256 identity, never re-admitted after resolution/cancellation. Freeze source hash, source path, source revision, provider symbol, bounds, origin/confirmation, quality evidence, initial cursor, registration clock, all entry/SL/TP/cost parameters. A newer nearest zone cannot rewrite an existing scenario. At most one open trade per instrument; opposite pending scenarios OCO. No automatic expiry in v1.

## Chronological processing, not hindsight

Only newly supplied **closed** H4 are processed, ascending. All bars observed before initial registration merely seed the model. Late-delivered pre-registration touches cancel without a trade. A touch in the already-running registration candle is ambiguous because its timing relative to registration is unknown. State times of fill/exit refer to proof candle end; exact execution time is not known.

OCO both entries on same H4, SL+TP same H4, entry+TP whose order is not proven by open/close, or a gap through entry and SL: ambiguous, excluded from win/loss/net-R statistics. Limit fill uses planned price, no positive improvement; ignores queues/partials. Existing open trade gap beyond SL fills on worse open. TP no favorable improvement. If entry and only SL are crossed within an otherwise continuous candle, model accepts entry then SL. These are OHLC simulation assumptions, not broker fills.

Missing cursor, non-weekend gap, future candle, changed latest previously processed OHLC: no invented outcome. Gaps can resume only after complete chronological history is supplied; explicit prior-bar revision requires review. Routine Friday 13:00 NY to Sunday 17:00 NY is allowed, including DST offset changes; not a full exchange holiday calendar. Missing source surfaces as diagnostics. Closed outcomes/events stay frozen even if old prices later change.

Gross TP=2R; gap losses may be below −1R. Working costs: spread 1bp + slippage 0.5bp each side, commission 0; financing is not modeled (null, not claimed free). Closed-only drawdown, losses before gains at equal proof timestamp; no mark-to-market, position sizing, margin, tick/minimum-distance or carry model. Ambiguous/cancelled/needs-data are not zero-R trades or wins/losses.

## Persistence and automation

Existing serialized static-publication workflow reads durable SQL `paper_h4.State` and appends `paper_h4.Events`. The new schema is created **only** by an explicit CLI `--ensure-schema`, never by a public request or ordinary web startup. No alterations to canonical candles, ingestion, schedules, or other SQL tables. Node evaluator runs after H4/CFD overlays; C# save verifies expected SQL revision under serializable lock, frozen setup identities, event SHA256/sequence/prefix, terminal outcomes. New event rows and head commit in one transaction. SQL failure must fail publication, not initialize an empty fallback. A retry loads current SQL; no double-fills.

Uses the existing secret `SEASONALITY_CONNECTION_STRING` through process environment `SEASONALITY_H4_SQL_CONNECTION`. No new secret or auth scope. Browser cannot create/alter/cancel setups; no public write endpoint. Ledger snapshot is a public model audit with same visibility as price/zone app, published no-store under `/data/h4-paper/ledger.json`. Includes model source data, no private user submissions or credentials.

Automatic checks are triggered by publication following actual accepted H4 additions (and ordinary D1/manual deployment); they do not require a browser. Work/pipeline failures cause lag. The dashboard separately shows last run, per-record last candle and source snapshot, never equates a page refresh with a new ingestion. Repeated no-new-bars refresh is idempotent. Initial deployment registers pending setups; it is not a retrospective backtest.

Tests: `node Tools/h4-paper-checks.cjs [rendered-root]`; C# `PaperTradeStore --validate fixture [--previous fixture]`; `Tools/h4-paper-browser-checks.cjs`; existing FM/framing checks. Test fixtures never get saved to production SQL. Real SQL acceptance is verified from the deployed ledger and its stable revision/hash.
