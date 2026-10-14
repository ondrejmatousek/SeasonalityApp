using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.SqlClient;

namespace SeasonalityApp.Services;

// Durable raw quarantine and isolated shadow generations. No registration/MCP writes yet.
// Only the trusted opt-in worker performs Node admission; no live price routing/publication.
public sealed class MarketDailySqlInbox(string connectionString)
{
    private static readonly UTF8Encoding Utf8 = new(false, true);
    public sealed class Submission
    {
        public byte[] DailyUtf8 { get; }
        public byte[] AuditUtf8 { get; }
        public string PayloadSha256 { get; }
        public string AuditSha256 { get; }
        public string ReceiptId { get; }
        public DateTimeOffset FetchedAt { get; }
        private Submission(byte[] daily, byte[] audit, string payloadHash, string auditHash, string receipt, DateTimeOffset fetched)
        { DailyUtf8=daily; AuditUtf8=audit; PayloadSha256=payloadHash; AuditSha256=auditHash; ReceiptId=receipt; FetchedAt=fetched; }
        // This is structural quarantine validation, not history/session admission or authorization.
        public static Submission Create(string dailyJson, string auditJson, JsonElement registry, DateTimeOffset now)
        {
            var daily = Encode(dailyJson); var audit = Encode(auditJson);
            using var p = JsonDocument.Parse(daily, new() { MaxDepth = 16 });
            using var a = JsonDocument.Parse(audit, new() { MaxDepth = 32 });
            RejectDuplicateKeys(p.RootElement); RejectDuplicateKeys(a.RootElement);
            if (MarketDailyProbe.Validate(p.RootElement, registry, now) != 39)
                throw new InvalidDataException("Require all 39 instruments.");
            var fetched = DateTimeOffset.Parse(p.RootElement.GetProperty("fetchedAt").GetString()!, CultureInfo.InvariantCulture);
            var runDate = TimeZoneInfo.ConvertTime(fetched, TimeZoneInfo.FindSystemTimeZoneById("Europe/Prague")).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            if (Text(p.RootElement, "runDate") != runDate ||
                a.RootElement.GetProperty("schemaVersion").GetInt32() != 1 ||
                Text(a.RootElement, "runDate") != runDate || Text(a.RootElement, "timezone") != "Europe/Prague")
                throw new InvalidDataException("Collection/audit Prague date mismatch.");
            if (p.RootElement.TryGetProperty("generatedAt", out var generated) &&
                !InstantEquals(generated, fetched)) throw new InvalidDataException("Conflicting collection timestamps.");
            var runs = a.RootElement.GetProperty("runs").EnumerateArray()
                .Where(r => r.TryGetProperty("checkedAt", out var v) && InstantEquals(v, fetched)).ToArray();
            if (runs.Length != 1 || runs[0].GetProperty("entries").GetArrayLength() != 39)
                throw new InvalidDataException("Require one matching 39-entry audit run.");
            foreach (var b in p.RootElement.GetProperty("bars").EnumerateArray())
            {
                var entries = runs[0].GetProperty("entries").EnumerateArray().Where(e =>
                    Text(e, "providerSymbol") == Text(b, "providerSymbol") &&
                    e.TryGetProperty("timestamp", out var t) && t.TryGetInt64(out var ts) && ts == b.GetProperty("timestamp").GetInt64()).ToArray();
                if (entries.Length != 1 || Text(entries[0], "symbol") != Text(b, "symbol") ||
                    Text(entries[0], "provider") != Text(b, "provider") || Text(entries[0], "status") != "ok" ||
                    !entries[0].TryGetProperty("completed", out var done) || done.ValueKind != JsonValueKind.True ||
                    (Text(entries[0], "selectedDate") ?? Text(entries[0], "date")) != Text(b, "date"))
                    throw new InvalidDataException("Audit bar identity/date/status mismatch.");
            }
            var payloadHash = Hash(daily); var auditHash = Hash(audit);
            // Fixed-length binary hashes cannot create ambiguous concatenation identities.
            var receipt = Hash(Convert.FromHexString(payloadHash + auditHash));
            return new(daily, audit, payloadHash, auditHash, receipt, fetched);
        }
    }

