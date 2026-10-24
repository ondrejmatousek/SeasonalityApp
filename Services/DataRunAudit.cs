using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;

namespace SeasonalityApp.Services;

// Public operational metadata only, matching the existing public /runs/ audit.
// No payloads, prices, credentials, provider calls, writes or workflow triggers.
public sealed class DataRunAudit(IConfiguration config, IMemoryCache cache)
{
    private readonly SemaphoreSlim gate = new(1, 1);
    public sealed record QuarantinedBar(string Symbol,long StartUnix);
    public sealed record Entry(string Id, string Source, string[] Timeframes, DateTimeOffset ReceivedAt,
        string Status, int Inserted, int Duplicates, int Excluded, int Symbols, int ReceivedBars,
        int VolumeWarnings, bool Historical, string[]? BlockedSymbols = null, int? OhlcConflictRows = null,
        string? Admission = null, QuarantinedBar[]? QuarantinedBars = null);
    public sealed record Snapshot(int SchemaVersion, bool Ready, DateTimeOffset AsOf, int LimitPerSource,
        List<Entry> Runs, string? Code = null);
    public static void Register(IServiceCollection services)
    {
        services.AddMemoryCache();
        services.AddSingleton<DataRunAudit>();
        services.AddCors(o => o.AddPolicy("data-run-audit", p => p
            .WithOrigins("https://delightful-ground-010f3d910.5.azurestaticapps.net")
            .WithMethods("GET").AllowAnyHeader()));
        services.AddRateLimiter(o => o.AddPolicy("data-run-audit", c =>
            RateLimitPartition.GetFixedWindowLimiter(c.Connection.RemoteIpAddress?.ToString() ?? "unknown",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 })));
    }
    public static void Map(WebApplication app) => app.MapGet("/api/data-runs/receipts",
        async (DataRunAudit audit, HttpContext context) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            var snapshot = await audit.Read(context.RequestAborted);
            return Results.Json(snapshot, statusCode: snapshot.Ready ? 200 : 503);
        }).RequireCors("data-run-audit").RequireRateLimiting("data-run-audit");

    public async Task<Snapshot> Read(CancellationToken ct)
    {
        if(cache.TryGetValue<Snapshot>("data-run-audit", out var saved)) return saved!;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        var entered = false;
        try
        {
            await gate.WaitAsync(timeout.Token); entered = true;
            if(cache.TryGetValue<Snapshot>("data-run-audit", out saved)) return saved!;
            var cs = config.GetConnectionString("DefaultConnection");
            if(string.IsNullOrWhiteSpace(cs)) throw new InvalidOperationException("SQL not configured");
            await using var db = new SqlConnection(new SqlConnectionStringBuilder(cs) { ConnectTimeout = 15 }.ConnectionString);
            await db.OpenAsync(timeout.Token);
            var entries = new List<Entry>();
            foreach(var source in new[] { "market_h4", "market_zones" })
            {
                // Fixed identifiers only. Limit each source independently so H4 cannot hide D1.
                var sql = source == "market_h4"
                    ? "SELECT TOP(200) ReceiptId,ReceivedAt,Status,InsertedBars,DuplicateBars,ExcludedBars,PayloadUtf8,VolumeDifferencesJson,OhlcConflictsJson,AdmissionPolicy FROM market_h4.LiveReceipts ORDER BY ReceivedAt DESC,ReceiptId"
                    : "SELECT TOP(200) ReceiptId,ReceivedAt,Status,InsertedBars,DuplicateBars,ExcludedBars,PayloadUtf8,VolumeAudit,NULL,NULL FROM market_zones.Receipts ORDER BY ReceivedAt DESC,ReceiptId";
                await using var command = new SqlCommand(sql, db) { CommandTimeout = 25 };
                await using var reader = await command.ExecuteReaderAsync(timeout.Token);
                while(await reader.ReadAsync(timeout.Token))
                {
                    using var payload = JsonDocument.Parse((byte[])reader[6]);
                    var frames = new HashSet<string>(); var symbols = new HashSet<string>(); var received = 0; var historical = false;
                    foreach(var capture in payload.RootElement.GetProperty("captures").EnumerateArray())
                    {
                        using var raw = JsonDocument.Parse(capture.GetProperty("rawJson").GetString()!);
                        var data = raw.RootElement; var interval = data.GetProperty("interval").GetString();
                        frames.Add(interval == "4h" ? "H4" : interval == "1D" ? "D1" : "unknown");
                        symbols.Add(data.GetProperty("symbol").GetString()!);
                        var count = data.GetProperty("count").GetInt32(); received += count; historical |= count > 96;
                    }
                    var warnings = 0;
                    if(!reader.IsDBNull(7)) { using var volume = JsonDocument.Parse(reader.GetString(7)); warnings = volume.RootElement.GetArrayLength(); }
                    var conflicts=reader.IsDBNull(8)?null:JsonSerializer.Deserialize<MarketH4Store.OhlcConflict[]>(reader.GetString(8));
                    var admission=reader.IsDBNull(9)?(conflicts is null?null:MarketH4Store.LegacyAdmissionPolicy):reader.GetString(9);
                    entries.Add(new(reader.GetString(0), source, frames.Order().ToArray(), reader.GetDateTimeOffset(1),
                        reader.GetString(2), reader.GetInt32(3), reader.GetInt32(4), reader.GetInt32(5), symbols.Count, received, warnings, historical,
                        admission==MarketH4Store.AdmissionPolicy?[]:conflicts?.Select(c=>c.Symbol).Distinct().Order().ToArray(),conflicts?.Length,
                        admission,conflicts?.Select(c=>new QuarantinedBar(c.Symbol,c.StartUnix)).Distinct().OrderBy(c=>c.Symbol).ThenBy(c=>c.StartUnix).ToArray()));
                }
            }
            var snapshot = new Snapshot(1, true, DateTimeOffset.UtcNow, 200, entries);
            cache.Set("data-run-audit", snapshot, TimeSpan.FromSeconds(30));
            return snapshot;
        }
        catch(Exception e) when(e is SqlException or InvalidOperationException or OperationCanceledException or JsonException or KeyNotFoundException)
        {
            var unavailable = new Snapshot(1, false, DateTimeOffset.UtcNow, 200, [], "RUN_AUDIT_UNAVAILABLE");
            if(entered) cache.Set("data-run-audit", unavailable, TimeSpan.FromSeconds(5));
            return unavailable;
        }
        finally { if(entered) gate.Release(); }
    }
}
