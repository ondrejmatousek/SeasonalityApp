# Controlled SQL inbox rollout (not a production cutover)

Current implementation: authenticated MCP -> exact original JSON/audit in SQL
quarantine -> manually selected existing GitHub Actions job -> immutable SQL shadow
history and private analytics rehearsal. Publication and automatic SQL polling are
NOT activated. Keep the existing Work GitHub collector and normal morning pipeline.

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

No JSON payload, credentials or SQL connection string should be pasted into logs,
chat or new repository files. The manual worker prints only safe status/receipt
information. Candidate web files are removed from private staging after verification;
their summary/hashes and immutable shadow state persist in SQL.

## Remaining before live cutover

Compare several receiver generations against the current pipeline, verify unattended
OAuth refresh, implement durable publication/version fencing and automatic queue
processing, verify a fresh stock/COT export and normal HTML rendering, and obtain
explicit cutover approval. Only then replace Work's repository-writing instructions.
Stock Yahoo data, COT/scoring and research-only futures/HTF restrictions stay unchanged.
