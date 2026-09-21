namespace TradingJournal.Models;

public sealed class SeasonalityPriceEntity
{
    public int Id { get; set; }
    public string AssetKey { get; set; } = string.Empty;
    public DateOnly Date { get; set; }
    public decimal Close { get; set; }
    public string Source { get; set; } = string.Empty;
    public DateTimeOffset UpdatedAt { get; set; }
}
