using System.Text;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using SeasonalityApp.Services;

try
{
    string Arg(string k){var i=Array.IndexOf(args,k);return i>=0&&i+1<args.Length?args[i+1]:throw new ArgumentException("Missing "+k);}
    if(args.Contains("--checks")){await Checks.Run(args.Contains("--sql"));return;}
    if(args.Contains("--validate")){var batch=MarketZonePrices.Parse(File.ReadAllText(Arg("--input")),DateTimeOffset.UtcNow,true);Console.WriteLine(JsonSerializer.Serialize(new{batch.Id,accepted=batch.Bars.Count,batch.Excluded,productionChanged=false}));return;}
    var root=Path.GetFullPath(Arg("--config-root"));
    if(!File.Exists(Path.Combine(root,"SeasonalityApp.csproj")))throw new InvalidOperationException("Unexpected config root.");
    var cs=Environment.GetEnvironmentVariable("SEASONALITY_H4_SQL_CONNECTION");
    if(string.IsNullOrWhiteSpace(cs)){using var c=JsonDocument.Parse(File.ReadAllText(Path.Combine(root,"appsettings.Development.json")));cs=c.RootElement.GetProperty("ConnectionStrings").GetProperty("DefaultConnection").GetString();}
    var target=new SqlConnectionStringBuilder(cs){ConnectTimeout=120};
    if(target.InitialCatalog!="seasonality-free-20261022"||!new[]{"seasonality.database.windows.net","tcp:seasonality.database.windows.net","seasonality.database.windows.net,1433","tcp:seasonality.database.windows.net,1433"}.Contains(target.DataSource,StringComparer.OrdinalIgnoreCase))throw new InvalidOperationException("Unexpected SQL target.");
    await using var db=new SqlConnection(target.ConnectionString);await db.OpenAsync();
    if(args.Contains("--install"))
    {
        if(Arg("--confirm-database")!=target.InitialCatalog)throw new InvalidOperationException("Explicit database confirmation required.");
        await using var c=new SqlCommand(File.ReadAllText(Path.Combine(root,"Data/MarketZonePrices.sql")),db){CommandTimeout=120};await c.ExecuteNonQueryAsync();Console.WriteLine("Zone schema installed additively; canonical data unchanged.");return;
    }
    if(args.Contains("--import"))
    {
        if(Arg("--confirm-database")!=target.InitialCatalog)throw new InvalidOperationException("Explicit database confirmation required.");
        var batch=MarketZonePrices.Parse(File.ReadAllText(Arg("--input")),DateTimeOffset.UtcNow,true);
        var receipt=await MarketZonePrices.Receive(db,batch);Console.WriteLine(JsonSerializer.Serialize(receipt));if(receipt.Status!="Accepted")Environment.ExitCode=1;return;
    }
    if(!args.Contains("--export"))throw new ArgumentException("Expected --install/--import/--export.");
    var output=Path.GetFullPath(Arg("--output"));if(File.Exists(output))throw new InvalidOperationException("Output must be new.");
    var rows=new List<object>();var ids=new HashSet<string>();
    await using(var c=new SqlCommand("WITH b AS(SELECT *,ROW_NUMBER() OVER(PARTITION BY Symbol,Interval ORDER BY StartUnix DESC) n FROM market_zones.Bars) SELECT Symbol,Interval,StartUnix,[Open],[High],[Low],[Close],Volume,ReceiptId FROM b WHERE n<=2200 ORDER BY Symbol,Interval,StartUnix",db){CommandTimeout=120})
    {await using var r=await c.ExecuteReaderAsync();while(await r.ReadAsync()){ids.Add(r.GetString(8));rows.Add(new{symbol=r.GetString(0),interval=r.GetString(1),timestamp=r.GetInt64(2),open=r.GetDecimal(3),high=r.GetDecimal(4),low=r.GetDecimal(5),close=r.GetDecimal(6),volume=r.IsDBNull(7)?(decimal?)null:r.GetDecimal(7),receiptId=r.GetString(8)});}}
    var receipts=new List<object>();foreach(var id in ids)
    {
        await using var c=new SqlCommand("SELECT PayloadUtf8,Status,ReceivedAt,VolumeAudit,RecoveryValidatedAt FROM market_zones.Receipts WHERE ReceiptId=@id",db);c.Parameters.AddWithValue("@id",id);await using var r=await c.ExecuteReaderAsync();if(!await r.ReadAsync()||r.GetString(1)!="Accepted")throw new InvalidDataException("Missing accepted receipt.");
        var raw=(byte[])r[0];if(MarketH4Ingestion.Sha(raw)!=id)throw new InvalidDataException("SQL raw hash mismatch.");
        receipts.Add(new{receiptId=id,payload=Encoding.UTF8.GetString(raw),receivedAt=r.GetDateTimeOffset(2),volumeAudit=r.GetString(3),recoveryValidatedAt=r.IsDBNull(4)?(DateTimeOffset?)null:r.GetDateTimeOffset(4),recoverySourceSha256=r.IsDBNull(4)?null:id});
    }
    var result=new{schemaVersion=1,source="Azure SQL market_zones",rule=MarketZonePrices.Rule,builtAt=DateTimeOffset.UtcNow,rows,receipts};
    Directory.CreateDirectory(Path.GetDirectoryName(output)!);await File.WriteAllTextAsync(output,JsonSerializer.Serialize(result),new UTF8Encoding(false));
    Console.WriteLine(JsonSerializer.Serialize(new{exportedRows=rows.Count,receipts=receipts.Count,canonicalDataChanged=false}));
}
catch(Exception e){Console.Error.WriteLine(JsonSerializer.Serialize(new{failed=true,type=e.GetType().Name,sqlNumber=e is SqlException sql?(int?)sql.Number:null,reason=e is SqlException?"SQL operation failed":e.Message}));Environment.ExitCode=1;}
