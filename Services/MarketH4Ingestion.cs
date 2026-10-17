using System.ComponentModel;
using System.Data;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace SeasonalityApp.Services;

// Isolated H4-only ingestion. The raw provider response is retained, not rebuilt
// from rounded OHLC. Boundary evidence is not a complete exchange calendar.
public static class MarketH4Ingestion
{
    public const string Rule="oanda-h4-boundary-v1";
    public sealed record Bar(string Symbol,long Start,decimal Open,decimal High,decimal Low,decimal Close,decimal? Volume);
    public sealed record Exclusion(string Symbol,long Start,string Reason);
    public sealed record Batch(string Id,byte[] Utf8,DateTimeOffset At,List<Bar> Bars,List<Exclusion> Excluded,int Captures);
    public static string Sha(byte[] b)=>Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant();
    private static readonly TimeZoneInfo Ny=TimeZoneInfo.FindSystemTimeZoneById("America/New_York");
    public static bool Aligned(long start)
    {
        var local=TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeSeconds(start),Ny);
        return local.Minute==0&&local.Second==0&&local.Millisecond==0&&(local.Hour+7)%4==0&&
            local.DayOfWeek!=DayOfWeek.Saturday&&!(local.DayOfWeek==DayOfWeek.Sunday&&local.Hour<17)&&!(local.DayOfWeek==DayOfWeek.Friday&&local.Hour>=17);
    }
    public static string? Completion(long start,long? next,DateTimeOffset captured)
    {
        if(!Aligned(start))return "UNALIGNED_OR_CLOSED_WEEK";
        var d=TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeSeconds(start),Ny);
        // Exceptional holiday sessions need separate evidence, never a guessed close.
        if(d.Month==12&&d.Day>=24||d.Month==1&&d.Day<=2)return "HOLIDAY_REQUIRES_D1_EVIDENCE";
        if(start+14400>captured.ToUnixTimeSeconds()-60)return "NOT_ELAPSED";
        // Published regular Friday close is 16:59 NY. Wait past nominal 17:00
        // plus one minute; no weekend bar is invented. Holiday block above wins.
        if(d.DayOfWeek==DayOfWeek.Friday&&d.Hour==13)return null;
        if(next!=start+14400||!Aligned(next.Value))return "NO_ADJACENT_PROVIDER_BOUNDARY";
        return null;
    }
    public static Batch Parse(string text,DateTimeOffset now,IReadOnlySet<string> allowed)
    {
        var bytes=Encoding.UTF8.GetBytes(text);if(bytes.Length is 0 or >262144)throw new InvalidDataException("H4 payload size.");
        using var json=JsonDocument.Parse(bytes,new JsonDocumentOptions{MaxDepth=16});var root=json.RootElement;
        if(root.GetProperty("schemaVersion").GetInt32()!=1)throw new InvalidDataException("H4 schema.");
        DateTimeOffset Fresh(JsonElement e){if(!DateTimeOffset.TryParse(e.GetString(),CultureInfo.InvariantCulture,DateTimeStyles.RoundtripKind,out var t)||t.Offset!=TimeSpan.Zero||t>now.AddMinutes(1)||t<now.AddMinutes(-30))throw new InvalidDataException("H4 capture freshness.");return t;}
        var fetched=Fresh(root.GetProperty("fetchedAt"));var captures=root.GetProperty("captures");
        if(captures.GetArrayLength() is <1 or >28)throw new InvalidDataException("H4 capture count.");
        var bars=new List<Bar>();var excluded=new List<Exclusion>();var seen=new HashSet<string>(StringComparer.Ordinal);
        foreach(var c in captures.EnumerateArray())
        {
            var at=Fresh(c.GetProperty("capturedAt"));if(at>fetched.AddMinutes(1))throw new InvalidDataException("Capture after envelope.");
            using var raw=JsonDocument.Parse(c.GetProperty("rawJson").GetString()!,new JsonDocumentOptions{MaxDepth=12});var r=raw.RootElement;var symbol=r.GetProperty("symbol").GetString()!;
            var format=r.GetProperty("format").GetString();
            if(!allowed.Contains(symbol)||!seen.Add(symbol)||!r.GetProperty("success").GetBoolean()||r.GetProperty("interval").GetString()!="4h"||format is not ("columns" or "rows"))throw new InvalidDataException("H4 provider identity.");
            var b=r.GetProperty("bars");var n=format=="rows"?b.GetArrayLength():b.GetProperty("t").GetArrayLength();if(n is <2 or >96||r.GetProperty("count").GetInt32()!=n)throw new InvalidDataException("H4 count.");
            if(format=="columns")foreach(var key in new[]{"o","h","l","c","v"})if(b.GetProperty(key).GetArrayLength()!=n)throw new InvalidDataException("H4 columns.");
            JsonElement Cell(string key,int index)=>format=="rows"?b[index].GetProperty(key):b.GetProperty(key)[index];
            long previous=0;
            for(var i=0;i<n;i++)
            {
                var t=Cell("t",i).GetInt64();if(t<=previous||t>at.ToUnixTimeSeconds())throw new InvalidDataException("H4 chronology.");previous=t;
                decimal Number(string k){var v=Cell(k,i).GetDecimal();if(decimal.Round(v,10)!=v)throw new InvalidDataException("H4 decimal precision.");return v;}
                var o=Number("o");var h=Number("h");var l=Number("l");var close=Number("c");decimal? v=Cell("v",i).ValueKind==JsonValueKind.Null?null:Number("v");
                if(o<=0||close<=0||l<=0||h<Math.Max(o,close)||l>Math.Min(o,close)||v<0)throw new InvalidDataException("H4 OHLCV bounds.");
                var reason=Completion(t,i+1<n?Cell("t",i+1).GetInt64():null,at);
                if(reason is null)bars.Add(new(symbol,t,o,h,l,close,v));else excluded.Add(new(symbol,t,reason));
            }
        }
        return new(Sha(bytes),bytes,now,bars,excluded,seen.Count);
    }
    public static async Task<HashSet<string>> Allowed(IConfiguration config,IWebHostEnvironment environment,CancellationToken ct)
    {
        var file=Path.GetFullPath(config["MarketData:BundlePath"]??"artifacts/tradingview-backfill-36-v1/analytics-sources-v1/manifest.json",environment.ContentRootPath);
        using var j=JsonDocument.Parse(await File.ReadAllTextAsync(file,ct));
        var result=j.RootElement.GetProperty("entries").EnumerateArray().Where(e=>e.GetProperty("assetClass").GetString()=="forex"&&e.GetProperty("provider").GetString()=="OANDA").Select(e=>e.GetProperty("providerSymbol").GetString()!).ToHashSet(StringComparer.Ordinal);
        if(result.Count!=28)throw new InvalidDataException("H4 registry unavailable.");return result;
    }
}

