using System.Data;
using System.Text.Json;
using Microsoft.Data.SqlClient;

internal static class RevisionChecks
{
    public static async Task Run()
    {
        // A uniquely named, disposable LocalDB database; never a production connection.
        var database = "DukascopyRevisionChecks_" + Guid.NewGuid().ToString("N");
        var local = new SqlConnectionStringBuilder { DataSource = @"(localdb)\MSSQLLocalDB", IntegratedSecurity = true, TrustServerCertificate = true };
        await using var admin = new SqlConnection(local.ConnectionString);
        await admin.OpenAsync();
        await using (var create = new SqlCommand($"CREATE DATABASE [{database}]", admin)) await create.ExecuteNonQueryAsync();
        try
        {
            local.InitialCatalog = database;
            await using var db = new SqlConnection(local.ConnectionString);
            await db.OpenAsync();
            async Task<int> Scalar(string sql, SqlTransaction? tx = null)
            {
                await using var command = new SqlCommand(sql, db, tx);
                return Convert.ToInt32(await command.ExecuteScalarAsync());
            }
            void Check(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
            await Scalar(RevisionPolicy.Schema);
            async Task<(int inserted, int observed, int recorded)> Import(char receipt, string bars, bool rollback = false)
            {
                await Scalar("DELETE FROM #Incoming; INSERT #Incoming VALUES " + bars);
                await using var tx = (SqlTransaction)await db.BeginTransactionAsync(IsolationLevel.Serializable);
                await using var command = new SqlCommand(RevisionPolicy.Commit, db, tx);
                command.Parameters.AddWithValue("@id", new string(receipt, 64));
                command.Parameters.AddWithValue("@observed", DateTimeOffset.UtcNow);
                command.Parameters.Add("@bytes", SqlDbType.VarBinary, -1).Value = new byte[] { (byte)receipt };
                (int inserted, int observed, int recorded) result;
                await using (var reader = await command.ExecuteReaderAsync())
                {
                    await reader.ReadAsync();
                    result = (reader.GetInt32(0), reader.GetInt32(1), reader.GetInt32(2));
                }
                if (rollback)
                {
                    // Model a failure saving source evidence after the commit SQL.
                    await Scalar("INSERT dukascopy.Sources VALUES('" + new string(receipt, 64) + "',0x01)", tx);
                    try { await Scalar("THROW 50003,'Injected source persistence failure',1;", tx); }
                    catch (SqlException e) when (e.Number == 50003) { await tx.RollbackAsync(); return result; }
                    throw new Exception("Expected injected failure");
                }
                await tx.CommitAsync();
                return result;
            }
            const string original = "('EURUSD','H4',14400,10,12,8,11,100),('XAUUSD','D1',86400,10,12,8,11,100),('GBPUSD','H4',14400,10,12,8,11,100),('USDJPY','H4',14400,10,12,8,11,100)";
            Check(await Import('a', original) == (4, 0, 0), "Initial bars must import");
            const string revised = "('EURUSD','H4',14400,9,12,8,11,101),('XAUUSD','D1',86400,10,13,8,11,100),('GBPUSD','H4',14400,10,12,7,11,100),('USDJPY','H4',14400,10,12,8,10,100),('EURUSD','H4',28800,11,13,9,12,100)";
            Check(await Import('b', revised) == (1, 4, 4), "All OHLC revision types must be audited while new bars import");
            Check(await Scalar("SELECT COUNT(*) FROM dukascopy.Bars WHERE StartUnix<>28800 AND [Open]=10 AND [High]=12 AND [Low]=8 AND [Close]=11 AND Volume=100 AND CollectionId='" + new string('a',64) + "'") == 4, "Original OHLCV and provenance must remain unchanged");
            Check(await Scalar("SELECT COUNT(*) FROM dukascopy.Revisions WHERE OriginalOpen=10 AND OriginalHigh=12 AND OriginalLow=8 AND OriginalClose=11 AND OriginalVolume=100 AND OriginalCollectionId='" + new string('a',64) + "'") == 4, "Revision audit must capture original prices and provenance");
            Check(await Scalar("SELECT COUNT(*) FROM dukascopy.Revisions WHERE Symbol='EURUSD' AND RevisedOpen=9 AND RevisedHigh=12 AND RevisedLow=8 AND RevisedClose=11 AND RevisedVolume=101 AND CollectionId='" + new string('b',64) + "'") == 1, "Revised evidence must be exact");
            Check(await Import('b', revised) == (0, 4, 0), "Retry must not duplicate bars or revision records");
            Check(await Import('c', "('EURUSD','H4',28800,11,13,9,12,999)") == (0, 0, 0), "Volume-only changes keep existing policy");
            Check(await Import('d', "('EURUSD','H4',14400,9,12,8,11,101),('EURUSD','H4',43200,11,13,9,12,100)", true) == (1, 1, 1), "Rollback fixture must exercise all insert types");
            Check(await Scalar("SELECT COUNT(*) FROM dukascopy.Bars WHERE StartUnix=43200") == 0, "Failed source save must roll back new bars");
            Check(await Scalar("SELECT COUNT(*) FROM dukascopy.Revisions WHERE CollectionId='" + new string('d',64) + "'") == 0, "Failed source save must roll back revisions");
            Check(await Scalar("SELECT COUNT(*) FROM dukascopy.Collections WHERE Id='" + new string('d',64) + "'") == 0, "Failed source save must roll back receipt");
            Check(await Scalar("SELECT COUNT(*) FROM dukascopy.Sources") == 0, "Failed source save must roll back evidence");
            Console.WriteLine(JsonSerializer.Serialize(new { passed = true, checks = "original OHLCV and provenance preserved; H4/D1 revisions audited; all OHLC fields; new bars; idempotent retry; volume-only policy; transaction rollback", productionChanged = false }));
        }
        finally
        {
            SqlConnection.ClearAllPools();
            await using var drop = new SqlCommand($"ALTER DATABASE [{database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{database}];", admin);
            await drop.ExecuteNonQueryAsync();
        }
    }
}
