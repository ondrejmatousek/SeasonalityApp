using System.Data;
using System.Text;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using SeasonalityApp.Services;

// Read-only conflict diagnosis. No provider calls, prices/receipt updates or jobs.
static class H4ReceiptAudit
{
 public static async Task Run(SqlConnection db,string id)
 {
  if(id.Length!=64||id.Any(c=>!Uri.IsHexDigit(c)))throw new InvalidDataException("Expected a receipt SHA-256.");
  byte[] bytes;DateTimeOffset received;string status;string? policy;MarketH4Store.VolumeDifference[]? savedAudit;
  await using(var cmd=new SqlCommand("SELECT PayloadUtf8,ReceivedAt,Status,ComparisonPolicy,VolumeDifferencesJson FROM market_h4.LiveReceipts WHERE ReceiptId=@id",db))
  {
   cmd.Parameters.Add("@id",SqlDbType.Char,64).Value=id;await using var r=await cmd.ExecuteReaderAsync();
   if(!await r.ReadAsync())throw new InvalidDataException("Receipt not found.");bytes=(byte[])r[0];received=r.GetDateTimeOffset(1);status=r.GetString(2);policy=r.IsDBNull(3)?null:r.GetString(3);savedAudit=r.IsDBNull(4)?null:JsonSerializer.Deserialize<MarketH4Store.VolumeDifference[]>(r.GetString(4));
  }
  if(MarketH4Ingestion.Sha(bytes)!=id)throw new InvalidDataException("Stored receipt hash mismatch.");
  var text=Encoding.UTF8.GetString(bytes);using var payload=JsonDocument.Parse(bytes);var allowed=new HashSet<string>(StringComparer.Ordinal);
  foreach(var c in payload.RootElement.GetProperty("captures").EnumerateArray()){using var raw=JsonDocument.Parse(c.GetProperty("rawJson").GetString()!);allowed.Add(raw.RootElement.GetProperty("symbol").GetString()!);}
  var batch=MarketH4Ingestion.Parse(text,received,allowed);var differences=new List<object>();var identical=0;var ohlcConflicts=0;var volumeOnly=0;
  foreach(var b in batch.Bars)
  {
   await using var cmd=new SqlCommand("SELECT 'live' AS Source,[Open],[High],[Low],[Close],Volume FROM market_h4.LiveBars WHERE Symbol=@s AND StartUnix=@t UNION ALL SELECT 'historical',[Open],[High],[Low],[Close],Volume FROM market_h4.Bars WHERE Provider='OANDA' AND Timeframe='H4' AND Symbol=@s AND StartUnix=@t",db);
   cmd.Parameters.AddWithValue("@s",b.Symbol);cmd.Parameters.AddWithValue("@t",b.Start);await using var r=await cmd.ExecuteReaderAsync();
   while(await r.ReadAsync())
   {
    decimal?[] stored=[r.GetDecimal(1),r.GetDecimal(2),r.GetDecimal(3),r.GetDecimal(4),r.IsDBNull(5)?null:r.GetDecimal(5)];
    decimal?[] captured=[b.Open,b.High,b.Low,b.Close,b.Volume];string[] names=["open","high","low","close","volume"];
    var fields=Enumerable.Range(0,5).Where(i=>stored[i]!=captured[i]).Select(i=>new{field=names[i],stored=stored[i],captured=captured[i]}).ToArray();
    if(fields.Length==0)identical++;else{if(fields.Any(f=>f.field!="volume"))ohlcConflicts++;else volumeOnly++;differences.Add(new{symbol=b.Symbol,startUtc=DateTimeOffset.FromUnixTimeSeconds(b.Start),source=r.GetString(0),fields});}
   }
  }
  Console.WriteLine(JsonSerializer.Serialize(new{receiptId=id,status,comparisonPolicy=policy,savedVolumeDifferences=savedAudit,hashVerified=true,receivedAt=received,admittedBars=batch.Bars.Count,excludedBars=batch.Excluded.Count,identicalStoredRows=identical,ohlcConflictingStoredRows=ohlcConflicts,volumeOnlyDifferingStoredRows=volumeOnly,differences,readOnly=true,productionChanged=false}));
 }
}
