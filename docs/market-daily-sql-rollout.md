# Controlled SQL inbox rollout (not a production cutover)

Implementation: authenticated MCP -> exact original JSON/audit in SQL quarantine ->
existing scheduled GitHub Actions -> immutable accepted SQL generations -> fresh
stock/COT export, analytics, SQL-fenced non-forcing Git publication and existing
static hosting. The repository JSON push trigger and legacy GitHub intake job are
removed. Original archived evidence stays intact; it is not an active feed.

The scheduler retains its existing UTC slots (`7,22,37,52 1-8 * * *`). These poll the
SQL inbox around the Czech morning; GitHub timing is best-effort, not an immediate
webhook after an MCP write. Same concurrency group prevents overlapping runs.
Before 03:00 Prague the schedule does not open SQL. In publish mode a committed
generation for today's Prague date skips subsequent automatic SQL connections,
avoiding unnecessary serverless wake-ups. Manual publication checks bypass this
cheap gate for a same-day correction. A failed hosting deployment is retried through
the separate hosting workflow; the Git manifest pointer denotes prepared output.
An unset `MARKET_DAILY_SQL_MODE` repository variable defaults to shadow queue-only.
`shadow` processes accepted history without publishing; `publish` additionally
builds/publishes new generations; `off` disables automatic processing. Explicit
manual `sql_publish=true` supports controlled live verification before activating
scheduled publication. `sql_inbox_shadow=true` remains a one-receipt rehearsal.

## Operator steps after code review and deployment approval

1. Deploy the code with the inbox disabled (default). Preserve automatic backend
   deployment and existing `MarketDailyMcp__*` settings. No worker flag in App Service.
2. With an authorized SQL administrator, explicitly apply `Data/MarketDailyInbox.sql`
   followed by `Data/MarketDailyShadowHistory.sql` to the existing application SQL
   database. These additive scripts create only the `market_daily` inbox/shadow
   objects. The application never runs DDL automatically. Verify the existing app
   SQL principal can read/write these objects; do not grant broad schema privileges.
3. In Auth0 API **Seasonality market validation**, add permission `market.ingest`.
   Grant it to **Seasonality Work** under User-Delegated Access, alongside the existing
   `market.validate`. Keep client/owner pins and PKCE; no new shared token is needed.
4. In App Service add `MarketDailyInbox__Enabled=true` and
   `MarketDailyInbox__Mode=shadow`. Keep the existing SQL connection unchanged.
   Save/apply, then reconnect the Seasonality plugin requesting both scopes.
5. Ask Work for ONE controlled `submit_market_daily` call with the exact original
   fresh 39-instrument JSON AND its original common audit. Preserve `fetchedAt`.
   Do not change the recurring job. Verify receipt status `PendingValidation`,
   `persisted=true`, and history/analytics/completion flags `false`. Repeat the
   identical call once: same receipt, duplicate, no second row. If SQL transport
   fails ambiguously, `persisted=null` means retry identical bytes, not a new batch.
6. GitHub -> Actions -> **Morning analytics** -> Run workflow -> master -> enable
   ONLY `sql_inbox_shadow`. Requires the existing secret
   `SEASONALITY_CONNECTION_STRING` to target the same SQL database and network access
   already used by the morning pipeline. This job processes ONE receipt, not a drain.
   It fetches read-only ETF HTF evidence and uses the current stock/COT static snapshot;
   stale or unavailable evidence must fail instead of bypassing checks.
7. Verify SQL receipt `ShadowAccepted` and the generation's admission report with
   39 passing identities, exact input hashes and `analyticsRehearsal.passed=true`.
   `publicationEligible=false`, `productionChanged=false` and
   `analyticsTriggered=false` still apply. `Blocked` indicates admission failure;
   infrastructure failures remain retryable. Readiness of the inbox is not proof
   that production history/web publication has switched.
8. Run **Morning analytics** manually with `sql_publish=true` only. This drains
   the queue, selects the latest fresh accepted generation, refreshes the existing
   Yahoo/CFTC SQL data, validates all outputs and commits under the SQL fence.
   Verify the separate **Publish verified static output** workflow succeeds.
9. Set repository Actions variable `MARKET_DAILY_SQL_MODE=publish` ONLY after that
   live test succeeds. No additional Azure settings, SQL tables, keys or services
   are required for this processing/publication stage. GitHub JSON intake remains
   disabled in all modes; the repository variable does not restore it.

No JSON payload, credentials or SQL connection string should be pasted into logs,
chat or new repository files. The manual worker prints only safe status/receipt
information. Candidate web files are removed from private staging after verification;
their summary/hashes and immutable shadow state persist in SQL.

## Publication and recovery

Queue processing is bounded to five receipts per run and retains failed jobs for
retry. Blocked admission is distinguished from infrastructure errors. Background
SQL connections use at least 120 seconds to tolerate a resumed database, without
changing the MCP request time budget or disabling TLS. No automatic DDL is added.

The export joins immutable generation state with its exact source payload/audit,
verifies stored hashes and admission binding, rejects collections older than 24h,
and places raw evidence ONLY in ignored `artifacts/sql-market`. Already-committed
generations are skipped; lower generations/changed identities fail closed. The
Node engine restores the original seed + SQL overlays and reruns full admission.
All 39 entries must already match accepted SQL history (no planned extra insertions).

The unchanged live builders refresh Yahoo stocks/CFTC, render the normal HTML shell
and enforce stock/market/HTF/static health checks. Source routing records the SQL
receipt instead of pretending to read repository JSON. Scoring/COT/research rules
are unchanged. Before final commit the worker acquires the SAME SQL application
lock as generation advancement and verifies the head again. That lock spans Git
commit/push. Git refuses concurrent repository changes; no rebase or force push is
allowed. Raw JSON/audit are never staged. Only generated web, cumulative overlays
and health audits enter the atomic Git commit.

`ShadowAccepted` is the existing SQL admission state, NOT proof of web deployment.
`marketDailySql` in the committed web manifest is the durable prepared-generation
pointer (receipt and hashes). Existing static hosting success is the publication
receipt. If hosting fails, retry its workflow; the last deployed web remains.
On an ambiguous failed Git push, inspect remote manifest before retrying from a
fresh checkout; the same generation skips safely if it was committed.

Before changing Work's recurring instructions obtain direct user authorization,
retain 39 instruments and the 03:00 Europe/Prague schedule, use MCP only, and report
errors without a silent fallback to GitHub. Verify unattended OAuth refresh on the
next real daily run. Stock Yahoo data, COT/scoring and research-only futures/HTF
restrictions stay unchanged.
