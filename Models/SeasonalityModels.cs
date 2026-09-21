namespace TradingJournal.Models;

public sealed record SeasonalityAsset(string Key, string Name, string YahooSymbol, string StooqSymbol);

public sealed record SeasonalityPrice(DateOnly Date, decimal Close);
