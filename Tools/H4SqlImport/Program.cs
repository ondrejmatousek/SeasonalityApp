using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.SqlClient;

// One-shot, opt-in production STORAGE import. No web host, D1 writes, schedules,
// analytics, provider calls, OAuth changes or activation of unvalidated H4 bars.
try
{
    string Arg(string key) { var i=Array.IndexOf(args,key); return i>=0&&i+1<args.Length ? args[i+1] : throw new ArgumentException("Missing "+key); }
    if(args.Contains("--self-test-localdb")) { await Importer.SelfTest(); return; }
    if(args.Contains("--h4-live-checks")) { await H4LiveChecks.Run(); return; }
    if(args.Contains("--h4-live-validation")) { await H4LiveChecks.Run(false); return; }
    var configRoot=Path.GetFullPath(Arg("--config-root"));
    if(!File.Exists(Path.Combine(configRoot,"SeasonalityApp.csproj")))throw new InvalidDataException("Configuration root is not SeasonalityApp.");
    if(args.Contains("--validate"))
    {
        var validated=Batch.Read(Arg("--input"),configRoot);
        Console.WriteLine(JsonSerializer.Serialize(new{validated.BatchId,validated.SymbolCount,validated.BarCount,validation="Offline structure/hash/elapsed-H4 check passed; session/calendar acceptance PENDING",productionChanged=false}));return;
    }
    var cs=Environment.GetEnvironmentVariable("SEASONALITY_H4_SQL_CONNECTION");
    if(string.IsNullOrWhiteSpace(cs))
    {
        using var cfg=JsonDocument.Parse(File.ReadAllBytes(Path.Combine(configRoot,"appsettings.Development.json")));
        cs=cfg.RootElement.GetProperty("ConnectionStrings").GetProperty("DefaultConnection").GetString();
    }
    var connection=new SqlConnectionStringBuilder(cs) {ConnectTimeout=120};
    if(connection.InitialCatalog!="free-sql-db-2426953" || !new[]{"seasonality.database.windows.net","tcp:seasonality.database.windows.net","seasonality.database.windows.net,1433","tcp:seasonality.database.windows.net,1433"}.Contains(connection.DataSource,StringComparer.OrdinalIgnoreCase))
        throw new InvalidOperationException("Refusing unexpected production SQL target.");
    Console.WriteLine(JsonSerializer.Serialize(new{configuredDatabase=connection.InitialCatalog,authentication=connection.Authentication.ToString(),integratedSecurity=connection.IntegratedSecurity,sqlUserConfigured=!string.IsNullOrWhiteSpace(connection.UserID),passwordConfigured=!string.IsNullOrWhiteSpace(connection.Password)}));
    await using var db=new SqlConnection(connection.ConnectionString);
    for(var attempt=0;;attempt++){try{await db.OpenAsync();break;}catch(SqlException e)when(e.Number==40613&&attempt<2){Console.WriteLine("SQL waking; retrying the connection only.");await Task.Delay(TimeSpan.FromSeconds(5));}}
    await using(var inspect=new SqlCommand("SELECT DB_NAME(), CAST(DATABASEPROPERTYEX(DB_NAME(),'Updateability') AS nvarchar(60)), OBJECT_ID('dbo.SeasonalityPrices'), OBJECT_ID('market_h4.Bars');",db))
    await using(var reader=await inspect.ExecuteReaderAsync())
    {
        await reader.ReadAsync(); if(reader.GetString(0)!="free-sql-db-2426953")throw new InvalidOperationException("SQL target identity mismatch.");
        Console.WriteLine(JsonSerializer.Serialize(new{database=reader.GetString(0),updateability=reader.GetString(1),d1TablePresent=!reader.IsDBNull(2),h4TablePresent=!reader.IsDBNull(3)}));
    }
    if(args.Contains("--inspect"))return;
    if(args.Contains("--install-h4-live-schema"))
    {
        if(Arg("--confirm-database")!="free-sql-db-2426953")throw new InvalidOperationException("Explicit database confirmation required.");
        await using var schema=new SqlCommand(File.ReadAllText(Path.Combine(configRoot,"Data/MarketH4Live.sql")),db){CommandTimeout=120};await schema.ExecuteNonQueryAsync();
        Console.WriteLine("H4 live schema installed additively; no D1/COT writes.");return;
    }
    if(args.Contains("--export-zone-source")){await ZoneEvidence.Export(db,Arg("--output"));return;}
    if(args.Contains("--record-zone-validation")){await ZoneEvidence.Record(db,File.ReadAllBytes(Arg("--input")));return;}
    var source=Batch.Read(Arg("--input"),configRoot);
    Console.WriteLine(JsonSerializer.Serialize(new{source.BatchId,source.SymbolCount,source.BarCount,validation="Structure and hash verified; session/calendar acceptance PENDING",productionChanged=false}));
    if(args.Contains("--verify")){Console.WriteLine(JsonSerializer.Serialize(await Importer.Verify(db,source)));return;}
    if(args.Contains("--validate"))return;
    if(!args.Contains("--import")||Arg("--confirm-database")!="free-sql-db-2426953")throw new ArgumentException("Explicit import and database confirmation required.");
    Console.WriteLine(JsonSerializer.Serialize(await Importer.Run(db,source)));
}
catch(Exception ex)
{
    // No connection strings, credentials, provider response bodies or raw SQL errors.
    Console.Error.WriteLine(JsonSerializer.Serialize(new{failed=true,errorType=ex.GetType().Name,sqlNumber=ex is SqlException sql ? (int?)sql.Number : null,reason=ex is SqlException?"SQL operation failed; no successful import is claimed.":ex.Message}));
    Environment.ExitCode=1;
}

