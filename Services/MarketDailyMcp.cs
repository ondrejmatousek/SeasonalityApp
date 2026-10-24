using System.ComponentModel;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Security.Claims;
using Microsoft.Data.SqlClient;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using ModelContextProtocol;
using ModelContextProtocol.AspNetCore;
using ModelContextProtocol.Server;
using ModelContextProtocol.Protocol;

namespace SeasonalityApp.Services;

// OAuth resource server only. The configured provider owns login, PKCE, consent and refresh tokens.
// Never accepts the REST probe's shared secret. SQL quarantine writes require a separate explicit opt-in/scope.
public static class MarketDailyMcp
{
    public const string Path = "/mcp/market-daily";
    public const string Resource = "https://seasonality-gbfhasdjamcnf6dm.westeurope-01.azurewebsites.net" + Path;
    public const string MetadataPath = "/.well-known/oauth-protected-resource/mcp/market-daily";
    public const string Scheme = "MarketDailyOAuth";
    public const string Scope = "market.validate";
    public const string IngestScope = "market.ingest";
    public const string Policy = "MarketDailyValidate";

    public static bool Register(IServiceCollection services, IConfiguration config)
    {
        var settings = SettingsFor(config);
        if (settings is null) return false;
        var inbox = InboxConfigured(config);
        if(config.GetValue<bool>("MarketDailyInbox:Enabled")&&!inbox)return false;
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
                (HasScope(c.User,config,Scope)||(inbox&&HasScope(c.User,config,IngestScope))));
        }));
        var tools=new List<McpServerTool>{CreateTool<MarketDailyValidationTool>(nameof(MarketDailyValidationTool.ValidateMarketDaily),settings.DiscoveryScope)};
        if(inbox)
        {
            services.AddSingleton(new MarketDailySqlInbox(config.GetConnectionString("DefaultConnection")!));
            services.AddHttpClient(MarketDailyGitHubTrigger.ClientName)
                .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false });
            services.AddTransient<MarketDailyGitHubTrigger>();
            tools.Add(CreateTool<MarketDailySubmissionTool>(nameof(MarketDailySubmissionTool.SubmitMarketDaily),IngestScope));
            tools.Add(CreateTool<MarketDailyCollectionTools>(nameof(MarketDailyCollectionTools.GetContract),IngestScope));
            tools.Add(CreateTool<MarketDailyCollectionTools>(nameof(MarketDailyCollectionTools.GetReceipt),IngestScope));
            tools.Add(CreateTool<MarketH4Tool>(nameof(MarketH4Tool.SubmitMarketH4),IngestScope));
            tools.Add(CreateTool<MarketH4Tool>(nameof(MarketH4Tool.GetMarketH4Status),IngestScope));
            tools.Add(CreateTool<MarketZonePriceTool>(nameof(MarketZonePriceTool.SubmitZonePrices),IngestScope));
            tools.Add(CreateTool<MarketZonePriceTool>(nameof(MarketZonePriceTool.GetZonePricesStatus),IngestScope));
        }
        services.AddMcpServer().WithHttpTransport(o => o.SessionMode = HttpServerSessionMode.Stateless).WithTools(tools);
        return true;
    }

    private static McpServerTool CreateTool<T>(string method,string scope) where T:class =>
        McpServerTool.Create(typeof(T).GetMethod(method)!,
            (RequestContext<CallToolRequestParams> context)=>ActivatorUtilities.CreateInstance<T>(context.Services!),
            new McpServerToolCreateOptions { Meta=new JsonObject {
                // Official ChatGPT compatibility metadata; actual scope checks remain in each handler.
                ["securitySchemes"]=new JsonArray(new JsonObject { ["type"]="oauth2",["scopes"]=new JsonArray(scope) })
            }});

    public static bool InboxConfigured(IConfiguration config)
    {
        if(!config.GetValue<bool>("MarketDailyInbox:Enabled")||config["MarketDailyInbox:Mode"]!="shadow"||
            config["MarketDailyMcp:Provider"]!="Auth0")return false;
        try
        {
            var connection=new SqlConnectionStringBuilder(config.GetConnectionString("DefaultConnection")??"");
            return !string.IsNullOrWhiteSpace(connection.DataSource)&&!string.IsNullOrWhiteSpace(connection.InitialCatalog)&&
                !new[]{"master","model","msdb","tempdb"}.Contains(connection.InitialCatalog,StringComparer.OrdinalIgnoreCase);
        }
        catch(ArgumentException){return false;}
    }

    public static bool HasScope(ClaimsPrincipal? user,IConfiguration config,string scope)=>user?.Identity?.IsAuthenticated==true &&
        (user.FindFirst(config["MarketDailyMcp:Provider"]=="Auth0"?"scope":"scp")?.Value
            .Split(' ',StringSplitOptions.RemoveEmptyEntries).Contains(scope,StringComparer.Ordinal)??false);

    public static CallToolResult ScopeRequired(string scope)=>new() {
        IsError=true,Content=[new TextContentBlock { Text="Authorization required for scope "+scope+"." }],
        Meta=new JsonObject { ["mcp/www_authenticate"]=new JsonArray(
            $"Bearer resource_metadata=\"{Resource[..Resource.IndexOf(Path,StringComparison.Ordinal)]}{MetadataPath}\", error=\"insufficient_scope\", error_description=\"Additional permission required\", scope=\"{scope}\"") }
    };
    public static CallToolResult ToolResult(object value,bool error=false)
    {
        var json=JsonSerializer.Serialize(value,new JsonSerializerOptions(JsonSerializerDefaults.Web));
        return new() { IsError=error,Content=[new TextContentBlock { Text=json }],StructuredContent=JsonSerializer.Deserialize<JsonElement>(json) };
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
        var inbox=InboxConfigured(app.Configuration);
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
            var maxBytes=inbox?1048576:524288; // two bounded 256-KiB JSON strings plus JSON-RPC escaping
            if (context.Request.ContentLength > maxBytes) { context.Response.StatusCode = 413; return; }
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
                        if (buffer.Length + count > maxBytes) { context.Response.StatusCode = 413; return; }
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
            scopes_supported = inbox?new[] { settings.DiscoveryScope,IngestScope }:new[] { settings.DiscoveryScope }, bearer_methods_supported = new[] { "header" }
        }));
        app.MapMcp(Path).RequireAuthorization(Policy).RequireRateLimiting("market-daily-probe");
    }
}

