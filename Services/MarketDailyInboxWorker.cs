using System.Diagnostics;
using System.Text.Json;

namespace SeasonalityApp.Services;

// Explicit one-shot SHADOW worker, never an ASP.NET background task or publication path.
// It runs the current Node admission/import engine on an isolated copy and commits only to shadow SQL.
public sealed class MarketDailyInboxWorker(MarketDailySqlInbox inbox, string repositoryRoot,
    string bootstrapState, string nodeExecutable = "node",string? analyticsSnapshot=null,string? htfFeed=null)
{
    public sealed record RunResult(string Status, string? ReceiptId, bool ProductionChanged = false,
        bool AnalyticsTriggered = false);

    public async Task<RunResult> ProcessOneAsync(CancellationToken ct = default)
    {
        var repository = Path.GetFullPath(repositoryRoot);
        var script = Path.Combine(repository,"Tools","market-daily-sql-worker.cjs");
        if (!File.Exists(script) || !File.Exists(Path.Combine(repository,"SeasonalityApp.csproj")))
            throw new InvalidOperationException("Worker requires its audited repository and Node scripts.");
        var previous = await inbox.ReadShadowHistoryAsync(ct);
        if (previous is null && !Directory.Exists(bootstrapState))
            throw new InvalidOperationException("Canonical bootstrap state unavailable; refusing an empty baseline.");
        var lease = await inbox.ClaimAsync(TimeSpan.FromMinutes(5),ct);
        if (lease is null) return new("Empty",null);
        // Everything below is private staging; production market-state/seed files are never written.
        var parent = Path.GetFullPath(Path.GetTempPath());
        var directoryName = "seasonality-sql-worker-" + Guid.NewGuid().ToString("N");
        var work = Path.Combine(parent,directoryName);
        try
        {
            Directory.CreateDirectory(work);
            using var payload = JsonDocument.Parse(lease.DailyUtf8);
            var date = payload.RootElement.GetProperty("runDate").GetString()!;
            if (!DateOnly.TryParseExact(date,"yyyy-MM-dd",out _)) throw new InvalidDataException("Invalid runDate.");
            Directory.CreateDirectory(Path.Combine(work,"audit"));
            await File.WriteAllBytesAsync(Path.Combine(work,"latest.json"),lease.DailyUtf8,ct);
            await File.WriteAllBytesAsync(Path.Combine(work,"audit",date+".json"),lease.AuditUtf8,ct);
            if (previous is not null) await File.WriteAllBytesAsync(Path.Combine(work,"previous-state.json"),previous.StateUtf8,ct);
            var request = Path.Combine(work,"request.json");
            await File.WriteAllTextAsync(request,JsonSerializer.Serialize(new {
                work,runDate=date,state=previous is not null,bootstrapState=Path.GetFullPath(bootstrapState),
                // Freshness is measured at durable SQL reception, not at retry time; fetchedAt is never rewritten.
                receivedAt=lease.ReceivedAt.ToUnixTimeMilliseconds(),
                analyticsSnapshot=analyticsSnapshot is null?null:Path.GetFullPath(analyticsSnapshot),
                htfFeed=htfFeed is null?null:Path.GetFullPath(htfFeed)
            }),ct);
            var start = new ProcessStartInfo(nodeExecutable) {
                WorkingDirectory=repository,UseShellExecute=false,CreateNoWindow=true,
                RedirectStandardOutput=true,RedirectStandardError=true
            };
            start.ArgumentList.Add(script);start.ArgumentList.Add(request);
            // The Node engine does not need SQL/GitHub/Auth0 credentials, even when the parent has them.
            var environment = start.Environment.Where(e=>new[] {"PATH","SYSTEMROOT","WINDIR","TEMP","TMP","LANG","TZ"}
                .Contains(e.Key,StringComparer.OrdinalIgnoreCase)).ToArray();
            start.Environment.Clear();foreach(var entry in environment)start.Environment[entry.Key]=entry.Value;
            using var process = new Process { StartInfo=start };
            if (!process.Start()) throw new InvalidOperationException("Node worker unavailable.");
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromMinutes(2));
            try
            {
                var stdout=ReadBoundedAsync(process.StandardOutput,timeout.Token);
                var stderr=ReadBoundedAsync(process.StandardError,timeout.Token);
                await process.WaitForExitAsync(timeout.Token);
                await Task.WhenAll(stdout,stderr);
                if (process.ExitCode!=0) throw new InvalidOperationException("Node worker failed; diagnostics suppressed.");
            }
            finally
            {
                if (!process.HasExited) { process.Kill(entireProcessTree:true); await process.WaitForExitAsync(CancellationToken.None); }
            }
            var outputFile = Path.Combine(work,"result.json");
            if (!File.Exists(outputFile) || new FileInfo(outputFile).Length>67108864)
                throw new InvalidDataException("Worker result missing/oversized.");
            using var output = JsonDocument.Parse(await File.ReadAllBytesAsync(outputFile,ct),new() { MaxDepth=16 });
            var report = output.RootElement.GetProperty("report");
            if (!report.GetProperty("accepted").GetBoolean())
            {
                var released=await inbox.RecordAdmissionFailureAsync(lease,JsonSerializer.SerializeToUtf8Bytes(report),ct);
                return new(released?"Blocked":"LeaseLost",lease.ReceiptId);
            }
            var result = await inbox.CommitShadowHistoryAsync(lease,previous?.GenerationId??0,
                report.GetProperty("baselineFingerprint").GetString()!,
                JsonSerializer.SerializeToUtf8Bytes(output.RootElement.GetProperty("state")),
                JsonSerializer.SerializeToUtf8Bytes(report),ct);
            if (result==MarketDailySqlInbox.ShadowCommitResult.HeadChanged)
                await inbox.ReleaseAsync(lease.ReceiptId,lease.LeaseId,false,"SHADOW_HEAD_CHANGED",ct);
            return new(result.ToString(),lease.ReceiptId);
        }
        catch (Exception e) when (e is IOException or InvalidOperationException or InvalidDataException or JsonException or OperationCanceledException or System.ComponentModel.Win32Exception)
        {
            // Interrupted infrastructure work remains retryable. No fire-and-forget task or false success.
            await inbox.ReleaseAsync(lease.ReceiptId,lease.LeaseId,false,"WORKER_RETRY_REQUIRED",CancellationToken.None);
            throw new InvalidOperationException("Shadow worker failed; durable receipt retained for retry.");
        }
        finally
        {
            // Exact server-generated child only. Never recursively delete caller/config/repository roots.
            if (Directory.Exists(work))
            {
                if (Path.GetFullPath(work)!=Path.Combine(parent,directoryName) ||
                    !System.Text.RegularExpressions.Regex.IsMatch(directoryName,@"\Aseasonality-sql-worker-[0-9a-f]{32}\z") ||
                    (File.GetAttributes(work)&FileAttributes.ReparsePoint)!=0)
                    throw new InvalidOperationException("Unsafe worker staging cleanup path.");
                Directory.Delete(work,recursive:true);
            }
        }
    }

    private static async Task ReadBoundedAsync(StreamReader reader,CancellationToken ct)
    {
        var buffer=new char[1024];var total=0;int length;
        while ((length=await reader.ReadAsync(buffer.AsMemory(),ct))>0)
        { total+=length;if(total>8192)throw new InvalidDataException("Worker diagnostics exceeded limit."); }
    }
}
