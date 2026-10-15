using System.ComponentModel;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace SeasonalityApp.Services;

[McpServerToolType]
public sealed class MarketDailySubmissionTool(IConfiguration config,IWebHostEnvironment environment,MarketDailySqlInbox inbox,
    MarketDailyGitHubTrigger trigger)
{
    [McpServerTool(Name="submit_market_daily",ReadOnly=false,Destructive=false,Idempotent=true,OpenWorld=false)]
    [Description("Store the unchanged 39-instrument daily JSON AND its shared completion audit in durable SQL quarantine. Requires market.ingest. After SQL commit, the configured server may request the fixed Morning analytics workflow. A pending receipt or requested workflow is NOT history acceptance, independent session validation, completed analytics, or publication. Never pass credentials.")]
    public async Task<CallToolResult> SubmitMarketDaily(
        [Description("Exact unchanged UTF-8 text of market-daily/latest.json (all 39 instruments), at most 256 KiB.")] string dailyJson,
        [Description("Exact unchanged UTF-8 text of the matching shared completion audit, at most 256 KiB. Not a URL.")] string completionAuditJson,
        RequestContext<CallToolRequestParams> context,CancellationToken cancellationToken)
    {
        // Authorize BEFORE parsing input, reading the registry or calling SQL.
        if(!MarketDailyMcp.HasScope(context.User,config,MarketDailyMcp.IngestScope))
            return MarketDailyMcp.ScopeRequired(MarketDailyMcp.IngestScope);
        if(!MarketDailyMcp.InboxConfigured(config))return Error("MARKET_DAILY_INBOX_DISABLED");
        MarketDailySqlInbox.Submission submission;
        try
        {
            var file=Path.GetFullPath(config["MarketData:BundlePath"]??
                "artifacts/tradingview-backfill-36-v1/analytics-sources-v1/manifest.json",environment.ContentRootPath);
            using var registry=JsonDocument.Parse(await File.ReadAllTextAsync(file,cancellationToken));
            if(registry.RootElement.GetProperty("schemaVersion").GetInt32()!=1)return Error("INBOX_REGISTRY_UNAVAILABLE");
            submission=MarketDailySqlInbox.Submission.Create(dailyJson,completionAuditJson,
                registry.RootElement.GetProperty("entries"),DateTimeOffset.UtcNow);
        }
        catch(Exception e)when(e is JsonException or InvalidDataException or ArgumentException or KeyNotFoundException or InvalidOperationException)
        {return Error("INVALID_MARKET_SUBMISSION");}
        catch(Exception e)when(e is IOException or UnauthorizedAccessException)
        {return Error("INBOX_REGISTRY_UNAVAILABLE");}
        try
        {
            using var timeout=CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(30));
            var receipt=await inbox.ReceiveAsync(submission,timeout.Token);
            var wakeup=await trigger.RequestAsync(receipt.Status,cancellationToken);
            return MarketDailyMcp.ToolResult(new { mode="sql-quarantine",receipt.ReceiptId,receipt.PayloadSha256,
                receipt.AuditSha256,receipt.Status,receipt.Duplicate,receivedBars=39,receipt.Persisted,
                receipt.HistoryAccepted,receipt.AnalyticsTriggered,receipt.CompletionValidated,productionChanged=false,
                workflowTrigger=wakeup.Status,workflowRequested=wakeup.Requested });
        }
        catch(Exception e)when(e is SqlException or InvalidOperationException or InvalidDataException or OperationCanceledException)
        {
            // A network/cancellation failure around COMMIT has an unknown write outcome, not persisted=false.
            return MarketDailyMcp.ToolResult(new { code="MARKET_DAILY_INBOX_UNAVAILABLE",persisted=(bool?)null,
                retryWithExactPayload=true,productionChanged=false,analyticsTriggered=false },error:true);
        }
    }
    private static CallToolResult Error(string code)=>MarketDailyMcp.ToolResult(new { code,persisted=false,productionChanged=false,analyticsTriggered=false },error:true);
}