[McpServerToolType]
public sealed class MarketDailyValidationTool(IConfiguration config, IWebHostEnvironment environment)
{
    [McpServerTool(Name = "validate_market_daily", ReadOnly = true, Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("Validate the exact daily JSON for all 39 registered instruments. Or read the producer contract with dailyJson={\"schemaVersion\":1,\"operation\":\"describe\"}; that mode is NOT payload validation. No persistence/SQL/jobs. Completion is NOT independently checked. Never pass credentials.")]
    public async Task<CallToolResult> ValidateMarketDaily(
        [Description("Exact UTF-8 JSON text of market-daily/latest.json, unchanged. Must contain all 39 bars.")] string dailyJson,
        RequestContext<CallToolRequestParams> context,
        CancellationToken cancellationToken)
    {
        if(!MarketDailyMcp.HasScope(context.User,config,MarketDailyMcp.Scope))
            return MarketDailyMcp.ScopeRequired(config["MarketDailyMcp:Provider"]=="Auth0"?MarketDailyMcp.Scope:MarketDailyMcp.Resource+"/"+MarketDailyMcp.Scope);
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
            if(payload.RootElement.TryGetProperty("operation",out var operation)&&operation.GetString()=="describe")
            {
                if(payload.RootElement.GetProperty("schemaVersion").GetInt32()!=1||payload.RootElement.EnumerateObject().Count()!=2)
                    throw new InvalidDataException("Contract request must contain only schemaVersion and operation.");
                return MarketDailyMcp.ToolResult(await MarketDailyCollectionTools.ReadContract(config,environment,cancellationToken));
            }
            var count = MarketDailyProbe.Validate(payload.RootElement, registry.RootElement.GetProperty("entries"), DateTimeOffset.UtcNow);
            if (count != 39) throw new McpException("This experiment requires all 39 instruments.");
            var digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(dailyJson))).ToLowerInvariant();
            return MarketDailyMcp.ToolResult(new
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