    public sealed record Receipt(string ReceiptId, string PayloadSha256, string AuditSha256,
        string Status, bool Duplicate, bool Persisted = true, bool HistoryAccepted = false,
        bool AnalyticsTriggered = false, bool CompletionValidated = false);
    public sealed record Lease(string ReceiptId, Guid LeaseId, byte[] DailyUtf8, byte[] AuditUtf8, int Attempts, DateTimeOffset ReceivedAt);
    public sealed record ShadowHistory(long GenerationId, string BaselineFingerprint, byte[] StateUtf8);
    public enum ShadowCommitResult { Committed, HeadChanged, LeaseLost }

    public async Task<Receipt> ReceiveAsync(Submission submission, CancellationToken ct = default)
    {
        // Defensively snapshot mutable buffers before awaits; no caller flag grants a validated state.
        var daily = submission.DailyUtf8.ToArray(); var audit = submission.AuditUtf8.ToArray();
        CheckBytes(daily); CheckBytes(audit);
        if (Hash(daily) != submission.PayloadSha256 || Hash(audit) != submission.AuditSha256 ||
            Hash(Convert.FromHexString(submission.PayloadSha256 + submission.AuditSha256)) != submission.ReceiptId)
            throw new InvalidDataException("Submission hash mismatch.");
        // Repeat basic structural checks even if a caller bypassed Submission.Create.
        using var p = JsonDocument.Parse(daily, new() { MaxDepth = 16 });
        using var a = JsonDocument.Parse(audit, new() { MaxDepth = 32 });
        RejectDuplicateKeys(p.RootElement); RejectDuplicateKeys(a.RootElement);
        if (p.RootElement.GetProperty("bars").GetArrayLength() != 39 ||
            !InstantEquals(p.RootElement.GetProperty("fetchedAt"), submission.FetchedAt))
            throw new InvalidDataException("Invalid inbox submission.");
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(ct);
        await using var tx = (SqlTransaction)await connection.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        await using (var guard = new SqlCommand("""
            DECLARE @result int;
            EXEC @result = sys.sp_getapplock @Resource=@key, @LockMode='Exclusive',
                @LockOwner='Transaction', @LockTimeout=10000;
            IF @result < 0 THROW 50001, 'Inbox receipt busy', 1;
            """, connection, tx))
        {
            // Only 39 daily instruments; serialize these short receives to avoid cross-key insert deadlocks.
            guard.Parameters.Add("@key", SqlDbType.NVarChar, 255).Value = "MarketDailyInbox:Receive";
            await guard.ExecuteNonQueryAsync(ct);
        }
        await using (var existing = new SqlCommand("SELECT Status, DailyUtf8, AuditUtf8 FROM market_daily.Inbox WHERE ReceiptId=@id", connection, tx))
        {
            existing.Parameters.Add("@id", SqlDbType.Char, 64).Value = submission.ReceiptId;
            await using var reader = await existing.ExecuteReaderAsync(ct);
            if (await reader.ReadAsync(ct))
            {
                var status = reader.GetString(0);
                if (!daily.AsSpan().SequenceEqual((byte[])reader[1]) || !audit.AsSpan().SequenceEqual((byte[])reader[2]))
                    throw new InvalidDataException("Stored inbox evidence differs; refusing overwrite.");
                await reader.DisposeAsync();
                await tx.CommitAsync(ct);
                return new(submission.ReceiptId, submission.PayloadSha256, submission.AuditSha256, status, true);
            }
        }
        await using (var insert = new SqlCommand("""
            INSERT market_daily.Inbox (ReceiptId, PayloadSha256, AuditSha256, DailyUtf8, AuditUtf8, FetchedAt)
            VALUES (@id, @payload, @audit, @dailyBytes, @auditBytes, @fetched);
            """, connection, tx))
        {
            insert.Parameters.Add("@id", SqlDbType.Char, 64).Value = submission.ReceiptId;
            insert.Parameters.Add("@payload", SqlDbType.Char, 64).Value = submission.PayloadSha256;
            insert.Parameters.Add("@audit", SqlDbType.Char, 64).Value = submission.AuditSha256;
            insert.Parameters.Add("@dailyBytes", SqlDbType.VarBinary, -1).Value = daily;
            insert.Parameters.Add("@auditBytes", SqlDbType.VarBinary, -1).Value = audit;
            insert.Parameters.Add("@fetched", SqlDbType.DateTimeOffset).Value = submission.FetchedAt;
            await insert.ExecuteNonQueryAsync(ct);
        }
        // Persisting this row atomically persists the pending work. No second in-memory enqueue can be lost.
        await tx.CommitAsync(ct);
        return new(submission.ReceiptId, submission.PayloadSha256, submission.AuditSha256, "PendingValidation", false);
    }

