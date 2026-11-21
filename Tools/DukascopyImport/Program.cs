using System.Data;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Data.SqlClient;

try
{
    string Arg(string key)
    {
        var index = Array.IndexOf(args, key);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : throw new ArgumentException("Missing " + key);
    }

    const string database = "seasonality-free-h4-20261118";
    const string rule = "dukascopy-bid-ny17-h1-v1";
    var target = new SqlConnectionStringBuilder(Environment.GetEnvironmentVariable("SEASONALITY_H4_SQL_CONNECTION")) { ConnectTimeout = 120 };
    if (target.InitialCatalog != database || target.DataSource is not ("seasonality.database.windows.net" or "tcp:seasonality.database.windows.net" or "seasonality.database.windows.net,1433" or "tcp:seasonality.database.windows.net,1433"))
        throw new InvalidOperationException("Unexpected Dukascopy database target.");
    await using var db = new SqlConnection(target.ConnectionString);
    await db.OpenAsync();

    if (args.Contains("--import"))
    {
        if (Arg("--confirm-database") != database) throw new InvalidOperationException("Database confirmation required.");
        var folder = Path.GetFullPath(Arg("--input"));
        var bytes = await File.ReadAllBytesAsync(Path.Combine(folder, "collection.json"));
        using var document = JsonDocument.Parse(bytes);
        var collection = document.RootElement;
        if (!collection.GetProperty("ready").GetBoolean() || collection.GetProperty("provider").GetString() != "Dukascopy" || collection.GetProperty("priceSide").GetString() != "BID" || collection.GetProperty("rule").GetString() != rule)
            throw new InvalidDataException("Invalid Dukascopy collection identity.");
        var observed = collection.GetProperty("observedAt").GetDateTimeOffset();
        if (observed < DateTimeOffset.UtcNow.AddHours(-2) || observed > DateTimeOffset.UtcNow.AddMinutes(1))
            throw new InvalidDataException("Dukascopy collection observation is stale or future.");
        var expected = "AUDCAD AUDCHF AUDJPY AUDNZD CADCHF CADJPY CHFJPY EURCAD EURCHF EURAUD EURGBP EURJPY EURNZD GBPAUD GBPCAD GBPCHF GBPJPY GBPNZD NZDCAD NZDCHF NZDJPY NZDUSD AUDUSD EURUSD GBPUSD USDCAD USDCHF USDJPY USDHKD EURNOK EURPLN EURSEK USDMXN USDNOK USDPLN USDSEK USDZAR SGDJPY USDSGD".Split(' ').ToHashSet();
        var instruments = collection.GetProperty("instruments").EnumerateArray().ToArray();
        if (instruments.Length != expected.Count || !expected.SetEquals(instruments.Select(i => i.GetProperty("key").GetString()!)))
            throw new InvalidDataException("Expected all 39 FX identities.");

        var table = new DataTable();
        table.Columns.Add("Symbol", typeof(string));
        table.Columns.Add("Interval", typeof(string));
        table.Columns.Add("StartUnix", typeof(long));
        foreach (var column in new[] { "Open", "High", "Low", "Close", "Volume" }) table.Columns.Add(column, typeof(decimal));
        var sources = new Dictionary<string, byte[]>();
        foreach (var instrument in instruments)
        {
            var key = instrument.GetProperty("key").GetString()!;
            if (instrument.GetProperty("symbol").GetString() != "DUKASCOPY:" + key) throw new InvalidDataException("Dukascopy symbol mismatch.");
            foreach (var source in instrument.GetProperty("evidence").EnumerateArray())
            {
                var relative = source.GetProperty("file").GetString()!;
                var path = Path.GetFullPath(Path.Combine(folder, relative));
                if (!path.StartsWith(folder + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Source path escaped collection.");
                var raw = await File.ReadAllBytesAsync(path);
                var hash = Hash(raw);
                if (hash != source.GetProperty("sha256").GetString()) throw new InvalidDataException("Original source hash changed.");
                sources[hash] = raw;
            }
            foreach (var (property, interval, duration) in new[] { ("h4", "H4", 14400), ("daily", "D1", 86400) })
            {
                long previous = 0;
                foreach (var bar in instrument.GetProperty(property).EnumerateArray())
                {
                    var start = bar.GetProperty("timestamp").GetInt64();
                    if (start <= previous || start % 3600 != 0 || bar.GetProperty("endTimestamp").GetInt64() != start + duration || start + duration > observed.ToUnixTimeSeconds() - 60)
                        throw new InvalidDataException("Invalid completed Dukascopy boundary.");
                    previous = start;
                    var prices = new[] { "open", "high", "low", "close", "volume" }.Select(p => decimal.Round(bar.GetProperty(p).GetDecimal(), 10)).ToArray();
                    if (prices[2] <= 0 || prices[2] > Math.Min(prices[0], prices[3]) || prices[1] < Math.Max(prices[0], prices[3]) || prices[4] < 0)
                        throw new InvalidDataException("Invalid Dukascopy OHLCV.");
                    table.Rows.Add(key, interval, start, prices[0], prices[1], prices[2], prices[3], prices[4]);
                }
            }
        }

        await using var schema = new SqlCommand("""
            IF SCHEMA_ID('dukascopy') IS NULL EXEC('CREATE SCHEMA dukascopy');
            IF OBJECT_ID('dukascopy.Collections','U') IS NULL CREATE TABLE dukascopy.Collections(
                Id char(64) PRIMARY KEY,ObservedAt datetimeoffset NOT NULL,ReceivedAt datetimeoffset NOT NULL DEFAULT SYSUTCDATETIME(),CollectionUtf8 varbinary(max) NOT NULL);
            IF OBJECT_ID('dukascopy.Sources','U') IS NULL CREATE TABLE dukascopy.Sources(
                Sha256 char(64) PRIMARY KEY,PayloadUtf8 varbinary(max) NOT NULL);
            IF OBJECT_ID('dukascopy.Bars','U') IS NULL CREATE TABLE dukascopy.Bars(
                Symbol varchar(16) NOT NULL,Interval varchar(2) NOT NULL CHECK(Interval IN('H4','D1')),StartUnix bigint NOT NULL,
                [Open] decimal(28,10) NOT NULL,[High] decimal(28,10) NOT NULL,[Low] decimal(28,10) NOT NULL,[Close] decimal(28,10) NOT NULL,Volume decimal(28,10) NOT NULL,
                CollectionId char(64) NOT NULL REFERENCES dukascopy.Collections(Id),PRIMARY KEY(Symbol,Interval,StartUnix));
            CREATE TABLE #Incoming(Symbol varchar(16),Interval varchar(2),StartUnix bigint,[Open] decimal(28,10),[High] decimal(28,10),[Low] decimal(28,10),[Close] decimal(28,10),Volume decimal(28,10),PRIMARY KEY(Symbol,Interval,StartUnix));
            """, db) { CommandTimeout = 180 };
        await schema.ExecuteNonQueryAsync();
        using (var bulk = new SqlBulkCopy(db) { DestinationTableName = "#Incoming", BulkCopyTimeout = 180 })
        {
            foreach (DataColumn column in table.Columns) bulk.ColumnMappings.Add(column.ColumnName, column.ColumnName);
            await bulk.WriteToServerAsync(table);
        }
        await using var tx = (SqlTransaction)await db.BeginTransactionAsync(IsolationLevel.Serializable);
        var id = Hash(bytes);
        await using var commit = new SqlCommand("""
            DECLARE @lock int;
            EXEC @lock=sys.sp_getapplock @Resource='Dukascopy:Commit',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=30000;
            IF @lock<0 THROW 50001,'Dukascopy writer lock unavailable',1;
            IF EXISTS(SELECT 1 FROM #Incoming i JOIN dukascopy.Bars b ON b.Symbol=i.Symbol AND b.Interval=i.Interval AND b.StartUnix=i.StartUnix
                WHERE b.[Open]<>i.[Open] OR b.[High]<>i.[High] OR b.[Low]<>i.[Low] OR b.[Close]<>i.[Close])
                THROW 50002,'Dukascopy immutable OHLC overlap conflict',1;
            IF NOT EXISTS(SELECT 1 FROM dukascopy.Collections WHERE Id=@id)
                INSERT dukascopy.Collections(Id,ObservedAt,CollectionUtf8) VALUES(@id,@observed,@bytes);
            INSERT dukascopy.Bars SELECT i.*,@id FROM #Incoming i WHERE NOT EXISTS(
                SELECT 1 FROM dukascopy.Bars b WHERE b.Symbol=i.Symbol AND b.Interval=i.Interval AND b.StartUnix=i.StartUnix);
            SELECT @@ROWCOUNT;
            """, db, tx) { CommandTimeout = 180 };
        commit.Parameters.AddWithValue("@id", id);
        commit.Parameters.AddWithValue("@observed", observed);
        commit.Parameters.Add("@bytes", SqlDbType.VarBinary, -1).Value = bytes;
        var inserted = Convert.ToInt32(await commit.ExecuteScalarAsync());
        foreach (var (hash, raw) in sources)
        {
            await using var save = new SqlCommand("IF NOT EXISTS(SELECT 1 FROM dukascopy.Sources WHERE Sha256=@hash) INSERT dukascopy.Sources VALUES(@hash,@raw);", db, tx);
            save.Parameters.AddWithValue("@hash", hash);
            save.Parameters.Add("@raw", SqlDbType.VarBinary, -1).Value = raw;
            await save.ExecuteNonQueryAsync();
        }
        await tx.CommitAsync();
        Console.WriteLine(JsonSerializer.Serialize(new { database, provider = "Dukascopy", receiptId = id, inserted, observed, originalSources = sources.Count }));
    }

    if (args.Contains("--export"))
    {
        var rows = new List<object>();
        await using var command = new SqlCommand("""
            SELECT b.Symbol,b.Interval,b.StartUnix,b.[Open],b.[High],b.[Low],b.[Close],b.Volume,b.CollectionId,c.ObservedAt
            FROM dukascopy.Bars b JOIN dukascopy.Collections c ON c.Id=b.CollectionId ORDER BY b.Symbol,b.Interval,b.StartUnix
            """, db) { CommandTimeout = 180 };
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            rows.Add(new { key = reader.GetString(0), interval = reader.GetString(1), timestamp = reader.GetInt64(2), open = reader.GetDecimal(3), high = reader.GetDecimal(4), low = reader.GetDecimal(5), close = reader.GetDecimal(6), volume = reader.GetDecimal(7), receiptId = reader.GetString(8), observedAt = reader.GetDateTimeOffset(9) });
        var output = Path.GetFullPath(Arg("--output"));
        if (!output.StartsWith(Path.GetFullPath("artifacts") + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Private output required.");
        Directory.CreateDirectory(Path.GetDirectoryName(output)!);
        await File.WriteAllTextAsync(output, JsonSerializer.Serialize(new { schemaVersion = 1, provider = "Dukascopy", priceSide = "BID", rule, builtAt = DateTimeOffset.UtcNow, rows }));
        Console.WriteLine(JsonSerializer.Serialize(new { exported = rows.Count }));
    }
}
catch (Exception error)
{
    Console.Error.WriteLine(JsonSerializer.Serialize(new { failed = true, type = error.GetType().Name, sqlNumber = error is SqlException sql ? sql.Number : (int?)null, reason = error is SqlException ? "Dukascopy SQL operation failed" : error.Message }));
    Environment.ExitCode = 1;
}

static string Hash(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));
