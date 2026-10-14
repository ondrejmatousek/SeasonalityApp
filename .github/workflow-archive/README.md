# Archived research workflows

Archived 2026-10-14 after adopting TradingView/OANDA market data. These manually dispatched experiments are not dependencies of ingestion, analytics, stocks/COT refresh or static hosting:

- `twelve-data-pilot.yml`: discontinued Twelve Data FX pilot.
- `alpha-vantage-pilot.yml`: historical Alpha Vantage FX pilot.
- `dukascopy-access-probe.yml`: historical Dukascopy unattended HTTPS probe.

The definitions are retained outside `.github/workflows`, so GitHub does not schedule or dispatch them from current master. Scripts, provider evidence, historical Actions runs/artifacts (subject to their existing retention), public encryption keys and secrets are not deleted by this cleanup. To resume a specifically approved experiment, restore its file to `.github/workflows` and re-enable the corresponding workflow.

Active workflows remain unchanged:

- `seasonality-update.yml` — Morning analytics: unified Work collection ingestion, Yahoo stocks/CFTC refresh, analytical export and health.
- `static-hosting.yml` — Publish verified static output: hosting verified output, including health; no-op analytics runs do not deploy.
- `master_seasonality.yml` — Automatic ASP.NET Azure backend build/deployment. The user explicitly requested retaining its automatic push trigger. This backend deployment is not required by the static site data reader, but is deliberately preserved.