    public async Task<Lease?> ClaimAsync(TimeSpan duration, CancellationToken ct = default)
    {
        if (duration < TimeSpan.FromSeconds(30) || duration > TimeSpan.FromMinutes(30))
            throw new ArgumentOutOfRangeException(nameof(duration));
        await using var connection = new SqlConnection(connectionString); await connection.OpenAsync(ct);
        await using var command = new SqlCommand("""
            ;WITH candidate AS (
                SELECT TOP (1) * FROM market_daily.Inbox WITH (UPDLOCK, READPAST, READCOMMITTEDLOCK)
                WHERE Status='PendingValidation' OR (Status='Processing' AND LeaseUntil<=SYSDATETIMEOFFSET())
                ORDER BY Sequence
            )
            UPDATE candidate SET Status='Processing', LeaseId=@lease,
                LeaseUntil=DATEADD(second,@seconds,SYSDATETIMEOFFSET()), Attempts=Attempts+1
            OUTPUT inserted.ReceiptId, inserted.DailyUtf8, inserted.AuditUtf8, inserted.Attempts,
                inserted.PayloadSha256, inserted.AuditSha256, inserted.ReceivedAt;
            """, connection);
        var leaseId = Guid.NewGuid();
        command.Parameters.Add("@lease", SqlDbType.UniqueIdentifier).Value = leaseId;
        command.Parameters.Add("@seconds", SqlDbType.Int).Value = (int)duration.TotalSeconds;
        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;
        var lease = new Lease(reader.GetString(0), leaseId, (byte[])reader[1], (byte[])reader[2], reader.GetInt32(3), reader.GetFieldValue<DateTimeOffset>(6));
        var payloadHash = reader.GetString(4); var auditHash = reader.GetString(5);
        await reader.DisposeAsync();
        if (Hash(lease.DailyUtf8) != payloadHash || Hash(lease.AuditUtf8) != auditHash ||
            Hash(Convert.FromHexString(payloadHash + auditHash)) != lease.ReceiptId)
        {
            await ReleaseAsync(lease.ReceiptId, lease.LeaseId, true, "STORED_EVIDENCE_HASH_MISMATCH", ct);
            throw new InvalidDataException("Stored evidence hash mismatch; no processing allowed.");
        }
        return lease;
    }

    public async Task<ShadowHistory?> ReadShadowHistoryAsync(CancellationToken ct = default)
    {
        await using var c = new SqlConnection(connectionString); await c.OpenAsync(ct);
        await using var command = new SqlCommand("SELECT TOP (1) GenerationId,BaselineFingerprint,StateUtf8,StateSha256 FROM market_daily.ShadowHistory ORDER BY GenerationId DESC", c);
        await using var r = await command.ExecuteReaderAsync(ct);
        if (!await r.ReadAsync(ct)) return null;
        var bytes = (byte[])r[2];
        if (Hash(bytes) != r.GetString(3)) throw new InvalidDataException("Shadow history checksum mismatch.");
        return new(r.GetInt64(0), r.GetString(1), bytes);
    }

    public sealed record PublicationSnapshot(long GenerationId,string BaselineFingerprint,string StateSha256,
        string ReceiptId,string PayloadSha256,string AuditSha256,byte[] StateUtf8,byte[] DailyUtf8,byte[] AuditUtf8,byte[] ReportUtf8);

    public async Task<PublicationSnapshot?> ReadPublicationSnapshotAsync(CancellationToken ct=default)
    {
        await using var c=new SqlConnection(connectionString);await c.OpenAsync(ct);
        return await ReadPublicationSnapshotAsync(c,ct);
    }

