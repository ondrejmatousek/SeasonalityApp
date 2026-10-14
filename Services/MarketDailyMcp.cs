using System.ComponentModel;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using ModelContextProtocol;
using ModelContextProtocol.AspNetCore;
using ModelContextProtocol.Server;

namespace SeasonalityApp.Services;

// OAuth resource server only. The configured provider owns login, PKCE, consent and refresh tokens.
// Never accepts the REST probe's shared secret or calls any ingestion/SQL service.
public static class MarketDailyMcp
{
    public const string Path = "/mcp/market-daily";
    public const string Resource = "https://seasonality-gbfhasdjamcnf6dm.westeurope-01.azurewebsites.net" + Path;
    public const string MetadataPath = "/.well-known/oauth-protected-resource/mcp/market-daily";
    public const string Scheme = "MarketDailyOAuth";
    public const string Scope = "market.validate";
    public const string Policy = "MarketDailyValidate";

    public static bool Register(IServiceCollection services, IConfiguration config)
    {
        var settings = SettingsFor(config);
        if (settings is null) return false;
        var issuer = settings.Issuer;
        services.AddAuthentication().AddJwtBearer(Scheme, options =>
        {
            options.Authority = issuer;
            options.MapInboundClaims = false;
            options.SaveToken = false;
            options.IncludeErrorDetails = false;
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidateIssuer = true, ValidIssuer = issuer,
                ValidateAudience = true, ValidAudience = settings.Audience,
                ValidateLifetime = true, RequireExpirationTime = true,
                ValidateIssuerSigningKey = true, RequireSignedTokens = true,
                ValidAlgorithms = [SecurityAlgorithms.RsaSha256], ClockSkew = TimeSpan.FromSeconds(30)
            };
            options.Events = new JwtBearerEvents
            {
                OnChallenge = context =>
                {
                    context.HandleResponse();
                    context.Response.StatusCode = 401;
                    // Configured canonical URL, never Host/X-Forwarded-Host from the caller.
                    context.Response.Headers.WWWAuthenticate =
                        $"Bearer resource_metadata=\"{Resource[..Resource.IndexOf(Path, StringComparison.Ordinal)]}{MetadataPath}\", scope=\"{settings.DiscoveryScope}\"";
                    return Task.CompletedTask;
                }
            };
        });
        services.AddAuthorization(options => options.AddPolicy(Policy, policy =>
        {
            policy.AddAuthenticationSchemes(Scheme).RequireAuthenticatedUser();
            policy.RequireAssertion(c =>
                (settings.Provider == "Auth0" ||
                    (c.User.FindFirst("tid")?.Value == settings.Tenant && c.User.FindFirst("ver")?.Value == "2.0")) &&
                c.User.FindFirst(settings.Provider == "Auth0" ? "sub" : "oid")?.Value == settings.Owner &&
                c.User.FindFirst("azp")?.Value == settings.Client &&
                (c.User.FindFirst(settings.Provider == "Auth0" ? "scope" : "scp")?.Value
                    .Split(' ', StringSplitOptions.RemoveEmptyEntries).Contains(Scope, StringComparer.Ordinal) ?? false));
        }));
        services.AddMcpServer().WithHttpTransport(o => o.SessionMode = HttpServerSessionMode.Stateless)
            .WithTools<MarketDailyValidationTool>();
        return true;
    }

    private sealed record OAuthSettings(string Provider, string Issuer, string Audience,
        string Owner, string Client, string DiscoveryScope, string? Tenant = null);

    private static bool Identifier(string? value) => !string.IsNullOrEmpty(value) && value.Length <= 512 &&
        !value.Any(ch => char.IsWhiteSpace(ch) || char.IsControl(ch) || ch == '*');

    private static OAuthSettings? SettingsFor(IConfiguration c)
    {
        if (!c.GetValue<bool>("MarketDailyMcp:Enabled")) return null;
        var provider = c["MarketDailyMcp:Provider"] ?? "Entra";
        if (provider == "Auth0")
        {
            var domain = c["MarketDailyMcp:Auth0Domain"];
            // Restrict JWKS/discovery destination to a standard Auth0 tenant, not an arbitrary URL/SSRF target.
            if (domain is null || !System.Text.RegularExpressions.Regex.IsMatch(domain,
                @"\A[a-z0-9][a-z0-9-]{0,62}\.(?:(?:eu|us|au|jp|uk|ca)\.)?auth0\.com\z") ||
                c["MarketDailyMcp:Audience"] != Resource ||
                !Identifier(c["MarketDailyMcp:AllowedSubject"]) || !Identifier(c["MarketDailyMcp:AllowedClientId"])) return null;
            return new(provider, $"https://{domain}/", Resource, c["MarketDailyMcp:AllowedSubject"]!,
                c["MarketDailyMcp:AllowedClientId"]!, Scope);
        }
        if (provider != "Entra" || !new[] { "TenantId", "Audience", "AllowedObjectId", "AllowedClientId" }
            .All(k => Guid.TryParse(c[$"MarketDailyMcp:{k}"], out var id) && id != Guid.Empty)) return null;
        var tenant = c["MarketDailyMcp:TenantId"]!;
        return new(provider, $"https://login.microsoftonline.com/{tenant}/v2.0", c["MarketDailyMcp:Audience"]!,
            c["MarketDailyMcp:AllowedObjectId"]!, c["MarketDailyMcp:AllowedClientId"]!, $"{Resource}/{Scope}", tenant);
    }

    public static void Map(WebApplication app, bool ready)
    {
        var settings = SettingsFor(app.Configuration);
        if (!ready || settings is null)
        {
            app.MapMethods(Path, ["GET", "POST", "DELETE"], () => Results.Json(new
            { code = "MARKET_DAILY_MCP_NOT_CONFIGURED", validationOnly = true }, statusCode: 503))
                .RequireRateLimiting("market-daily-probe");
            app.MapGet(MetadataPath, () => Results.Json(new { code = "MARKET_DAILY_MCP_NOT_CONFIGURED" }, statusCode: 503));
            return;
        }
        app.UseAuthentication();
        app.UseAuthorization();
        // Remote callers must use HTTPS, cannot send a browser Origin, and cannot stream unbounded bodies.
        // The explicit local probe host is the sole loopback exception.
        app.Use(async (context, next) =>
        {
            if (!context.Request.Path.StartsWithSegments(Path)) { await next(context); return; }
            var local = app.Configuration.GetValue<bool>("MarketDailyProbe:AllowLocalHttp") &&
                context.Connection.RemoteIpAddress is { } ip && System.Net.IPAddress.IsLoopback(ip);
            if (!context.Request.IsHttps && !local) { context.Response.StatusCode = 400; return; }
            if (context.Request.Headers.ContainsKey("Origin")) { context.Response.StatusCode = 403; return; }
            if (context.Request.ContentLength > 524288) { context.Response.StatusCode = 413; return; }
            if (context.Request.Method == "POST")
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
                timeout.CancelAfter(TimeSpan.FromSeconds(10));
                using var buffer = new MemoryStream();
                try
                {
                    var chunk = new byte[8192]; int count;
                    while ((count = await context.Request.Body.ReadAsync(chunk, timeout.Token)) > 0)
                    {
                        if (buffer.Length + count > 524288) { context.Response.StatusCode = 413; return; }
                        buffer.Write(chunk, 0, count);
                    }
                }
                catch (OperationCanceledException) { context.Response.StatusCode = 408; return; }
                buffer.Position = 0;
                var original = context.Request.Body;
                context.Request.Body = buffer;
                try { await next(context); } finally { context.Request.Body = original; }
                return;
            }
            await next(context);
        });
        app.MapGet(MetadataPath, () => Results.Json(new
        {
            resource = Resource,
            authorization_servers = new[] { settings.Issuer },
            scopes_supported = new[] { settings.DiscoveryScope }, bearer_methods_supported = new[] { "header" }
        }));
        app.MapMcp(Path).RequireAuthorization(Policy).RequireRateLimiting("market-daily-probe");
    }
}

