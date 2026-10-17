# Daily session completion and WTI display dates

## Yahoo stocks / ETFs

`DailyPriceImport.YahooCompleted` accepts today's exchange-local daily bar only
when Yahoo `meta.currentTradingPeriod.regular` identifies that same session date,
its start/end range is valid (at most 24 hours), and the observed time is at least
15 minutes after its explicit end. This handles provider-specified early closes
and DST without assuming a fixed US close. Future bars remain excluded. Missing,
future or mismatched metadata retains the previous-day-only fallback. Existing
same-source prices remain revisable; no provider splicing is enabled.

The existing 03:00 Europe/Prague collection need not move to 05:00 for this fix.
Waiting for NY calendar midnight was the bug; 05:00 Prague is often still 23:00
in NY. An exchange session boundary, not an arbitrary later cron, determines
admission. This patch changes no schedules and starts no market collection.

## WTI: two separate date concepts

Source: NYMEX:CL1! via TradingView, not Yahoo CL=F. The immutable series uses the
provider's UTC timestamp date. A regular 17:00 America/Chicago start belongs to
the following calendar session day. Presentation helpers expose BOTH dates for
normal Sunday–Thursday starts, with a stated derivation and holiday caveat.
Missing/off-cutoff timestamps do not get guessed dates. This is display metadata,
not a new completion proof or a verified holiday calendar/trade-date assignment.

The chart axis, bar.date, weekly grouping, historical hashes, ingestion IDs,
seasonality and COT calculations are unchanged. Historical report dates are not
rewritten. New Data reports include lastSessionDate and its derivation; older
reports explicitly show that this extra field was not recorded.

Checks: `dotnet run --project Tools/PriceImportChecks -c Release`,
`node Tools/market-date-checks.cjs`, morning-health and zone browser regressions.
