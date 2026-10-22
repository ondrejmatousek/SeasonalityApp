using System.Data;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using TradingJournal.Data;
using SeasonalityApp.Services;

try {
 string Arg(string key){var i=Array.IndexOf(args,key);return i>=0&&i+1<args.Length?args[i+1]:throw new ArgumentException("Missing "+key);}
 const string targetName="seasonality-free-20261022";
 var input=Path.GetFullPath(Arg("--input"));var repo=Path.GetFullPath(Arg("--repo"));var phase=Arg("--phase");
 if(Arg("--confirm-database")!=targetName)throw new InvalidOperationException("Explicit NEW database confirmation required.");
 var target=new SqlConnectionStringBuilder(Environment.GetEnvironmentVariable("SEASONALITY_RECOVERY_SQL_CONNECTION")??throw new InvalidOperationException("Secure connection missing")){ConnectTimeout=120};
 if(target.InitialCatalog!=targetName||!new[]{"seasonality.database.windows.net","tcp:seasonality.database.windows.net","seasonality.database.windows.net,1433","tcp:seasonality.database.windows.net,1433"}.Contains(target.DataSource,StringComparer.OrdinalIgnoreCase))throw new InvalidOperationException("Unexpected recovery target");
 using var plan=JsonDocument.Parse(File.ReadAllText(Path.Combine(input,"plan.json")));
 foreach(var f in plan.RootElement.GetProperty("baseline").EnumerateArray()){var path=Path.GetFullPath(Path.Combine(input,"baseline",f.GetProperty("path").GetString()!));if(!path.StartsWith(Path.Combine(input,"baseline")+Path.DirectorySeparatorChar)||Hash(File.ReadAllBytes(path))!=f.GetProperty("sha256").GetString())throw new InvalidDataException("Baseline hash/path changed");}
 await using var db=new SqlConnection(target.ConnectionString);for(var attempt=0;;attempt++){try{await db.OpenAsync();break;}catch(SqlException e)when(e.Number==40613&&attempt<3){Console.WriteLine("New serverless database waking; retrying connection only.");await Task.Delay(5000);}}
 async Task Execute(string sql){await using var c=new SqlCommand(sql,db){CommandTimeout=180};await c.ExecuteNonQueryAsync();}
 async Task<long> Count(string table){await using var c=new SqlCommand("SELECT COUNT_BIG(*) FROM "+table,db){CommandTimeout=180};return Convert.ToInt64(await c.ExecuteScalarAsync());}
 async Task Bulk(DataTable data,string table,SqlTransaction? tx=null){using var b=new SqlBulkCopy(db,SqlBulkCopyOptions.CheckConstraints,tx){DestinationTableName=table,BulkCopyTimeout=180,BatchSize=10000};foreach(DataColumn c in data.Columns)b.ColumnMappings.Add(c.ColumnName,c.ColumnName);await b.WriteToServerAsync(data);}
 if(phase=="base") {
  var options=new DbContextOptionsBuilder<SeasonalityDbContext>().UseSqlServer(target.ConnectionString,s=>s.EnableRetryOnFailure(3)).Options;
  await using(var ctx=new SeasonalityDbContext(options)){await ctx.Database.EnsureCreatedAsync();await ctx.EnsureCotSchemaAsync();}
  await Execute("""
   IF SCHEMA_ID('market_recovery') IS NULL EXEC('CREATE SCHEMA market_recovery');
   IF OBJECT_ID('market_recovery.Series') IS NULL CREATE TABLE market_recovery.Series(AssetKey nvarchar(32) NOT NULL PRIMARY KEY,SourceSha256 char(64) NOT NULL,ImportedRows int NOT NULL,ImportedAt datetimeoffset NOT NULL);
   IF OBJECT_ID('market_recovery.Evidence') IS NULL CREATE TABLE market_recovery.Evidence(Id char(64) NOT NULL PRIMARY KEY,Kind varchar(32) NOT NULL,SourcePath nvarchar(512) NOT NULL,Payload varbinary(max) NOT NULL,RecoveredAt datetimeoffset NOT NULL,Note nvarchar(1024) NOT NULL);
   IF OBJECT_ID('market_recovery.Intraday') IS NULL CREATE TABLE market_recovery.Intraday(Symbol varchar(32) NOT NULL,Interval varchar(4) NOT NULL,StartUnix bigint NOT NULL,[Open] decimal(28,10) NOT NULL,[High] decimal(28,10) NOT NULL,[Low] decimal(28,10) NOT NULL,[Close] decimal(28,10) NOT NULL,Volume decimal(28,10) NULL,PRIMARY KEY(Symbol,Interval,StartUnix));
   """);
  long imported=0;var unavailable=0;
  foreach(var file in Directory.EnumerateFiles(Path.Combine(input,"candidate-prices"),"*.json").Order()) {
   var bytes=File.ReadAllBytes(file);using var doc=JsonDocument.Parse(bytes);var root=doc.RootElement;var key=root.GetProperty("assetKey").GetString()!;var rows=root.GetProperty("prices");if(rows.GetArrayLength()==0){unavailable++;continue;}var hash=Hash(bytes);
   await using(var c=new SqlCommand("SELECT SourceSha256,ImportedRows FROM market_recovery.Series WHERE AssetKey=@key",db)){c.Parameters.AddWithValue("@key",key);await using var r=await c.ExecuteReaderAsync();if(await r.ReadAsync()){if(r.GetString(0)!=hash||r.GetInt32(1)!=rows.GetArrayLength())throw new InvalidDataException("Previously imported series changed "+key);continue;}}
   using var tx=db.BeginTransaction();try {
    await using(var c=new SqlCommand("SELECT COUNT_BIG(*) FROM dbo.SeasonalityPrices WHERE AssetKey=@key",db,tx)){c.Parameters.AddWithValue("@key",key);if(Convert.ToInt64(await c.ExecuteScalarAsync())!=0)throw new InvalidDataException("Refusing untracked series overwrite "+key);}
    var table=new DataTable();table.Columns.Add("AssetKey",typeof(string));table.Columns.Add("Date",typeof(DateTime));table.Columns.Add("Close",typeof(decimal));table.Columns.Add("Source",typeof(string));table.Columns.Add("UpdatedAt",typeof(DateTimeOffset));
    var meta=root.GetProperty("priceSource");var provider=meta.TryGetProperty("provider",out var p)?p.GetString():null;var source=provider=="Yahoo"?"Yahoo":"TradingView:"+(provider??"Unknown");DateTime? previous=null;
    foreach(var row in rows.EnumerateArray()){var date=DateTime.ParseExact(row[0].GetString()!,"yyyy-MM-dd",System.Globalization.CultureInfo.InvariantCulture);var close=row[1].GetDecimal();if(previous>=date||close==0)throw new InvalidDataException("Invalid price date/value "+key);previous=date;table.Rows.Add(key,date,close,source,DateTimeOffset.UtcNow);}
    await Bulk(table,"dbo.SeasonalityPrices",tx);
    var expected=table.Rows.Cast<DataRow>().ToDictionary(r=>(DateTime)r["Date"],r=>decimal.Round((decimal)r["Close"],8,MidpointRounding.AwayFromZero));
    await using(var c=new SqlCommand("SELECT [Date],[Close],[Source] FROM dbo.SeasonalityPrices WHERE AssetKey=@key ORDER BY [Date]",db,tx)){c.Parameters.AddWithValue("@key",key);await using var r=await c.ExecuteReaderAsync();while(await r.ReadAsync()){if(!expected.Remove(r.GetDateTime(0),out var value)||r.GetDecimal(1)!=value||r.GetString(2)!=source)throw new InvalidDataException("Exact SQL price readback mismatch "+key);}if(expected.Count!=0)throw new InvalidDataException("Missing SQL prices "+key);}
    await using(var c=new SqlCommand("SELECT COUNT_BIG(*) FROM dbo.SeasonalityPrices WHERE AssetKey=@key",db,tx)){c.Parameters.AddWithValue("@key",key);if(Convert.ToInt64(await c.ExecuteScalarAsync())!=table.Rows.Count)throw new InvalidDataException("SQL price readback mismatch");}
    await using(var c=new SqlCommand("INSERT market_recovery.Series VALUES(@key,@hash,@rows,SYSDATETIMEOFFSET())",db,tx)){c.Parameters.AddWithValue("@key",key);c.Parameters.AddWithValue("@hash",hash);c.Parameters.AddWithValue("@rows",table.Rows.Count);await c.ExecuteNonQueryAsync();}
    tx.Commit();imported+=table.Rows.Count;Console.WriteLine(JsonSerializer.Serialize(new{series=key,rows=table.Rows.Count,imported}));
   }catch{tx.Rollback();throw;}
  }
  await Execute("IF COL_LENGTH('dbo.CotReports','FirstObservedAt') IS NULL ALTER TABLE dbo.CotReports ADD FirstObservedAt datetimeoffset NULL;");
  using var manifest=JsonDocument.Parse(File.ReadAllText(Path.Combine(input,"baseline/data/manifest.json")));
  foreach(var contract in manifest.RootElement.GetProperty("contracts").EnumerateObject()) {
   var relative=contract.Value.GetProperty("files").GetProperty("156").GetString()!;using var cot=JsonDocument.Parse(File.ReadAllText(Path.Combine(input,"baseline",relative.TrimStart('/'))));
   var table=new DataTable();foreach(var name in new[]{"ContractCode","ReportDate","OpenInterest","CommercialLong","CommercialShort","NonCommercialLong","NonCommercialShort","NonCommercialSpread","NonReportableLong","NonReportableShort","UpdatedAt","FirstObservedAt"})table.Columns.Add(name,name=="ContractCode"?typeof(string):name=="ReportDate"?typeof(DateTime):name.EndsWith("At")?typeof(DateTimeOffset):typeof(long));
   foreach(var r in cot.RootElement.GetProperty("reports").EnumerateArray()) {
    var oi=r.GetProperty("openInterest").GetInt64();long V(string g,string f)=>r.GetProperty(g).GetProperty(f).GetInt64();var cl=V("commercial","long");var cs=V("commercial","short");var nl=V("nonCommercial","long");var ns=V("nonCommercial","short");var spread=V("nonCommercial","spread");var rl=V("nonReportable","long");var rs=V("nonReportable","short");
    if(new[]{oi,cl,cs,nl,ns,spread,rl,rs}.Any(n=>n<0)||cl+nl+spread+rl!=oi||cs+ns+spread+rs!=oi)continue;
    table.Rows.Add(contract.Name,DateTime.ParseExact(r.GetProperty("date").GetString()!,"yyyy-MM-dd",System.Globalization.CultureInfo.InvariantCulture),oi,cl,cs,nl,ns,spread,rl,rs,DateTimeOffset.UtcNow,DBNull.Value);
   }
   using var tx=db.BeginTransaction();await using(var c=new SqlCommand("SELECT COUNT_BIG(*) FROM dbo.CotReports WHERE ContractCode=@code",db,tx)){c.Parameters.AddWithValue("@code",contract.Name);if(Convert.ToInt64(await c.ExecuteScalarAsync())>0){tx.Commit();continue;}}
   await Bulk(table,"dbo.CotReports",tx);tx.Commit();
  }
  foreach(var name in new[]{"MarketDailyInbox.sql","MarketDailyShadowHistory.sql","MarketH4Live.sql","MarketZonePrices.sql"})await Execute(await File.ReadAllTextAsync(Path.Combine(repo,"Data",name)));
  await Execute("IF COL_LENGTH('market_zones.Receipts','RecoveryValidatedAt') IS NULL ALTER TABLE market_zones.Receipts ADD RecoveryValidatedAt datetimeoffset NULL;");
  await Execute("IF NOT EXISTS(SELECT 1 FROM market_daily.ShadowHistory) DBCC CHECKIDENT ('market_daily.ShadowHistory', RESEED, 1000000) WITH NO_INFOMSGS;");
  foreach(var name in new[]{"plan.json","source-archive.json","candidate-inventory.json","intraday-inventory-current.json","extra-daily-inventory.json","README.md"}){var bytes=await File.ReadAllBytesAsync(Path.Combine(input,name));await using var c=new SqlCommand("IF NOT EXISTS(SELECT 1 FROM market_recovery.Evidence WHERE Id=@id) INSERT market_recovery.Evidence VALUES(@id,'OperatorRecovery',@path,@bytes,SYSDATETIMEOFFSET(),N'Local reconstruction; former SQL audit not restored; original database preserved.')",db);c.Parameters.AddWithValue("@id",Hash(bytes));c.Parameters.AddWithValue("@path",name);c.Parameters.Add("@bytes",SqlDbType.VarBinary,-1).Value=bytes;await c.ExecuteNonQueryAsync();}
  Console.WriteLine(JsonSerializer.Serialize(new{phase,database=targetName,prices=await Count("dbo.SeasonalityPrices"),cot=await Count("dbo.CotReports"),unavailable,oldAuditRestored=false}));
 }
 else if(phase=="live-h4") {
  using var manifest=JsonDocument.Parse(File.ReadAllText(Path.Combine(repo,"artifacts/sql-recovery-market/analytics-sources-v1/manifest.json")));
  var allowed=manifest.RootElement.GetProperty("entries").EnumerateArray().Where(e=>e.GetProperty("assetClass").GetString()=="forex").Select(e=>e.GetProperty("providerSymbol").GetString()!).ToHashSet(StringComparer.Ordinal);
  if(allowed.Count!=28)throw new InvalidDataException("Expected core 28 FX registry");
  foreach(var file in Directory.EnumerateFiles(input,"live-h4-*.json").Order()){
   var batch=MarketH4Ingestion.Parse(File.ReadAllText(file),DateTimeOffset.UtcNow,allowed);
   var receipt=await new MarketH4Store(target.ConnectionString).Receive(batch,CancellationToken.None);
   Console.WriteLine(JsonSerializer.Serialize(receipt));if(receipt.Status!="Accepted")throw new InvalidDataException("H4 SQL conflict");
  }
 }
 else if(phase=="sync-market") {
  var bundle=Path.Combine(repo,"artifacts/sql-recovery-market/analytics-sources-v1");using var manifest=JsonDocument.Parse(File.ReadAllText(Path.Combine(bundle,"manifest.json")));long inserted=0;
  using var tx=db.BeginTransaction();
  await using(var create=new SqlCommand("CREATE TABLE #MarketSync(AssetKey nvarchar(32),[Date] date,[Close] decimal(20,8),Source nvarchar(40));",db,tx))await create.ExecuteNonQueryAsync();
  var incoming=new DataTable();incoming.Columns.Add("AssetKey",typeof(string));incoming.Columns.Add("Date",typeof(DateTime));incoming.Columns.Add("Close",typeof(decimal));incoming.Columns.Add("Source",typeof(string));
  foreach(var entry in manifest.RootElement.GetProperty("entries").EnumerateArray()){
   using var series=JsonDocument.Parse(File.ReadAllText(Path.Combine(bundle,entry.GetProperty("file").GetString()!)));var root=series.RootElement;var key=entry.GetProperty("assetKey").GetString()!;
   foreach(var row in root.GetProperty("prices").EnumerateArray()){
    var date=DateTime.ParseExact(row[0].GetString()!,"yyyy-MM-dd",System.Globalization.CultureInfo.InvariantCulture);var close=decimal.Round(row[1].GetDecimal(),8,MidpointRounding.AwayFromZero);
    // The existing source-preserving bundle is authoritative for these 39 registered series.
    incoming.Rows.Add(key,date,close,"TradingView:"+entry.GetProperty("provider").GetString());
   }
  }
  await Bulk(incoming,"#MarketSync",tx);
  await using(var c=new SqlCommand("INSERT dbo.SeasonalityPrices(AssetKey,[Date],[Close],Source,UpdatedAt) SELECT m.AssetKey,m.[Date],m.[Close],m.Source,SYSDATETIMEOFFSET() FROM #MarketSync m WHERE NOT EXISTS(SELECT 1 FROM dbo.SeasonalityPrices p WHERE p.AssetKey=m.AssetKey AND p.[Date]=m.[Date]);",db,tx){CommandTimeout=180})inserted=await c.ExecuteNonQueryAsync();
  tx.Commit();Console.WriteLine(JsonSerializer.Serialize(new{phase,inserted}));
 }
 else if(phase is "zones" or "zones-current") {
  var folder=phase=="zones"?Path.Combine(input,"source-archive/artifacts/cfd-history"):Path.Combine(input,"zone-envelopes");
  foreach(var file in Directory.EnumerateFiles(folder,"*.json").Order()) {
   var text=File.ReadAllText(file);using var doc=JsonDocument.Parse(text);var at=DateTimeOffset.Parse(doc.RootElement.GetProperty("fetchedAt").GetString()!);var batch=MarketZonePrices.Parse(text,at,true,true);var receipt=await MarketZonePrices.Receive(db,batch);if(receipt.Status!="Accepted")throw new InvalidDataException("Zone recovery conflict");
   await using var c=new SqlCommand("UPDATE market_zones.Receipts SET RecoveryValidatedAt=@at WHERE ReceiptId=@id AND (RecoveryValidatedAt IS NULL OR RecoveryValidatedAt=@at)",db);c.Parameters.AddWithValue("@at",at);c.Parameters.AddWithValue("@id",batch.Id);await c.ExecuteNonQueryAsync();Console.WriteLine(JsonSerializer.Serialize(new{zone=Path.GetFileName(file),receipt.Status,receipt.Inserted,receipt.Duplicates}));
  }
  Console.WriteLine(JsonSerializer.Serialize(new{phase,rows=await Count("market_zones.Bars")}));
 }
 else if(phase=="intraday") {
  foreach(var file in Directory.EnumerateFiles(Path.Combine(input,"candidate-intraday-current"),"*.json").Order()) {
   using var doc=JsonDocument.Parse(File.ReadAllText(file));var root=doc.RootElement;var symbol=root.GetProperty("symbol").GetString()!;var interval=root.GetProperty("interval").GetString()!;
   await using(var c=new SqlCommand("SELECT COUNT_BIG(*) FROM market_recovery.Intraday WHERE Symbol=@s AND Interval=@i",db)){c.Parameters.AddWithValue("@s",symbol);c.Parameters.AddWithValue("@i",interval);if(Convert.ToInt64(await c.ExecuteScalarAsync())>0)continue;}
   var table=new DataTable();table.Columns.Add("Symbol",typeof(string));table.Columns.Add("Interval",typeof(string));table.Columns.Add("StartUnix",typeof(long));foreach(var f in new[]{"Open","High","Low","Close","Volume"})table.Columns.Add(f,typeof(decimal));
   foreach(var r in root.GetProperty("rows").EnumerateArray())table.Rows.Add(symbol,interval,r.GetProperty("timestamp").GetInt64(),r.GetProperty("open").GetDecimal(),r.GetProperty("high").GetDecimal(),r.GetProperty("low").GetDecimal(),r.GetProperty("close").GetDecimal(),r.TryGetProperty("volume",out var v)&&v.ValueKind==JsonValueKind.Number?v.GetDecimal():DBNull.Value);
   await Bulk(table,"market_recovery.Intraday");
  }
  Console.WriteLine(JsonSerializer.Serialize(new{phase,rows=await Count("market_recovery.Intraday")}));
 }
 else if(phase=="verify") {
  long checkedRows=0;
  foreach(var file in Directory.EnumerateFiles(Path.Combine(input,"candidate-intraday-current"),"*.json")){
   using var doc=JsonDocument.Parse(File.ReadAllText(file));var root=doc.RootElement;var expected=root.GetProperty("rows").EnumerateArray().ToDictionary(r=>r.GetProperty("timestamp").GetInt64());
   await using var cmd=new SqlCommand("SELECT StartUnix,[Open],[High],[Low],[Close],Volume FROM market_recovery.Intraday WHERE Symbol=@s AND Interval=@i",db){CommandTimeout=180};cmd.Parameters.AddWithValue("@s",root.GetProperty("symbol").GetString());cmd.Parameters.AddWithValue("@i",root.GetProperty("interval").GetString());await using var reader=await cmd.ExecuteReaderAsync();
   while(await reader.ReadAsync()){if(!expected.Remove(reader.GetInt64(0),out var row))throw new InvalidDataException("Unexpected SQL intraday timestamp");var fields=new[]{"open","high","low","close","volume"};for(var i=0;i<fields.Length;i++){var value=row.GetProperty(fields[i]);if(value.ValueKind==JsonValueKind.Null){if(!reader.IsDBNull(i+1))throw new InvalidDataException("Intraday null mismatch");}else if(reader.IsDBNull(i+1)||reader.GetDecimal(i+1)!=decimal.Round(value.GetDecimal(),10,MidpointRounding.AwayFromZero))throw new InvalidDataException("Intraday exact readback mismatch");}checkedRows++;}if(expected.Count!=0)throw new InvalidDataException("Missing SQL intraday rows");
  }
  var tables=new List<object>();await using(var c=new SqlCommand("SELECT s.name,t.name,SUM(p.rows) FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id JOIN sys.partitions p ON p.object_id=t.object_id AND p.index_id IN (0,1) GROUP BY s.name,t.name ORDER BY s.name,t.name",db)){await using var r=await c.ExecuteReaderAsync();while(await r.ReadAsync())tables.Add(new{schema=r.GetString(0),table=r.GetString(1),rows=r.GetInt64(2)});}
  var report=JsonSerializer.Serialize(new{at=DateTimeOffset.UtcNow,database=targetName,tables,intradayExactReadback=checkedRows,oldSqlAuditRestored=false,readOnly=true});await File.WriteAllTextAsync(Path.Combine(input,"sql-recovery-readback.json"),report);Console.WriteLine(report);
 } else throw new ArgumentException("Unknown recovery phase");
} catch(Exception e){Console.Error.WriteLine(JsonSerializer.Serialize(new{failed=true,type=e.GetType().Name,sqlNumber=e is SqlException sql?(int?)sql.Number:null,reason=e is SqlException?"SQL failed; secrets withheld":e.Message}));Environment.ExitCode=1;}
static string Hash(byte[] bytes)=>Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
