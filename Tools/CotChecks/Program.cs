using TradingJournal.Models;
using TradingJournal.Services;
using System.Net.Http.Json;

static void Check(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

static void Reject(Action action, string message)
{
    try { action(); }
    catch (FormatException) { return; }
    throw new InvalidOperationException(message);
}

// A deliberately unsorted series with negative net positions and a missing week.
var reports = new[]
{
    new CotReportEntity { ReportDate = new(2026, 1, 27), CommercialShort = 20 },
    new CotReportEntity { ReportDate = new(2026, 1, 6), CommercialShort = 30 },
    new CotReportEntity { ReportDate = new(2026, 1, 13), CommercialShort = 10 }
};
var points = CotService.BuildPoints(reports, 2);
Check(points[0].Commercial.Index is null && points[0].Commercial.Change is null, "Incomplete window must not have an index/change.");
Check(points[1].Commercial.Net == -10 && points[1].Commercial.Change == 20 && points[1].Commercial.Index == 100, "Negative positions must normalize correctly.");
Check(points[2].Commercial.Index == 0 && points[2].Commercial.Change is null, "A missing week must not be shown as a weekly change.");
Check(points[2].NonReportable.Index is null, "A flat window must not divide by zero or invent an index.");
Check(CotService.MarketsForAsset("GBPJPY").Select(x => x.Key).SequenceEqual(new[] { "GBP", "JPY" }), "Cross pairs must map both currencies.");
Check(CotService.MarketsForAsset("USDJPY")[0].ContractCode == "098662", "USD must explicitly use the DXY market.");
Check(CotService.MarketsForAsset("DXY").Count == 1, "DXY must resolve to one report.");
Check(CotService.MarketsForAsset("XAUUSD").Single().ContractCode == "088691", "Gold must map to COMEX, not USD.");
Check(CotService.MarketsForAsset("NDX").Single().ContractCode == "209742", "Nasdaq must use the mini contract, not a micro/consolidated series.");
Check(CotService.MarketsForAsset("QQQ").SequenceEqual(CotService.MarketsForAsset("NDX")), "ETF must reuse its underlying report without importing it twice.");
Check(CotCatalog.NoteForAsset("QQQ").StartsWith("Proxy:") && CotCatalog.NoteForAsset("TLT").Contains("durace"), "ETF proxy and bond maturity differences must be explicit.");
Check(!CotCatalog.IsForexPair("BTCUSD") && !CotCatalog.IsForexPair("XAUUSD") && !CotCatalog.IsForexPair("SPX"), "Non-FX keys must not be sliced/interpreted as currency pairs.");
foreach (var (key, code) in new[] { ("BTCUSD", "133741"), ("ETHUSD", "146021"), ("SOLUSD", "177741"), ("XRPUSD", "176740") })
    Check(CotService.MarketsForAsset(key).Single().ContractCode == code, "Crypto must map only to its own CME contract.");
foreach (var key in new[] { "AAPL", "NVDA", "BNBUSD", "DAX", "FTSE100", "STOXX50E", "HSI", "DBC", "PDBC", "DBA", "DBE", "DBB", "VT", "VTI", "VNQ", "ARKK" })
    Check(CotService.MarketsForAsset(key).Count == 0, "Unsupported instruments must not silently use unrelated COT data: " + key);
Check(CotService.MarketsForAsset("LUMBER").Select(x => x.ContractCode).SequenceEqual(new[] { "058644", "058643" }), "Old/new lumber history must remain separate.");
Check(CotService.MarketsForAsset("xauusd").Single().Key == "GOLD", "Mapping must be case-insensitive.");
Check(CotService.Markets.Count == CotService.Markets.Select(x => x.ContractCode).Distinct().Count(), "Each contract must be imported only once.");
var supported = SeasonalityService.Assets.Where(x => CotService.MarketsForAsset(x.Key).Count > 0).ToArray();
Check(supported.Length == 95, "Expected COT coverage: 28 FX + DXY + 30 commodities + 6 indices + 4 crypto + 26 ETF.");
foreach (var (key, code) in new[] { ("MILK", "052641"), ("BUTTER", "050642"), ("CHEESE", "063642"), ("KCWHEAT", "001612"),
    ("LIVECATTLE", "057642"), ("FEEDERCATTLE", "061641"), ("LEANHOGS", "054642") })
    Check(CotService.MarketsForAsset(key).Single().ContractCode == code, "Agricultural contracts must map exactly: " + key);
foreach (var asset in SeasonalityService.Assets)
{
    var category = AssetClassification.ClassFor(asset);
    Check(new[] { "index", "commodity", "forex", "etf", "crypto", "equity" }.Contains(category), "Every asset needs a known class.");
    Check((category == "commodity") == (AssetClassification.CommodityGroupFor(asset.Key) is not null), "Only commodity instruments need a commodity group.");
}
foreach (var (key, category) in new[] { ("EURUSD", "forex"), ("GBPCAD", "forex"), ("DXY", "index"), ("NDX", "index"),
    ("QQQ", "etf"), ("GLD", "etf"), ("XAUUSD", "commodity"), ("MILK", "commodity"), ("BTCUSD", "crypto"), ("AAPL", "equity") })
    Check(AssetClassification.ClassFor(SeasonalityService.Assets.Single(a => a.Key == key)) == category, "Classify the instrument, not its COT proxy: " + key);
Check(SeasonalityService.SearchAliases("LEANHOGS").Contains("maso") && SeasonalityService.SearchAliases("MILK").Contains("mléko"), "Food markets must be discoverable in Czech.");
Check(supported.SelectMany(x => CotService.MarketsForAsset(x.Key)).Select(x => x.Key).Distinct().Count() == CotService.Markets.Count, "Do not import unused markets.");
foreach (var asset in SeasonalityService.Assets.Where(x => x.YahooSymbol.EndsWith("=F")))
    Check(CotService.MarketsForAsset(asset.Key).Count > 0, "Every catalog commodity futures asset must have a mapping: " + asset.Key);
Check(SeasonalityService.SearchAliases("NDX").Contains("NQ") && SeasonalityService.SearchAliases("XAUUSD").Contains("XAU"), "Common NQ/XAU search aliases must resolve existing assets.");

const string sample = """
    [{"cftc_contract_market_code":"096742","futonly_or_combined":"FutOnly",
    "report_date_as_yyyy_mm_dd":"2026-01-06T00:00:00","open_interest_all":"100",
    "comm_positions_long_all":"50","comm_positions_short_all":"40",
    "noncomm_positions_long_all":"20","noncomm_positions_short_all":"30",
    "noncomm_postions_spread_all":"10","nonrept_positions_long_all":"20","nonrept_positions_short_all":"20"}]
    """;
var parsed = CotService.ParseReports(sample, "096742");
Check(parsed.Count == 1 && parsed[0].CommercialLong == 50 && parsed[0].ReportDate == new DateOnly(2026, 1, 6), "CFTC JSON parsing failed.");
Reject(() => CotService.ParseReports(sample, "097741"), "A mismatched currency must be rejected.");
Reject(() => CotService.ParseReports(sample.Replace("FutOnly", "Combined"), "096742"), "Combined reports must not be mixed with futures-only.");
Reject(() => CotService.ParseReports(sample.Replace("\"100\"", "\"101\""), "096742"), "Broken open-interest totals must be rejected.");
Reject(() => CotService.ParseReports(sample.Replace("\"50\"", "\"-50\""), "096742"), "Negative contract counts must be rejected.");
var warnings = new List<string>();
var invalidHistory = CotService.ParseReports(sample.Replace("\"50\"", "\"-50\""), "096742", warnings.Add);
Check(invalidHistory.Count == 0 && warnings.Count == 1 && warnings[0].Contains("2026-01-06"), "An omitted historical record must be reported with its date.");
Console.WriteLine($"COT checks passed: {supported.Length} supported assets, {CotService.Markets.Count} unique contracts, proxy/FX mapping, net/index calculations and strict CFTC input validation.");

// Optional read-only integration check against a running app with imported history.
if (args.Length == 2 && args[0] == "--live-url")
{
    using var client = new HttpClient { BaseAddress = new Uri(args[1].TrimEnd('/') + "/") };
    var contracts = new HashSet<string>();
    foreach (var asset in supported)
    {
        var response = await client.GetFromJsonAsync<CotData>($"Seasonality/CotData?assetKey={Uri.EscapeDataString(asset.Key)}&lookbackWeeks=52");
        Check(response is not null && response.AssetKey == asset.Key && response.Note == CotCatalog.NoteForAsset(asset.Key), "Invalid live response/note: " + asset.Key);
        var actual = response!.Markets;
        Check(actual.Select(x => x.ContractCode).SequenceEqual(CotService.MarketsForAsset(asset.Key).Select(x => x.ContractCode)), "Wrong live contracts: " + asset.Key);
        foreach (var market in actual)
        {
            Check(market.Reports.Count > 0, "Missing imported history: " + asset.Key + "/" + market.ContractCode);
            Check(market.IsQuoteCurrency == (CotCatalog.IsForexPair(asset.Key) && asset.Key[3..] == market.Key), "Wrong currency orientation: " + asset.Key);
            Check(market.Reports.Select(x => x.Date).Distinct().Count() == market.Reports.Count, "Duplicate report dates: " + market.ContractCode);
            contracts.Add(market.ContractCode);
        }
    }
    Check(contracts.Count == CotService.Markets.Count, "Live check must cover every imported contract.");
    var unsupported = await client.GetFromJsonAsync<CotData>("Seasonality/CotData?assetKey=AAPL");
    Check(unsupported?.Markets.Count == 0, "Unsupported stocks must not return unrelated reports.");
    Console.WriteLine($"Live COT checks passed: {supported.Length} assets, {contracts.Count} populated contracts, exposure notes and FX orientation.");
}
