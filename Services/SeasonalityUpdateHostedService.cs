namespace TradingJournal.Services;

public sealed class SeasonalityUpdateHostedService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly SeasonalityUpdateState _state;
    private readonly ILogger<SeasonalityUpdateHostedService> _logger;

    public SeasonalityUpdateHostedService(IServiceScopeFactory scopeFactory, SeasonalityUpdateState state, ILogger<SeasonalityUpdateHostedService> logger)
    {
        _scopeFactory = scopeFactory;
        _state = state;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            using var timer = new PeriodicTimer(TimeSpan.FromDays(1));
            await RunUpdateAsync(stoppingToken, missingOnly: true);
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                await RunUpdateAsync(stoppingToken, missingOnly: false);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
    }

    private async Task RunUpdateAsync(CancellationToken cancellationToken, bool missingOnly)
    {
        _state.Started();
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var service = scope.ServiceProvider.GetRequiredService<SeasonalityService>();
            if (missingOnly)
                await service.UpdateMissingAsync(cancellationToken);
            else
                await service.UpdateAsync(cancellationToken);
            _state.Completed();
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            _state.Completed();
        }
        catch (Exception exception)
        {
            _state.Failed(exception);
            _logger.LogError(exception, "Scheduled seasonality update failed.");
        }
    }
}