sealed record Capture(string Symbol,byte[] Raw,string Hash,DateTimeOffset At,int Count);
sealed record Row(string Symbol,long Start,decimal Open,decimal High,decimal Low,decimal Close,decimal? Volume);
static class ZoneEvidence
{
    public static async Task Record(SqlConnection db,byte[] bytes)
    {
        using var json=JsonDocument.Parse(bytes);var report=json.RootElement;
        if(report.GetProperty("schemaVersion").GetInt32()!=1||report.GetProperty("ruleVersion").GetString()!="h4-d1-parity-v1")throw new InvalidDataException("Unknown H4 validation rule.");
        var batch=report.GetProperty("batchId").GetString()!;var hash=Batch.Sha(bytes);var accepted=report.GetProperty("accepted").GetInt32();var rejected=report.GetProperty("rejected").GetInt32();
        using var tx=db.BeginTransaction(IsolationLevel.Serializable);
        async Task<object?> Scalar(string sql,params SqlParameter[] parameters){await using var cmd=new SqlCommand(sql,db,tx){CommandTimeout=120};cmd.Parameters.AddRange(parameters);return await cmd.ExecuteScalarAsync();}
        SqlParameter Id()=>new("@id",SqlDbType.Char,64){Value=batch};
        try
        {
            var count=Convert.ToInt32(await Scalar("SELECT Bars FROM market_h4.Batches WHERE BatchId=@id;",Id()));
            if(accepted<=0||rejected<0||accepted+rejected!=count)throw new InvalidDataException("Zone validation/batch counts mismatch.");
            var symbols=new HashSet<string>(StringComparer.Ordinal);var a=0;var r=0;
            foreach(var item in report.GetProperty("instruments").EnumerateArray())
            {
                var symbol=item.GetProperty("symbol").GetString()!;if(!symbols.Add(symbol))throw new InvalidDataException("Repeated eligibility identity.");
                var n=item.GetProperty("accepted").GetInt32()+item.GetProperty("rejected").GetInt32();
                var found=Convert.ToInt32(await Scalar("SELECT COUNT(*) FROM market_h4.Captures WHERE BatchId=@id AND Symbol=@s AND RawSha256=@h AND BarCount=@n;",Id(),new("@s",SqlDbType.VarChar,32){Value=symbol},new("@h",SqlDbType.Char,64){Value=item.GetProperty("rawSha256").GetString()!},new("@n",SqlDbType.Int){Value=n}));
                if(found!=1)throw new InvalidDataException("Zone validation raw evidence mismatch.");a+=item.GetProperty("accepted").GetInt32();r+=item.GetProperty("rejected").GetInt32();
            }
            if(a!=accepted||r!=rejected||symbols.Count!=Convert.ToInt32(await Scalar("SELECT Symbols FROM market_h4.Batches WHERE BatchId=@id;",Id())))throw new InvalidDataException("Incomplete eligibility report.");
            await Scalar("IF OBJECT_ID('market_h4.ZoneValidation','U') IS NULL CREATE TABLE market_h4.ZoneValidation(BatchId char(64) NOT NULL REFERENCES market_h4.Batches(BatchId),RuleVersion varchar(32) NOT NULL CHECK(RuleVersion='h4-d1-parity-v1'),ReportUtf8 varbinary(max) NOT NULL,ReportSha256 char(64) NOT NULL,AcceptedBars int NOT NULL,RejectedBars int NOT NULL,ValidatedAt datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),PRIMARY KEY(BatchId,RuleVersion));");
            var previous=await Scalar("SELECT ReportSha256 FROM market_h4.ZoneValidation WHERE BatchId=@id AND RuleVersion='h4-d1-parity-v1';",Id());
            if(previous is string existing&&existing!=hash)throw new InvalidDataException("Existing validation differs; no overwrite permitted.");
            if(previous is not string)await Scalar("INSERT market_h4.ZoneValidation(BatchId,RuleVersion,ReportUtf8,ReportSha256,AcceptedBars,RejectedBars) VALUES(@id,'h4-d1-parity-v1',@report,@hash,@a,@r);",Id(),new("@report",SqlDbType.VarBinary,-1){Value=bytes},new("@hash",SqlDbType.Char,64){Value=hash},new("@a",SqlDbType.Int){Value=accepted},new("@r",SqlDbType.Int){Value=rejected});
            if(await Scalar("SELECT HASHBYTES('SHA2_256',ReportUtf8) FROM market_h4.ZoneValidation WHERE BatchId=@id AND RuleVersion='h4-d1-parity-v1';",Id()) is not byte[] saved||Convert.ToHexString(saved).ToLowerInvariant()!=hash)throw new InvalidDataException("Eligibility SQL hash readback mismatch.");
            tx.Commit();Console.WriteLine(JsonSerializer.Serialize(new{batchId=batch,accepted,rejected,validationSha256=hash,persisted=true,d1Changed=false}));
        }catch{try{tx.Rollback();}catch{}throw;}
    }
    public static async Task Export(SqlConnection db,string output)
    {
        var file=Path.GetFullPath(output);if(!file.StartsWith(Path.GetFullPath("artifacts")+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)||File.Exists(file))throw new InvalidOperationException("Use a NEW private artifacts output file.");
        string batch;await using(var head=new SqlCommand("SELECT TOP(1) BatchId FROM market_h4.Batches ORDER BY ImportedAt DESC,BatchId;",db))batch=(string?)await head.ExecuteScalarAsync()??throw new InvalidDataException("No H4 SQL backfill.");
        var captures=new List<object>();await using(var cmd=new SqlCommand("SELECT Symbol,RawSha256,RawUtf8,CapturedAt,BarCount FROM market_h4.Captures WHERE BatchId=@id ORDER BY Symbol;",db){CommandTimeout=180})
        {
            cmd.Parameters.Add("@id",SqlDbType.Char,64).Value=batch;await using var r=await cmd.ExecuteReaderAsync();
            while(await r.ReadAsync()){var bytes=(byte[])r[2];if(Batch.Sha(bytes)!=r.GetString(1))throw new InvalidDataException("Stored H4 capture SHA mismatch.");captures.Add(new{symbol=r.GetString(0),rawSha256=r.GetString(1),rawText=Encoding.UTF8.GetString(bytes),capturedAt=r.GetDateTimeOffset(3).ToUniversalTime().ToString("O"),count=r.GetInt32(4)});}
        }
        if(captures.Count!=28)throw new InvalidDataException("H4 SQL source is incomplete.");
        string? validation=null,validationSha=null;
        await using(var cmd=new SqlCommand("IF OBJECT_ID('market_h4.ZoneValidation','U') IS NOT NULL SELECT ReportUtf8,ReportSha256 FROM market_h4.ZoneValidation WHERE BatchId=@id AND RuleVersion='h4-d1-parity-v1';",db))
        {cmd.Parameters.Add("@id",SqlDbType.Char,64).Value=batch;await using var r=await cmd.ExecuteReaderAsync();if(await r.ReadAsync()){var bytes=(byte[])r[0];validationSha=r.GetString(1);if(Batch.Sha(bytes)!=validationSha)throw new InvalidDataException("H4 eligibility SHA mismatch.");validation=Encoding.UTF8.GetString(bytes);}}
        var liveRows=new List<object>();var ids=new HashSet<string>(StringComparer.Ordinal);
        await using(var cmd=new SqlCommand("IF OBJECT_ID('market_h4.LiveBars','U') IS NOT NULL SELECT Symbol,StartUnix,[Open],[High],[Low],[Close],Volume,ReceiptId FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY Symbol ORDER BY StartUnix DESC) AS rn FROM market_h4.LiveBars) b WHERE rn<=2200 ORDER BY Symbol,StartUnix",db){CommandTimeout=180})
        {await using var r=await cmd.ExecuteReaderAsync();while(await r.ReadAsync()){ids.Add(r.GetString(7));liveRows.Add(new{symbol=r.GetString(0),timestamp=r.GetInt64(1),open=r.GetDecimal(2),high=r.GetDecimal(3),low=r.GetDecimal(4),close=r.GetDecimal(5),volume=r.IsDBNull(6)?(decimal?)null:r.GetDecimal(6),receiptId=r.GetString(7)});}}
        var receipts=new List<object>();foreach(var id in ids.Order())
        {await using var cmd=new SqlCommand("SELECT PayloadUtf8,ReceivedAt FROM market_h4.LiveReceipts WHERE ReceiptId=@id AND Status='Accepted'",db);cmd.Parameters.AddWithValue("@id",id);await using var r=await cmd.ExecuteReaderAsync();if(!await r.ReadAsync())throw new InvalidDataException("H4 accepted receipt missing.");var bytes=(byte[])r[0];if(Batch.Sha(bytes)!=id)throw new InvalidDataException("H4 live receipt SHA mismatch.");receipts.Add(new{receiptId=id,receivedAt=r.GetDateTimeOffset(1).ToUniversalTime().ToString("O"),payloadText=Encoding.UTF8.GetString(bytes)});}
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);await File.WriteAllTextAsync(file,JsonSerializer.Serialize(new{schemaVersion=1,source="Azure SQL market_h4",batchId=batch,captures,zoneValidationText=validation,zoneValidationSha256=validationSha,live=new{rule=SeasonalityApp.Services.MarketH4Ingestion.Rule,rows=liveRows,receipts}}),new UTF8Encoding(false));
        Console.WriteLine(JsonSerializer.Serialize(new{batchId=batch,captures=captures.Count,hasZoneValidation=validation is not null,readOnly=true,output=file}));
    }
}
sealed record Batch(string BatchId,List<Capture> Captures,List<Row> Rows)
{
    public int SymbolCount=>Captures.Count; public int BarCount=>Rows.Count;
    public static string Sha(byte[] bytes)=>Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    public static Batch Read(string folder,string repository)
    {
        folder=Path.GetFullPath(folder);var manifest=File.ReadAllBytes(Path.Combine(folder,"manifest.json"));
        using var m=JsonDocument.Parse(manifest);using var checks=JsonDocument.Parse(File.ReadAllBytes(Path.Combine(folder,"checksums.json")));
        using var registry=JsonDocument.Parse(File.ReadAllBytes(Path.Combine(repository,"data/generated/site/data/manifest.json")));
        var allowed=registry.RootElement.GetProperty("assets").EnumerateArray().Where(a=>a.TryGetProperty("priceSource",out var s)&&s.TryGetProperty("assetClass",out var c)&&c.GetString()=="forex"&&s.GetProperty("provider").GetString()=="OANDA").Select(a=>a.GetProperty("key").GetString()!).ToHashSet(StringComparer.Ordinal);
        var expected=checks.RootElement.GetProperty("files").EnumerateArray().ToDictionary(x=>x.GetProperty("file").GetString()!,x=>x.GetProperty("sha256").GetString()!);
        var captures=new List<Capture>();var rows=new List<Row>();var seen=new HashSet<string>(StringComparer.Ordinal);
        foreach(var item in m.RootElement.GetProperty("instruments").EnumerateArray())
        {
            var key=item.GetProperty("key").GetString()!;if(!allowed.Contains(key)||!seen.Add(key))throw new InvalidDataException("Unexpected/duplicate FX identity.");
            var name=key+".raw.json";if(item.GetProperty("rawFile").GetString()!=name)throw new InvalidDataException("Unexpected raw path.");
            var file=Path.Combine(folder,name);if((File.GetAttributes(file)&FileAttributes.ReparsePoint)!=0)throw new InvalidDataException("Raw symlink rejected.");
            var bytes=File.ReadAllBytes(file);if(bytes.Length>2*1024*1024||!expected.TryGetValue(name,out var hash)||Sha(bytes)!=hash)throw new InvalidDataException("Raw SHA/size mismatch: "+key);
            using var j=JsonDocument.Parse(bytes);var root=j.RootElement;var symbol="OANDA:"+key;
            if(root.GetProperty("success").GetBoolean()!=true||root.GetProperty("symbol").GetString()!=symbol||root.GetProperty("interval").GetString()!="4h"||root.GetProperty("format").GetString()!="columns")throw new InvalidDataException("Raw identity/format mismatch.");
            var at=DateTimeOffset.ParseExact(item.GetProperty("capturedAtUtc").GetString()!,"yyyy-MM-dd HH:mm:ss 'UTC'",CultureInfo.InvariantCulture,DateTimeStyles.AssumeUniversal);
            var b=root.GetProperty("bars");var n=b.GetProperty("t").GetArrayLength();if(n<1||n>8000||n!=item.GetProperty("count").GetInt32()||n!=root.GetProperty("count").GetInt32())throw new InvalidDataException("Bar count mismatch.");
            foreach(var k in new[]{"o","h","l","c","v"})if(b.GetProperty(k).GetArrayLength()!=n)throw new InvalidDataException("Column count mismatch.");
            long previous=0;
            for(var i=0;i<n;i++)
            {
                var start=b.GetProperty("t")[i].GetInt64();if(start<=previous||start>at.ToUnixTimeSeconds()-4*3600)throw new InvalidDataException("Unordered/future/not-elapsed bar: "+key);previous=start;
                decimal Number(string k){var x=b.GetProperty(k)[i].GetDecimal();if(decimal.Round(x,10)!=x)throw new InvalidDataException("SQL precision loss rejected.");return x;}
                var o=Number("o");var h=Number("h");var l=Number("l");var c=Number("c");decimal? v=b.GetProperty("v")[i].ValueKind==JsonValueKind.Null?null:Number("v");
                if(o<=0||l<=0||h<Math.Max(o,c)||l>Math.Min(o,c)||c<=0||v<0)throw new InvalidDataException("Invalid raw OHLC/volume.");
                rows.Add(new(symbol,start,o,h,l,c,v));
            }
            captures.Add(new(symbol,bytes,hash,at,n));
        }
        if(captures.Count!=28||!seen.SetEquals(allowed)||expected.Count!=28||rows.Count!=m.RootElement.GetProperty("totalBars").GetInt32())throw new InvalidDataException("Incomplete FX backfill.");
        // Include each raw SHA in the stable batch ID; never rely on filenames alone.
        var identity=Sha(manifest)+"\n"+string.Join("\n",captures.OrderBy(c=>c.Symbol,StringComparer.Ordinal).Select(c=>c.Symbol+":"+c.Hash));
        return new(Sha(Encoding.UTF8.GetBytes(identity)),captures,rows);
    }
}

