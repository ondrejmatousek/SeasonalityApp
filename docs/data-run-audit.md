# D1 / H4 operational audit

`/runs/` keeps separate D1 and H4 tabs, each with its own selected record and
eight-record page. D1 combines existing daily analytics reports (one per day,
current 30-day export) with additional D1 SQL receipts. H4 shows receipts from
both the original FX ingestion and the additional CFD ingestion. Receipts are
not merged by date: one Work execution may submit multiple batches.

The static web reads `GET /api/data-runs/receipts` from the existing backend.
This intentionally public, read-only endpoint exposes operational metadata only,
consistent with the existing public daily reports: receipt ID, source, interval,
stored timestamp, counts and decision. No raw captures, prices, secrets or
connection strings are returned. There are no SQL writes, provider calls,
workflow triggers, schema migrations or schedule changes.

The snapshot contains at most 200 recent receipts from each SQL source and is
cached server-side for 30 seconds behind a single-flight gate. Requests are
rate-limited; CORS allows only the existing static production origin. The UI
refreshes every five minutes or on the Refresh button. Therefore duplicate-only
H4 receipts remain visible without requiring another static publication.
Missing SQL is a 503/unavailable state, never an empty successful history.

Counts belong to a complete SQL receipt, including mixed historical D1/H4
batches (shown in both tabs with an explicit totals warning). Historical imports
with more than 96 provider bars per capture are labelled historical. Legacy H4
`ReceivedAt` is the envelope collection timestamp saved by the existing receiver,
not independently measured job start/end. Accepted SQL receipt is not proof that
the entire Work job, analytics or deployment completed. Jobs skipped or failing
before submitting to SQL have no receipt here. Existing D1 deployment evidence
still requires exact generation/hash agreement with the served manifest.

Verification:

- `dotnet build SeasonalityApp.slnx -c Release`
- `dotnet run --project Tools/DataRunAuditChecks -c Release -- --sql`
- `node Tools/data-runs-checks.cjs`
- `node Tools/market-daily-probe-checks.cjs`
- `node Tools/data-runs-browser-checks.cjs <rendered-site>`

The SQL test creates and removes only its uniquely named LocalDB test database.
