using System.ComponentModel;
using System.Data;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace SeasonalityApp.Services;

// Read-only producer contract. It exposes identities, not local paths/secrets or
// a fabricated confirmation that an exchange session has actually completed.
[McpServerToolType]
public sealed class MarketDailyCollectionTools(IConfiguration config,IWebHostEnvironment environment)
{
    public static object Contract(JsonElement registry,string registrySha256)
    {
        if(registry.GetProperty("schemaVersion").GetInt32()!=1)throw new InvalidDataException("D1 registry schema.");
        var entries=registry.GetProperty("entries").EnumerateArray().ToArray();
        if(entries.Length!=39||entries.Select(e=>e.GetProperty("providerSymbol").GetString()).Distinct().Count()!=39)
            throw new InvalidDataException("D1 registry must contain 39 unique identities.");
        string Text(JsonElement e,string name)=>e.GetProperty(name).GetString() is {Length:>0} value?value:throw new InvalidDataException("Missing D1 identity.");
        var instruments=entries.Select(e=>new {
            symbol=Text(e,"logicalSymbol"),provider=Text(e,"provider"),providerSymbol=Text(e,"providerSymbol"),
            id=Text(e,"id"),canonicalIdentity=Text(e,"id"),sourceIdentity=Text(e,"sourceIdentity"),assetClass=Text(e,"assetClass"),timeframe="1D",
            researchOnly=Text(e,"sourceIdentity").EndsWith("_RESEARCH",StringComparison.Ordinal),
            completion=Text(e,"assetClass") is "forex" or "metal"
                ?new {method="documented_session_and_bar_timestamp",timezone="America/New_York",dateLabel="New York start date plus one calendar day",minimumAuditWindow="Elapsed timestamp-derived NY17 session; cite actual provider/session/calendar findings. This is not independent exchange-calendar certification."}
                :Text(e,"providerSymbol")=="ICEEUR:BRN1!"
                ?new {method="documented_session_and_bar_timestamp",timezone="Europe/London",dateLabel="Original provider timestamp UTC date, NOT a fabricated trading-day label",minimumAuditWindow="23:00 London; actual applicable session and holiday exceptions must also be checked"}
                :Text(e,"assetClass")=="index"
                ?new {method="documented_session_and_bar_timestamp",timezone="America/New_York",dateLabel="Original provider timestamp UTC date",minimumAuditWindow="18:00 New York; retain index correction/distribution window and calendar evidence"}
                :new {method="documented_session_and_bar_timestamp",timezone="America/Chicago",dateLabel="Original provider timestamp UTC date; session/trading date may differ",minimumAuditWindow="17:00 Chicago is a conservative audit gate, NOT an inferred exact sessionEnd or completion proof"}
        }).ToArray();
        return new {
            schemaVersion=1,mode="collection-contract",ready=true,registrySha256,instruments,expectedInstruments=39,timezone="Europe/Prague",
            persisted=false,analyticsTriggered=false,completionValidated=false,
            dailyEnvelope=new {schemaVersion=1,timeframe="1D",requiredFields=new[]{"runDate (Prague collection day)","fetchedAt (actual UTC capture time)","bars (all 39)"},
                barFields=new[]{"symbol","provider","providerSymbol","id or canonicalIdentity","sourceIdentity","assetClass (optional; exact registry value forex/metal/index/commodity, legacy fx/metals/futures also accepted only for the same class)","timeframe","timestamp (original Unix seconds)","date (registry date-label rule)","open","high","low","close","completed:true only after verification","status:ok only after verification","sessionEnd:null unless independently known"}},
            auditEnvelope=new {schemaVersion=1,timezone="Europe/Prague",requiredFields=new[]{"runDate","runs:[{checkedAt: exact fetchedAt, entries: all 39}]"},
                entryFields=new[]{"symbol","provider","providerSymbol","canonicalIdentity","timestamp","selectedDate or date","completed","status","timezone","completionMethod:documented_session_and_bar_timestamp","completionEvidence (actual verified finding, >20 chars)","sourceEvidence:[{url,finding}] (>=2 distinct primary URLs)","rawResponse (original success/1D/rows response; selected timestamp and OHLC must match)"}},
            sourceReferences=new[]{
                "https://www.oanda.com/uk-en/trading/hours-of-operation/",
                "https://www.oanda.com/uk-en/trading/holiday-trading-hours/",
                "https://developer.oanda.com/rest-live-v20/pricing-ep/",
                "https://indexes.nasdaq.com/docs/Methodology_NDX.pdf",
                "https://www.nasdaq.com/market-activity/stock-market-holiday-schedule",
                "https://www.nyse.com/trade/hours-calendars",
                "https://www.spglobal.com/spdji/en/documents/methodologies/methodology-sp-us-indices.pdf",
                "https://www.ice.com/products/219/Brent-Crude-Futures",
                "https://www.ice.com/publicdocs/Trading_Schedule.pdf",
                "https://www.cmegroup.com/trading-hours.html",
                "https://www.cmegroup.com/markets/energy/crude-oil/light-sweet-crude.contractSpecs.html",
                "https://www.cmegroup.com/markets/energy/natural-gas/natural-gas.contractSpecs.html",
                "https://www.cmegroup.com/markets/metals/base/copper.contractSpecs.html",
                "https://www.cmegroup.com/markets/agriculture/grains/wheat.contractSpecs.html",
                "https://www.cmegroup.com/markets/agriculture/grains/soybean.contractSpecs.html",
                "https://www.cmegroup.com/markets/agriculture/livestock/live-cattle.contractSpecs.html"},
            sourceNotice="References are starting points, NOT current verification. Read applicable sessions/calendar for the actual dates. Never reuse old findings as newly checked evidence, invent sessionEnd, or relabel a duplicate-only completion method to admit new data.",
            workflow="submit_market_daily stores quarantine only; get_market_daily_receipt reads the decision. ShadowAccepted is not completed analytics/publication. Verify the actual published manifest/report separately. H4 is independent."
        };
    }
    public static async Task<object> ReadContract(IConfiguration config,IWebHostEnvironment environment,CancellationToken ct)
    {
        var file=Path.GetFullPath(config["MarketData:BundlePath"]??"artifacts/tradingview-backfill-36-v1/analytics-sources-v1/manifest.json",environment.ContentRootPath);
        var bytes=await File.ReadAllBytesAsync(file,ct);using var doc=JsonDocument.Parse(bytes);
        return Contract(doc.RootElement,Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant());
    }
    [McpServerTool(Name="get_market_daily_contract",ReadOnly=true,Destructive=false,Idempotent=true,OpenWorld=false)]
    [Description("Read the exact server-side 39-instrument D1 identities, date rules and submission/audit contract. No SQL/network/writes/jobs. Reference URLs are NOT date-specific completion certification. Requires market.ingest.")]
    public async Task<CallToolResult> GetContract(RequestContext<CallToolRequestParams> context,CancellationToken cancellationToken)
    {
        if(!MarketDailyMcp.HasScope(context.User,config,MarketDailyMcp.IngestScope))return MarketDailyMcp.ScopeRequired(MarketDailyMcp.IngestScope);
        try{return MarketDailyMcp.ToolResult(await ReadContract(config,environment,cancellationToken));}
        catch(Exception e)when(e is IOException or JsonException or InvalidDataException or UnauthorizedAccessException or KeyNotFoundException or InvalidOperationException or ArgumentException)
        {return MarketDailyMcp.ToolResult(new{ready=false,code="DAILY_CONTRACT_UNAVAILABLE",persisted=false},true);}
    }
    [McpServerTool(Name="get_market_daily_receipt",ReadOnly=true,Destructive=false,Idempotent=true,OpenWorld=false)]
    [Description("Read one existing D1 SQL quarantine receipt and worker validation report by its exact SHA256 ID. No writes, provider calls or workflows. ShadowAccepted does not certify publication. Requires market.ingest.")]
    public async Task<CallToolResult> GetReceipt([Description("Exact 64-hex receipt ID returned by submit_market_daily.")]string receiptId,RequestContext<CallToolRequestParams> context,CancellationToken cancellationToken)
    {
        if(!MarketDailyMcp.HasScope(context.User,config,MarketDailyMcp.IngestScope))return MarketDailyMcp.ScopeRequired(MarketDailyMcp.IngestScope);
        if(string.IsNullOrEmpty(receiptId)||receiptId.Length!=64||receiptId.Any(c=>!Uri.IsHexDigit(c)))return MarketDailyMcp.ToolResult(new{code="INVALID_RECEIPT_ID"},true);
        try{
            await using var db=new SqlConnection(new SqlConnectionStringBuilder(config.GetConnectionString("DefaultConnection")){ConnectTimeout=15}.ConnectionString);await db.OpenAsync(cancellationToken);
            await using var cmd=new SqlCommand("SELECT Status,PayloadSha256,AuditSha256,FetchedAt,ReceivedAt,Attempts,LastErrorCode,ValidationReportUtf8 FROM market_daily.Inbox WHERE ReceiptId=@id",db){CommandTimeout=15};
            cmd.Parameters.Add("@id",SqlDbType.Char,64).Value=receiptId;await using var r=await cmd.ExecuteReaderAsync(cancellationToken);
            if(!await r.ReadAsync(cancellationToken))return MarketDailyMcp.ToolResult(new{ready=true,found=false,receiptId,persisted=false});
            JsonElement? report=null;if(!r.IsDBNull(7)){using var doc=JsonDocument.Parse((byte[])r[7]);report=doc.RootElement.Clone();}
            return MarketDailyMcp.ToolResult(new{ready=true,found=true,receiptId,persisted=true,status=r.GetString(0),payloadSha256=r.GetString(1),auditSha256=r.GetString(2),fetchedAt=r.GetDateTimeOffset(3),receivedAt=r.GetDateTimeOffset(4),attempts=r.GetInt32(5),lastErrorCode=r.IsDBNull(6)?null:r.GetString(6),validationReport=report,shadowHistoryAccepted=r.GetString(0)=="ShadowAccepted",completionValidated=false,publicationConfirmed=false});
        }catch(Exception e)when(e is SqlException or OperationCanceledException or InvalidOperationException or JsonException){return MarketDailyMcp.ToolResult(new{ready=false,code="DAILY_RECEIPT_UNAVAILABLE",persisted=(bool?)null},true);}
    }
}
