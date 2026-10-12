using System.Text.Json;
using TradingJournal.Models;

namespace TradingJournal.Services;

// Read-only file routing; SQL remains the stock/ETF store. Missing market data never uses Yahoo.
public sealed class MarketPriceSources
{
    private readonly string _bundlePath;
    public MarketPriceSources(IConfiguration configuration, IWebHostEnvironment environment)
        : this(Path.GetFullPath(configuration["MarketData:BundlePath"] ?? "artifacts/tradingview-backfill-36-v1/analytics-sources-v1/manifest.json", environment.ContentRootPath)) { }
    public MarketPriceSources(string bundlePath) => _bundlePath = Path.GetFullPath(bundlePath);

    public static bool IsMarket(SeasonalityAsset asset) => AssetClassification.ClassFor(asset) is "forex" or "index" or "commodity";
    public JsonElement Metadata(string assetKey)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(_bundlePath));
        if (doc.RootElement.GetProperty("schemaVersion").GetInt32() != 1) throw new InvalidDataException("Unknown market bundle schema.");
        foreach (var e in doc.RootElement.GetProperty("entries").EnumerateArray())
            if (e.GetProperty("assetKey").GetString() == assetKey) return e.Clone();
        return JsonSerializer.SerializeToElement(new { assetKey, status = "unavailable", error = "No TradingView source in the 36-instrument registry; no Yahoo fallback" });
    }
    public IReadOnlyList<SeasonalityPrice> Prices(string assetKey)
    {
        var e = Metadata(assetKey);
        if (e.GetProperty("status").GetString() == "unavailable") return [];
        var folder = Path.GetDirectoryName(_bundlePath)!;
        var file = Path.GetFullPath(Path.Combine(folder, e.GetProperty("file").GetString()!));
        if (!file.StartsWith(folder + Path.DirectorySeparatorChar, StringComparison.Ordinal)) throw new InvalidDataException("Unsafe market source path.");
        using var doc = JsonDocument.Parse(File.ReadAllText(file));
        var root = doc.RootElement;
        foreach (var name in new[] { "id", "provider", "providerSymbol", "sourceIdentity", "assetKey" })
            if (root.GetProperty(name).GetString() != e.GetProperty(name).GetString()) throw new InvalidDataException("Market source identity mismatch: " + name);
        if (root.GetProperty("timeframe").GetString() != "1D") throw new InvalidDataException("Market source is not D1.");
        var rows = root.GetProperty("prices").EnumerateArray().Select(p => new SeasonalityPrice(DateOnly.ParseExact(p[0].GetString()!, "yyyy-MM-dd"), p[1].GetDecimal())).ToArray();
        for (var i = 1; i < rows.Length; i++) if (rows[i].Date <= rows[i - 1].Date) throw new InvalidDataException("Market dates not strictly ordered.");
        return rows;
    }
}
