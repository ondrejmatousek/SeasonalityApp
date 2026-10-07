using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using TradingJournal.Data;
using TradingJournal.Models;

namespace TradingJournal.Services;

public sealed class CotService(SeasonalityDbContext db, IHttpClientFactory clients, ILogger<CotService> logger)
{
    public static IReadOnlyList<CotMarket> Markets => CotCatalog.Markets;
    public static IReadOnlyList<CotMarket> MarketsForAsset(string key) => CotCatalog.MarketsForAsset(key);

    public async Task<CotData> LoadAsync(SeasonalityAsset asset, int lookbackWeeks, CancellationToken ct)
    {
        var markets = MarketsForAsset(asset.Key);
        var series = new List<CotSeries>();
        foreach (var market in markets)
        {
            var reports = await db.CotReports.AsNoTracking()
                .Where(x => x.ContractCode == market.ContractCode)
                .OrderBy(x => x.ReportDate).ToListAsync(ct);
            series.Add(new CotSeries(market.Key, market.Name, market.ContractCode,
                market.Key == "USD", CotCatalog.IsForexPair(asset.Key) && asset.Key[3..] == market.Key,
                BuildPoints(reports, lookbackWeeks)));
        }
        return new CotData(asset.Key, asset.Name, "CFTC Legacy · Futures Only", lookbackWeeks, CotCatalog.NoteForAsset(asset.Key), series);
    }

    public static IReadOnlyList<CotPoint> BuildPoints(IReadOnlyList<CotReportEntity> reports, int lookbackWeeks)
    {
        if (lookbackWeeks is < 2 or > 260) throw new ArgumentOutOfRangeException(nameof(lookbackWeeks));
        var sorted = reports.OrderBy(x => x.ReportDate).ToArray();
        var result = new List<CotPoint>(sorted.Length);
        for (var i = 0; i < sorted.Length; i++)
        {
            var row = sorted[i];
            // Only label a difference as a weekly change when reports are one week apart.
            var previous = i > 0 && row.ReportDate.DayNumber - sorted[i - 1].ReportDate.DayNumber == 7
                ? sorted[i - 1] : null;
            CotPosition Position(Func<CotReportEntity, long> longValue, Func<CotReportEntity, long> shortValue, long spread = 0)
            {
                var net = longValue(row) - shortValue(row);
                long? change = previous is null ? null : net - (longValue(previous) - shortValue(previous));
                double? index = null;
                if (i + 1 >= lookbackWeeks)
                {
                    var window = sorted.Skip(i + 1 - lookbackWeeks).Take(lookbackWeeks)
                        .Select(x => longValue(x) - shortValue(x)).ToArray();
                    var min = window.Min();
                    var max = window.Max();
                    if (max != min) index = Math.Round(100d * (net - min) / (max - min), 2);
                }
                return new CotPosition(longValue(row), shortValue(row), spread, net, change, index);
            }
            result.Add(new CotPoint(row.ReportDate.ToString("yyyy-MM-dd"), row.OpenInterest,
                Position(x => x.CommercialLong, x => x.CommercialShort),
                Position(x => x.NonCommercialLong, x => x.NonCommercialShort, row.NonCommercialSpread),
                Position(x => x.NonReportableLong, x => x.NonReportableShort)));
        }
        return result;
    }

    public async Task UpdateAsync(CancellationToken ct = default)
    {
        var client = clients.CreateClient("CFTC");
        foreach (var market in Markets)
        {
            // Read only the correction window on daily runs, not every historical row.
            var latest = await db.CotReports.Where(x => x.ContractCode == market.ContractCode)
                .MaxAsync(x => (DateOnly?)x.ReportDate, ct);
            var from = latest?.AddDays(-35) ?? new DateOnly(1986, 1, 1);
            var cached = await db.CotReports.Where(x => x.ContractCode == market.ContractCode && x.ReportDate >= from)
                .ToDictionaryAsync(x => x.ReportDate, ct);
            var reports = await DownloadAsync(client, market, from, ct);
            if (reports.Count == 0 && cached.Count == 0)
                throw new InvalidOperationException($"CFTC returned no history for {market.Key} ({market.ContractCode}).");
            foreach (var report in reports)
            {
                if (cached.TryGetValue(report.ReportDate, out var existing))
                    db.Entry(existing).CurrentValues.SetValues(report);
                else
                {
                    db.CotReports.Add(report);
                    cached.Add(report.ReportDate, report);
                }
            }
            await db.SaveChangesAsync(ct);
            db.ChangeTracker.Clear();
            logger.LogInformation("COT {Market} ({Code}): {Count} reports received, latest {Date}.",
                market.Key, market.ContractCode, reports.Count, cached.Count == 0 ? null : cached.Keys.Max().ToString());
        }
    }

