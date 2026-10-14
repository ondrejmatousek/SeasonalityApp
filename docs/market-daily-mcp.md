# Market daily validation MCP — staged, not connected to Work

## Implemented

- Official C# MCP SDK 2.2.0, stateless Streamable HTTP at `/mcp/market-daily`.
- Exactly one tool: `validate_market_daily(dailyJson)`. `dailyJson` is the exact original JSON text, not rewritten prices or a credential.
- All 39 registered instruments required, using the existing source registry and `MarketDailyProbe.Validate`; maximum 256 KiB argument / 512 KiB transport, bounded body-read time, 30 requests/IP/minute, no browser Origin/CORS access.
- No persistence, SQL registration in the isolated test host, ingestion, queues, analytics or provider fallback. Completion declarations are checked, not independently proven. Research flags/routing/scoring remain untouched.
- Receipt/checksum is deterministic for identical input bytes. It explicitly reports `persisted:false`, `analyticsTriggered:false`, `completionValidated:false`.
- OAuth resource validation uses ASP.NET JWT middleware: RS256 signature, v2 issuer, tenant, audience, expiry, `market.validate` scope, one owner object ID and one allowed OAuth client ID. No shared-probe-token fallback.
- No custom authorization server, DCR server, token storage, password form or OAuth login is implemented. Entra is the intended authorization provider candidate, not a proven Work connection.

## Default and configuration

Default **disabled**. Missing/invalid settings also fail closed with HTTP 503 `MARKET_DAILY_MCP_NOT_CONFIGURED` for MCP and discovery. This does not disable the website or alter the existing REST probe.

The following App Service settings are public identifiers, NOT API secrets:

| Setting | Meaning |
| --- | --- |
| `MarketDailyMcp__Enabled` | `true` only after identity provider and client compatibility checks |
| `MarketDailyMcp__TenantId` | Single Entra tenant GUID |
| `MarketDailyMcp__Audience` | Application/client ID GUID of the resource/API registration |
| `MarketDailyMcp__AllowedObjectId` | Your tenant-local user object ID GUID (not email, tenant ID or app object ID) |
| `MarketDailyMcp__AllowedClientId` | Client/application ID GUID of the approved OAuth calling client |

Use canonical lower-case GUID values. Resource URL is pinned to
`https://seasonality-gbfhasdjamcnf6dm.westeurope-01.azurewebsites.net/mcp/market-daily`.
Unauthenticated configured requests return 401 with a trusted `WWW-Authenticate` discovery URL:
`/.well-known/oauth-protected-resource/mcp/market-daily`.
JWT audience is the API's application ID, not the caller's ID. The exposed API resource identifier must match the canonical MCP URL. Valid tokens must carry delegated `scp=market.validate`, `ver=2.0`, owner `oid`, tenant `tid`, and approved `azp`. App-only, wrong-user and wrong-client tokens are rejected.

The existing `MARKET_DAILY_PROBE_TOKEN` is NOT an OAuth credential and must not be pasted into Work, tool arguments or a plugin package. Do not use deployment client credentials as a user/MCP identity. No secrets are packaged or created here. No local auth/signing-key override exists in the production service.

## Authentication blocker — verify before guiding the user through registration

On 2026-10-14 the public Entra `common/v2.0/.well-known/openid-configuration` response omitted `code_challenge_methods_supported`, CIMD and DCR. OpenAI's plugin documentation requires PKCE `S256` in discovery. The target tenant and actual ChatGPT connection flow have not been configured/tested. Therefore direct Entra -> hosted Work authentication is **NOT proven** and must not be advertised as ready. A pre-registered client alone does not resolve a failed metadata compatibility check.

Before enabling anything:

1. Verify the actual tenant's OAuth discovery against the target hosted Work connector (PKCE S256, client registration support, resource indicator support, token endpoint auth methods).
2. If incompatible, obtain approval for a standards-compliant authorization broker/provider; do NOT fabricate Entra discovery metadata, weaken JWT validation, disable authentication or add anonymous token issuance.
3. If compatible, register a dedicated single-tenant resource API (v2 tokens, exact MCP Application ID URI, delegated scope `market.validate`) and approved calling client. Restrict user access to the owner. These are Entra changes requiring tenant authority, not App Service settings alone.
4. Use the EXACT redirect URI shown by the connector's management page. Do not guess a generic ChatGPT callback. Any OAuth client secret goes only into the supported connection's secure authentication settings, not chat/source/JSON.
5. Configure the above public identifiers and enable MCP. Complete Microsoft login/consent personally. Verify hosted tool discovery and one real, unchanged current 39-bar JSON call. Preserve the GitHub flow until the whole path succeeds; do not change the recurring schedule/prompt for this experiment.

No Azure/Entra application registration or identity policy was silently created. No hosted plugin installation is claimed. A desktop-local `mcp.json` package is not proof of availability to cloud scheduled Work.

## Verification

Prepare the existing 39-series bundle, then:

```powershell
dotnet build SeasonalityApp.slnx -c Release
node Tools/market-daily-probe-checks.cjs
dotnet run --project Tools/MarketMcpChecks/MarketMcpChecks.csproj -c Release
```

An already prepared isolated 39-series bundle can be selected with `MARKET_DAILY_PROBE_TEST_BUNDLE`. MCP checks launch an actual HTTP host using the production MCP resource configuration and validator. Only the separate test executable generates an ephemeral RSA key and pins a static test JWKS in memory; it never changes the production configuration or disables signature validation. Tests cover initialize, list (exactly one tool), call with 39 bars/checksum, invalid signature/issuer/audience/expiry, wrong scopes/owner/client, disabled/missing configuration, malformed/stale/incomplete/provider/OHLC inputs, request limits and unchanged stored market files. Test-envelope freshness is updated in memory only, not in the repository daily feed.

These tests establish server-side MCP/JWT behavior, **not interactive OAuth, refresh-token retention, hosted Work tool availability or unattended authentication**. The backend build workflow runs both isolated tests before normal deployment.

## Rollback

Set `MarketDailyMcp__Enabled=false` (or leave it unset). The existing GitHub ingestion/analytics flow remains independent; no market data rollback is necessary because this connector writes nothing.

References: [Official C# SDK sample](https://github.com/modelcontextprotocol/csharp-sdk/tree/v2.2.0/samples/ProtectedMcpServer), [Microsoft Entra MCP resource guidance](https://learn.microsoft.com/en-us/entra/agent-id/secure-mcp-server-with-entra-id), [OpenAI OAuth requirements](https://developers.openai.com/plugins/build/auth).
