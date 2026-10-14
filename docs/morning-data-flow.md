# One market collection and morning analytics

Active market input is ONLY `data/market-daily/latest.json` (39 identities). Its identical daily archive uses Prague collection date, not a single instrument's trading date. Completion evidence for all 39 lives in `data/market-daily/audit/YYYY-MM-DD.json`. Stocks remain on Yahoo, with their existing adjusted-price pipeline.

The removed split feed is preserved under `data/market-daily-legacy/commodity-extension/`. Original 2026-10-14 pre-merge envelope/audit bytes and hashes are retained in `data/market-daily/migration-evidence/2026-10-14/`. No provider OHLC/timestamp is changed. Historical archives before the migration retain their original scope.

Morning analytics starts immediately after a master push affecting latest.json or completion audits. It does NOT wait until 06:00. Cron `7,22,37,52 1-8 * * *` UTC is fallback only, skips before local 03:00 and after this exact collection was already published successfully. The existing concurrency group serializes writers. Successful publication is deduplicated by Prague day + input SHA-256; failures can retry. Manual dispatch with `force=true` permits a deliberate repeated rebuild.

This avoids dependence on delayed cron delivery but does NOT guarantee an exact runner start time. Analytics duration and GitHub runner availability still apply. The user explicitly changed the desired start from 06:00 to immediately after collection.

Collector must follow `data/market-daily/README.md`: stage archive/audit, publish latest atomically in the same commit, preserve source identities and completion evidence, never recreate the active split feed. Updating repository code does not itself edit an external Work task's instructions.
