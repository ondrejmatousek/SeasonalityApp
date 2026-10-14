using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace SeasonalityApp.Services;

// Transport/structural-validation experiment ONLY. No SQL, files, queue or analytics writes.
public static class MarketDailyProbe
{
    private const int MaxBytes = 262144;
    private const string Route = "/api/market-daily/probe";
    public static void Register(IServiceCollection services) => services.AddRateLimiter(o =>
    {
        o.RejectionStatusCode = 429;
        o.AddPolicy("market-daily-probe", c => RateLimitPartition.GetFixedWindowLimiter(
            c.Connection.RemoteIpAddress?.ToString() ?? "unknown", _ => new FixedWindowRateLimiterOptions
            { PermitLimit = 30, Window = TimeSpan.FromMinutes(1), QueueLimit = 0, AutoReplenishment = true }));
    });
    private static IResult? Access(HttpRequest request, IConfiguration configuration)
    {
        if (!configuration.GetValue<bool>("MarketDailyProbe:Enabled"))
            return Results.Json(new { code = "MARKET_DAILY_PROBE_DISABLED", probeOnly = true }, statusCode: 404);
        if (!request.IsHttps && !(configuration.GetValue<bool>("MarketDailyProbe:AllowLocalHttp") &&
            request.HttpContext.Connection.RemoteIpAddress is { } ip && System.Net.IPAddress.IsLoopback(ip)))
            return Results.Json(new { code = "HTTPS_REQUIRED" }, statusCode: 400);
        var key = configuration["MARKET_DAILY_PROBE_TOKEN"];
        if (string.IsNullOrEmpty(key) || key.Length < 32 || key.Length > 256)
            return Results.Json(new { code = "MARKET_DAILY_PROBE_NOT_CONFIGURED" }, statusCode: 503);
        var headers = request.Headers.Authorization;
        var header = headers.ToString();
        if (headers.Count != 1 || !header.StartsWith("Bearer ", StringComparison.Ordinal) || header.Length > 263)
            return Results.Unauthorized();
        var actual = SHA256.HashData(Encoding.UTF8.GetBytes(header[7..]));
        var expected = SHA256.HashData(Encoding.UTF8.GetBytes(key));
        return CryptographicOperations.FixedTimeEquals(actual, expected) ? null : Results.Unauthorized();
    }
    public static void Map(WebApplication app)
    {
        app.MapGet(Route, (HttpRequest r, IConfiguration c) => Access(r, c) ?? Results.Ok(new
        { mode = "validation-only", persisted = false, analyticsTriggered = false })).RequireRateLimiting("market-daily-probe");
        app.MapPost(Route, Receive).RequireRateLimiting("market-daily-probe");
    }
    private static async Task<IResult> Receive(HttpRequest request, IConfiguration configuration, IWebHostEnvironment environment)
    {
        var access = Access(request, configuration);
        if (access is not null) return access;
        if (!string.Equals(request.ContentType?.Split(';')[0].Trim(), "application/json", StringComparison.OrdinalIgnoreCase))
            return Results.StatusCode(415);
        if (request.ContentLength > MaxBytes) return Results.StatusCode(413);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(request.HttpContext.RequestAborted);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));
        using var buffer = new MemoryStream();
        try
        {
            var chunk = new byte[8192];
            int count;
            while ((count = await request.Body.ReadAsync(chunk, timeout.Token)) > 0)
            {
                if (buffer.Length + count > MaxBytes) return Results.StatusCode(413);
                buffer.Write(chunk, 0, count);
            }
        }
        catch (OperationCanceledException) { return Results.StatusCode(408); }
        var bytes = buffer.ToArray();
        try
        {
            using var payload = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 16 });
            var file = Path.GetFullPath(configuration["MarketData:BundlePath"] ??
                "artifacts/tradingview-backfill-36-v1/analytics-sources-v1/manifest.json", environment.ContentRootPath);
            using var registry = JsonDocument.Parse(await File.ReadAllTextAsync(file, timeout.Token));
            if (registry.RootElement.GetProperty("schemaVersion").GetInt32() != 1)
                return Results.Json(new { code = "PROBE_REGISTRY_UNAVAILABLE" }, statusCode: 503);
            var received = Validate(payload.RootElement, registry.RootElement.GetProperty("entries"), DateTimeOffset.UtcNow);
            var digest = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
            return Results.Ok(new { mode = "validation-only", receiptId = "probe-" + digest[..24], payloadSha256 = digest,
                receivedBars = received, receivedAt = DateTimeOffset.UtcNow, persisted = false, analyticsTriggered = false,
                completionValidated = false, validation = "Envelope, source identity and OHLC only; not historical/session validation or ingestion" });
        }
        catch (JsonException) { return Results.BadRequest(new { code = "INVALID_JSON" }); }
        catch (InvalidDataException e) { return Results.BadRequest(new { code = "INVALID_PROBE_PAYLOAD", reason = e.Message }); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or KeyNotFoundException or InvalidOperationException or ArgumentException)
        { return Results.Json(new { code = "PROBE_REGISTRY_UNAVAILABLE" }, statusCode: 503); }
    }
    private static void Check(bool ok, string reason) { if (!ok) throw new InvalidDataException(reason); }
    private static string? Text(JsonElement e, string key) => e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    private static void Unique(JsonElement e)
    {
        Check(e.ValueKind == JsonValueKind.Object, "Object required");
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var p in e.EnumerateObject()) Check(names.Add(p.Name), "Duplicate JSON property");
    }
    public static int Validate(JsonElement payload, JsonElement registry, DateTimeOffset now)
    {
        Unique(payload);
        Check(payload.TryGetProperty("schemaVersion", out var schema) && schema.ValueKind == JsonValueKind.Number && schema.TryGetInt32(out var version) && version == 1, "schemaVersion must be 1");
        Check(Text(payload, "timeframe") == "1D", "timeframe must be 1D");
        var fetched = Text(payload, "fetchedAt");
        Check(fetched is not null && (fetched.EndsWith('Z') || System.Text.RegularExpressions.Regex.IsMatch(fetched, @"[+-]\d\d:\d\d$")), "fetchedAt timezone required");
        Check(DateTimeOffset.TryParse(fetched, CultureInfo.InvariantCulture, DateTimeStyles.None, out var observed) && observed <= now && now - observed <= TimeSpan.FromHours(24), "fetchedAt stale/invalid/future");
        Check(payload.TryGetProperty("bars", out var bars) && bars.ValueKind == JsonValueKind.Array && bars.GetArrayLength() is > 0 and <= 39, "Require 1 to 39 bars");
        var sources = registry.EnumerateArray().ToDictionary(e => Text(e, "providerSymbol")!, e => e, StringComparer.Ordinal);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var bar in bars.EnumerateArray())
        {
            Unique(bar);
            var symbol = Text(bar, "symbol");
            var providerSymbol = Text(bar, "providerSymbol");
            Check(providerSymbol is not null && sources.ContainsKey(providerSymbol), "Unknown providerSymbol");
            var source = sources[providerSymbol!];
            var logical = Text(source, "logicalSymbol");
            var mapped = symbol switch { "NASDAQ100" => "NDX", "SP500" => "SPX", "NATURALGAS" => "NATGAS", _ => symbol };
            Check(mapped == logical && seen.Add(providerSymbol!), "Symbol mismatch/duplicate source");
            var provider = Text(bar, "provider");
            if (logical == "SPX" && provider == "SP") provider = "S&P";
            Check(provider == Text(source, "provider"), "Provider mismatch");
            Check(Text(bar, "timeframe") == "1D", "Bar timeframe must be 1D");
            foreach (var k in new[] { "id", "canonicalIdentity", "sourceIdentity" })
                if (bar.TryGetProperty(k, out var identity)) Check(identity.ValueKind == JsonValueKind.String && identity.GetString() == Text(source, k == "sourceIdentity" ? k : "id"), "Source identity mismatch");
            Check(bar.TryGetProperty("timestamp", out var ts) && ts.ValueKind == JsonValueKind.Number && ts.TryGetInt64(out var t) && t >= 0 && t <= observed.ToUnixTimeSeconds(), "Invalid/future Unix timestamp");
            var ohlc = new Dictionary<string, double>();
            foreach (var k in new[] { "open", "high", "low", "close" })
            {
                Check(bar.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var n) && double.IsFinite(n) && n != 0, "Invalid OHLC");
                ohlc[k] = bar.GetProperty(k).GetDouble();
            }
            Check(ohlc["low"] <= ohlc["open"] && ohlc["open"] <= ohlc["high"] && ohlc["low"] <= ohlc["close"] && ohlc["close"] <= ohlc["high"], "OHLC bounds");
            if (Text(source, "assetClass") != "commodity") Check(ohlc.Values.All(v => v > 0), "Non-futures prices must be positive");
            Check(bar.TryGetProperty("completed", out var completed) && completed.ValueKind == JsonValueKind.True && Text(bar, "status") == "ok", "Completed/ok declaration required");
        }
        return bars.GetArrayLength();
    }
}