public sealed class MarketH4Store(string connectionString)
{
    public const string Policy="ohlc-exact-volume-audit-v1";
    public sealed record VolumeDifference(string Symbol,long StartUnix,string Source,decimal? StoredVolume,decimal? ObservedVolume);
    public sealed record Receipt(string ReceiptId,string Status,bool Duplicate,int InsertedBars,int DuplicateBars,int ExcludedBars,bool Persisted=true,string? ComparisonPolicy=null,VolumeDifference[]? VolumeDifferences=null);
    public async Task<Receipt> Receive(MarketH4Ingestion.Batch batch,CancellationToken ct)
    {
        await using var db=new SqlConnection(connectionString);await db.OpenAsync(ct);using var tx=db.BeginTransaction(IsolationLevel.Serializable);
        async Task<object?> Scalar(string sql,params SqlParameter[] args){await using var c=new SqlCommand(sql,db,tx){CommandTimeout=90};c.Parameters.AddRange(args);return await c.ExecuteScalarAsync(ct);}
        SqlParameter Id()=>new("@id",SqlDbType.Char,64){Value=batch.Id};
        try
        {
            await using(var c=new SqlCommand("SELECT Status,InsertedBars,DuplicateBars,ExcludedBars,ComparisonPolicy,VolumeDifferencesJson FROM market_h4.LiveReceipts WITH(UPDLOCK,HOLDLOCK) WHERE ReceiptId=@id",db,tx)){c.Parameters.Add(Id());await using var r=await c.ExecuteReaderAsync(ct);if(await r.ReadAsync(ct)){var found=new Receipt(batch.Id,r.GetString(0),true,r.GetInt32(1),r.GetInt32(2),r.GetInt32(3),true,r.IsDBNull(4)?null:r.GetString(4),r.IsDBNull(5)?null:JsonSerializer.Deserialize<VolumeDifference[]>(r.GetString(5)));await r.DisposeAsync();tx.Commit();return found;}}
            var insert=new List<MarketH4Ingestion.Bar>();var duplicates=0;var conflict=false;var volumeDifferences=new List<VolumeDifference>();
            foreach(var b in batch.Bars)
            {
                var query="SELECT [Open],[High],[Low],[Close],Volume,'live' AS Source FROM market_h4.LiveBars WHERE Symbol=@s AND StartUnix=@t UNION ALL SELECT [Open],[High],[Low],[Close],Volume,'historical' FROM market_h4.Bars WHERE Provider='OANDA' AND Timeframe='H4' AND Symbol=@s AND StartUnix=@t";
                await using var cmd=new SqlCommand(query,db,tx);cmd.Parameters.AddWithValue("@s",b.Symbol);cmd.Parameters.AddWithValue("@t",b.Start);await using var r=await cmd.ExecuteReaderAsync(ct);var exists=false;
                while(await r.ReadAsync(ct))
                {
                    exists=true;
                    var sameOhlc=r.GetDecimal(0)==b.Open&&r.GetDecimal(1)==b.High&&r.GetDecimal(2)==b.Low&&r.GetDecimal(3)==b.Close;
                    if(!sameOhlc)conflict=true;
                    var storedVolume=r.IsDBNull(4)?(decimal?)null:r.GetDecimal(4);
                    if(sameOhlc&&storedVolume!=b.Volume)volumeDifferences.Add(new(b.Symbol,b.Start,r.GetString(5),storedVolume,b.Volume));
                }
                if(exists)duplicates++;else insert.Add(b);
            }
            var status=conflict?"Conflict":"Accepted";var inserted=conflict?0:insert.Count;
            var volumeAudit=JsonSerializer.Serialize(volumeDifferences);
            await Scalar("INSERT market_h4.LiveReceipts(ReceiptId,PayloadUtf8,ReceivedAt,InsertedBars,DuplicateBars,ExcludedBars,Status,ComparisonPolicy,VolumeDifferencesJson) VALUES(@id,@raw,@at,@n,@d,@e,@status,@policy,@volume)",Id(),new("@raw",SqlDbType.VarBinary,-1){Value=batch.Utf8},new("@at",SqlDbType.DateTimeOffset){Value=batch.At},new("@n",SqlDbType.Int){Value=inserted},new("@d",SqlDbType.Int){Value=duplicates},new("@e",SqlDbType.Int){Value=batch.Excluded.Count},new("@status",SqlDbType.VarChar,24){Value=status},new("@policy",SqlDbType.VarChar,48){Value=Policy},new("@volume",SqlDbType.NVarChar,-1){Value=volumeAudit});
            if(!conflict)foreach(var b in insert)
            {
                SqlParameter Dec(string name,decimal? value)=>new(name,SqlDbType.Decimal){Precision=28,Scale=10,Value=(object?)value??DBNull.Value};
                await Scalar("INSERT market_h4.LiveBars(Symbol,StartUnix,[Open],[High],[Low],[Close],Volume,ReceiptId) VALUES(@s,@t,@o,@h,@l,@c,@v,@id)",new("@s",SqlDbType.VarChar,32){Value=b.Symbol},new("@t",SqlDbType.BigInt){Value=b.Start},Dec("@o",b.Open),Dec("@h",b.High),Dec("@l",b.Low),Dec("@c",b.Close),Dec("@v",b.Volume),Id());
            }
            if(await Scalar("SELECT HASHBYTES('SHA2_256',PayloadUtf8) FROM market_h4.LiveReceipts WHERE ReceiptId=@id",Id()) is not byte[] saved||Convert.ToHexString(saved).ToLowerInvariant()!=batch.Id)throw new InvalidDataException("H4 SQL hash mismatch.");
            if((string?)await Scalar("SELECT VolumeDifferencesJson FROM market_h4.LiveReceipts WHERE ReceiptId=@id",Id())!=volumeAudit)throw new InvalidDataException("H4 volume audit readback mismatch.");
            tx.Commit();return new(batch.Id,status,false,inserted,duplicates,batch.Excluded.Count,true,Policy,volumeDifferences.ToArray());
        }catch{try{tx.Rollback();}catch{}throw;}
    }
}