static class Importer
{
    public static async Task<object> Verify(SqlConnection db,Batch batch)
    {
        var expected=batch.Rows.ToDictionary(r=>(r.Symbol,r.Start));var verified=0;
        await using(var cmd=new SqlCommand("SELECT b.Symbol,b.StartUnix,b.[Open],b.[High],b.[Low],b.[Close],b.Volume FROM market_h4.Bars b WHERE b.Provider='OANDA' AND b.Timeframe='H4' AND b.StartUnix BETWEEN @first AND @last AND EXISTS(SELECT 1 FROM market_h4.Captures c WHERE c.BatchId=@id AND c.Symbol=b.Symbol);",db){CommandTimeout=180})
        {
            cmd.Parameters.Add("@id",SqlDbType.Char,64).Value=batch.BatchId;
            cmd.Parameters.Add("@first",SqlDbType.BigInt).Value=batch.Rows.Min(r=>r.Start);cmd.Parameters.Add("@last",SqlDbType.BigInt).Value=batch.Rows.Max(r=>r.Start);
            await using var reader=await cmd.ExecuteReaderAsync();
            while(await reader.ReadAsync())
            {
                var row=new Row(reader.GetString(0),reader.GetInt64(1),reader.GetDecimal(2),reader.GetDecimal(3),reader.GetDecimal(4),reader.GetDecimal(5),reader.IsDBNull(6)?null:reader.GetDecimal(6));
                if(!expected.Remove((row.Symbol,row.Start),out var wanted))continue;
                if(row!=wanted)throw new InvalidDataException("Committed H4 values differ from raw capture.");verified++;
            }
        }
        if(expected.Count!=0)throw new InvalidDataException("Committed H4 rows are missing.");
        foreach(var capture in batch.Captures)
        {
            await using var cmd=new SqlCommand("SELECT HASHBYTES('SHA2_256',RawUtf8) FROM market_h4.Captures WHERE BatchId=@id AND Symbol=@s;",db){CommandTimeout=60};
            cmd.Parameters.Add("@id",SqlDbType.Char,64).Value=batch.BatchId;cmd.Parameters.Add("@s",SqlDbType.VarChar,32).Value=capture.Symbol;
            if(await cmd.ExecuteScalarAsync() is not byte[] hash||Convert.ToHexString(hash).ToLowerInvariant()!=capture.Hash)throw new InvalidDataException("Committed raw capture hash mismatch.");
        }
        return new{batchId=batch.BatchId,database=db.Database,verifiedBars=verified,verifiedCaptures=batch.SymbolCount,readOnly=true,status="PendingSessionValidation",analyticsTriggered=false};
    }
    const string Schema="""
        IF SCHEMA_ID('market_h4') IS NULL EXEC('CREATE SCHEMA market_h4');
        IF OBJECT_ID('market_h4.Batches','U') IS NULL CREATE TABLE market_h4.Batches(
          BatchId char(64) NOT NULL PRIMARY KEY, Symbols int NOT NULL, Bars int NOT NULL,
          ImportedAt datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET(),
          Status varchar(32) NOT NULL CHECK(Status='PendingSessionValidation'));
        IF OBJECT_ID('market_h4.Captures','U') IS NULL CREATE TABLE market_h4.Captures(
          BatchId char(64) NOT NULL REFERENCES market_h4.Batches(BatchId), Symbol varchar(32) NOT NULL,
          RawSha256 char(64) NOT NULL, RawUtf8 varbinary(max) NOT NULL, CapturedAt datetimeoffset(7) NOT NULL,
          BarCount int NOT NULL, PRIMARY KEY(BatchId,Symbol));
        IF OBJECT_ID('market_h4.Bars','U') IS NULL CREATE TABLE market_h4.Bars(
          Provider varchar(16) NOT NULL CHECK(Provider='OANDA'),Symbol varchar(32) NOT NULL,
          Timeframe varchar(2) NOT NULL CHECK(Timeframe='H4'),StartUnix bigint NOT NULL CHECK(StartUnix>0),
          [Open] decimal(28,10) NOT NULL,[High] decimal(28,10) NOT NULL,[Low] decimal(28,10) NOT NULL,[Close] decimal(28,10) NOT NULL,
          Volume decimal(28,10) NULL, FirstBatchId char(64) NOT NULL,
          Status varchar(32) NOT NULL CHECK(Status='PendingSessionValidation'),
          PRIMARY KEY(Provider,Symbol,Timeframe,StartUnix),
          FOREIGN KEY(FirstBatchId,Symbol) REFERENCES market_h4.Captures(BatchId,Symbol),
          CHECK([Low]>0 AND [Low]<=[Open] AND [Low]<=[Close] AND [High]>=[Open] AND [High]>=[Close] AND (Volume IS NULL OR Volume>=0)));
        """;
    public static async Task<object> Run(SqlConnection db,Batch batch,bool simulateFailure=false)
    {
        using var tx=db.BeginTransaction(IsolationLevel.Serializable);
        async Task<object?> Scalar(string sql,params SqlParameter[] parameters)
        {await using var cmd=new SqlCommand(sql,db,tx){CommandTimeout=180};cmd.Parameters.AddRange(parameters);return await cmd.ExecuteScalarAsync();}
        SqlParameter Id()=>new("@id",SqlDbType.Char,64){Value=batch.BatchId};
        try
        {
            var locked=Convert.ToInt32(await Scalar("DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource='Seasonality:H4StorageImport:v1',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=30000; SELECT @r;"));
            if(locked<0)throw new InvalidOperationException("H4 import lock unavailable.");
            await Scalar(Schema);
            var duplicate=Convert.ToInt32(await Scalar("SELECT COUNT(*) FROM market_h4.Batches WHERE BatchId=@id;",Id()))>0;
            if(duplicate)
            {
                if(Convert.ToInt32(await Scalar("SELECT COUNT(*) FROM market_h4.Captures WHERE BatchId=@id;",Id()))!=batch.SymbolCount)throw new InvalidDataException("Existing batch is incomplete.");
                foreach(var c in batch.Captures)
                {
                    var same=Convert.ToInt32(await Scalar("SELECT COUNT(*) FROM market_h4.Captures WHERE BatchId=@id AND Symbol=@s AND RawSha256=@hash AND HASHBYTES('SHA2_256',RawUtf8)=CONVERT(varbinary(32),@hash,2);",Id(),new("@s",SqlDbType.VarChar,32){Value=c.Symbol},new("@hash",SqlDbType.Char,64){Value=c.Hash}));
                    if(same!=1)throw new InvalidDataException("Stored raw evidence mismatch.");
                }
            }
            else
            {
                await Scalar("INSERT market_h4.Batches(BatchId,Symbols,Bars,Status) VALUES(@id,@symbols,@bars,'PendingSessionValidation');",Id(),new("@symbols",SqlDbType.Int){Value=batch.SymbolCount},new("@bars",SqlDbType.Int){Value=batch.BarCount});
                foreach(var c in batch.Captures)await Scalar("INSERT market_h4.Captures(BatchId,Symbol,RawSha256,RawUtf8,CapturedAt,BarCount) VALUES(@id,@s,@h,@raw,@at,@n);",Id(),new("@s",SqlDbType.VarChar,32){Value=c.Symbol},new("@h",SqlDbType.Char,64){Value=c.Hash},new("@raw",SqlDbType.VarBinary,-1){Value=c.Raw},new("@at",SqlDbType.DateTimeOffset){Value=c.At},new("@n",SqlDbType.Int){Value=c.Count});
            }
            await Scalar("CREATE TABLE #H4Stage(Symbol varchar(32) NOT NULL,StartUnix bigint NOT NULL,[Open] decimal(28,10) NOT NULL,[High] decimal(28,10) NOT NULL,[Low] decimal(28,10) NOT NULL,[Close] decimal(28,10) NOT NULL,Volume decimal(28,10) NULL,PRIMARY KEY(Symbol,StartUnix));");
            var table=new DataTable();table.Columns.Add("Symbol",typeof(string));table.Columns.Add("StartUnix",typeof(long));foreach(var k in new[]{"Open","High","Low","Close","Volume"})table.Columns.Add(k,typeof(decimal));
            foreach(var r in batch.Rows)table.Rows.Add(r.Symbol,r.Start,r.Open,r.High,r.Low,r.Close,(object?)r.Volume??DBNull.Value);
            using(var bulk=new SqlBulkCopy(db,SqlBulkCopyOptions.CheckConstraints,tx){DestinationTableName="#H4Stage",BulkCopyTimeout=180,BatchSize=10000})
            {foreach(DataColumn c in table.Columns)bulk.ColumnMappings.Add(c.ColumnName,c.ColumnName);await bulk.WriteToServerAsync(table);}
            const string Join="FROM #H4Stage s JOIN market_h4.Bars b ON b.Provider='OANDA' AND b.Timeframe='H4' AND b.Symbol=s.Symbol AND b.StartUnix=s.StartUnix";
            var conflicts=Convert.ToInt32(await Scalar("SELECT COUNT(*) "+Join+" WHERE b.[Open]<>s.[Open] OR b.[High]<>s.[High] OR b.[Low]<>s.[Low] OR b.[Close]<>s.[Close] OR b.Volume<>s.Volume OR (b.Volume IS NULL AND s.Volume IS NOT NULL) OR (b.Volume IS NOT NULL AND s.Volume IS NULL);"));
            if(conflicts!=0)throw new InvalidDataException("Existing H4 values conflict; import rolled back, no overwrite.");
            var inserted=Convert.ToInt32(await Scalar("INSERT market_h4.Bars(Provider,Symbol,Timeframe,StartUnix,[Open],[High],[Low],[Close],Volume,FirstBatchId,Status) SELECT 'OANDA',s.Symbol,'H4',s.StartUnix,s.[Open],s.[High],s.[Low],s.[Close],s.Volume,@id,'PendingSessionValidation' FROM #H4Stage s WHERE NOT EXISTS(SELECT 1 FROM market_h4.Bars b WHERE b.Provider='OANDA' AND b.Symbol=s.Symbol AND b.Timeframe='H4' AND b.StartUnix=s.StartUnix); SELECT @@ROWCOUNT;",Id()));
            var verified=Convert.ToInt32(await Scalar("SELECT COUNT(*) "+Join+" WHERE b.[Open]=s.[Open] AND b.[High]=s.[High] AND b.[Low]=s.[Low] AND b.[Close]=s.[Close] AND (b.Volume=s.Volume OR b.Volume IS NULL AND s.Volume IS NULL);"));
            if(verified!=batch.BarCount)throw new InvalidDataException("H4 readback mismatch.");
            foreach(var c in batch.Captures)
            {
                var hash=(byte[]?)await Scalar("SELECT HASHBYTES('SHA2_256',RawUtf8) FROM market_h4.Captures WHERE BatchId=@id AND Symbol=@s;",Id(),new("@s",SqlDbType.VarChar,32){Value=c.Symbol});
                if(hash is null||Convert.ToHexString(hash).ToLowerInvariant()!=c.Hash)throw new InvalidDataException("SQL raw SHA readback mismatch.");
            }
            if(simulateFailure)throw new InvalidOperationException("Test rollback after staging.");
            await Scalar("DROP TABLE #H4Stage;");tx.Commit();
            return new{batchId=batch.BatchId,database=db.Database,symbols=batch.SymbolCount,received=batch.BarCount,inserted,duplicates=batch.BarCount-inserted,verified,rawHashesVerified=batch.SymbolCount,status="PendingSessionValidation",persisted=true,d1Changed=false,analyticsTriggered=false};
        }
        catch {try{tx.Rollback();}catch{}throw;}
    }
    public static async Task SelfTest()
    {
        var name="SeasonalityH4Test_"+Guid.NewGuid().ToString("N");
        if(!System.Text.RegularExpressions.Regex.IsMatch(name,"^SeasonalityH4Test_[a-f0-9]{32}$"))throw new InvalidOperationException();
        const string master="Server=(localdb)\\MSSQLLocalDB;Database=master;Integrated Security=true;Encrypt=false;Pooling=false";
        await using var admin=new SqlConnection(master);await admin.OpenAsync();
        await using(var create=new SqlCommand("CREATE DATABASE ["+name+"];",admin))await create.ExecuteNonQueryAsync();
        try
        {
            await using var db=new SqlConnection(new SqlConnectionStringBuilder(master){InitialCatalog=name}.ConnectionString);await db.OpenAsync();
            var raw=Encoding.UTF8.GetBytes("{\"test\":true}");var c=new Capture("OANDA:EURUSD",raw,Batch.Sha(raw),DateTimeOffset.UtcNow,1);
            var b=new Batch(new string('a',64),[c],[new(c.Symbol,1792170000,1.12205m,1.12404m,1.1217m,1.12387m,16982)]);
            await Run(db,b);await Run(db,b);await Verify(db,b);
            var eligibility=JsonSerializer.SerializeToUtf8Bytes(new{schemaVersion=1,ruleVersion="h4-d1-parity-v1",batchId=b.BatchId,accepted=1,rejected=0,instruments=new[]{new{symbol=c.Symbol,rawSha256=c.Hash,accepted=1,rejected=0}}});
            await ZoneEvidence.Record(db,eligibility);await ZoneEvidence.Record(db,eligibility);
            var conflict=b with{Rows=[b.Rows[0] with{Close=1.12388m}]};
            try{await Run(db,conflict);throw new Exception("Conflict accepted");}catch(InvalidDataException){}
            var rollback=b with{BatchId=new string('b',64)};
            try{await Run(db,rollback,true);throw new Exception("Rollback not exercised");}catch(InvalidOperationException){}
            await using var check=new SqlCommand("SELECT (SELECT COUNT(*) FROM market_h4.Bars),(SELECT COUNT(*) FROM market_h4.Batches),(SELECT COUNT(*) FROM market_h4.Captures),(SELECT COUNT(*) FROM market_h4.ZoneValidation);",db);
            await using var r=await check.ExecuteReaderAsync();await r.ReadAsync();if(r.GetInt32(0)!=1||r.GetInt32(1)!=1||r.GetInt32(2)!=1||r.GetInt32(3)!=1)throw new Exception("Idempotency/rollback failed");
            Console.WriteLine("PASS: real isolated SQL schema, bulk insert, exact decimal/raw SHA readback, idempotency, conflict rejection and rollback. No production data used.");
        }
        finally
        {
            await using var drop=new SqlCommand("ALTER DATABASE ["+name+"] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ["+name+"];",admin);await drop.ExecuteNonQueryAsync();
        }
    }
}
