# Direct Work receiver: staged migration

## Implemented first stage

`Tools/market-daily-preflight.cjs` checks a complete 39-instrument collection and
its common completion audit without writing files or acquiring/creating a writer
lock. It calls the existing `market-daily-ingest.cjs` engine in `dryRun` mode;
session normalization, same-provider source identity, strict OHLC, date collisions,
append-only historical tail and price-conflict rules are not separate receiver
implementations. The current writer and current morning flow are unchanged.

The stricter admission envelope requires fresh `fetchedAt` (24 hours), a Prague
`runDate`, completed/ok declarations, exactly 39 unique sources, exactly one
timestamp-matched audit run and 39 entries. Every entry must have consistent raw
TradingView OHLC and documented session/calendar citations. FX/metal boundaries
use the existing NY17 timezone rules. Cash/futures audit windows use the existing
exchange policy even for duplicate bars. No sessionEnd is manufactured for cash
or futures. Source citations are checked as submitted evidence, not downloaded
or independently established as authoritative calendars.

Example, after historical seed restoration:

```powershell
node Tools/market-daily-preflight.cjs --input=data/market-daily/latest.json --root=artifacts/tradingview-backfill-36-v1
node Tools/market-daily-preflight-checks.cjs
```

`accepted` is true only when the entire collection passes. `inserted` is always
zero in this mode; `plannedInsertions` and `skipped` describe the prospective
append and existing identical bars. SHA-256 hashes bind the exact input and audit
bytes. `persisted` and `analyticsTriggered` are false. Admission plans are not
commit authorizations: the worker must repeat checks while holding its exclusive
writer/transaction lock against CURRENT cumulative state. A concurrent writer
already holding the existing lock blocks preflight. Calendar gaps are not
silently filled; this is append-only consistency, not a proof that every expected
exchange session is present.

## Selected storage: existing Azure SQL

The user selected the existing Azure SQL database. No new account, paid resource,
secret, production database schema or deployment has been created for the receiver.
Do not use App Service deployment files, `wwwroot`, or temporary disk as a durable
source of truth. Do not infer persistence from the current read-only bundle.

Implemented SQL foundation:

- `Data/MarketDailyInbox.sql`: explicit additive `market_daily.Inbox` migration,
  not executed during application startup. No stock/COT tables changed.
- `Services/MarketDailySqlInbox.cs`: exact UTF-8 payload/audit bytes, server-computed
  digest pair/receipt ID, transactional same-evidence retries and durable pending
  work. The row itself is the outbox item, so there is no post-commit in-memory
  enqueue that can be lost.
- Atomic leased claims, expiry/crash recovery, stale-worker fencing and bounded
  failure codes. Stored evidence hashes are checked before handing data to a worker.
- Schema/39-source/freshness/audit-identity checks before raw storage; full session,
  raw-provider evidence and historical conflict admission remain the canonical Node
  preflight stage. This is explicitly a **quarantine inbox**, never an accepted-price
  store. Receipts report `HistoryAccepted=false`, `CompletionValidated=false` and
  `AnalyticsTriggered=false`. No receive/lease method is exposed as an MCP tool yet.
- A real SQL Server LocalDB integration test creates a uniquely named isolated
  database with read-committed snapshot isolation, applies the migration, starts a
  real HTTP/SQL health host, tests concurrent receipt retries, exact bytes, malformed
  rejection, durable crash/retry recovery and fencing, then removes only that test
  database. It never reads a production/Azure connection string.

```powershell
# Requires SQL Server LocalDB; never substitutes SQLite or an in-memory provider.
dotnet run --project Tools/MarketSqlInboxChecks/MarketSqlInboxChecks.csproj -c Release -- --localdb
```

## Implemented isolated SQL/Node shadow worker

`Services/MarketDailyInboxWorker.cs` + `Tools/market-daily-sql-worker.cjs` now run
the existing seed restore, preflight and full-39 import in a private temporary
directory. Bootstrap uses the current canonical `data/market-state` overlays,
not a new empty pricing history. Subsequent jobs resume the cumulative overlay
from SQL. Immutable seed and supplemental research definitions are fingerprinted;
changed baselines fail closed. Node receives no SQL/GitHub/Auth0 credentials.

`Data/MarketDailyShadowHistory.sql` is a SECOND explicit migration. It adds
immutable `ShadowHistory` generations and bounded admission reports. A successful
generation insert and the queue's `ShadowAccepted` ACK are ONE SQL transaction.
Generation compare-and-swap and the live lease fence prevent an outdated worker
from overwriting a newer result. A failed batch stores its rejection report but
does not advance history. Infrastructure interruption keeps the original receipt
retryable. This schema is not applied automatically during deployment/startup.

Freshness is checked against the database's durable `ReceivedAt`; an old queued
job is not made "fresh" by changing `fetchedAt`. Session completion is still
evaluated against the original collection timestamp. This remains a shadow state,
**not a live history commit or analytics/publication success**. Work/GitHub, SQL
stock/COT tables, live price routing and generated static data are unchanged.

The actual app supports an opt-in one-shot CLI BEFORE stock/COT initialization:

```powershell
# Use only after explicit schema application and approved shadow/test SQL setup.
# ConnectionStrings__DefaultConnection must come from the normal secure environment.
$env:MarketDailyInboxWorker__Enabled='true'
$env:MarketDailyInboxWorker__RepositoryRoot='C:\path\to\SeasonalityApp'
$env:MarketDailyInboxWorker__BootstrapState='C:\path\to\SeasonalityApp\data\market-state'
dotnet bin/Release/net10.0/SeasonalityApp.dll --process-market-inbox-once
```

