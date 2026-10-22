using System.ComponentModel;
using System.Data;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace SeasonalityApp.Services;

// Separate price identities: never extend/rewrite the immutable 39-market daily baseline.
public static class MarketZonePrices
{
    public static readonly string[] Forex = ["USDHKD","EURNOK","EURPLN","EURSEK","USDMXN","USDNOK","USDPLN","USDSEK","USDZAR","SGDJPY","USDSGD"];
    public static readonly string[] Crypto = ["BTCUSD","ETHUSD","SOLUSD","XRPUSD","BNBUSD"];
    public const string Rule = "zone-provider-boundary-v1";
    private static readonly TimeZoneInfo Ny = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");
    public sealed record Bar(string Symbol,string Interval,long Start,decimal Open,decimal High,decimal Low,decimal Close,decimal? Volume);
    public sealed record Batch(string Id,byte[] Utf8,List<Bar> Bars,int Excluded);
    public sealed record Receipt(string ReceiptId,string Status,int Inserted,int Duplicates,int Excluded,bool Retry=false);
    public static bool Allowed(string symbol,string interval) =>
        (interval is "1D" or "4h" && Forex.Any(k=>symbol=="OANDA:"+k)) ||
        (interval=="1D" && (symbol=="OANDA:XPTUSD" || Crypto.Any(k=>symbol=="CRYPTO:"+k)));
    public static Batch Parse(string text,DateTimeOffset now,bool bootstrap=false,bool recoveryQuarantineInvalid=false)
    {
        var bytes=Encoding.UTF8.GetBytes(text);
        if(bytes.Length is 0 || bytes.Length>(bootstrap?24*1024*1024:262144))throw new InvalidDataException("Zone payload size.");
        using var j=JsonDocument.Parse(bytes,new JsonDocumentOptions{MaxDepth=16});var root=j.RootElement;
        if(root.GetProperty("schemaVersion").GetInt32()!=1)throw new InvalidDataException("Zone schema.");
        DateTimeOffset Fresh(JsonElement e){if(!DateTimeOffset.TryParse(e.GetString(),CultureInfo.InvariantCulture,DateTimeStyles.RoundtripKind,out var t)||t.Offset!=TimeSpan.Zero||t>now.AddMinutes(1)||t<now.AddMinutes(bootstrap?-1440:-30))throw new InvalidDataException("Zone capture freshness.");return t;}
        var fetched=Fresh(root.GetProperty("fetchedAt"));var captures=root.GetProperty("captures");
        if(captures.GetArrayLength() is <1 or >28)throw new InvalidDataException("Zone capture count.");
        var bars=new List<Bar>();var excluded=0;var seen=new HashSet<string>(StringComparer.Ordinal);
        foreach(var capture in captures.EnumerateArray())
        {
            var at=Fresh(capture.GetProperty("capturedAt"));if(at>fetched.AddMinutes(1))throw new InvalidDataException("Capture after envelope.");
            using var raw=JsonDocument.Parse(capture.GetProperty("rawJson").GetString()!);var r=raw.RootElement;
            var s=r.GetProperty("symbol").GetString()!;var interval=r.GetProperty("interval").GetString()!;var format=r.GetProperty("format").GetString();
            if(!Allowed(s,interval)||!seen.Add(s+interval)||!r.GetProperty("success").GetBoolean()||format is not ("columns" or "rows"))throw new InvalidDataException("Unregistered zone source/interval.");
            var b=r.GetProperty("bars");var n=format=="rows"?b.GetArrayLength():b.GetProperty("t").GetArrayLength();
            if(n<2||n>(bootstrap?8000:96)||n!=r.GetProperty("count").GetInt32())throw new InvalidDataException("Zone bar count.");
            if(format=="columns")foreach(var k in new[]{"o","h","l","c","v"})if(b.GetProperty(k).GetArrayLength()!=n)throw new InvalidDataException("Zone columns.");
            JsonElement Cell(string k,int i)=>format=="rows"?b[i].GetProperty(k):b.GetProperty(k)[i];
            long previous=0;
            for(var i=0;i<n;i++)
            {
                var t=Cell("t",i).GetInt64();if(t<=previous||t>at.ToUnixTimeSeconds())throw new InvalidDataException("Zone chronology.");previous=t;
                decimal Number(string k){var v=Cell(k,i).GetDecimal();if(decimal.Round(v,10)!=v)throw new InvalidDataException("Zone precision.");return v;}
                var o=Number("o");var h=Number("h");var l=Number("l");var c=Number("c");decimal? v=Cell("v",i).ValueKind==JsonValueKind.Null?null:Number("v");
                if(o<=0||l<=0||c<=0||h<Math.Max(o,c)||l>Math.Min(o,c)||v<0){if(bootstrap&&recoveryQuarantineInvalid){excluded++;continue;}throw new InvalidDataException("Zone OHLCV bounds.");}
                long? next=i+1<n?Cell("t",i+1).GetInt64():null;
                var complete=interval=="4h"?MarketH4Ingestion.Completion(t,next,at)==null:DailyComplete(s,t,next,at);
                if(complete)bars.Add(new(s,interval,t,o,h,l,c,v));else excluded++;
            }
        }
        return new(MarketH4Ingestion.Sha(bytes),bytes,bars,excluded);
    }
    public static bool DailyComplete(string symbol,long t,long? next,DateTimeOffset at)
    {
        if(symbol.StartsWith("CRYPTO:",StringComparison.Ordinal))return t%86400==0&&t+86400<=at.ToUnixTimeSeconds()-60;
        var d=TimeZoneInfo.ConvertTime(DateTimeOffset.FromUnixTimeSeconds(t),Ny);
        if(d.Hour!=17||d.Minute!=0||d.Second!=0||d.DayOfWeek is DayOfWeek.Friday or DayOfWeek.Saturday||d.Month==12&&d.Day>=24||d.Month==1&&d.Day<=2)return false;
        var close=TimeZoneInfo.ConvertTimeToUtc(d.Date.AddDays(1).AddHours(17),Ny);
        if(new DateTimeOffset(close).AddMinutes(1)>at)return false;
        // Adjacent provider boundary; regular Thursday->Friday close exception only.
        return d.DayOfWeek==DayOfWeek.Thursday || next==new DateTimeOffset(close).ToUnixTimeSeconds();
    }
    public static async Task<bool> NeedsZonePublication(SqlConnection db,Receipt receipt,CancellationToken ct=default)
    {
        if(receipt.Status!="Accepted"||receipt.Inserted==0)return false;
        // Duplicates retain their original ReceiptId. Inspect actual inserted rows,
        // not all submitted symbols; this also preserves the decision on retries.
        await using var cmd=new SqlCommand("SELECT CASE WHEN EXISTS(SELECT 1 FROM market_zones.Bars WHERE ReceiptId=@id AND Symbol LIKE 'OANDA:%') THEN 1 ELSE 0 END",db){CommandTimeout=120};
        cmd.Parameters.Add(new SqlParameter("@id",SqlDbType.Char,64){Value=receipt.ReceiptId});
        return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct))==1;
    }
    public static async Task<Receipt> Receive(SqlConnection db,Batch batch,CancellationToken ct=default)
    {
        using var tx=db.BeginTransaction(IsolationLevel.Serializable);
        SqlParameter Id()=>new("@id",SqlDbType.Char,64){Value=batch.Id};
        async Task<object?> Scalar(string sql,params SqlParameter[] p){await using var c=new SqlCommand(sql,db,tx){CommandTimeout=120};c.Parameters.AddRange(p);return await c.ExecuteScalarAsync(ct);}
        await using(var cmd=new SqlCommand("SELECT Status,InsertedBars,DuplicateBars,ExcludedBars FROM market_zones.Receipts WITH(UPDLOCK,HOLDLOCK) WHERE ReceiptId=@id",db,tx))
        {cmd.Parameters.Add(Id());await using var r=await cmd.ExecuteReaderAsync(ct);if(await r.ReadAsync(ct)){var result=new Receipt(batch.Id,r.GetString(0),r.GetInt32(1),r.GetInt32(2),r.GetInt32(3),true);await r.DisposeAsync();tx.Commit();return result;}}
        var insert=new List<Bar>();var duplicates=0;var conflict=false;var volume=new List<object>();
        var existing=new Dictionary<(string,string,long),(decimal Open,decimal High,decimal Low,decimal Close,decimal? Volume)>();
        if(batch.Bars.Count>0)
        {
            await using var cmd=new SqlCommand("SELECT Symbol,Interval,StartUnix,[Open],[High],[Low],[Close],Volume FROM market_zones.Bars WITH(UPDLOCK,HOLDLOCK) WHERE StartUnix BETWEEN @from AND @to",db,tx){CommandTimeout=120};
            cmd.Parameters.AddWithValue("@from",batch.Bars.Min(b=>b.Start));cmd.Parameters.AddWithValue("@to",batch.Bars.Max(b=>b.Start));
            await using var r=await cmd.ExecuteReaderAsync(ct);
            while(await r.ReadAsync(ct))existing.Add((r.GetString(0),r.GetString(1),r.GetInt64(2)),(r.GetDecimal(3),r.GetDecimal(4),r.GetDecimal(5),r.GetDecimal(6),r.IsDBNull(7)?null:r.GetDecimal(7)));
        }
        foreach(var b in batch.Bars)
        {
            if(existing.TryGetValue((b.Symbol,b.Interval,b.Start),out var old))
            {
                duplicates++;var same=old.Open==b.Open&&old.High==b.High&&old.Low==b.Low&&old.Close==b.Close;
                if(!same)conflict=true;
                if(same&&old.Volume!=b.Volume)volume.Add(new{symbol=b.Symbol,interval=b.Interval,start=b.Start,storedVolume=old.Volume,observedVolume=b.Volume});
            }else insert.Add(b);
        }
        var status=conflict?"Conflict":"Accepted";var count=conflict?0:insert.Count;
        await Scalar("INSERT market_zones.Receipts(ReceiptId,PayloadUtf8,ReceivedAt,Status,InsertedBars,DuplicateBars,ExcludedBars,VolumeAudit) VALUES(@id,@raw,@at,@status,@n,@d,@e,@volume)",Id(),new("@raw",SqlDbType.VarBinary,-1){Value=batch.Utf8},new("@at",SqlDbType.DateTimeOffset){Value=DateTimeOffset.UtcNow},new("@status",SqlDbType.VarChar,24){Value=status},new("@n",SqlDbType.Int){Value=count},new("@d",SqlDbType.Int){Value=duplicates},new("@e",SqlDbType.Int){Value=batch.Excluded},new("@volume",SqlDbType.NVarChar,-1){Value=JsonSerializer.Serialize(volume)});
        if(!conflict&&insert.Count>0)
        {
            var table=new DataTable();table.Columns.Add("Symbol",typeof(string));table.Columns.Add("Interval",typeof(string));table.Columns.Add("StartUnix",typeof(long));
            foreach(var k in new[]{"Open","High","Low","Close","Volume"})table.Columns.Add(k,typeof(decimal));table.Columns.Add("ReceiptId",typeof(string));
            foreach(var b in insert)table.Rows.Add(b.Symbol,b.Interval,b.Start,b.Open,b.High,b.Low,b.Close,(object?)b.Volume??DBNull.Value,batch.Id);
            using var bulk=new SqlBulkCopy(db,SqlBulkCopyOptions.CheckConstraints,tx){DestinationTableName="market_zones.Bars",BatchSize=1000,BulkCopyTimeout=120};
            foreach(DataColumn column in table.Columns)bulk.ColumnMappings.Add(column.ColumnName,column.ColumnName);
            await bulk.WriteToServerAsync(table,ct);
        }
        if(await Scalar("SELECT HASHBYTES('SHA2_256',PayloadUtf8) FROM market_zones.Receipts WHERE ReceiptId=@id",Id()) is not byte[] saved||Convert.ToHexString(saved).ToLowerInvariant()!=batch.Id)throw new InvalidDataException("Zone receipt hash mismatch.");
        tx.Commit();return new(batch.Id,status,count,duplicates,batch.Excluded);
    }
}

