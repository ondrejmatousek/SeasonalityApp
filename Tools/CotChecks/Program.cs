using TradingJournal.Models;
using TradingJournal.Services;

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
Check(CotService.MarketsForAsset("BTCUSD").Count == 0 && CotService.MarketsForAsset("AAPL").Count == 0, "Unsupported instruments must not silently map to USD.");

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
Console.WriteLine("COT checks passed: net changes, normalized extremes, missing weeks, flat/incomplete windows, pair mapping and CFTC input validation.");