There is no automatic scheduler/background job. Ordinary web startup does not
invoke this CLI. The deployed .NET-only bundle does not include the required raw
seed/repository/Node runtime; do not switch this on in Azure by just setting a flag.
The existing LocalDB integration check now exercises the actual app CLI and Node
worker, duplicate replay, all-39 synthetic append, conflict rejection, version CAS,
expired-lease fencing and infrastructure retry. Its synthetic future-session fixture
adjusts `ReceivedAt` only inside the explicitly isolated test database; production
code never rewrites collection or reception timestamps. All test DBs and private
staging directories are removed; the existing canonical files are hash-checked.

### Optional analytics rehearsal

Set the trusted `MarketDailyInboxWorker:AnalyticsSnapshot` directory (existing
stock/COT static snapshot) and `MarketDailyInboxWorker:HtfFeed` directory to run
the unchanged `morning-analytics.cjs` builders against the candidate shadow state.
These are server configuration paths, NOT Work tool arguments. There is no provider
refresh, SQL stock/COT read/write, or deployment. Output stays in the worker's
private staging subtree and is removed after validation; only its summary/hashes
are retained in the SQL generation's admission report.

The raw seasonality, HTF export and static-site regressions plus existing daily
health/source-freshness checks must pass before the shadow generation/ACK commits.
If rehearsal fails, the prior shadow state is unchanged and the receipt remains
retryable. Original stock/COT snapshot timestamps are preserved rather than
relabeled with the market calculation time. `analyticsRehearsal.passed=true` still
has `publicationEligible=false`: this is NOT a production analytics trigger.
The HTML shell is copied, not re-rendered; a production deployment must use the
normal renderer and fresh SQL export. Scoring/threshold formulas are unchanged.

```powershell
$env:MarketDailyInboxWorker__AnalyticsSnapshot='C:\path\to\SeasonalityApp\data\generated\site'
$env:MarketDailyInboxWorker__HtfFeed='C:\path\to\SeasonalityApp\artifacts\htf-ohlc'
```

The inbox, exact-byte receipts, lease-fenced worker and immutable shadow history
described above are implemented locally. The following production publication
requirements remain pending:

- A durable pending job is distinguishable from accepted/processed/published.
  Restart/retry must not lose a receipt or publish an older generation over a newer
  one. Build and verify output in staging, then atomically advance the publication
  pointer. Preserve the last working generation on failure.
- The shadow bootstrap already uses checksum-pinned immutable history and existing
  cumulative state. Production publication must retain that lineage; this is a
  transport/storage migration, not a second pricing branch.

## Scoped MCP SQL quarantine and manual Actions rehearsal

The deployed `validate_market_daily` remains validation-only. The local implementation
now adds `submit_market_daily(dailyJson, completionAuditJson)`, exposed only with
`MarketDailyInbox:Enabled=true`, `MarketDailyInbox:Mode=shadow`, Auth0 and a valid
existing SQL connection. It checks `market.ingest` separately from `market.validate`,
plus the existing owner/client/issuer/audience/lifetime restrictions. Per-tool OAuth
metadata and insufficient-scope reauthorization challenges are included.
The tool atomically stores exact original bytes and a pending receipt, not accepted
history or published analytics. It never creates SQL tables or starts the worker.

`Morning analytics` now has an opt-in manual `sql_inbox_shadow` input. Its separate
read-only-repository job processes ONE pending SQL receipt with .NET/Node and rehearses
analytics privately using the frozen stock/COT snapshot and read-only ETF HTF evidence.
It cannot commit or publish output. Cron/push/default manual runs are unchanged.
Existing workflow concurrency serializes the rehearsal with the normal pipeline.
Source fingerprints ignore checkout newlines/JSON formatting, not identity changes;
the seed and referenced source data still undergo their original checksum validation.

Real LocalDB + HTTP MCP tests verify disabled/fail-closed writes, separate scopes,
JWT restrictions, exact-byte storage, duplicates and no automatically started worker.
No Auth0 permission grant, production SQL mutation, cloud deployment or Work schedule
change has been made. Work's current GitHub collector must continue.

Before enabling the implemented tool in the deployed application:

1. Provision/use the approved durable store and worker execution environment.
   The canonical admission/analytics code is Node plus .NET; do not assume the
   deployed .NET App Service already has Node or the full audited historical seed.
2. Enforce `market.ingest` in the server handler in addition to owner, client,
   RS256 issuer/audience/lifetime validation. `market.validate` alone can never
   authorize writes. Declare accurate per-tool OAuth scopes and write annotations.
   Reject incomplete collections before persistence or jobs.
3. Use bounded payload AND audit arguments; the transport cap must accommodate
   their JSON-RPC escaped representation without removing request/time limits.
4. Test exact-byte storage, duplicate retries, OHLC conflicts, incomplete batches,
   crash recovery, concurrency, and publication failure on isolated storage.
5. Explicitly grant and reauthorize the new scope in Auth0/ChatGPT, then run a
   controlled isolated 39-instrument test. A successful validation call is not
   evidence that unattended refresh or writes work.
6. Compare several daily receiver results with the existing pipeline, verify OAuth
   refresh, then obtain the go-ahead to switch the collector away from GitHub.

Scoring, COT, Yahoo stocks, SQL stock data, continuous-futures research restrictions
and HTF activation remain unchanged throughout this migration.
