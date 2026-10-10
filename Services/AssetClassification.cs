using TradingJournal.Models;

namespace TradingJournal.Services;

// Catalog metadata describes the traded instrument, never its COT proxy.
public static class AssetClassification
{
    private static readonly HashSet<string> Indices = ["DXY", "SPX", "NDX", "DJI", "RUT", "VIX", "DAX", "FTSE100", "NIKKEI225", "HSI", "STOXX50E"];
    private static readonly HashSet<string> Crypto = ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BNBUSD"];
    private static readonly HashSet<string> Etfs = ["DBC", "PDBC", "DBA", "DBE", "DBB", "CPER", "WEAT", "CORNETF", "SOYBETF", "CANE",
        "SPY", "QQQ", "DIA", "IWM", "VTI", "VT", "EFA", "EEM", "TLT", "IEF", "GLD", "SLV", "USO", "UNG",
        "XLE", "XLF", "XLK", "XLV", "XLY", "XLP", "XLI", "XLU", "XLB", "VNQ", "ARKK"];

    public static string ClassFor(SeasonalityAsset asset) => CotCatalog.IsForexPair(asset.Key) ? "forex"
        : Indices.Contains(asset.Key) ? "index" : Crypto.Contains(asset.Key) ? "crypto"
        : asset.YahooSymbol.EndsWith("=F", StringComparison.Ordinal) ? "commodity"
        : Etfs.Contains(asset.Key) ? "etf" : "equity";

    public static string? CommodityGroupFor(string key) => key switch
    {
        "XAUUSD" or "SILVER" or "COPPER" or "PLATINUM" or "PALLADIUM" => "metals",
        "WTI" or "BRENT" or "NATGAS" or "GASOLINE" or "HEATINGOIL" => "energy",
        "CORN" or "WHEAT" or "KCWHEAT" or "SOYBEANS" or "OATS" or "RICE" or "SOYBEANOIL" or "SOYBEANMEAL" => "grains",
        "COFFEE" or "SUGAR" or "COTTON" or "COCOA" or "ORANGEJUICE" => "softs",
        "LIVECATTLE" or "FEEDERCATTLE" or "LEANHOGS" => "livestock",
        "MILK" or "BUTTER" or "CHEESE" => "dairy",
        "LUMBER" => "wood",
        _ => null
    };
}
