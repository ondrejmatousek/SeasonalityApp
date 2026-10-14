using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;

namespace SeasonalityApp.Services;

// Export immutable accepted evidence to private Actions staging; never rewrite fetchedAt or raw repository data.
public static class MarketDailySqlPublication
{
    public static string Export(MarketDailySqlInbox.PublicationSnapshot s,string repository,string output,DateTimeOffset now)
    {
        var root=Path.GetFullPath(repository);var dir=Path.GetFullPath(output,root);
        if(!dir.StartsWith(Path.Combine(root,"artifacts")+Path.DirectorySeparatorChar,StringComparison.Ordinal)||Directory.Exists(dir))
            throw new InvalidOperationException("Use a new publication staging directory under artifacts.");
        using var payload=JsonDocument.Parse(s.DailyUtf8);var p=payload.RootElement;
        var fetched=DateTimeOffset.Parse(p.GetProperty("fetchedAt").GetString()!);
        if(fetched>now.AddMinutes(1)||now-fetched>TimeSpan.FromHours(24))throw new InvalidDataException("SQL collection stale; last good web retained.");
        var date=p.GetProperty("runDate").GetString()!;
        if(!DateOnly.TryParseExact(date,"yyyy-MM-dd",out _))throw new InvalidDataException("Invalid run date.");
        Directory.CreateDirectory(Path.Combine(dir,"audit"));
        File.WriteAllBytes(Path.Combine(dir,"latest.json"),s.DailyUtf8);
        File.WriteAllBytes(Path.Combine(dir,"audit",date+".json"),s.AuditUtf8);
        File.WriteAllBytes(Path.Combine(dir,"state.json"),s.StateUtf8);
        var context=Path.Combine(dir,"context.json");
        File.WriteAllText(context,JsonSerializer.Serialize(new {schemaVersion=1,generationId=s.GenerationId,receiptId=s.ReceiptId,
            payloadSha256=s.PayloadSha256,auditSha256=s.AuditSha256,stateSha256=s.StateSha256,
            baselineFingerprint=s.BaselineFingerprint,runDate=date}));
        return context;
    }

    public static void CheckContext(MarketDailySqlInbox.PublicationSnapshot s,string context)
    {
        using var doc=JsonDocument.Parse(File.ReadAllBytes(context));var c=doc.RootElement;
        if(c.GetProperty("schemaVersion").GetInt32()!=1||c.GetProperty("generationId").GetInt64()!=s.GenerationId||
            c.GetProperty("receiptId").GetString()!=s.ReceiptId||c.GetProperty("stateSha256").GetString()!=s.StateSha256||
            c.GetProperty("payloadSha256").GetString()!=s.PayloadSha256||c.GetProperty("auditSha256").GetString()!=s.AuditSha256||
            c.GetProperty("baselineFingerprint").GetString()!=s.BaselineFingerprint)
            throw new InvalidDataException("Publication context no longer matches SQL head.");
        var dir=Path.GetDirectoryName(Path.GetFullPath(context))!;
        string Hash(string file)=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(file))).ToLowerInvariant();
        if(Hash(Path.Combine(dir,"state.json"))!=s.StateSha256||Hash(Path.Combine(dir,"latest.json"))!=s.PayloadSha256||
            Hash(Path.Combine(dir,"audit",c.GetProperty("runDate").GetString()+".json"))!=s.AuditSha256)
            throw new InvalidDataException("Publication staging evidence changed.");
    }

    public static async Task CommitAsync(string repository,string context,CancellationToken ct=default)
    {
        var start=new ProcessStartInfo("node") {WorkingDirectory=repository,UseShellExecute=false,CreateNoWindow=true};
        start.ArgumentList.Add(Path.Combine(repository,"Tools","market-daily-sql-publication.cjs"));
        start.ArgumentList.Add("--commit");start.ArgumentList.Add(context);
        // Node/Git publication requires no SQL/Auth0 credentials. Checkout already holds the scoped Git credential.
        var allowed=new[]{"PATH","HOME","USERPROFILE","APPDATA","SYSTEMROOT","WINDIR","TEMP","TMP","LANG","TZ","GITHUB_STEP_SUMMARY"};
        foreach(var key in start.Environment.Keys.ToArray())if(!allowed.Contains(key,StringComparer.OrdinalIgnoreCase))start.Environment.Remove(key);
        start.Environment["SEASONALITY_SQL_PUBLICATION_FENCED"]="true";
        using var child=Process.Start(start)??throw new InvalidOperationException("Publication process unavailable.");
        using var timeout=CancellationTokenSource.CreateLinkedTokenSource(ct);timeout.CancelAfter(TimeSpan.FromMinutes(3));
        try{await child.WaitForExitAsync(timeout.Token);if(child.ExitCode!=0)throw new InvalidOperationException("Fenced publication failed; retry from fresh checkout.");}
        finally{if(!child.HasExited){child.Kill(entireProcessTree:true);await child.WaitForExitAsync(CancellationToken.None);}}
    }
}
