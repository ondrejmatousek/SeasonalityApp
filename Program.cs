using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using TradingJournal.Data;
using TradingJournal.Services;
using SeasonalityApp.Controllers;
using SeasonalityApp.Services;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
if(args.Contains("--export-market-inbox",StringComparer.Ordinal)||args.Contains("--publish-market-inbox",StringComparer.Ordinal))
{
    if(!builder.Configuration.GetValue<bool>("MarketDailyInboxWorker:Enabled"))throw new InvalidOperationException("Explicit SQL worker opt-in required.");
    var sql=builder.Configuration.GetConnectionString("DefaultConnection")??throw new InvalidOperationException("SQL connection required.");
    var sqlBuilder=new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(sql);sqlBuilder.ConnectTimeout=Math.Max(sqlBuilder.ConnectTimeout,120);
    var store=new MarketDailySqlInbox(sqlBuilder.ConnectionString);
    var repository=Path.GetFullPath(builder.Configuration["MarketDailyInboxWorker:RepositoryRoot"]??throw new InvalidOperationException("Repository required."));
    var head=await store.ReadPublicationSnapshotAsync();
    if(args.Contains("--export-market-inbox",StringComparer.Ordinal))
    {
        var run=head is not null;
        var manifest=Path.Combine(repository,"data","generated","site","data","manifest.json");
        if(run&&File.Exists(manifest))
        {
            using var previous=System.Text.Json.JsonDocument.Parse(await File.ReadAllBytesAsync(manifest));
            if(previous.RootElement.TryGetProperty("marketDailySql",out var published))
            {
                var generation=published.GetProperty("generationId").GetInt64();
                if(generation>head!.GenerationId)throw new InvalidDataException("SQL head older than committed web generation.");
                if(generation==head!.GenerationId)
                {
                    if(published.GetProperty("stateSha256").GetString()!=head.StateSha256||published.GetProperty("receiptId").GetString()!=head.ReceiptId)
                        throw new InvalidDataException("Committed SQL generation identity changed.");
                    run=false;
                }
            }
        }
        if(run)MarketDailySqlPublication.Export(head!,repository,"artifacts/sql-market",DateTimeOffset.UtcNow);
        if(Environment.GetEnvironmentVariable("GITHUB_OUTPUT") is string output)await File.AppendAllTextAsync(output,"run="+run.ToString().ToLowerInvariant()+"\n");
        Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new {run,generationId=head?.GenerationId}));
    }
    else
    {
        if(!builder.Configuration.GetValue<bool>("MarketDailySqlPublication:Enabled"))throw new InvalidOperationException("Explicit SQL publication opt-in required.");
        if(head is null)throw new InvalidOperationException("No accepted SQL generation.");
        var context=Path.Combine(repository,"artifacts","sql-market","context.json");
        MarketDailySqlPublication.CheckContext(head,context);
        await store.WithPublicationFenceAsync(head,()=>MarketDailySqlPublication.CommitAsync(repository,context));
    }
    return;
}
// Explicit shadow-only CLI, before any stock/COT database registration or schema initialization.
// Requires a repository/Node runtime and an opt-in flag; never starts during ordinary web deployment.
if (args.Contains("--process-market-inbox-once", StringComparer.Ordinal)||args.Contains("--process-market-inbox-queue",StringComparer.Ordinal))
{
    if (!builder.Configuration.GetValue<bool>("MarketDailyInboxWorker:Enabled"))
        throw new InvalidOperationException("MarketDailyInboxWorker:Enabled must be explicitly true.");
    var inboxConnection=builder.Configuration.GetConnectionString("DefaultConnection");
    var repository=builder.Configuration["MarketDailyInboxWorker:RepositoryRoot"];
    var state=builder.Configuration["MarketDailyInboxWorker:BootstrapState"];
    if (string.IsNullOrWhiteSpace(inboxConnection)||string.IsNullOrWhiteSpace(repository)||string.IsNullOrWhiteSpace(state))
        throw new InvalidOperationException("Shadow inbox worker configuration incomplete.");
    var workerConnection=new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(inboxConnection);
    workerConnection.ConnectTimeout=Math.Max(workerConnection.ConnectTimeout,120);
    var worker=new MarketDailyInboxWorker(new MarketDailySqlInbox(workerConnection.ConnectionString),repository,state,
        builder.Configuration["MarketDailyInboxWorker:NodeExecutable"]??"node",
        builder.Configuration["MarketDailyInboxWorker:AnalyticsSnapshot"],builder.Configuration["MarketDailyInboxWorker:HtfFeed"]);
    var queue=args.Contains("--process-market-inbox-queue",StringComparer.Ordinal);
    for(var i=0;i<(queue?5:1);i++)
    {
        var result=await worker.ProcessOneAsync();
        Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(result));
        if(result.Status=="Empty")break;
        if(result.Status!="Committed"){Environment.ExitCode=1;break;}
        if(queue&&i==4){Console.WriteLine("Queue batch limit reached; continue next scheduled run before publication.");Environment.ExitCode=1;}
    }
    return;
}
MarketDailyProbe.Register(builder.Services);
var marketMcpReady = MarketDailyMcp.Register(builder.Services, builder.Configuration);
// Explicit isolated probe host: no SQL registration, schema initialization or market jobs.
if (args.Contains("--market-daily-probe-only", StringComparer.OrdinalIgnoreCase))
{
    builder.Configuration["MarketDailyProbe:AllowLocalHttp"] = "true";
    var probe = builder.Build();
    probe.UseRouting();
    probe.UseRateLimiter();
    MarketDailyProbe.Map(probe);
    MarketDailyMcp.Map(probe, marketMcpReady);
    await probe.RunAsync();
    return;
}
var connection = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection is required.");
var exporting = args.Contains("--export-static", StringComparer.OrdinalIgnoreCase);
if (exporting)
{
    // A paused serverless SQL database can need more than 30 seconds to resume.
    var exportConnection = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(connection) { ConnectTimeout = 120 };
    connection = exportConnection.ConnectionString;
}

