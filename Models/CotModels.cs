namespace TradingJournal.Models;

public sealed record CotMarket(string Key, string Name, string ContractCode);

public sealed class CotReportEntity
{
    public string ContractCode { get; set; } = string.Empty;
    public DateOnly ReportDate { get; set; }
    public long OpenInterest { get; set; }
    public long CommercialLong { get; set; }
    public long CommercialShort { get; set; }
    public long NonCommercialLong { get; set; }
    public long NonCommercialShort { get; set; }
    public long NonCommercialSpread { get; set; }
    public long NonReportableLong { get; set; }
    public long NonReportableShort { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public sealed record CotPosition(long Long, long Short, long Spread, long Net, long? Change, double? Index);
public sealed record CotPoint(string Date, long OpenInterest, CotPosition Commercial, CotPosition NonCommercial, CotPosition NonReportable);
public sealed record CotSeries(string Key, string Name, string ContractCode, bool IsDollarIndex, bool IsQuoteCurrency, IReadOnlyList<CotPoint> Reports);
public sealed record CotData(string AssetKey, string AssetName, string ReportType, int LookbackWeeks, string? Note, IReadOnlyList<CotSeries> Markets);
