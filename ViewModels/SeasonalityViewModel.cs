using TradingJournal.Models;

namespace SeasonalityApp.ViewModels;

public sealed class SeasonalityViewModel
{
    public IReadOnlyList<SeasonalityAsset> Assets { get; init; } = [];
    public IReadOnlyDictionary<string, IReadOnlyList<SeasonalityPrice>> Prices { get; init; } = new Dictionary<string, IReadOnlyList<SeasonalityPrice>>();
    public bool IsUpdating { get; init; }
}
