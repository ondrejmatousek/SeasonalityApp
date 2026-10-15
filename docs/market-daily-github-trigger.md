# SQL reception → GitHub Actions wake-up

The MCP handler first commits the exact submitted daily JSON/audit to SQL quarantine.
Only then it requests the existing `seasonality-update.yml` workflow on `master`, with
`sql_publish=true`, using a GitHub App installation token restricted to `SeasonalityApp`
and `actions:write`. Existing admission checks, SQL leases, generation fences and
non-forcing publication remain authoritative. No credentials come from MCP arguments.

## One-time owner setup (not automatically provisioned)

1. Create a private GitHub App under the repository owner's account:
   <https://github.com/settings/apps/new>. Use the Seasonality application URL as
   homepage, disable webhooks, leave user OAuth/callbacks unused, select only the
   current account for installation. Set repository **Actions: Read and write**;
   no Contents write or organization permissions. Metadata read is implicit.
2. Install the App on **only** `ondrejmatousek/SeasonalityApp`. Record App ID and the
   numeric installation ID from its installation URL. These IDs are not secrets.
3. Generate a private key in the App settings. Keep the downloaded PEM private and
   outside the repository. Never paste PEM, base64 PEM, JWT, or installation tokens
   in chat, screenshots, logs or committed files. Base64 is encoding, not encryption.
4. In the existing Azure App Service configuration, add:

   - `MarketDailyGitHubTrigger__AppId`: App ID.
   - `MarketDailyGitHubTrigger__InstallationId`: installation ID.
   - `MarketDailyGitHubTrigger__PrivateKeyPemBase64`: base64 of the original PEM bytes,
     preferably a Key Vault reference if an existing vault/access policy is available.
   - `MarketDailyGitHubTrigger__Enabled`: `true` **last**, only after confirming IDs/key
     and App installation scope. Save/apply the configuration.

The App Service holds only the App key; installation tokens are minted in memory for
each attempt, never returned or persisted. Redirects are disabled and both HTTP calls
share an eight-second timeout. App JWT expires in five minutes (iat backdated one minute).

## Evidence and failure semantics

- `persisted=true` means SQL reception, not accepted history or completed analytics.
- `workflowTrigger=Requested`, `workflowRequested=true` means GitHub accepted the
  dispatch, **not** that any job succeeded. `analyticsTriggered` remains the original
  receipt evidence, not a synonym for the dispatch request.
- `Unavailable` includes ambiguous timeouts: a run might already exist. SQL data stays
  durable. Retry only the exact same payload/audit; pending duplicate receipts may
  repeat the wake-up, existing queue leases/publication fences prevent double admission.
- `Disabled`/`ConfigurationRequired` is not a working automatic trigger. Cron remains
  the fallback, but is not a guaranteed delivery mechanism.
- Accepted/blocked/processing duplicate receipts do not dispatch through this handler.
- No background fire-and-forget task, new cloud service or database migration is added.
  A process crash after SQL commit but before dispatch still relies on the cron fallback.

## Verification

`dotnet run --project Tools/MarketTriggerChecks/MarketTriggerChecks.csproj -c Release`
uses an ephemeral key and intercepted HTTP, never GitHub or SQL. This is not evidence
of a real App installation. After owner configuration, verify the next real collection
has a requested wake-up and a GitHub run whose actor is the App, then verify receipt,
analytical report, publication and served manifest separately. Do not resubmit old
collections with rewritten timestamps just to test a trigger.

Disable the feature with `MarketDailyGitHubTrigger__Enabled=false`; preserve the SQL
queue and scheduled fallback. Rotate/revoke keys in GitHub and Azure together.

References: [workflow dispatch API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event),
[installation token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app).
