using TradingJournal.Models;

namespace TradingJournal.Services;

// Contract codes verified against CFTC Legacy Futures Only (6dca-aqww).
// Keep different contracts separate: never splice old/new lumber or mini/micro series.
public static class CotCatalog
{
    private static readonly HashSet<string> Currencies = ["EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "USD"];

    public static IReadOnlyList<CotMarket> Markets { get; } =
    [
        new("EUR", "Euro", "099741"),
        new("GBP", "Britská libra", "096742"),
        new("JPY", "Japonský jen", "097741"),
        new("CHF", "Švýcarský frank", "092741"),
        new("CAD", "Kanadský dolar", "090741"),
        new("AUD", "Australský dolar", "232741"),
        new("NZD", "Novozélandský dolar", "112741"),
        new("USD", "US Dollar Index (DXY)", "098662"),
        new("GOLD", "Gold · COMEX", "088691"),
        new("SILVER", "Silver · COMEX", "084691"),
        new("COPPER", "Copper #1 · COMEX", "085692"),
        new("PLATINUM", "Platinum · NYMEX", "076651"),
        new("PALLADIUM", "Palladium · NYMEX", "075651"),
        new("WTI", "WTI Physical · NYMEX", "067651"),
        new("BRENT", "Brent Last Day · NYMEX", "06765T"),
        new("NATGAS", "Natural Gas · NYMEX", "023651"),
        new("CORN", "Corn · CBOT", "002602"),
        new("WHEAT", "Wheat SRW · CBOT", "001602"),
        new("SOYBEANS", "Soybeans · CBOT", "005602"),
        new("COFFEE", "Coffee C · ICE US", "083731"),
        new("SUGAR", "Sugar No. 11 · ICE US", "080732"),
        new("GASOLINE", "Gasoline RBOB · NYMEX", "111659"),
        new("HEATINGOIL", "NY Harbor ULSD · NYMEX", "022651"),
        new("COTTON", "Cotton No. 2 · ICE US", "033661"),
        new("COCOA", "Cocoa · ICE US", "073732"),
        new("OATS", "Oats · CBOT", "004603"),
        new("RICE", "Rough Rice · CBOT", "039601"),
        new("SOYBEANOIL", "Soybean Oil · CBOT", "007601"),
        new("SOYBEANMEAL", "Soybean Meal · CBOT", "026603"),
        new("LIVECATTLE", "Live Cattle · CME", "057642"),
        new("FEEDERCATTLE", "Feeder Cattle · CME", "061641"),
        new("LEANHOGS", "Lean Hogs · CME", "054642"),
        new("ORANGEJUICE", "Frozen Concentrated Orange Juice · ICE US", "040701"),
        new("LUMBER", "Lumber · CME (nový kontrakt)", "058644"),
        new("LUMBEROLD", "Random Length Lumber · CME (historický)", "058643"),
        new("SPX", "E-mini S&P 500 · CME", "13874A"),
        new("NDX", "Nasdaq Mini (NQ) · CME", "209742"),
        new("DJI", "DJIA × $5 · CBOT", "124603"),
        new("RUT", "Russell E-mini · CME", "239742"),
        new("VIX", "VIX Futures · CFE", "1170E1"),
        new("NIKKEI225", "Nikkei 225 Yen · CME", "240743"),
        new("EAFE", "MSCI EAFE · ICE US", "244041"),
        new("EM", "MSCI Emerging Markets · ICE US", "244042"),
        new("USTBOND", "Ultra UST Bond · CBOT", "020604"),
        new("UST10Y", "UST 10Y Note · CBOT", "043602"),
        new("ENERGY", "E-mini S&P Energy · CME", "138749"),
        new("FINANCIAL", "E-mini S&P Financial · CME", "13874C"),
        new("TECHNOLOGY", "E-mini S&P Technology · CME", "13874I"),
        new("HEALTHCARE", "E-mini S&P Health Care · CME", "13874E"),
        new("CONSUMERDISC", "E-mini S&P Consumer Discretionary · CME", "138747"),
        new("STAPLES", "E-mini S&P Consumer Staples · CME", "138748"),
        new("INDUSTRIAL", "E-mini S&P Industrial · CME", "13874F"),
        new("UTILITIES", "E-mini S&P Utilities · CME", "13874J"),
        new("MATERIALS", "E-mini S&P Materials · CME", "13874H"),
        new("BTC", "Bitcoin · CME", "133741"),
        new("ETH", "Ether Cash Settled · CME", "146021"),
        new("SOL", "Solana · CME", "177741"),
        new("XRP", "XRP · CME", "176740")
    ];

    private sealed record Mapping(string[] Markets, string Note);
    private static readonly IReadOnlyDictionary<string, Mapping> Mappings = BuildMappings();
    private static readonly IReadOnlyDictionary<string, CotMarket> ByKey = Markets.ToDictionary(x => x.Key);

    private static Dictionary<string, Mapping> BuildMappings()
    {
        var result = new Dictionary<string, Mapping>(StringComparer.OrdinalIgnoreCase);
        void Map(string market, string note, params string[] assets)
        {
            foreach (var asset in assets) result.Add(asset, new([market], note));
        }
        const string commodity = "Pozice v podkladových komoditních futures, nikoli v celém spotovém trhu. Každá řada patří uvedené burze a kontraktu.";
        foreach (var key in new[] { "SILVER", "COPPER", "PLATINUM", "PALLADIUM", "WTI", "BRENT", "NATGAS", "CORN", "WHEAT", "SOYBEANS", "COFFEE", "SUGAR", "GASOLINE", "HEATINGOIL", "COTTON", "COCOA", "OATS", "RICE", "SOYBEANOIL", "SOYBEANMEAL", "LIVECATTLE", "FEEDERCATTLE", "LEANHOGS", "ORANGEJUICE" })
            Map(key, commodity, key);
        Map("GOLD", "Podkladové futures na zlato (COMEX); nejde o samostatný COT report spotového XAU/USD.", "XAUUSD");
        result.Add("LUMBER", new(["LUMBER", "LUMBEROLD"], "Nový Lumber a ukončený Random Length Lumber (LBS) jsou odlišné kontrakty. Historie se nespojuje; stará řada končí v roce 2023."));
        Map("USD", "Pozice se vztahují k futures na US Dollar Index.", "DXY");
        foreach (var key in new[] { "SPX", "NDX", "DJI", "RUT", "VIX", "NIKKEI225" })
            Map(key, "Podkladové indexové futures, nikoli pozice v hotovostním indexu. Mini, micro a konsolidované reporty se nesčítají.", key);
        foreach (var key in new[] { "BTC", "ETH", "SOL", "XRP" })
            Map(key, "Podkladové kryptoměnové futures na CME; nejde o pozice na spotových burzách ani o celý kryptoměnový trh.", key + "USD");

        const string etf = "Proxy: futures na podkladový trh / benchmark, nikoli COT pozic přímo v ETF. Složení, expirace a expozice ETF se mohou lišit.";
        foreach (var (asset, market) in new[] { ("SPY", "SPX"), ("QQQ", "NDX"), ("DIA", "DJI"), ("IWM", "RUT"), ("EFA", "EAFE"), ("EEM", "EM"), ("GLD", "GOLD"), ("SLV", "SILVER"), ("USO", "WTI"), ("UNG", "NATGAS"), ("CPER", "COPPER"), ("WEAT", "WHEAT"), ("CORNETF", "CORN"), ("SOYBETF", "SOYBEANS"), ("CANE", "SUGAR") })
            Map(market, etf, asset);
        Map("USTBOND", etf + " Pro TLT používáme Ultra Treasury Bond futures; splatnosti a durace nejsou totožné s portfoliem ETF.", "TLT");
        Map("UST10Y", etf + " Pro IEF používáme 10leté Treasury Note futures; splatnosti a durace nejsou totožné s portfoliem ETF.", "IEF");
        foreach (var (asset, market) in new[] { ("XLE", "ENERGY"), ("XLF", "FINANCIAL"), ("XLK", "TECHNOLOGY"), ("XLV", "HEALTHCARE"), ("XLY", "CONSUMERDISC"), ("XLP", "STAPLES"), ("XLI", "INDUSTRIAL"), ("XLU", "UTILITIES"), ("XLB", "MATERIALS") })
            Map(market, etf + " Podkladem jsou příslušné S&P Select Sector futures. CFTC je může zveřejňovat nepravidelně.", asset);
        return result;
    }

    public static bool IsForexPair(string key) => key.Length == 6 && Currencies.Contains(key[..3]) && Currencies.Contains(key[3..]);

    public static IReadOnlyList<CotMarket> MarketsForAsset(string key)
    {
        key = key.ToUpperInvariant();
        if (IsForexPair(key)) return [ByKey[key[..3]], ByKey[key[3..]]];
        return Mappings.TryGetValue(key, out var mapping) ? mapping.Markets.Select(x => ByKey[x]).ToArray() : [];
    }

    public static string NoteForAsset(string key)
    {
        key = key.ToUpperInvariant();
        if (IsForexPair(key))
            return "COT popisuje futures na jednotlivé měny, nikoli pozice v celém spotovém páru. Long kotované měny působí vůči páru opačně. "
                + (key.Contains("USD", StringComparison.Ordinal) ? "USD zde zastupuje US Dollar Index (DXY), nikoli samostatný spotový USD report. " : "")
                + "JPY, CHF a CAD futures jsou kotované v USD za jednotku měny, opačně než USD/JPY, USD/CHF a USD/CAD.";
        return Mappings.TryGetValue(key, out var mapping) ? mapping.Note
            : "Pro tento instrument nemáme odpovídající CFTC Legacy Futures Only report. Jednotlivým akciím, košovým fondům a nepodporovaným trhům nepřiřazujeme nesouvisející COT data.";
    }
}
