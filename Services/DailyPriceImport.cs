using System.Text.Json;
using TradingJournal.Models;

namespace TradingJournal.Services;

// Provider dates are not UTC dates. Never persist an unfinished daily candle.
public static class DailyPriceImport
{
    public static IReadOnlyList<SeasonalityPrice> YahooCompleted(string json, DateTimeOffset observedAt)
    {
        using var document = JsonDocument.Parse(json);
        var chart = document.RootElement.GetProperty("chart").GetProperty("result")[0];
        var zone = TimeZoneInfo.FindSystemTimeZoneById(chart.GetProperty("meta").GetProperty("exchangeTimezoneName").GetString()
            ?? throw new FormatException("Yahoo daily timezone is missing."));
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(observedAt, zone).DateTime);
        // Use the provider's actual regular-session end (including DST/short days),
        // never a hard-coded 16:00 or the date of the next session. Leave 15 minutes
        // for the final quote to settle; metadata absence keeps the old fallback.
        DateOnly? completedSessionDate = null;
        if (chart.GetProperty("meta").TryGetProperty("currentTradingPeriod", out var periods)
            && periods.ValueKind == JsonValueKind.Object
            && periods.TryGetProperty("regular", out var regular)
            && regular.ValueKind == JsonValueKind.Object
            && regular.TryGetProperty("start", out var startValue) && startValue.ValueKind == JsonValueKind.Number && startValue.TryGetInt64(out var start)
            && regular.TryGetProperty("end", out var endValue) && endValue.ValueKind == JsonValueKind.Number && endValue.TryGetInt64(out var end)
            && start > 0 && end > start && end - start <= 86400
            && end <= observedAt.ToUnixTimeSeconds() - 15 * 60)
        {
            completedSessionDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeSeconds(start), zone).DateTime);
        }
        var timestamps = chart.GetProperty("timestamp");
        var closes = chart.GetProperty("indicators").GetProperty("quote")[0].GetProperty("close");
        if (timestamps.GetArrayLength() != closes.GetArrayLength()) throw new FormatException("Yahoo timestamp/close length mismatch.");
        var result = new List<SeasonalityPrice>();
        for (var i = 0; i < timestamps.GetArrayLength(); i++)
        {
            if (timestamps[i].ValueKind != JsonValueKind.Number || closes[i].ValueKind == JsonValueKind.Null) continue;
            var instant = DateTimeOffset.FromUnixTimeSeconds(timestamps[i].GetInt64());
            var date = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(instant, zone).DateTime);
            var close = closes[i].GetDecimal();
            if (instant <= observedAt && close > 0 && (date < today || date == today && date == completedSessionDate))
                result.Add(new(date, close));
        }
        if (result.Select(x => x.Date).Distinct().Count() != result.Count) throw new FormatException("Duplicate Yahoo trading dates.");
        return result.OrderBy(x => x.Date).ToList();
    }

    public static bool RefreshSameSource(SeasonalityPriceEntity existing, SeasonalityPrice incoming, string source, DateTimeOffset observedAt)
    {
        if (!string.Equals(existing.Source, source, StringComparison.Ordinal))
            throw new InvalidOperationException("Source switch requires a separate series; automatic price-history splicing is forbidden.");
        if (existing.Date != incoming.Date || incoming.Close <= 0) throw new FormatException("Invalid price revision.");
        if (existing.Close == incoming.Close) return false;
        existing.Close = incoming.Close;
        existing.UpdatedAt = observedAt;
        return true;
    }
}
