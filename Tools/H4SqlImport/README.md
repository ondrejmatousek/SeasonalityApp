# Private H4 SQL storage import

This opt-in CLI stores OANDA H4 captures in the EXISTING production Seasonality
database, in a separate `market_h4` schema. It never writes D1, daily queue/state,
COT or analytics tables, and does not register a scheduled job or MCP tool.

Tables: `Batches`, `Captures` (original UTF-8 response + SHA-256), `Bars` (exact
decimal OHLCV, provider/symbol/timeframe/Unix-start identity). Rows stay in
`PendingSessionValidation`: elapsed 4-hour duration and structural validity do
not establish historical calendar completeness or provider-finality. Nothing is
automatically activated for zone detection, seasonality or COT.

Zone-only eligibility is now recorded SEPARATELY in `market_h4.ZoneValidation`.
The trusted `Tools/h4-zone-snapshot.cjs` validator requires exactly six elapsed
4-hour NY17 slots matching the accepted same-provider D1 OHLC exactly. Missing
or incomplete sessions are excluded, never filled. The raw storage status stays
pending for the full unfiltered batch; zone consumers must require the separate
SQL eligibility evidence and independently revalidate it against immutable D1
seed/overlays. This does not claim a complete exchange holiday calendar.

`--record-zone-validation --input <validator-report> --config-root <repo>` stores
an idempotent, hash-checked eligibility report (no raw price edits). Conflicting
reports cannot overwrite previous evidence. `--export-zone-source --output
<new artifacts file> --config-root <repo>` reads SQL captures plus eligibility
evidence, verifies stored hashes and exports private build input. The static
hosting pipeline uses this read-only operation and overlays H4 ONLY onto the
zone snapshot; no raw capture texts are copied to public output.

Checks: hashes, all 28 registered FX identities, full column counts, monotonic
timestamps, elapsed H4, OHLC bounds, no decimal rounding. No gap filling. Import
uses a single serializable transaction and application lock; identical bars are
deduplicated and conflicts abort without overwrite. Readback compares EVERY
normalized value and every raw SHA before commit; `--verify` repeats readback
using a new connection after commit. Original captures remain Git-ignored.

Build: `dotnet build Tools/H4SqlImport/H4SqlImport.csproj -c Release`.
Run the resulting DLL with:

- `--self-test-localdb`: creates a uniquely named isolated LocalDB database,
  tests real SQL inserts/readback/idempotency/conflicts/rollback, then drops ONLY
  that exact generated test database. Does not read production credentials.
- `--validate --config-root <repo> --input <capture-dir>`: offline checks only.
- `--inspect --config-root <repo>`: read-only production target check.
- `--inspect-live-receipt <sha256> --config-root <repo>`: read-only comparison
  of one retained live receipt against existing H4 rows, including per-field
  differences and stored raw SHA verification. No data corrections or jobs.
- `--import --confirm-database seasonality-free-20261022 --config-root <repo> --input <capture-dir>`:
  explicit production storage import, no analytical activation.
- `--verify --config-root <repo> --input <capture-dir>`: read-only committed check.

Credentials are read IN MEMORY from `SEASONALITY_H4_SQL_CONNECTION`, or the
existing development connection configuration under the explicit repo root.
Neither the connection string nor secrets are logged or passed as CLI arguments.
The production path refuses any server/database other than the known Seasonality
target. Tool code can be shared; capture files and secret configuration must not
be published. There is no automatic schema migration on application startup.