    private static async Task<PublicationSnapshot?> ReadPublicationSnapshotAsync(SqlConnection c,CancellationToken ct)
    {
        await using var command=new SqlCommand("""
            SELECT TOP (1) h.GenerationId,h.BaselineFingerprint,h.StateSha256,h.ReceiptId,
                i.PayloadSha256,i.AuditSha256,h.StateUtf8,i.DailyUtf8,i.AuditUtf8,h.ReportUtf8
            FROM market_daily.ShadowHistory h JOIN market_daily.Inbox i ON i.ReceiptId=h.ReceiptId
            WHERE i.Status='ShadowAccepted' ORDER BY h.GenerationId DESC
            """,c);
        await using var r=await command.ExecuteReaderAsync(ct);
        if(!await r.ReadAsync(ct))return null;
        var s=new PublicationSnapshot(r.GetInt64(0),r.GetString(1),r.GetString(2),r.GetString(3),r.GetString(4),r.GetString(5),
            (byte[])r[6],(byte[])r[7],(byte[])r[8],(byte[])r[9]);
        if(Hash(s.StateUtf8)!=s.StateSha256||Hash(s.DailyUtf8)!=s.PayloadSha256||Hash(s.AuditUtf8)!=s.AuditSha256||
            Hash(Convert.FromHexString(s.PayloadSha256+s.AuditSha256))!=s.ReceiptId)
            throw new InvalidDataException("Publication evidence hash mismatch.");
        using var report=JsonDocument.Parse(s.ReportUtf8);RejectDuplicateKeys(report.RootElement);
        if(!report.RootElement.GetProperty("accepted").GetBoolean()||Text(report.RootElement,"baselineFingerprint")!=s.BaselineFingerprint||
            Text(report.RootElement,"payloadSha256")!=s.PayloadSha256||Text(report.RootElement,"auditSha256")!=s.AuditSha256)
            throw new InvalidDataException("Publication admission binding mismatch.");
        return s;
    }

    // Hold the SAME lock used by generation advancement until the non-forcing Git push finishes.
    // This is an explicit Actions CLI capability, never an MCP tool or web startup action.
    public async Task WithPublicationFenceAsync(PublicationSnapshot expected,Func<Task> publish,CancellationToken ct=default)
    {
        await using var c=new SqlConnection(connectionString);await c.OpenAsync(ct);
        await using var acquire=new SqlCommand("""
            DECLARE @result int;
            EXEC @result=sys.sp_getapplock @Resource=N'MarketDailyInbox:ShadowCommit',
                @LockMode='Exclusive',@LockOwner='Session',@LockTimeout=10000;
            SELECT @result;
            """,c);
        if((int)(await acquire.ExecuteScalarAsync(ct))!<0)throw new InvalidOperationException("Publication fence busy.");
        try
        {
            var current=await ReadPublicationSnapshotAsync(c,ct);
            if(current is null||current.GenerationId!=expected.GenerationId||current.StateSha256!=expected.StateSha256||
                current.ReceiptId!=expected.ReceiptId||Hash(current.ReportUtf8)!=Hash(expected.ReportUtf8))
                throw new InvalidDataException("SQL generation advanced; stale publication refused.");
            await publish();
        }
        finally
        {
            await using var release=new SqlCommand("EXEC sys.sp_releaseapplock @Resource=N'MarketDailyInbox:ShadowCommit',@LockOwner='Session';",c);
            await release.ExecuteNonQueryAsync(CancellationToken.None);
        }
    }

