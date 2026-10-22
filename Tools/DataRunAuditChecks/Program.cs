using System.Text;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using SeasonalityApp.Services;

if(args.Contains("--read-production"))
{
 var index=Array.IndexOf(args,"--config-root");if(index<0||index+1>=args.Length)throw new ArgumentException("Config root required");
 var root=Path.GetFullPath(args[index+1]);if(!File.Exists(Path.Combine(root,"SeasonalityApp.csproj")))throw new Exception("Unexpected config root");
 using var settings=JsonDocument.Parse(File.ReadAllText(Path.Combine(root,"appsettings.Development.json")));
 var target=new SqlConnectionStringBuilder(settings.RootElement.GetProperty("ConnectionStrings").GetProperty("DefaultConnection").GetString());
 if(target.InitialCatalog!="seasonality-free-20261022"||!target.DataSource.Contains("seasonality.database.windows.net",StringComparison.OrdinalIgnoreCase))throw new Exception("Unexpected SQL target");
 var config=new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{{"ConnectionStrings:DefaultConnection",target.ConnectionString}}).Build();
 using var memory=new MemoryCache(new MemoryCacheOptions());var snapshot=await new DataRunAudit(config,memory).Read(default);
 Console.WriteLine(JsonSerializer.Serialize(new{snapshot.Ready,snapshot.AsOf,readOnly=true,d1=snapshot.Runs.Count(r=>r.Timeframes.Contains("D1")),h4=snapshot.Runs.Count(r=>r.Timeframes.Contains("H4")),sources=snapshot.Runs.GroupBy(r=>r.Source).Select(g=>new{source=g.Key,count=g.Count(),last=g.Max(r=>r.ReceivedAt)})}));
 if(!snapshot.Ready)Environment.ExitCode=1;return;
}
if(!args.Contains("--sql")) throw new ArgumentException("Explicit --sql required for isolated LocalDB test.");
var name="SeasonalityAuditTest_"+Guid.NewGuid().ToString("N");
var master="Data Source=(localdb)\\MSSQLLocalDB;Initial Catalog=master;Integrated Security=true;Encrypt=false;Pooling=false";
await using var admin=new SqlConnection(master); await admin.OpenAsync();
async Task Exec(SqlConnection db,string sql){await using var c=new SqlCommand(sql,db);await c.ExecuteNonQueryAsync();}
void Check(bool b,string m){if(!b)throw new Exception(m);}
await Exec(admin,$"CREATE DATABASE [{name}]");
try
{
 var cs=new SqlConnectionStringBuilder(master){InitialCatalog=name}.ConnectionString;
 await using(var db=new SqlConnection(cs))
 {
  await db.OpenAsync();await Exec(db,File.ReadAllText("Data/MarketH4Live.sql"));await Exec(db,File.ReadAllText("Data/MarketZonePrices.sql"));
  string Raw(string interval,int count)=>JsonSerializer.Serialize(new{symbol="OANDA:USDHKD",interval,count});
  var payload=Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new{captures=new[]{new{rawJson=Raw("4h",12)}}}));
  await using(var c=new SqlCommand("INSERT market_h4.LiveReceipts(ReceiptId,PayloadUtf8,ReceivedAt,InsertedBars,DuplicateBars,ExcludedBars,Status) VALUES(@id,@raw,SYSDATETIMEOFFSET(),0,12,0,'Accepted')",db))
  {c.Parameters.AddWithValue("@id",new string('a',64));c.Parameters.AddWithValue("@raw",payload);await c.ExecuteNonQueryAsync();}
  var mixed=Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new{captures=new[]{new{rawJson=Raw("1D",200)},new{rawJson=Raw("4h",300)}}}));
  await using(var c=new SqlCommand("INSERT market_zones.Receipts VALUES(@id,@raw,SYSDATETIMEOFFSET(),'Conflict',0,1,2,'[]')",db))
  {c.Parameters.AddWithValue("@id",new string('b',64));c.Parameters.AddWithValue("@raw",mixed);await c.ExecuteNonQueryAsync();}
 }
 using var cache=new MemoryCache(new MemoryCacheOptions());
 var config=new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?>{{"ConnectionStrings:DefaultConnection",cs}}).Build();
 var audit=new DataRunAudit(config,cache);var snapshot=await audit.Read(default);
 Check(snapshot.Ready&&snapshot.Runs.Count==2,"Both SQL receipt sources available");
 Check(snapshot.Runs.Single(r=>r.Source=="market_h4").Duplicates==12,"No-new-bars receipt remains visible");
 var extension=snapshot.Runs.Single(r=>r.Source=="market_zones");
 Check(extension.Timeframes.SequenceEqual(new[]{"D1","H4"})&&extension.Historical&&extension.Status=="Conflict"&&extension.ReceivedBars==500,"Mixed historical/conflict metadata preserved without inventing interval totals");
 var json=JsonSerializer.Serialize(snapshot);
 Check(!json.Contains("rawJson")&&!json.Contains("PayloadUtf8")&&!json.Contains(cs),"Public audit contains metadata only");
 Check(ReferenceEquals(snapshot,await audit.Read(default)),"Repeated reads use bounded cache");
 using var emptyCache=new MemoryCache(new MemoryCacheOptions());var unavailable=await new DataRunAudit(new ConfigurationBuilder().Build(),emptyCache).Read(default);
 Check(!unavailable.Ready&&unavailable.Runs.Count==0,"Missing SQL is explicitly unavailable");
 Console.WriteLine("PASS isolated SQL read-only audit: H4 duplicates, mixed D1/H4, conflicts, historical metadata, safe projection, cache and unavailable state.");
}
finally
{
 if(!System.Text.RegularExpressions.Regex.IsMatch(name,"^SeasonalityAuditTest_[a-f0-9]{32}$"))throw new Exception("Unsafe cleanup target");
 await Exec(admin,$"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}]");
}
