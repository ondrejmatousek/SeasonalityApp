using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.Mvc.Razor;
using Microsoft.AspNetCore.Mvc.Rendering;
using Microsoft.AspNetCore.Mvc.ViewFeatures;
using Microsoft.EntityFrameworkCore;
using TradingJournal.Data;
using TradingJournal.Models;
using TradingJournal.ViewModels;

namespace TradingJournal.Services;

public sealed record StaticPrices(string Path, int Count, string? LastDate);
public sealed record StaticContract(IReadOnlyDictionary<string, string> Files, int Count, string? LastDate);

// Build-time only. Nothing in the generated directory needs .NET or SQL.
public sealed class StaticSiteExporter(SeasonalityDbContext db, IWebHostEnvironment environment,
    IRazorViewEngine views, IModelMetadataProvider metadata, ITempDataProvider tempData,
    IServiceProvider services, ILogger<StaticSiteExporter> logger)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task ExportAsync(string output, CancellationToken ct = default)
    {
        var directory = Path.GetFullPath(output);
        var artifacts = Path.GetFullPath(Path.Combine(environment.ContentRootPath, "artifacts")) + Path.DirectorySeparatorChar;
        if (!directory.StartsWith(artifacts, StringComparison.OrdinalIgnoreCase) || Directory.Exists(directory) || File.Exists(directory))
            throw new ArgumentException("Use a new directory underneath artifacts/. Existing output is never overwritten.");
        Directory.CreateDirectory(directory);
        Directory.CreateDirectory(Path.Combine(directory, "data", "prices"));
        Directory.CreateDirectory(Path.Combine(directory, "data", "cot"));

        var assets = SeasonalityService.Assets;
        var known = assets.Select(item => item.Key).ToHashSet(StringComparer.Ordinal);
        var prices = new Dictionary<string, StaticPrices>();
        string? current = null;
        var rows = new List<object[]>();
        async Task FlushPrices()
        {
            if (current is null) return;
            var path = await WriteHashedAsync(directory, "prices", current, new { assetKey = current, prices = rows }, ct);
            prices[current] = new StaticPrices(path, rows.Count, rows.Count == 0 ? null : (string)rows[^1][0]);
            rows.Clear();
        }
        // One streaming SQL query instead of one round trip for every ticker.
        await foreach (var row in db.SeasonalityPrices.AsNoTracking().OrderBy(item => item.AssetKey).ThenBy(item => item.Date)
            .Select(item => new { item.AssetKey, item.Date, item.Close }).AsAsyncEnumerable().WithCancellation(ct))
        {
            if (!known.Contains(row.AssetKey)) continue;
            if (current != row.AssetKey) { await FlushPrices(); current = row.AssetKey; }
            rows.Add([row.Date.ToString("yyyy-MM-dd"), row.Close]);
        }
        await FlushPrices();
        foreach (var asset in assets.Where(item => !prices.ContainsKey(item.Key)))
        {
            current = asset.Key;
            await FlushPrices();
        }
        if (!prices.TryGetValue(assets[0].Key, out var initial) || initial.Count == 0)
            throw new InvalidOperationException("Initial instrument has no price history; refusing to publish an empty snapshot.");

        var contracts = new Dictionary<string, StaticContract>();
        var reports = await db.CotReports.AsNoTracking().OrderBy(item => item.ReportDate).ToListAsync(ct);
        var byContract = reports.GroupBy(item => item.ContractCode).ToDictionary(item => item.Key, item => item.ToList());
        foreach (var market in CotCatalog.Markets)
        {
            var history = byContract.GetValueOrDefault(market.ContractCode) ?? [];
            if (history.Count == 0)
                throw new InvalidOperationException($"COT contract {market.ContractCode} has no history; refusing an incomplete snapshot.");
            var files = new Dictionary<string, string>();
            foreach (var lookbackWeeks in new[] { 26, 52, 156 })
            {
                var path = await WriteHashedAsync(directory, "cot", $"{market.ContractCode}-{lookbackWeeks}",
                    new { contractCode = market.ContractCode, lookbackWeeks, reports = CotService.BuildPoints(history, lookbackWeeks) }, ct);
                files[lookbackWeeks.ToString()] = path;
            }
            contracts[market.ContractCode] = new StaticContract(files, history.Count, history[^1].ReportDate.ToString("yyyy-MM-dd"));
        }
        var manifest = JsonSerializer.Serialize(new
        {
            schemaVersion = 1,
            exportedAt = DateTimeOffset.UtcNow,
            assets = assets.Select(asset => new
            {
                key = asset.Key, name = asset.Name, aliases = SeasonalityService.SearchAliases(asset.Key),
                assetClass = AssetClassification.ClassFor(asset), commodityGroup = AssetClassification.CommodityGroupFor(asset.Key),
                prices = prices[asset.Key],
                cot = new
                {
                    note = CotCatalog.NoteForAsset(asset.Key),
                    markets = CotCatalog.MarketsForAsset(asset.Key).Select(market => new
                    {
                        key = market.Key, name = market.Name, contractCode = market.ContractCode,
                        isDollarIndex = market.Key == "USD",
                        isQuoteCurrency = CotCatalog.IsForexPair(asset.Key) && asset.Key[3..] == market.Key
                    })
                }
            }),
            contracts
        }, Json);
        await File.WriteAllTextAsync(Path.Combine(directory, "data", "manifest.json"), manifest, ct);
        await RenderPageAsync(directory, manifest);
        foreach (var file in Directory.EnumerateFiles(environment.WebRootPath, "*", SearchOption.AllDirectories))
        {
            var destination = Path.Combine(directory, Path.GetRelativePath(environment.WebRootPath, file));
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            File.Copy(file, destination);
        }
        File.Copy(Path.Combine(environment.ContentRootPath, "StaticSite", "staticwebapp.config.json"),
            Path.Combine(directory, "staticwebapp.config.json"));
        var exported = Directory.GetFiles(directory, "*", SearchOption.AllDirectories);
        var bytes = exported.Sum(file => new FileInfo(file).Length);
        if (exported.Length > 15000 || bytes > 240L * 1024 * 1024)
            throw new InvalidOperationException("Static export exceeds the safe Azure Free hosting size/file limits.");
        logger.LogInformation("Static export ready: {Directory}; {Assets} tickers ({Empty} without prices), {Contracts} COT contracts, {Files} files, {MiB:F2} MiB",
            directory, assets.Count, prices.Values.Count(item => item.Count == 0), contracts.Count, exported.Length, bytes / 1048576d);
    }

    private static async Task<string> WriteHashedAsync(string directory, string folder, string key, object payload, CancellationToken ct)
    {
        if (!Regex.IsMatch(key, "^[A-Za-z0-9_-]+$")) throw new InvalidOperationException("Unsafe export key.");
        var bytes = JsonSerializer.SerializeToUtf8Bytes(payload, Json);
        var hash = Convert.ToHexStringLower(SHA256.HashData(bytes))[..20];
        var path = $"/data/{folder}/{key}.{hash}.json";
        await File.WriteAllBytesAsync(Path.Combine(directory, path[1..].Replace('/', Path.DirectorySeparatorChar)), bytes, ct);
        return path;
    }

    private async Task RenderPageAsync(string directory, string manifest)
    {
        var http = new DefaultHttpContext { RequestServices = services };
        http.Request.Scheme = "http";
        http.Request.Host = new HostString("localhost");
        var action = new ActionContext(http, new RouteData(), new ActionDescriptor());
        var view = views.GetView(null, "/Views/Seasonality/Index.cshtml", true);
        if (!view.Success) throw new InvalidOperationException("Static HTML view not found.");
        var data = new ViewDataDictionary<SeasonalityViewModel>(metadata, new ModelStateDictionary())
        {
            Model = new SeasonalityViewModel { Assets = SeasonalityService.Assets, StaticManifestJson = manifest }
        };
        using var writer = new StringWriter();
        await view.View.RenderAsync(new ViewContext(action, view.View, data,
            new TempDataDictionary(http, tempData), writer, new HtmlHelperOptions()));
        await File.WriteAllTextAsync(Path.Combine(directory, "index.html"), writer.ToString());
    }
}