    public async Task<bool> RecordAdmissionFailureAsync(Lease lease,byte[] reportUtf8,CancellationToken ct=default)
    {
        var report=reportUtf8.ToArray();CheckBytes(report);
        using var json=JsonDocument.Parse(report,new() { MaxDepth=16 });RejectDuplicateKeys(json.RootElement);
        if(Text(json.RootElement,"mode")!="shadow-history-only" || json.RootElement.GetProperty("accepted").GetBoolean() ||
            Text(json.RootElement,"payloadSha256")!=Hash(lease.DailyUtf8) || Text(json.RootElement,"auditSha256")!=Hash(lease.AuditUtf8))
            throw new InvalidDataException("Failure report binding mismatch.");
        await using var c=new SqlConnection(connectionString);await c.OpenAsync(ct);
        await using var command=new SqlCommand("""
            UPDATE market_daily.Inbox SET Status='Blocked',LeaseId=NULL,LeaseUntil=NULL,
                LastErrorCode='ADMISSION_REJECTED',ValidationReportUtf8=@report
            WHERE ReceiptId=@id AND Status='Processing' AND LeaseId=@lease AND LeaseUntil>SYSDATETIMEOFFSET();
            """,c);
        command.Parameters.Add("@id",SqlDbType.Char,64).Value=lease.ReceiptId;
        command.Parameters.Add("@lease",SqlDbType.UniqueIdentifier).Value=lease.LeaseId;
        command.Parameters.Add("@report",SqlDbType.VarBinary,-1).Value=report;
        return await command.ExecuteNonQueryAsync(ct)==1;
    }

    // Trusted worker only, NEVER bind this method to MCP arguments. Commit shadow state + queue ACK together.
    public async Task<ShadowCommitResult> CommitShadowHistoryAsync(Lease lease, long expectedGeneration,
        string baselineFingerprint, byte[] stateUtf8, byte[] reportUtf8, CancellationToken ct = default)
    {
        var state = stateUtf8.ToArray(); var report = reportUtf8.ToArray();
        if (state.Length is < 1 or > 67108864 || report.Length is < 1 or > 262144 ||
            !System.Text.RegularExpressions.Regex.IsMatch(baselineFingerprint, @"\A[0-9a-f]{64}\z"))
            throw new InvalidDataException("Invalid shadow state bounds/fingerprint.");
        using var s = JsonDocument.Parse(state, new() { MaxDepth = 16 });
        using var p = JsonDocument.Parse(report, new() { MaxDepth = 16 });
        RejectDuplicateKeys(s.RootElement); RejectDuplicateKeys(p.RootElement);
        if (s.RootElement.GetProperty("schemaVersion").GetInt32() != 1 ||
            Text(s.RootElement,"baselineFingerprint") != baselineFingerprint ||
            s.RootElement.GetProperty("files").ValueKind != JsonValueKind.Object ||
            Text(p.RootElement,"mode") != "shadow-history-only" ||
            !p.RootElement.GetProperty("accepted").GetBoolean() ||
            p.RootElement.GetProperty("receivedBars").GetInt32() != 39 ||
            Text(p.RootElement,"payloadSha256") != Hash(lease.DailyUtf8) ||
            Text(p.RootElement,"auditSha256") != Hash(lease.AuditUtf8) ||
            Text(p.RootElement,"baselineFingerprint") != baselineFingerprint ||
            p.RootElement.GetProperty("analyticsTriggered").GetBoolean())
            throw new InvalidDataException("Shadow result binding mismatch.");
        var files=s.RootElement.GetProperty("files").EnumerateObject().ToArray();
        if(files.Length!=39 || files.Any(f=>!System.Text.RegularExpressions.Regex.IsMatch(f.Name,@"\A[A-Z]+\.json\z") ||
            f.Value.ValueKind!=JsonValueKind.String))throw new InvalidDataException("Invalid shadow source files.");
        await using var c = new SqlConnection(connectionString); await c.OpenAsync(ct);
        await using var tx = (SqlTransaction)await c.BeginTransactionAsync(ct);
        await using var command = new SqlCommand("""
            DECLARE @lock int;
            EXEC @lock = sys.sp_getapplock @Resource=N'MarketDailyInbox:ShadowCommit',
                @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=10000;
            IF @lock < 0 THROW 50001, 'Shadow commit busy', 1;
            IF NOT EXISTS (SELECT 1 FROM market_daily.Inbox WITH (UPDLOCK,READCOMMITTEDLOCK)
                WHERE ReceiptId=@id AND Status='Processing' AND LeaseId=@lease AND LeaseUntil>SYSDATETIMEOFFSET())
            BEGIN SELECT 2; RETURN; END;
            DECLARE @head bigint=0,@fingerprint char(64);
            SELECT TOP (1) @head=GenerationId,@fingerprint=BaselineFingerprint FROM market_daily.ShadowHistory ORDER BY GenerationId DESC;
            IF @head<>@expected BEGIN SELECT 1; RETURN; END;
            IF @head>0 AND @fingerprint<>@baseline THROW 50003, 'Immutable history baseline changed', 1;
            INSERT market_daily.ShadowHistory (ReceiptId,BaselineFingerprint,StateSha256,StateUtf8,ReportUtf8)
                VALUES (@id,@baseline,@sha,@state,@report);
            UPDATE market_daily.Inbox SET Status='ShadowAccepted',LeaseId=NULL,LeaseUntil=NULL,LastErrorCode=NULL,
                ValidationReportUtf8=@report WHERE ReceiptId=@id;
            SELECT 0;
            """, c, tx);
        command.Parameters.Add("@id",SqlDbType.Char,64).Value=lease.ReceiptId;
        command.Parameters.Add("@lease",SqlDbType.UniqueIdentifier).Value=lease.LeaseId;
        command.Parameters.Add("@expected",SqlDbType.BigInt).Value=expectedGeneration;
        command.Parameters.Add("@baseline",SqlDbType.Char,64).Value=baselineFingerprint;
        command.Parameters.Add("@sha",SqlDbType.Char,64).Value=Hash(state);
        command.Parameters.Add("@state",SqlDbType.VarBinary,-1).Value=state;
        command.Parameters.Add("@report",SqlDbType.VarBinary,-1).Value=report;
        var result=(int)(await command.ExecuteScalarAsync(ct))!;
        await tx.CommitAsync(ct);
        return result switch { 0=>ShadowCommitResult.Committed, 1=>ShadowCommitResult.HeadChanged, _=>ShadowCommitResult.LeaseLost };
    }