[McpServerToolType]
public sealed class MarketDailyValidationTool(IConfiguration config, IWebHostEnvironment environment)
{
    [McpServerTool(Name = "validate_market_daily", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("Validate the exact daily JSON for all 39 registered market instruments. No persistence, ingestion, SQL, analytics or jobs. Completion/session evidence is NOT independently checked. Never pass credentials in arguments.")]
    public async Task<string> ValidateMarketDaily(
        [Description("Exact UTF-8 JSON text of market-daily/latest.json, unchanged. Must contain all 39 bars.")] string dailyJson,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(dailyJson) || Encoding.UTF8.GetByteCount(dailyJson) > 262144)
            throw new McpException("Daily JSON is empty or exceeds 256 KiB.");
        try
        {
            using var payload = JsonDocument.Parse(dailyJson, new JsonDocumentOptions { MaxDepth = 16 });
            var file = System.IO.Path.GetFullPath(config["MarketData:BundlePath"] ??
                "artifacts/tradingview-backfill-36-v1/analytics-sources-v1/manifest.json", environment.ContentRootPath);
            using var registry = JsonDocument.Parse(await File.ReadAllTextAsync(file, cancellationToken));
            if (registry.RootElement.GetProperty("schemaVersion").GetInt32() != 1)
                throw new McpException("Trusted source registry unavailable.");
            var count = MarketDailyProbe.Validate(payload.RootElement, registry.RootElement.GetProperty("entries"), DateTimeOffset.UtcNow);
            if (count != 39) throw new McpException("This experiment requires all 39 instruments.");
            var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(dailyJson))).ToLowerInvariant();
            return JsonSerializer.Serialize(new
            {
                mode = "validation-only", receivedBars = count, payloadSha256 = digest,
                receiptId = "mcp-probe-" + digest[..24], receivedAt = DateTimeOffset.UtcNow,
                persisted = false, analyticsTriggered = false, completionValidated = false,
                validation = "Envelope, registered source identities and OHLC only; not session/history validation or ingestion."
            });
        }
        catch (JsonException) { throw new McpException("Invalid daily JSON or registry JSON."); }
        catch (InvalidDataException e) { throw new McpException("Invalid daily payload: " + e.Message); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or KeyNotFoundException or InvalidOperationException or ArgumentException)
        { throw new McpException("Trusted source registry unavailable."); }
    }
}
