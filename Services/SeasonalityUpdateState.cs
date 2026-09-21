namespace TradingJournal.Services;

public sealed class SeasonalityUpdateState
{
    public bool IsRunning { get; private set; }
    public DateTimeOffset? LastCompletedAt { get; private set; }
    public string? LastError { get; private set; }

    public void Started() => IsRunning = true;
    public void Completed() { IsRunning = false; LastCompletedAt = DateTimeOffset.UtcNow; LastError = null; }
    public void Failed(Exception exception) { IsRunning = false; LastError = exception.Message; }
}
