using System.Text.Json;
using Microsoft.Data.SqlClient;
using SeasonalityApp.Services;

static class Checks
{
 public static async Task Run(bool sql)
 {
  void Check(bool b,string m){if(!b)throw new InvalidDataException(m);}
  var at=DateTimeOffset.Parse("2026-10-18T12:00:00Z");
  long T(string x)=>DateTimeOffset.Parse(x).ToUnixTimeSeconds();
  string Payload(decimal close=7.75m,decimal? volume=100,string symbol="OANDA:USDHKD",string interval="1D",bool rows=false)=>JsonSerializer.Serialize(new{schemaVersion=1,fetchedAt=at.ToString("O"),captures=new[]{new{capturedAt=at.ToString("O"),rawJson=JsonSerializer.Serialize(new{success=true,symbol,interval,format=rows?"rows":"columns",count=2,bars=rows?(object)new[]{new{t=T("2026-10-14T21:00Z"),o=7.75m,h=7.8m,l=7.7m,c=close,v=volume},new{t=T("2026-10-15T21:00Z"),o=7.75m,h=7.8m,l=7.7m,c=7.75m,v=volume}}:new{t=new[]{T("2026-10-14T21:00Z"),T("2026-10-15T21:00Z")},o=new[]{7.75m,7.75m},h=new[]{7.8m,7.8m},l=new[]{7.7m,7.7m},c=new[]{close,7.75m},v=new[]{volume,volume}}})}}});
  var batch=MarketZonePrices.Parse(Payload(),at);Check(batch.Bars.Count==2,"Elapsed D1 including Thursday/Friday close");
  Check(MarketZonePrices.Parse(Payload(rows:true),at).Bars.SequenceEqual(batch.Bars),"Rows/columns parity");
  Check(MarketZonePrices.Forex.Length==11&&MarketZonePrices.Forex.Distinct().Count()==11,"11 unique new FX");
  Check(!MarketZonePrices.Allowed("OANDA:EURUSD","1D")&&!MarketZonePrices.Allowed("CRYPTO:BTCUSD","4h")&&MarketZonePrices.Allowed("CRYPTO:BTCUSD","1D"),"Separate canonical and crypto identities");
  foreach(var bad in new[]{Payload(symbol:"OANDA:EURUSD"),Payload(close:8.0m),Payload(interval:"1W")}){try{MarketZonePrices.Parse(bad,at);throw new Exception("Invalid capture accepted");}catch(InvalidDataException){}}
  try{MarketZonePrices.Parse(Payload(),at.AddHours(1));throw new Exception("Stale accepted");}catch(InvalidDataException){}
  Check(!MarketZonePrices.DailyComplete("OANDA:USDHKD",T("2026-10-14T21:00Z"),null,at),"Missing D1 adjacent boundary rejected");
  Check(!MarketZonePrices.DailyComplete("OANDA:USDHKD",T("2026-12-24T22:00Z"),T("2026-12-25T22:00Z"),DateTimeOffset.Parse("2026-12-27T12:00Z")),"Holiday not guessed");
  Check(!MarketZonePrices.DailyComplete("CRYPTO:BTCUSD",T("2026-10-18T00:00Z"),null,at),"Crypto open UTC day excluded");
  Check(MarketZonePrices.DailyComplete("CRYPTO:BTCUSD",T("2026-10-17T00:00Z"),null,at),"Crypto elapsed weekend day retained");
  if(!sql){Console.WriteLine("PASS zone admission, source separation, rows/columns, stale/open/gap/holiday exclusions.");return;}
  var name="SeasonalityZoneTest_"+Guid.NewGuid().ToString("N");var master="Data Source=(localdb)\\MSSQLLocalDB;Initial Catalog=master;Integrated Security=true;Encrypt=false;Pooling=false";
  await using var admin=new SqlConnection(master);await admin.OpenAsync();
  async Task Exec(SqlConnection db,string text){await using var c=new SqlCommand(text,db);await c.ExecuteNonQueryAsync();}
  await Exec(admin,$"CREATE DATABASE [{name}]");
  try
  {
   await using var db=new SqlConnection(new SqlConnectionStringBuilder(master){InitialCatalog=name}.ConnectionString);await db.OpenAsync();
   await Exec(db,File.ReadAllText("Data/MarketZonePrices.sql"));await Exec(db,File.ReadAllText("Data/MarketZonePrices.sql"));await Exec(db,"CREATE TABLE dbo.CanonicalSentinel(Value int);INSERT dbo.CanonicalSentinel VALUES(39)");
   var first=await MarketZonePrices.Receive(db,batch);Check(first.Status=="Accepted"&&first.Inserted==2,"New isolated SQL rows");
   Check((await MarketZonePrices.Receive(db,batch)).Retry,"Idempotent receipt retry");
   var revise=await MarketZonePrices.Receive(db,MarketZonePrices.Parse(Payload(volume:null),at));Check(revise.Status=="Accepted"&&revise.Inserted==0&&revise.Duplicates==2,"Volume revision not overwrite");
   var conflict=await MarketZonePrices.Receive(db,MarketZonePrices.Parse(Payload(close:7.76m),at));Check(conflict.Status=="Conflict"&&conflict.Inserted==0,"Exact OHLC conflict fails closed");
   await using(var c=new SqlCommand("SELECT COUNT(*) FROM market_zones.Bars WHERE Volume=100 AND [Close]=7.75",db))Check(Convert.ToInt32(await c.ExecuteScalarAsync())==2,"Original prices/volumes retained");
   await using(var c=new SqlCommand("SELECT Value FROM dbo.CanonicalSentinel",db))Check(Convert.ToInt32(await c.ExecuteScalarAsync())==39,"Canonical D1 untouched");
   Console.WriteLine("PASS isolated SQL receipts, raw hash readback, idempotence, conflicts, immutable volume and canonical sentinel.");
  }
  finally{if(!System.Text.RegularExpressions.Regex.IsMatch(name,"^SeasonalityZoneTest_[a-f0-9]{32}$"))throw new InvalidOperationException("Unsafe test cleanup");await Exec(admin,$"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}]");}
 }
}
