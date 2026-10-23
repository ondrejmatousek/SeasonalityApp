using System.Text.Json;
using Microsoft.Data.SqlClient;
using SeasonalityApp.Services;

static class H4LiveChecks
{
 public static async Task Run(bool sql=true)
 {
  void Check(bool ok,string s){if(!ok)throw new Exception(s);}
  var at=DateTimeOffset.Parse("2026-10-19T10:00:00Z");long T(string s)=>DateTimeOffset.Parse(s).ToUnixTimeSeconds();
  var t=T("2026-10-19T01:00:00Z");var times=new[]{t,t+14400,t+28800};
  string Payload(decimal firstClose=1.1m,int stamp=0,int? firstVolume=100,int? secondVolume=null)=>JsonSerializer.Serialize(new{schemaVersion=1,fetchedAt=at.AddSeconds(-stamp).ToString("O"),captures=new[]{new{capturedAt=at.AddSeconds(-20).ToString("O"),rawJson=JsonSerializer.Serialize(new{success=true,symbol="OANDA:EURUSD",interval="4h",format="columns",count=3,bars=new{t=times,o=new[]{1.1m,1.1m,1.1m},h=new[]{1.2m,1.2m,1.2m},l=new[]{1.0m,1.0m,1.0m},c=new[]{firstClose,1.1m,1.1m},v=new int?[]{firstVolume,secondVolume,120}}})}}});
  var allowed=new HashSet<string>{"OANDA:EURUSD"};var batch=MarketH4Ingestion.Parse(Payload(),at,allowed);
  string RowsPayload()=>JsonSerializer.Serialize(new{schemaVersion=1,fetchedAt=at.ToString("O"),captures=new[]{new{capturedAt=at.AddSeconds(-20).ToString("O"),rawJson=JsonSerializer.Serialize(new{success=true,symbol="OANDA:EURUSD",interval="4h",format="rows",count=3,bars=times.Select((t,i)=>new{t,o=1.1m,h=1.2m,l=1.0m,c=1.1m,v=i==1?(int?)null:i==0?100:120}).ToArray()})}}});
  var rows=MarketH4Ingestion.Parse(RowsPayload(),at,allowed);
  Check(rows.Bars.SequenceEqual(batch.Bars)&&rows.Excluded.SequenceEqual(batch.Excluded),"Rows/columns exact admission parity");
  Check(System.Text.Encoding.UTF8.GetString(rows.Utf8)==RowsPayload()&&rows.Id!=batch.Id,"Original rows payload bytes retained, not converted");
  Check(batch.Bars.Count==2&&batch.Excluded.Count==1,"Open/last bar excluded");
  Check(MarketH4Ingestion.Completion(T("2026-01-05T02:00:00Z"),T("2026-01-05T06:00:00Z"),DateTimeOffset.Parse("2026-01-05T07:00Z")) is null,"Winter NY offset");
  Check(MarketH4Ingestion.Completion(T("2026-10-16T17:00Z"),T("2026-10-18T21:00Z"),at) is null,"Regular Friday close independently elapsed");
  Check(MarketH4Ingestion.Completion(T("2026-10-15T17:00Z"),T("2026-10-18T21:00Z"),at)=="NO_ADJACENT_PROVIDER_BOUNDARY","Non-weekend gap not guessed");
  Check(MarketH4Ingestion.Completion(T("2026-12-25T02:00Z"),T("2026-12-25T06:00Z"),DateTimeOffset.Parse("2026-12-25T10:00Z"))=="HOLIDAY_REQUIRES_D1_EVIDENCE","Christmas excluded");
  foreach(var text in new[]{Payload().Replace("4h","1D"),Payload().Replace("EURUSD","AAPL"),Payload().Replace("1.2","0.9")}){try{MarketH4Ingestion.Parse(text,at,allowed);throw new Exception("Invalid accepted");}catch(System.IO.InvalidDataException){}}
  foreach(var text in new[]{RowsPayload().Replace("4h","1D"),RowsPayload().Replace("EURUSD","AAPL"),RowsPayload().Replace("1.2","0.9"),RowsPayload().Replace("rows","other")}){try{MarketH4Ingestion.Parse(text,at,allowed);throw new Exception("Invalid rows accepted");}catch(System.IO.InvalidDataException){}}
  try{MarketH4Ingestion.Parse(Payload(),at.AddHours(1),allowed);throw new Exception("Stale accepted");}catch(System.IO.InvalidDataException){}
  if(!sql){Console.WriteLine("PASS: H4 server validation, raw identities, chronology, OHLC bounds, DST, weekend/holiday/open exclusions. No SQL used.");return;}
  var name="SeasonalityH4LiveTest_"+Guid.NewGuid().ToString("N");var master="Data Source=(localdb)\\MSSQLLocalDB;Initial Catalog=master;Integrated Security=true;Encrypt=false;Pooling=false";
  await using var admin=new SqlConnection(master);await admin.OpenAsync();
  async Task Exec(SqlConnection db,string sql){await using var c=new SqlCommand(sql,db);await c.ExecuteNonQueryAsync();}
  await Exec(admin,$"CREATE DATABASE [{name}]");
  try
  {
   var cs=new SqlConnectionStringBuilder(master){InitialCatalog=name}.ConnectionString;await using var db=new SqlConnection(cs);await db.OpenAsync();
   var schema=File.ReadAllText("Data/MarketH4Live.sql");await Exec(db,schema);await Exec(db,schema);
   await Exec(db,"CREATE TABLE market_h4.Bars(Provider varchar(16),Symbol varchar(32),Timeframe varchar(8),StartUnix bigint,[Open] decimal(28,10),[High] decimal(28,10),[Low] decimal(28,10),[Close] decimal(28,10),Volume decimal(28,10)); CREATE TABLE dbo.D1Sentinel(Value int);INSERT dbo.D1Sentinel VALUES(39)");
   var store=new MarketH4Store(cs);var first=await store.Receive(batch,default);Check(first.InsertedBars==2&&first.Status=="Accepted","Live insert");
   Check((await store.Receive(batch,default)).Duplicate,"Exact payload idempotence");
   var rowsReceipt=await store.Receive(rows,default);Check(rowsReceipt.Status=="Accepted"&&rowsReceipt.InsertedBars==0&&rowsReceipt.DuplicateBars==2,"Rows SQL exact cross-format duplicates");
   var duplicate=await store.Receive(MarketH4Ingestion.Parse(Payload(stamp:1),at,allowed),default);Check(duplicate.InsertedBars==0&&duplicate.DuplicateBars==2,"Cross-payload duplicates");
   var conflict=await store.Receive(MarketH4Ingestion.Parse(Payload(1.11m),at,allowed),default);Check(conflict.Status=="Conflict"&&conflict.InsertedBars==0,"Conflict preserved, no overwrite");
   var revised=MarketH4Ingestion.Parse(Payload(firstVolume:101,secondVolume:123),at,allowed);
   var warning=await store.Receive(revised,default);Check(warning.Status=="Accepted"&&warning.InsertedBars==0&&warning.DuplicateBars==2&&warning.ComparisonPolicy==MarketH4Store.Policy&&warning.VolumeDifferences?.Length==2,"Volume-only changes including null to number are audited, not blocking");
   var retry=await store.Receive(revised,default);Check(retry.Duplicate&&retry.VolumeDifferences!.SequenceEqual(warning.VolumeDifferences!),"Exact retry preserves durable volume audit");
   var missing=await store.Receive(MarketH4Ingestion.Parse(Payload(firstVolume:null),at,allowed),default);Check(missing.Status=="Accepted"&&missing.VolumeDifferences?.Single().StoredVolume==100&&missing.VolumeDifferences.Single().ObservedVolume is null,"Number to null retains stored volume");
   await Exec(db,$"INSERT market_h4.Bars SELECT 'OANDA','OANDA:GBPUSD','H4',StartUnix,[Open],[High],[Low],[Close],Volume FROM market_h4.LiveBars");
   var historical=await store.Receive(MarketH4Ingestion.Parse(Payload(firstVolume:101,secondVolume:123).Replace("EURUSD","GBPUSD"),at,new HashSet<string>{"OANDA:GBPUSD"}),default);Check(historical.Status=="Accepted"&&historical.InsertedBars==0&&historical.VolumeDifferences?.Length==2&&historical.VolumeDifferences.All(d=>d.Source=="historical"),"Historical volume revisions are also audited without insertion");
   // A legacy receipt's decision is immutable under the new comparison policy.
   var legacy=MarketH4Ingestion.Parse(Payload(stamp:7),at,allowed);
   await using(var seed=new SqlCommand("INSERT market_h4.LiveReceipts(ReceiptId,PayloadUtf8,ReceivedAt,InsertedBars,DuplicateBars,ExcludedBars,Status) VALUES(@id,@raw,@at,0,2,1,'Conflict')",db)){seed.Parameters.AddWithValue("@id",legacy.Id);seed.Parameters.AddWithValue("@raw",legacy.Utf8);seed.Parameters.AddWithValue("@at",legacy.At);await seed.ExecuteNonQueryAsync();}
   var old=await store.Receive(legacy,default);Check(old.Duplicate&&old.Status=="Conflict"&&old.ComparisonPolicy is null,"Legacy Conflict is not reclassified");
   string Mixed(decimal firstClose)=>JsonSerializer.Serialize(new{schemaVersion=1,fetchedAt=at.AddHours(4).ToString("O"),captures=new[]{new{capturedAt=at.AddHours(4).ToString("O"),rawJson=JsonSerializer.Serialize(new{success=true,symbol="OANDA:EURUSD",interval="4h",format="rows",count=4,bars=Enumerable.Range(0,4).Select(i=>new{t=t+i*14400,o=1.1m,h=1.2m,l=1.0m,c=i==0?firstClose:1.1m,v=i==0?(int?)101:i==1?null:120}).ToArray()})}}});
   var mixedConflict=await store.Receive(MarketH4Ingestion.Parse(Mixed(1.11m),at.AddHours(4),allowed),default);Check(mixedConflict.Status=="Conflict"&&mixedConflict.InsertedBars==0,"One OHLC conflict blocks the whole batch including new bars");
   var mixed=await store.Receive(MarketH4Ingestion.Parse(Mixed(1.1m),at.AddHours(4),allowed),default);Check(mixed.Status=="Accepted"&&mixed.InsertedBars==1&&mixed.DuplicateBars==2&&mixed.VolumeDifferences?.Length==1,"Volume warning does not block new unrelated bars");
   using(var one=JsonDocument.Parse(Mixed(1.11m)))
   {
    var capture=one.RootElement.GetProperty("captures")[0];
    using var healthy=JsonDocument.Parse(Mixed(1.1m));
    var multi=JsonSerializer.Serialize(new{schemaVersion=1,fetchedAt=at.AddHours(4).ToString("O"),captures=new[]{capture.Clone(),JsonSerializer.SerializeToElement(new{capturedAt=at.AddHours(4).ToString("O"),rawJson=healthy.RootElement.GetProperty("captures")[0].GetProperty("rawJson").GetString()!.Replace("EURUSD","GBPUSD")})}});
    var partialBatch=MarketH4Ingestion.Parse(multi,at.AddHours(4),new HashSet<string>{"OANDA:EURUSD","OANDA:GBPUSD"});
    var partial=await store.Receive(partialBatch,default);
    Check(partial.Status=="PartialConflict"&&partial.InsertedBars==1&&partial.DuplicateBars==5&&partial.OhlcConflicts?.Single().Symbol=="OANDA:EURUSD","Only conflicted symbol quarantined; healthy GBPUSD inserted");
    var replay=await store.Receive(partialBatch,default);
    Check(replay.Duplicate&&replay.Status==partial.Status&&replay.InsertedBars==partial.InsertedBars&&replay.OhlcConflicts!.SequenceEqual(partial.OhlcConflicts!)&&replay.Admission==MarketH4Store.AdmissionPolicy,"Partial receipt and conflict evidence immutable on exact retry");
   }
   await H4ReceiptAudit.Run(db,conflict.ReceiptId); // Read-only audit must leave all counts and D1 unchanged below.
   await using var count=new SqlCommand($"SELECT (SELECT COUNT(*) FROM market_h4.LiveBars),(SELECT COUNT(*) FROM market_h4.LiveReceipts),(SELECT SUM(Value) FROM dbo.D1Sentinel),(SELECT COUNT(*) FROM market_h4.LiveBars WHERE Volume IS NULL),(SELECT Volume FROM market_h4.LiveBars WHERE Symbol='OANDA:EURUSD' AND StartUnix={t}),(SELECT Volume FROM market_h4.Bars WHERE Symbol='OANDA:GBPUSD' AND StartUnix={t})",db);await using var r=await count.ExecuteReaderAsync();await r.ReadAsync();Check(r.GetInt32(0)==4&&r.GetInt32(1)==11&&r.GetInt32(2)==39&&r.GetInt32(3)==1&&r.GetDecimal(4)==100&&r.GetDecimal(5)==100,"SQL isolation/idempotency and unchanged live/historical volumes including null");
  }
  finally{await Exec(admin,$"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}]");}
  Console.WriteLine("PASS: real isolated H4 SQL, durable volume-only audits and retries, unchanged historical/live volumes including null, mixed-batch admission, strict OHLC conflicts, immutable legacy decisions, raw hashes and unchanged D1 sentinel.");
 }
}
