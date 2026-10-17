# H4 zone-only SQL sidecar

Source: the private OANDA H4 SQL captures in `market_h4`, not a new provider call.
Raw archival rows remain PendingSessionValidation. A separate ZoneValidation
record authorizes the explicitly verified subset for zones, NOT all raw rows.

`Tools/h4-zone-snapshot.cjs` requires six consecutive elapsed 4h slots, anchored
to the existing accepted OANDA NY17 D1 start. Aggregated open/high/low/close must
equal that same D1 session exactly, and D1 completion evidence must exist.
Incomplete sessions and mismatches are excluded, never filled or rounded.
The rule does not claim an independently complete exchange holiday calendar.

Initial backfill: 165,326 stored bars; 165,312 accepted and 14 excluded across
28 pairs. SQL records the deterministic report and its hash; every static build
revalidates both the original raw SHA and D1 parity before using the evidence.
The exported zone chart keeps the latest 2,200 accepted bars per pair (enough
for the current 365-day zone age plus initialization). Full history stays in SQL.

H4 carries full UTC start/end timestamps. BOS remains close-only; confirmation
is the END of the departure candle. The very next bar, whose START equals that
confirmation end, is a valid retest and can invalidate at 25% penetration. Gaps
between formation/departure bars cannot manufacture an H4 impulse. The source
volume quality rule is unchanged; FX volume is not centralized traded volume.
London/NY impulse timing and macro remain unknown, not extra quality points.

Closed D1 sessions starting AFTER H4 confirmation also check later wick hits,
so an absent H4 session cannot silently preserve an already mitigated zone.
Daily ranges containing pre-confirmation action are never used for this fallback.
The historical whole-D1 parity gate is NOT an intraday incremental admission
policy: future 4-hour ingestion still needs independent session/completion proof.

H4 has its own filter and timestamp-based chart. Seasonal/COT context is still
the existing daily context. D1/W1 price inputs, chart date keys, weekly grouping,
seasonality/COT calculations and daily SQL provenance are not modified. Automatic
in-nested D1→H4 refinement is not implemented by this change; H4 zones are separate.

Static hosting exports raw SQL captures into PRIVATE Actions staging only, then
overlays the validated H4 subset onto the zone snapshot. Raw capture texts and
credentials are not public assets. No full market analytics job is needed for
this overlay. No new Work task, provider request, OAuth flow or schedule is made.
The captured H4 history is not a promise of automatic 4-hour freshness.

Checks: h4-zone-checks (session and lifecycle fixtures), h4-zone-snapshot-checks
(real SQL-backed snapshot, immutable D1/W1/context), trade-zones-browser-checks
(real UTC chart/filter/tooltips and desktop/mobile), H4SqlImport --self-test-localdb
(isolated real SQL schema/bulk insert/conflicts/rollback/eligibility evidence).