[McpServerToolType]
public sealed class MarketH4Tool(IConfiguration config,IWebHostEnvironment environment,MarketDailyGitHubTrigger trigger)
{
    [McpServerTool(Name="get_market_h4_status",ReadOnly=true,Destructive=false,Idempotent=true,OpenWorld=false)]
    [Description("Read H4 SQL readiness and recent receipts. No writes/provider calls/jobs. Lists the 28 allowed symbols and accepted incremental watermarks. Daily collection is separate. Uses market.ingest.")]
    public async Task<CallToolResult> GetMarketH4Status(RequestContext<CallToolRequestParams> context,CancellationToken cancellationToken)
    {
        if(!MarketDailyMcp.HasScope(context.User,config,MarketDailyMcp.IngestScope))return MarketDailyMcp.ScopeRequired(MarketDailyMcp.IngestScope);
        try
        {
            var allowed=await MarketH4Ingestion.Allowed(config,environment,cancellationToken);await using var db=new SqlConnection(config.GetConnectionString("DefaultConnection"));await db.OpenAsync(cancellationToken);
            var watermarks=new List<object>();await using(var c=new SqlCommand("SELECT Symbol,MAX(StartUnix) FROM (SELECT Symbol,StartUnix FROM market_h4.LiveBars UNION ALL SELECT Symbol,StartUnix FROM market_h4.Bars WHERE Provider='OANDA' AND Timeframe='H4') b GROUP BY Symbol ORDER BY Symbol",db))
            {await using var r=await c.ExecuteReaderAsync(cancellationToken);while(await r.ReadAsync(cancellationToken))watermarks.Add(new{symbol=r.GetString(0),storedThrough=DateTimeOffset.FromUnixTimeSeconds(r.GetInt64(1)),note="Storage watermark, not a claim of complete coverage"});}
            var receipts=new List<object>();await using(var c=new SqlCommand("SELECT TOP(12) ReceiptId,ReceivedAt,Status,InsertedBars,DuplicateBars,ExcludedBars,ComparisonPolicy,VolumeDifferencesJson FROM market_h4.LiveReceipts ORDER BY ReceivedAt DESC,ReceiptId",db))
            {await using var r=await c.ExecuteReaderAsync(cancellationToken);while(await r.ReadAsync(cancellationToken))receipts.Add(new{receiptId=r.GetString(0),receivedAt=r.GetDateTimeOffset(1),status=r.GetString(2),inserted=r.GetInt32(3),duplicates=r.GetInt32(4),excluded=r.GetInt32(5),comparisonPolicy=r.IsDBNull(6)?null:r.GetString(6),volumeDifferenceRows=r.IsDBNull(7)?(int?)null:JsonSerializer.Deserialize<MarketH4Store.VolumeDifference[]>(r.GetString(7))!.Length});}
            return MarketDailyMcp.ToolResult(new{ready=true,rule=MarketH4Ingestion.Rule,allowedSymbols=allowed.Order().ToArray(),watermarks,receipts,exchangeCalendarValidated=false,admission="Elapsed aligned OANDA NY17 4h slot AND adjacent observed provider bar, OR documented regular Friday close (13:00 NY slot, received after 17:01 NY). Open/nonadjacent/Dec24-Jan2 bars excluded otherwise. No synthetic bars. This is provider-boundary evidence, not a complete holiday calendar. Whole-D1 parity remains a separate historical gate."});
        }catch(Exception e)when(e is SqlException or IOException or JsonException or InvalidDataException or OperationCanceledException or InvalidOperationException){return MarketDailyMcp.ToolResult(new{ready=false,code="H4_STATUS_UNAVAILABLE"},true);}
    }
    [McpServerTool(Name="submit_market_h4",ReadOnly=false,Destructive=false,Idempotent=true,OpenWorld=false)]
    [Description("Store original OANDA FX H4 provider captures with immutable audit, deduplication and exact OHLC conflict rejection. Volume-only differences on existing identical OHLC are audited; stored volume is never overwritten. Requires market.ingest. H4-only: no daily, COT or seasonality analytics. Provider-boundary validation is not independent exchange-calendar certification. Never pass credentials.")]
    public async Task<CallToolResult> SubmitMarketH4([Description("Exact JSON text: {schemaVersion:1,fetchedAt:UTC ISO,captures:[{capturedAt:UTC ISO,rawJson:EXACT original TradingView success/4h response JSON string, format rows OR columns}]}. Rows are original [{t,o,h,l,c,v}], columns are original arrays t/o/h/l/c/v. 1-28 registered OANDA FX symbols, 2-96 bars each, max 256 KiB. Keep open/last bars in original raw response; SERVER excludes them. Never rewrite prices or convert raw format. Capture within 30 minutes; preserve exact payload for retry.")]string h4Json,RequestContext<CallToolRequestParams> context,CancellationToken cancellationToken)
    {
        if(!MarketDailyMcp.HasScope(context.User,config,MarketDailyMcp.IngestScope))return MarketDailyMcp.ScopeRequired(MarketDailyMcp.IngestScope);
        if(!MarketDailyMcp.InboxConfigured(config))return MarketDailyMcp.ToolResult(new{code="H4_INBOX_DISABLED",persisted=false},true);
        try
        {
            var allowed=await MarketH4Ingestion.Allowed(config,environment,cancellationToken);var batch=MarketH4Ingestion.Parse(h4Json,DateTimeOffset.UtcNow,allowed);
            var receipt=await new MarketH4Store(config.GetConnectionString("DefaultConnection")!).Receive(batch,cancellationToken);
            var wake=receipt.Status=="Accepted"&&receipt.InsertedBars>0?await trigger.RequestH4Async(cancellationToken):new MarketDailyGitHubTrigger.Result("NoNewBars");
            return MarketDailyMcp.ToolResult(new{receipt,receivedCaptures=batch.Captures,validationRule=MarketH4Ingestion.Rule,providerBoundaryValidated=receipt.Status=="Accepted",completionValidated=false,exchangeCalendarValidated=false,excluded=batch.Excluded,zonePublicationRequested=wake.Requested,workflowTrigger=wake.Status,analyticsTriggered=false,d1Changed=false},receipt.Status!="Accepted");
        }
        catch(Exception e)when(e is JsonException or InvalidDataException or KeyNotFoundException or InvalidOperationException or ArgumentException or FormatException){return MarketDailyMcp.ToolResult(new{code="INVALID_H4_SUBMISSION",persisted=false,analyticsTriggered=false},true);}
        catch(Exception e)when(e is SqlException or OperationCanceledException or IOException){return MarketDailyMcp.ToolResult(new{code="H4_INBOX_UNAVAILABLE",persisted=(bool?)null,retryExactPayload=true,analyticsTriggered=false},true);}
    }
}
