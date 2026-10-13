using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using TradingJournal.Data;
using TradingJournal.Services;
using SeasonalityApp.Controllers;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
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
app.MapControllerRoute("default", "{controller=Seasonality}/{action=Index}/{id?}");
app.Run();