    private async Task<IReadOnlyList<CotReportEntity>> DownloadAsync(HttpClient client, CotMarket market, DateOnly from, CancellationToken ct)
    {
        var result = new List<CotReportEntity>();
        const int pageSize = 5000;
        for (var offset = 0; ; offset += pageSize)
        {
            var where = $"cftc_contract_market_code='{market.ContractCode}' AND report_date_as_yyyy_mm_dd >= '{from:yyyy-MM-dd}T00:00:00'";
            const string fields = "cftc_contract_market_code,report_date_as_yyyy_mm_dd,open_interest_all,comm_positions_long_all,comm_positions_short_all,noncomm_positions_long_all,noncomm_positions_short_all,noncomm_postions_spread_all,nonrept_positions_long_all,nonrept_positions_short_all,futonly_or_combined";
            var url = $"https://publicreporting.cftc.gov/resource/6dca-aqww.json?$select={fields}&$where={Uri.EscapeDataString(where)}&$order=report_date_as_yyyy_mm_dd&$limit={pageSize}&$offset={offset}";
            string json;
            for (var attempt = 0; ; attempt++)
            {
                try { json = await client.GetStringAsync(url, ct); break; }
                catch (Exception ex) when (attempt < 2 && !ct.IsCancellationRequested &&
                    (ex is HttpRequestException || ex is TaskCanceledException))
                { await Task.Delay(TimeSpan.FromSeconds(2 * (attempt + 1)), ct); }
            }
            using var source = JsonDocument.Parse(json);
            var sourceCount = source.RootElement.GetArrayLength();
            var page = ParseReports(json, market.ContractCode, message =>
                logger.LogWarning("Invalid historical CFTC report omitted: {Message}", message));
            result.AddRange(page);
            if (sourceCount < pageSize) break;
        }
        return result.DistinctBy(x => x.ReportDate).OrderBy(x => x.ReportDate).ToArray();
    }

    public static IReadOnlyList<CotReportEntity> ParseReports(string json, string expectedCode, Action<string>? onInvalidReport = null)
    {
        using var document = JsonDocument.Parse(json);
        var result = new List<CotReportEntity>();
        foreach (var row in document.RootElement.EnumerateArray())
        {
            if (row.GetProperty("cftc_contract_market_code").GetString() != expectedCode ||
                row.GetProperty("futonly_or_combined").GetString() != "FutOnly")
                throw new FormatException("CFTC returned a different contract or report type.");
            long Count(string field)
            {
                var value = row.GetProperty(field);
                var count = value.ValueKind == JsonValueKind.String
                    ? long.Parse(value.GetString()!, CultureInfo.InvariantCulture) : value.GetInt64();
                if (count < 0) throw new FormatException($"Invalid CFTC position count: {field}.");
                return count;
            }
            try
            {
                var report = new CotReportEntity
                {
                    ContractCode = expectedCode,
                    ReportDate = DateOnly.ParseExact(row.GetProperty("report_date_as_yyyy_mm_dd").GetString()![..10], "yyyy-MM-dd", CultureInfo.InvariantCulture),
                    OpenInterest = Count("open_interest_all"),
                    CommercialLong = Count("comm_positions_long_all"),
                    CommercialShort = Count("comm_positions_short_all"),
                    NonCommercialLong = Count("noncomm_positions_long_all"),
                    NonCommercialShort = Count("noncomm_positions_short_all"),
                    NonCommercialSpread = Count("noncomm_postions_spread_all"),
                    NonReportableLong = Count("nonrept_positions_long_all"),
                    NonReportableShort = Count("nonrept_positions_short_all"),
                    UpdatedAt = DateTimeOffset.UtcNow
                };
                if (report.CommercialLong + report.NonCommercialLong + report.NonCommercialSpread + report.NonReportableLong != report.OpenInterest ||
                    report.CommercialShort + report.NonCommercialShort + report.NonCommercialSpread + report.NonReportableShort != report.OpenInterest)
                    throw new FormatException($"CFTC position totals do not match open interest ({expectedCode}, {report.ReportDate}).");
                result.Add(report);
            }
            catch (FormatException ex) when (onInvalidReport is not null)
            {
                var date = row.GetProperty("report_date_as_yyyy_mm_dd").GetString();
                onInvalidReport($"{expectedCode}, {date}: {ex.Message}");
            }
        }
        return result;
    }
}