    // Safe failure/retry only. No "published" or "history accepted" shortcut exists in this foundation.
    public async Task<bool> ReleaseAsync(string receiptId, Guid leaseId, bool blocked, string errorCode, CancellationToken ct = default)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(errorCode, @"\A[A-Z0-9_]{1,64}\z"))
            throw new ArgumentException("Use a bounded error code, never payloads, credentials or exception details.");
        await using var connection = new SqlConnection(connectionString); await connection.OpenAsync(ct);
        await using var command = new SqlCommand("""
            UPDATE market_daily.Inbox SET Status=@status, LeaseId=NULL, LeaseUntil=NULL, LastErrorCode=@error
            WHERE ReceiptId=@id AND Status='Processing' AND LeaseId=@lease AND LeaseUntil>SYSDATETIMEOFFSET();
            """, connection);
        command.Parameters.Add("@status", SqlDbType.VarChar, 24).Value = blocked ? "Blocked" : "PendingValidation";
        command.Parameters.Add("@error", SqlDbType.VarChar, 64).Value = errorCode;
        command.Parameters.Add("@id", SqlDbType.Char, 64).Value = receiptId;
        command.Parameters.Add("@lease", SqlDbType.UniqueIdentifier).Value = leaseId;
        return await command.ExecuteNonQueryAsync(ct) == 1;
    }

    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static byte[] Encode(string text) { var bytes = Utf8.GetBytes(text); CheckBytes(bytes); return bytes; }
    private static void CheckBytes(byte[] bytes) { if (bytes.Length is < 1 or > 262144) throw new InvalidDataException("JSON must be 1..256 KiB."); }
    private static string? Text(JsonElement e, string key) => e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    private static bool InstantEquals(JsonElement value, DateTimeOffset expected) => value.ValueKind == JsonValueKind.String &&
        value.GetString() is { } text && (text.EndsWith('Z') || System.Text.RegularExpressions.Regex.IsMatch(text, @"[+-]\d\d:\d\d$")) &&
        DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.None, out var actual) && actual == expected;
    private static void RejectDuplicateKeys(JsonElement e)
    {
        if (e.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var p in e.EnumerateObject()) { if (!names.Add(p.Name)) throw new InvalidDataException("Duplicate JSON key."); RejectDuplicateKeys(p.Value); }
        }
        else if (e.ValueKind == JsonValueKind.Array) foreach (var v in e.EnumerateArray()) RejectDuplicateKeys(v);
    }
}
