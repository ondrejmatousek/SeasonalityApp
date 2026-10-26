using System.Data;
using System.Text;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using SeasonalityApp.Services;

// Operator-only historical backfill. Preserves ALL existing OHLCV and raw receipts.
// The online ingestion rules, Work schedules and prospective ledgers are unchanged.
try
{
 string Arg(string key){var i=Array.IndexOf(args,key);return i>=0&&i+1<args.Length?args[i+1]:throw new ArgumentException("Missing "+key);}
 var folder=Path.GetFullPath(Arg("--input"));var target=new SqlConnectionStringBuilder(Environment.GetEnvironmentVariable("SEASONALITY_H4_SQL_CONNECTION")??throw new InvalidOperationException("Secure SQL connection required")){ConnectTimeout=120};
 if(target.InitialCatalog!="seasonality-free-20261022"||!new[]{"seasonality.database.windows.net","tcp:seasonality.database.windows.net","seasonality.database.windows.net,1433","tcp:seasonality.database.windows.net,1433"}.Contains(target.DataSource,StringComparer.OrdinalIgnoreCase))throw new InvalidOperationException("Unexpected SQL target");
 var import=args.Contains("--import");if(import&&Arg("--confirm-database")!=target.InitialCatalog)throw new InvalidOperationException("Explicit database confirmation required");
 await using var db=new SqlConnection(target.ConnectionString);await db.OpenAsync();
 if(import){await using var schema=new SqlCommand("""
  IF OBJECT_ID('market_zones.HistoryBackfills','U') IS NULL CREATE TABLE market_zones.HistoryBackfills(
   ReceiptId char(64) NOT NULL PRIMARY KEY REFERENCES market_zones.Receipts(ReceiptId),
   AuditUtf8 varbinary(max) NOT NULL,AuditSha256 char(64) NOT NULL,CreatedAt datetimeoffset NOT NULL DEFAULT SYSDATETIMEOFFSET());
  """,db);await schema.ExecuteNonQueryAsync();}
 var reports=new List<object>();
 foreach(var file in Directory.EnumerateFiles(folder,"*.capture.json").Order())
 {
  using var capture=JsonDocument.Parse(await File.ReadAllBytesAsync(file));var now=DateTimeOffset.UtcNow;
  // Envelope is saved once before admission so retries reuse exactly the same bytes/hash.
  var envelopeFile=file+".envelope.json";
  if(!File.Exists(envelopeFile))await File.WriteAllTextAsync(envelopeFile,JsonSerializer.Serialize(new{schemaVersion=1,fetchedAt=now,captures=new[]{capture.RootElement}}),new UTF8Encoding(false));
  var bytes=await File.ReadAllBytesAsync(envelopeFile);var batch=MarketZonePrices.Parse(Encoding.UTF8.GetString(bytes),now,true);
  if(batch.Bars.Any(b=>b.Interval!="4h"||!b.Symbol.StartsWith("OANDA:"))||batch.Bars.Select(b=>b.Symbol).Distinct().Count()!=1)throw new InvalidDataException("One registered extra FX H4 capture per file required");
  var symbol=batch.Bars[0].Symbol;using var tx=db.BeginTransaction(IsolationLevel.Serializable);
  async Task<object?> Scalar(string sql,params SqlParameter[] parameters){await using var cmd=new SqlCommand(sql,db,tx){CommandTimeout=180};cmd.Parameters.AddRange(parameters);return await cmd.ExecuteScalarAsync();}
  SqlParameter Id()=>new("@id",SqlDbType.Char,64){Value=batch.Id};
  var prior=await Scalar("SELECT Status FROM market_zones.Receipts WITH(UPDLOCK,HOLDLOCK) WHERE ReceiptId=@id",Id());
  if(prior is string){reports.Add(new{symbol,receiptId=batch.Id,retry=true,status=prior});tx.Commit();continue;}
  var existing=new Dictionary<long,MarketZonePrices.Bar>();
  await using(var cmd=new SqlCommand("SELECT StartUnix,[Open],[High],[Low],[Close],Volume FROM market_zones.Bars WITH(UPDLOCK,HOLDLOCK) WHERE Symbol=@s AND Interval='4h'",db,tx))
  {cmd.Parameters.AddWithValue("@s",symbol);await using var r=await cmd.ExecuteReaderAsync();while(await r.ReadAsync())existing.Add(r.GetInt64(0),new(symbol,"4h",r.GetInt64(0),r.GetDecimal(1),r.GetDecimal(2),r.GetDecimal(3),r.GetDecimal(4),r.IsDBNull(5)?null:r.GetDecimal(5)));}
  var missing=new List<MarketZonePrices.Bar>();var conflicts=new List<object>();var volume=new List<object>();var overlap=0;
  foreach(var b in batch.Bars)
  {
   if(!existing.TryGetValue(b.Start,out var old)){missing.Add(b);continue;}overlap++;
   if(old.Open!=b.Open||old.High!=b.High||old.Low!=b.Low||old.Close!=b.Close)conflicts.Add(new{startUnix=b.Start,stored=old,observed=b,decision="PRESERVE_EXISTING"});
   else if(old.Volume!=b.Volume)volume.Add(new{symbol=b.Symbol,interval=b.Interval,start=b.Start,storedVolume=old.Volume,observedVolume=b.Volume});
  }
  var audit=new{policy="historical-missing-only-v1",symbol,receiptId=batch.Id,rawSha256=MarketH4Ingestion.Sha(Encoding.UTF8.GetBytes(capture.RootElement.GetProperty("rawJson").GetString()!)),eligible=batch.Bars.Count,inserted=missing.Count,overlap,conflicts,volumeWarnings=volume.Count,excluded=batch.Excluded,existingPricesChanged=false};
  if(import)
  {
   await Scalar("INSERT market_zones.Receipts(ReceiptId,PayloadUtf8,ReceivedAt,Status,InsertedBars,DuplicateBars,ExcludedBars,VolumeAudit) VALUES(@id,@raw,@at,'Accepted',@n,@d,@e,@v)",Id(),new("@raw",SqlDbType.VarBinary,-1){Value=bytes},new("@at",SqlDbType.DateTimeOffset){Value=now},new("@n",SqlDbType.Int){Value=missing.Count},new("@d",SqlDbType.Int){Value=overlap},new("@e",SqlDbType.Int){Value=batch.Excluded},new("@v",SqlDbType.NVarChar,-1){Value=JsonSerializer.Serialize(volume)});
   var table=new DataTable();table.Columns.Add("Symbol",typeof(string));table.Columns.Add("Interval",typeof(string));table.Columns.Add("StartUnix",typeof(long));foreach(var k in new[]{"Open","High","Low","Close","Volume"})table.Columns.Add(k,typeof(decimal));table.Columns.Add("ReceiptId",typeof(string));
   foreach(var b in missing)table.Rows.Add(b.Symbol,b.Interval,b.Start,b.Open,b.High,b.Low,b.Close,(object?)b.Volume??DBNull.Value,batch.Id);
   using(var bulk=new SqlBulkCopy(db,SqlBulkCopyOptions.CheckConstraints,tx){DestinationTableName="market_zones.Bars",BatchSize=2000,BulkCopyTimeout=180}){foreach(DataColumn c in table.Columns)bulk.ColumnMappings.Add(c.ColumnName,c.ColumnName);await bulk.WriteToServerAsync(table);}
   var auditBytes=JsonSerializer.SerializeToUtf8Bytes(audit);await Scalar("INSERT market_zones.HistoryBackfills(ReceiptId,AuditUtf8,AuditSha256) VALUES(@id,@raw,@sha)",Id(),new("@raw",SqlDbType.VarBinary,-1){Value=auditBytes},new("@sha",SqlDbType.Char,64){Value=MarketH4Ingestion.Sha(auditBytes)});
   if(await Scalar("SELECT HASHBYTES('SHA2_256',PayloadUtf8) FROM market_zones.Receipts WHERE ReceiptId=@id",Id()) is not byte[] saved||Convert.ToHexString(saved).ToLowerInvariant()!=batch.Id)throw new InvalidDataException("Receipt readback SHA mismatch");
   var readback=new Dictionary<long,MarketZonePrices.Bar>();await using(var check=new SqlCommand("SELECT StartUnix,[Open],[High],[Low],[Close],Volume FROM market_zones.Bars WHERE Symbol=@s AND Interval='4h'",db,tx)){check.Parameters.AddWithValue("@s",symbol);await using var r=await check.ExecuteReaderAsync();while(await r.ReadAsync())readback.Add(r.GetInt64(0),new(symbol,"4h",r.GetInt64(0),r.GetDecimal(1),r.GetDecimal(2),r.GetDecimal(3),r.GetDecimal(4),r.IsDBNull(5)?null:r.GetDecimal(5)));}
   if(readback.Count!=existing.Count+missing.Count||existing.Any(p=>!readback.TryGetValue(p.Key,out var b)||b!=p.Value)||missing.Any(b=>!readback.TryGetValue(b.Start,out var savedBar)||savedBar!=b))throw new InvalidDataException("Full SQL OHLCV readback or existing-price preservation failed");
   tx.Commit();
  }else tx.Rollback();
  await File.WriteAllTextAsync(file+(import?".import-audit.json":".preview-audit.json"),JsonSerializer.Serialize(audit),new UTF8Encoding(false));
  reports.Add(new{symbol,receiptId=batch.Id,eligible=batch.Bars.Count,inserted=missing.Count,overlap,ohlcConflictsPreserved=conflicts.Count,volumeWarnings=volume.Count,excluded=batch.Excluded,persisted=import,readbackValidated=import});
 }
 Console.WriteLine(JsonSerializer.Serialize(new{database=target.InitialCatalog,reports,existingPricesChanged=false}));
}catch(Exception e){Console.Error.WriteLine(JsonSerializer.Serialize(new{failed=true,type=e.GetType().Name,sqlNumber=e is SqlException sql?(int?)sql.Number:null,reason=e is SqlException?"SQL operation failed; no success claimed":e.Message}));Environment.ExitCode=1;}