builder.Services.AddDbContext<SeasonalityDbContext>(options => options.UseSqlServer(connection, sql =>
{
    sql.EnableRetryOnFailure(8, TimeSpan.FromSeconds(30), null);
    if (exporting) sql.CommandTimeout(180);
}));
builder.Services.AddHttpClient();
builder.Services.AddHttpClient("CFTC", client =>
{
    client.Timeout = TimeSpan.FromSeconds(90);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("SeasonalityApp-COT/1.0");
});
builder.Services.AddScoped<SeasonalityService>();
builder.Services.AddScoped<MarketPriceSources>();
builder.Services.AddScoped<CotService>();
builder.Services.AddScoped<StaticSiteExporter>();
builder.Services.AddSingleton<SeasonalityUpdateState>();
builder.Services.AddControllersWithViews().ConfigureApplicationPartManager(parts =>
{
    foreach (var part in parts.ApplicationParts.OfType<AssemblyPart>().Where(part => part.Assembly != typeof(SeasonalityController).Assembly).ToList())
        parts.ApplicationParts.Remove(part);
});

var app = builder.Build();
if (args.Contains("--render-static-shell", StringComparer.OrdinalIgnoreCase))
{
    var outputIndex = Array.IndexOf(args, "--output");
    if (outputIndex < 0 || outputIndex + 1 >= args.Length) throw new ArgumentException("Missing --output.");
    using var scope = app.Services.CreateScope();
    await scope.ServiceProvider.GetRequiredService<StaticSiteExporter>().RefreshShellAsync(args[outputIndex + 1]);
    return;
}
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<SeasonalityDbContext>();
    if (args.Contains("--export-static", StringComparer.OrdinalIgnoreCase))
    {
        var outputIndex = Array.IndexOf(args, "--output");
        if (outputIndex < 0 || outputIndex + 1 >= args.Length)
            throw new ArgumentException("--export-static requires --output <new-directory>.");
        // Export is deliberately read-only: no schema initialization or updates.
        await scope.ServiceProvider.GetRequiredService<StaticSiteExporter>().ExportAsync(args[outputIndex + 1]);
        return;
    }
    await db.Database.EnsureCreatedAsync();
    await db.EnsureCotSchemaAsync();
    if (args.Contains("--update-missing-once", StringComparer.OrdinalIgnoreCase))
    {
        await scope.ServiceProvider.GetRequiredService<SeasonalityService>().UpdateMissingAsync();
        return;
    }
    if (args.Contains("--update-cot-once", StringComparer.OrdinalIgnoreCase))
    {
        await scope.ServiceProvider.GetRequiredService<CotService>().UpdateAsync();
        return;
    }
    if (args.Contains("--update-once", StringComparer.OrdinalIgnoreCase))
    {
        var stocks = scope.ServiceProvider.GetRequiredService<SeasonalityService>();
        await stocks.UpdateAsync();
        var stockReportIndex = Array.IndexOf(args, "--stock-refresh-report");
        if (stockReportIndex >= 0)
        {
            if (stockReportIndex + 1 >= args.Length) throw new ArgumentException("Stock refresh report path required");
            var reportPath = Path.GetFullPath(args[stockReportIndex + 1]);
            var auditRoot = Path.GetFullPath("artifacts") + Path.DirectorySeparatorChar;
            if (!reportPath.StartsWith(auditRoot, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Stock audit must be under artifacts/");
            Directory.CreateDirectory(Path.GetDirectoryName(reportPath)!);
            await File.WriteAllTextAsync(reportPath, System.Text.Json.JsonSerializer.Serialize(stocks.LastStockRefreshAudit));
        }
        return;
    }
}
if (!app.Environment.IsDevelopment()) app.UseExceptionHandler("/Home/Error");
app.UseStaticFiles();
app.UseRouting();
app.UseRateLimiter();
MarketDailyProbe.Map(app);
MarketDailyMcp.Map(app, marketMcpReady);
app.MapControllerRoute("default", "{controller=Seasonality}/{action=Index}/{id?}");
app.Run();