[McpServerToolType]
public sealed class MarketZonePriceTool(IConfiguration config,MarketDailyGitHubTrigger trigger)
{
    [McpServerTool(Name="get_zone_prices_status",ReadOnly=true,Destructive=false,Idempotent=true,OpenWorld=false)]
    [Description("Read isolated CFD zone SQL readiness, recent receipt decisions and storage watermarks. No provider calls, writes, analytics or schedule changes. CRYPTO rows are comparison-only; Yahoo stays authoritative. Requires market.ingest.")]
    public async Task<CallToolResult> GetZonePricesStatus(RequestContext<CallToolRequestParams> context,CancellationToken cancellationToken)
    {
        if(!MarketDailyMcp.HasScope(context.User,config,MarketDailyMcp.IngestScope))return MarketDailyMcp.ScopeRequired(MarketDailyMcp.IngestScope);
        try
        {
            await using var db=new SqlConnection(config.GetConnectionString("DefaultConnection"));await db.OpenAsync(cancellationToken);var rows=new List<object>();var receipts=new List<object>();
            await using(var c=new SqlCommand("SELECT Symbol,Interval,MAX(StartUnix),COUNT(*) FROM market_zones.Bars GROUP BY Symbol,Interval ORDER BY Symbol,Interval",db))
            {await using var r=await c.ExecuteReaderAsync(cancellationToken);while(await r.ReadAsync(cancellationToken))rows.Add(new{symbol=r.GetString(0),interval=r.GetString(1),storedThrough=DateTimeOffset.FromUnixTimeSeconds(r.GetInt64(2)),storedBars=r.GetInt32(3)});}
            await using(var c=new SqlCommand("SELECT TOP(12) ReceiptId,Status,InsertedBars,DuplicateBars,ExcludedBars,ReceivedAt,VolumeAudit FROM market_zones.Receipts ORDER BY ReceivedAt DESC,ReceiptId",db))
            {await using var r=await c.ExecuteReaderAsync(cancellationToken);while(await r.ReadAsync(cancellationToken))receipts.Add(new{receiptId=r.GetString(0),status=r.GetString(1),inserted=r.GetInt32(2),duplicates=r.GetInt32(3),excluded=r.GetInt32(4),receivedAt=r.GetDateTimeOffset(5),volumeWarnings=JsonDocument.Parse(r.GetString(6)).RootElement.GetArrayLength()});}
            return MarketDailyMcp.ToolResult(new{ready=true,extraForex=MarketZonePrices.Forex,platinum="OANDA:XPTUSD (D1)",crypto=MarketZonePrices.Crypto,cryptoPolicy="CRYPTO: D1 comparison only; Yahoo remains zone source",rule=MarketZonePrices.Rule,watermarks=rows,receipts,note="Storage watermark, not proof of gap-free history or complete exchange calendar"});
        }catch(Exception e)when(e is SqlException or IOException or InvalidOperationException or OperationCanceledException){return MarketDailyMcp.ToolResult(new{ready=false,code="ZONE_STATUS_UNAVAILABLE"},true);}
    }
    [McpServerTool(Name="submit_zone_prices",ReadOnly=false,Destructive=false,Idempotent=true,OpenWorld=false)]
    [Description("Add zone-only TradingView prices for 11 additional OANDA FX, OANDA:XPTUSD D1, and five CRYPTO D1 comparison-only series. Original 39-market D1 and 28 FX H4 tools stay separate. Immutable raw captures, exact OHLC conflicts fail entire batch; volume-only revisions audited, never overwrite. No COT/seasonality/stock writes. Requires market.ingest; never pass credentials.")]
    public async Task<CallToolResult> SubmitZonePrices([Description("Exact JSON {schemaVersion:1,fetchedAt:UTC ISO,captures:[{capturedAt:UTC ISO,rawJson:exact original TradingView success JSON text}]}. Allowed OANDA USDHKD,EURNOK,EURPLN,EURSEK,USDMXN,USDNOK,USDPLN,USDSEK,USDZAR,SGDJPY,USDSGD: 1D or 4h. OANDA:XPTUSD:1D. CRYPTO BTCUSD,ETHUSD,SOLUSD,XRPUSD,BNBUSD:1D comparison-only (Yahoo remains authoritative). 2-96 original rows/columns each, 1-28 captures, max256KiB, captured within30min. Server excludes open/unproven boundaries; do not trim/rebuild raw bars. Retry exact payload.")]string pricesJson,RequestContext<CallToolRequestParams> context,CancellationToken cancellationToken)
    {
        if(!MarketDailyMcp.HasScope(context.User,config,MarketDailyMcp.IngestScope))return MarketDailyMcp.ScopeRequired(MarketDailyMcp.IngestScope);
        if(!MarketDailyMcp.InboxConfigured(config))return MarketDailyMcp.ToolResult(new{code="ZONE_INBOX_DISABLED",persisted=false},true);
        try
        {
            var batch=MarketZonePrices.Parse(pricesJson,DateTimeOffset.UtcNow);await using var db=new SqlConnection(config.GetConnectionString("DefaultConnection"));await db.OpenAsync(cancellationToken);
            var receipt=await MarketZonePrices.Receive(db,batch,cancellationToken);
            var publish=await MarketZonePrices.NeedsZonePublication(db,receipt,cancellationToken);
            var wake=publish?await trigger.RequestH4Async(cancellationToken):new MarketDailyGitHubTrigger.Result("NoNewZoneBars");
            return MarketDailyMcp.ToolResult(new{receipt,persisted=true,rule=MarketZonePrices.Rule,comparisonPolicy="ohlc-exact-volume-audit-v1",providerBoundaryValidated=receipt.Status=="Accepted",exchangeCalendarValidated=false,completionValidated=false,canonicalD1Changed=false,cryptoYahooChanged=false,zonePublicationRequested=wake.Requested,workflowTrigger=wake.Status},receipt.Status!="Accepted");
        }
        catch(Exception e)when(e is JsonException or InvalidDataException or KeyNotFoundException or InvalidOperationException or ArgumentException or FormatException){return MarketDailyMcp.ToolResult(new{code="INVALID_ZONE_PRICES",persisted=false},true);}
        catch(Exception e)when(e is SqlException or OperationCanceledException or IOException){return MarketDailyMcp.ToolResult(new{code="ZONE_PRICES_UNAVAILABLE",persisted=(bool?)null,retryExactPayload=true},true);}
    }
}
