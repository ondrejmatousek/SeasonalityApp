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
  string Payload(decimal firstClose=1.1m,int stamp=0)=>JsonSerializer.Serialize(new{schemaVersion=1,fetchedAt=at.AddSeconds(-stamp).ToString("O"),captures=new[]{new{capturedAt=at.AddSeconds(-20).ToString("O"),rawJson=JsonSerializer.Serialize(new{success=true,symbol="OANDA:EURUSD",interval="4h",format="columns",count=3,bars=new{t=times,o=new[]{1.1m,1.1m,1.1m},h=new[]{1.2m,1.2m,1.2m},l=new[]{1.0m,1.0m,1.0m},c=new[]{firstClose,1.1m,1.1m},v=new int?[]{100,null,120}}})}}});
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
   await H4ReceiptAudit.Run(db,conflict.ReceiptId); // Read-only audit must leave all counts and D1 unchanged below.
   await using var count=new SqlCommand("SELECT (SELECT COUNT(*) FROM market_h4.LiveBars),(SELECT COUNT(*) FROM market_h4.LiveReceipts),(SELECT SUM(Value) FROM dbo.D1Sentinel),(SELECT COUNT(*) FROM market_h4.LiveBars WHERE Volume IS NULL)",db);await using var r=await count.ExecuteReaderAsync();await r.ReadAsync();Check(r.GetInt32(0)==2&&r.GetInt32(1)==4&&r.GetInt32(2)==39&&r.GetInt32(3)==1,"SQL isolation/idempotency/null volume");
  }
  finally{await Exec(admin,$"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}]");}
  Console.WriteLine("PASS: real isolated H4 SQL, raw hashes, 2 inserts, duplicate retries, conflicts, null volume, open/holiday/weekend exclusions, DST and unchanged D1 sentinel.");
 }
}
