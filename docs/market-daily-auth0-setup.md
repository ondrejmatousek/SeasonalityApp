# Auth0 setup for the validation-only market MCP

Status: Auth0 server-side JWT/MCP adapter tested locally; actual Auth0 tenant, login, hosted Work connection and unattended refresh are NOT configured or proven. No account, paid plan, secret, public registration policy or OAuth client was created automatically.

## First user step

1. Sign up/sign in at https://auth0.com/ and use a Free tenant (EU region if desired). Do not enable paid add-ons/custom domains for this experiment.
2. Send only the tenant **Domain**, such as `dev-example.eu.auth0.com`. This is public configuration, not a secret. Never share Client Secret, access/refresh tokens, Management API keys or passwords.
3. We will verify the tenant's real public discovery before further setup. Auth0 pricing currently lists Auth for MCP in Free; verify the account's actual entitlement/trial state in its dashboard.

## Exact resource/API contract

- API name: `Seasonality market validation`.
- API Identifier/audience, exactly (no extra slash):
  `https://seasonality-gbfhasdjamcnf6dm.westeurope-01.azurewebsites.net/mcp/market-daily`
- Signing algorithm: **RS256**, never HS256/shared probe key.
- One permission/scope: `market.validate`. No write, ingestion, admin or Management API scopes.
- Turn on the provider's documented Resource Parameter Compatibility Profile so MCP's `resource` targets the exact API; don't silently substitute `/userinfo` as the audience.
- If later testing scheduled access, configure supported refresh/offline access and verify rotation/revocation. Do not presume a first successful login proves daily unattended access.

## Register and restrict the calling client

Prefer Auth0's documented **CIMD** registration/approval with the EXACT metadata URL shown by the ChatGPT MCP connection management page. Do not invent a generic callback or client ID. Auth0 documentation describes administrator review/confirmation of CIMD clients; use that rather than globally enabling unauthenticated DCR by default.

For the free experiment use a supported public-client **PKCE / token endpoint auth `none`** connection. Auth0's current CIMD documentation restricts `private_key_jwt` to Enterprise; do not assume the general Free MCP entitlement includes it. If the host selects/requires that paid method, stop and verify a supported public/pre-registered alternative before any upgrade. Enable CIMD and resource compatibility in tenant settings only after reviewing the actual available options. No paid purchase is authorized by this setup.

If CIMD is not available in this tenant/host, use the documented pre-registered OAuth client flow only if the host supports it. Use the exact callback shown by the host, PKCE S256, and only authorization-code/refresh grants. Any confidential-client secret goes into the connection's secure credential UI, not a message or package. Do NOT use a client-credentials/M2M account for the user-scoped tool.

Approve only this resource and `market.validate` for this calling client. Obtain the actual `azp`/client identifier from the provider's trusted client configuration/token contract; don't guess that a CIMD URL and the resulting Auth0 application ID are necessarily interchangeable. The backend pins this exact identifier.

Create/use one application end-user in Auth0, and use that user's exact **User ID/sub** as `AllowedSubject`. The Auth0 dashboard administrator account is not automatically the application end-user. Backend rejects every other `sub` even if other users can log in to the tenant. Do not replace this allowlist with email matching or wildcard access.

## Azure App Service settings (all public identifiers)

| Setting | Value |
| --- | --- |
| `MarketDailyMcp__Provider` | `Auth0` |
| `MarketDailyMcp__Auth0Domain` | Actual standard tenant domain, lower-case; no `https://`, path, port or query |
| `MarketDailyMcp__Audience` | Exact resource/API Identifier above |
| `MarketDailyMcp__AllowedSubject` | Exact owner's Auth0 User ID/sub |
| `MarketDailyMcp__AllowedClientId` | Exact approved calling client's azp/client ID |
| `MarketDailyMcp__Enabled` | Keep unset/false until all prior checks are complete, then `true` |

Only standard Auth0 tenant hosts are supported, not arbitrary/custom domains; no caller-supplied issuer/JWKS URL is accepted. Missing/wildcard/invalid IDs, unknown providers and wrong audience fail closed. JWT verifies issuer (including trailing slash), RS256 signature, expiry, audience, exact `sub`, exact `azp`, and `scope` containing `market.validate`. Entra's `oid/scp` claims cannot substitute for Auth0's claims.

The REST probe's `MARKET_DAILY_PROBE_TOKEN` is independent and NOT used by Auth0. Neither Auth0 login nor this MCP tool stores market data or triggers SQL/analytics. Existing GitHub collection, source routing, scoring/COT and research flags remain unchanged.

## End-to-end gate

After supported login/consent, verify real hosted Work tool discovery (exactly `validate_market_daily`) and submit unchanged current `latest.json` with all 39 instruments. Check the checksum/count and `persisted:false`, `analyticsTriggered:false`, `completionValidated:false`. Do not rewrite fetchedAt in the real test to mask stale input; only isolated regression fixtures adjust envelope time in memory. Do not change the recurring job or remove GitHub transport until the authenticated hosted path and unattended credential renewal are tested.

Current local/CI regressions use an ephemeral test RSA key and real MCP HTTP server for both Auth0 and Entra claim contracts. They do NOT contact Auth0 or prove user login/host compatibility.

Rollback: `MarketDailyMcp__Enabled=false`. No price-data rollback is needed: this experiment writes nothing.

Sources: [Auth0 MCP overview](https://auth0.com/ai/docs/mcp/overview), [Auth0 Auth for MCP GA and CIMD controls](https://auth0.com/blog/auth0-auth-for-mcp-servers-generally-available/), [Auth0 pricing](https://auth0.com/pricing), [OpenAI OAuth/host requirements](https://developers.openai.com/plugins/build/auth).
