using System.Data;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.SqlClient;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using SeasonalityApp.Services;

// Explicit REAL SQL Server LocalDB integration test. No Azure/production connection is read.
// A new uniquely named database is created, and only that database is removed at the end.
if (!args.Contains("--localdb", StringComparer.Ordinal))
    throw new ArgumentException("Explicit --localdb is required; this check creates an isolated local test database.");
var repository = new DirectoryInfo(Directory.GetCurrentDirectory());
while (repository is not null && !File.Exists(Path.Combine(repository.FullName,"SeasonalityApp.csproj"))) repository=repository.Parent;
if(repository is null)throw new Exception("Run from the SeasonalityApp repository.");
Directory.SetCurrentDirectory(repository.FullName);
var name="SeasonalityInboxTest_"+Guid.NewGuid().ToString("N");
var master="Data Source=(localdb)\\MSSQLLocalDB;Initial Catalog=master;Integrated Security=true;Encrypt=false;Connect Timeout=30;Pooling=false";
var test=new SqlConnectionStringBuilder(master){InitialCatalog=name}.ConnectionString;
void Check(bool ok,string label){if(!ok)throw new Exception(label);}
async Task Execute(string connection,string sql)
{await using var c=new SqlConnection(connection);await c.OpenAsync();await using var cmd=new SqlCommand(sql,c){CommandTimeout=30};await cmd.ExecuteNonQueryAsync();}
async Task<int> Count()
{await using var c=new SqlConnection(test);await c.OpenAsync();await using var cmd=new SqlCommand("SELECT COUNT(*) FROM market_daily.Inbox",c);return (int)(await cmd.ExecuteScalarAsync())!;}
await Execute(master,$"CREATE DATABASE [{name}]");
WebApplication? host=null;
try
{
    // Azure SQL commonly enables RCSI. Exercise the queue's READCOMMITTEDLOCK hint under that mode.
    await Execute(master,$"ALTER DATABASE [{name}] SET READ_COMMITTED_SNAPSHOT ON;");
    await Execute(test,File.ReadAllText("Data/MarketDailyInbox.sql"));
    await Execute(test,File.ReadAllText("Data/MarketDailyInbox.sql")); // additive/idempotent migration
    await Execute(test,File.ReadAllText("Data/MarketDailyShadowHistory.sql"));
    await Execute(test,File.ReadAllText("Data/MarketDailyShadowHistory.sql"));
    var b=WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName="Development" });
    b.Logging.ClearProviders();b.WebHost.UseUrls("http://127.0.0.1:0");
    // Explicit integration host; no stock/COT context, fake provider, or production config.
    b.Services.AddSingleton(new MarketDailySqlInbox(test));host=b.Build();
    host.MapGet("/health",async()=> {await Count();return Results.Ok(new{ready=true,storage="isolated-real-sql"});});
    await host.StartAsync();
    var url=host.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
    using var http=new HttpClient();Check((await http.GetAsync(url+"/health")).IsSuccessStatusCode,"Real host/SQL readiness");
    var store=host.Services.GetRequiredService<MarketDailySqlInbox>();
    var payload=File.ReadAllText("data/market-daily/latest.json");
    var node=JsonNode.Parse(payload)!;
    var observed=DateTimeOffset.Parse(node["fetchedAt"]!.GetValue<string>());
    var audit=File.ReadAllText("data/market-daily/audit/"+node["runDate"]!.GetValue<string>()+".json");
    using var registry=JsonDocument.Parse(File.ReadAllText(Environment.GetEnvironmentVariable("MARKET_DAILY_PROBE_TEST_BUNDLE")??"artifacts/tradingview-backfill-36-v1/analytics-sources-v1/manifest.json"));
    MarketDailySqlInbox.Submission Create(string p,string a)=>MarketDailySqlInbox.Submission.Create(p,a,registry.RootElement.GetProperty("entries"),observed.AddMinutes(1));
    var submission=Create(payload,audit);
    var receipts=await Task.WhenAll(Enumerable.Range(0,8).Select(_=>store.ReceiveAsync(submission)));
    Check(receipts.Count(r=>!r.Duplicate)==1 && await Count()==1,"Concurrent exact retries insert one queue row");
    Check(receipts.All(r=>r.Persisted&&!r.HistoryAccepted&&!r.AnalyticsTriggered&&!r.CompletionValidated&&r.Status=="PendingValidation"),"Quarantine never claims price admission");
    await using(var c=new SqlConnection(test))
    {
        await c.OpenAsync();await using var cmd=new SqlCommand("SELECT DailyUtf8,AuditUtf8 FROM market_daily.Inbox",c);
        await using var reader=await cmd.ExecuteReaderAsync();await reader.ReadAsync();
        Check(Encoding.UTF8.GetBytes(payload).SequenceEqual((byte[])reader[0])&&Encoding.UTF8.GetBytes(audit).SequenceEqual((byte[])reader[1]),"Exact original byte preservation");
    }
    async Task Reject(Func<Task> action,string message)
    {bool failed=false;try{await action();}catch(Exception e)when(e is InvalidDataException or JsonException or KeyNotFoundException or InvalidOperationException){failed=true;}Check(failed,message);}
    var incomplete=JsonNode.Parse(payload)!;incomplete["bars"]!.AsArray().RemoveAt(0);
    await Reject(()=>{Create(incomplete.ToJsonString(),audit);return Task.CompletedTask;},"Incomplete collection rejected before SQL");
    await Reject(()=>{Create(payload,"{}");return Task.CompletedTask;},"Missing audit rejected before SQL");
    var duplicateKeys=payload.Replace("\"schemaVersion\": 1","\"schemaVersion\": 1, \"schemaVersion\": 1");
    if(duplicateKeys==payload)duplicateKeys=payload.Insert(payload.IndexOf('{')+1,"\"schemaVersion\":1,");
    await Reject(()=>{Create(duplicateKeys,audit);return Task.CompletedTask;},"Duplicate JSON keys rejected");
    var originalByte=submission.DailyUtf8[0];submission.DailyUtf8[0]=0;
    await Reject(async()=>{await store.ReceiveAsync(submission);},"Mutable buffer tampering rejected");submission.DailyUtf8[0]=originalByte;
    Check(await Count()==1,"Rejected collections leave no partial queue rows");
    // Different exact audit bytes are separately retained, not treated as a price update.
    var second=Create(payload,audit+"\n");await store.ReceiveAsync(second);Check(await Count()==2,"Both exact evidence pairs retained");
    var leases=await Task.WhenAll(store.ClaimAsync(TimeSpan.FromMinutes(1)),store.ClaimAsync(TimeSpan.FromMinutes(1)));
    Check(leases.All(l=>l is not null)&&leases[0]!.ReceiptId!=leases[1]!.ReceiptId,"Concurrent workers cannot claim same job");
    Check(await store.ClaimAsync(TimeSpan.FromMinutes(1)) is null,"Leased work is not duplicated");
    var first=leases[0]!;
    // Simulate a worker crash/elapsed lease in the isolated SQL database only.
    await Execute(test,$"UPDATE market_daily.Inbox SET LeaseUntil=DATEADD(second,-1,SYSDATETIMEOFFSET()) WHERE ReceiptId='{first.ReceiptId}'");
    var recovered=(await store.ClaimAsync(TimeSpan.FromMinutes(1)))!;
    Check(recovered.ReceiptId==first.ReceiptId&&recovered.LeaseId!=first.LeaseId&&recovered.Attempts==2,"Crash recovery renews lease fencing token");
    Check(!await store.ReleaseAsync(first.ReceiptId,first.LeaseId,true,"OLD_WORKER"),"Stale worker cannot mutate recovered job");
    Check(await store.ReleaseAsync(recovered.ReceiptId,recovered.LeaseId,true,"AUDIT_REJECTED"),"Validation failure is durably blocked");
    var other=leases[1]!;Check(await store.ReleaseAsync(other.ReceiptId,other.LeaseId,false,"RETRYABLE_FAILURE"),"Retry survives restart");
    var freshService=new MarketDailySqlInbox(test);
    var retry=(await freshService.ClaimAsync(TimeSpan.FromMinutes(1)))!;
    Check(retry.ReceiptId==other.ReceiptId&&retry.Attempts==2,"New service instance recovers durable retry");
    Check(await freshService.ReleaseAsync(retry.ReceiptId,retry.LeaseId,true,"MANUAL_REVIEW"),"Block completed test work");
    Check(await freshService.ClaimAsync(TimeSpan.FromMinutes(1)) is null,"Blocked jobs do not loop forever");
    // Evidence corruption cannot silently reach the worker, even when lengths still satisfy SQL checks.
    var corrupt=Create(payload+"\n",audit);await store.ReceiveAsync(corrupt);
    await Execute(test,$"UPDATE market_daily.Inbox SET DailyUtf8=0x7B7D WHERE ReceiptId='{corrupt.ReceiptId}'");
    await Reject(async()=>{await store.ClaimAsync(TimeSpan.FromMinutes(1));},"Corrupted stored evidence rejected");
    Check(await store.ClaimAsync(TimeSpan.FromMinutes(1)) is null,"Corrupted evidence is durably blocked");
    // End-to-end: real SQL queue -> real Node engine -> cumulative SHADOW generation -> atomic ACK.
    // Each worker uses private temporary directories; the canonical input/source files remain untouched.
    var before=ProductionSnapshot();
    var worker=new MarketDailyInboxWorker(store,repository.FullName,Path.GetFullPath("data/market-state"));
    var healthy=Create(payload,audit+"\n\n");await store.ReceiveAsync(healthy);
    var processed=await worker.ProcessOneAsync();
    Check(processed.Status=="Committed"&&!processed.ProductionChanged&&!processed.AnalyticsTriggered,"Real Node/SQL shadow worker completed without publication");
    var firstHead=(await store.ReadShadowHistoryAsync())!;
    using(var stateJson=JsonDocument.Parse(firstHead.StateUtf8))
        Check(stateJson.RootElement.GetProperty("files").EnumerateObject().Count()==39,"All 39 cumulative identities preserved in SQL shadow state");
    Check((await store.ReceiveAsync(healthy)).Status=="ShadowAccepted","ACK and generation committed together");
    Check((await worker.ProcessOneAsync()).Status=="Empty","Accepted collection not reprocessed");
    // Another evidence copy is idempotent in prices and resumes from SQL, not the bootstrap directory.
    var repeat=Create(payload,audit+"\n\n\n");await store.ReceiveAsync(repeat);
    Check((await worker.ProcessOneAsync()).Status=="Committed","Next worker loads previous SQL shadow generation");
    var secondHead=(await store.ReadShadowHistoryAsync())!;
    Check(secondHead.GenerationId>firstHead.GenerationId,"Immutable generations are ordered");
    var conflicting=JsonNode.Parse(payload)!;var conflictingAudit=JsonNode.Parse(audit)!;
    conflicting["bars"]![0]!["close"]=conflicting["bars"]![0]!["open"]!.DeepClone();
    foreach(var raw in conflictingAudit["runs"]![0]!["entries"]![0]!["rawResponse"]!["bars"]!.AsArray())
        if(raw!["t"]!.GetValue<long>()==conflicting["bars"]![0]!["timestamp"]!.GetValue<long>())raw["c"]=conflicting["bars"]![0]!["close"]!.DeepClone();
    var conflict=Create(conflicting.ToJsonString(),conflictingAudit.ToJsonString());await store.ReceiveAsync(conflict);
    Check((await worker.ProcessOneAsync()).Status=="Blocked","Matching raw audit cannot authorize a conflicting historical OHLC");
    Check((await store.ReadShadowHistoryAsync())!.GenerationId==secondHead.GenerationId,"Rejected batch cannot partially advance history");
    Check((await store.ReceiveAsync(conflict)).Status=="Blocked","Rejected evidence retained without price overwrite");
    Check(ProductionSnapshot()==before,"Worker never mutates canonical files or stock/COT data");
    // Infrastructure failure retains the receipt; a new healthy worker can recover it.
    var retryJob=Create(payload,audit+"\n\n\n\n");await store.ReceiveAsync(retryJob);
    var badWorker=new MarketDailyInboxWorker(store,repository.FullName,Path.GetFullPath("data/market-state"),"nonexistent-seasonality-node-executable");
    await Reject(async()=>{await badWorker.ProcessOneAsync();},"Unavailable Node is not a false success");
    Check((await store.ReceiveAsync(retryJob)).Status=="PendingValidation","Infrastructure failure returns to durable retry");
    Check((await worker.ProcessOneAsync()).Status=="Committed","Healthy worker recovers after infrastructure failure");
    // Deterministic CAS test: two independently leased jobs start from the SAME generation.
    var pairA=Create(payload,audit+"\n\n\n\n\n");var pairB=Create(payload,audit+"\n\n\n\n\n\n");
    await store.ReceiveAsync(pairA);await store.ReceiveAsync(pairB);
    var leaseA=(await store.ClaimAsync(TimeSpan.FromMinutes(1)))!;var leaseB=(await store.ClaimAsync(TimeSpan.FromMinutes(1)))!;
    var oldHead=(await store.ReadShadowHistoryAsync())!;
    byte[] template;
    await using(var c=new SqlConnection(test))
    {await c.OpenAsync();await using var command=new SqlCommand("SELECT ReportUtf8 FROM market_daily.ShadowHistory WHERE GenerationId=@id",c);
     command.Parameters.Add("@id",SqlDbType.BigInt).Value=oldHead.GenerationId;template=(byte[])(await command.ExecuteScalarAsync())!;}
    byte[] Binding(MarketDailySqlInbox.Lease l)
    {var report=JsonNode.Parse(template)!;report["payloadSha256"]=Digest(l.DailyUtf8);report["auditSha256"]=Digest(l.AuditUtf8);return Encoding.UTF8.GetBytes(report.ToJsonString());}
    Check(await store.CommitShadowHistoryAsync(leaseA,oldHead.GenerationId,oldHead.BaselineFingerprint,oldHead.StateUtf8,Binding(leaseA))==MarketDailySqlInbox.ShadowCommitResult.Committed,"First result advances state");
    var winningHead=(await store.ReadShadowHistoryAsync())!;
    Check(await store.CommitShadowHistoryAsync(leaseB,oldHead.GenerationId,oldHead.BaselineFingerprint,oldHead.StateUtf8,Binding(leaseB))==MarketDailySqlInbox.ShadowCommitResult.HeadChanged,"Concurrent stale state rejected");
    Check((await store.ReadShadowHistoryAsync())!.GenerationId==winningHead.GenerationId,"Loser cannot overwrite winner generation");
    await Execute(test,$"UPDATE market_daily.Inbox SET LeaseUntil=DATEADD(second,-1,SYSDATETIMEOFFSET()) WHERE ReceiptId='{leaseB.ReceiptId}'");
    Check(await store.CommitShadowHistoryAsync(leaseB,winningHead.GenerationId,oldHead.BaselineFingerprint,oldHead.StateUtf8,Binding(leaseB))==MarketDailySqlInbox.ShadowCommitResult.LeaseLost,"Expired worker cannot commit generation or ACK");
    Check((await worker.ProcessOneAsync()).Status=="Committed","Expired job reruns from newest SQL generation");
    // Isolated synthetic next-session fixture exercises INSERTS, not just duplicate replay.
    var next=JsonNode.Parse(payload)!;var nextAudit=JsonNode.Parse(audit)!;
    var futureReceived=observed.AddDays(1).AddMinutes(1);var nextDate=DateOnly.Parse(node["runDate"]!.GetValue<string>()).AddDays(1).ToString("yyyy-MM-dd");
    next["fetchedAt"]=observed.AddDays(1).ToString("O");next["runDate"]=nextDate;
    if(next["generatedAt"] is not null)next["generatedAt"]=observed.AddDays(1).ToString("O");
    nextAudit["runDate"]=nextDate;nextAudit["runs"]![0]!["checkedAt"]=observed.AddDays(1).ToString("O");
    foreach(var bar in next["bars"]!.AsArray())
    {
        var timestamp=bar!["timestamp"]!.GetValue<long>();var symbol=bar["providerSymbol"]!.GetValue<string>();
        bar["timestamp"]=timestamp+86400;bar["date"]=DateOnly.Parse(bar["date"]!.GetValue<string>()).AddDays(1).ToString("yyyy-MM-dd");
        if(bar["sessionEnd"] is not null)bar["sessionEnd"]=DateTimeOffset.Parse(bar["sessionEnd"]!.GetValue<string>()).AddDays(1).ToString("O");
        var entry=nextAudit["runs"]![0]!["entries"]!.AsArray().Single(e=>e!["providerSymbol"]!.GetValue<string>()==symbol)!;
        entry["timestamp"]=timestamp+86400;entry["date"]=bar["date"]!.DeepClone();entry["selectedDate"]=bar["date"]!.DeepClone();
        // Shift the ENTIRE synthetic response; shifting only the selected bar can collide with its forming successor.
        foreach(var raw in entry["rawResponse"]!["bars"]!.AsArray())raw!["t"]=raw["t"]!.GetValue<long>()+86400;
    }
    var nextSubmission=MarketDailySqlInbox.Submission.Create(next.ToJsonString(),nextAudit.ToJsonString(),registry.RootElement.GetProperty("entries"),futureReceived);
    await store.ReceiveAsync(nextSubmission);
    // Test-only clock boundary in this uniquely owned database; production never rewrites fetchedAt/ReceivedAt.
    await using(var c=new SqlConnection(test))
    {await c.OpenAsync();await using var command=new SqlCommand("UPDATE market_daily.Inbox SET ReceivedAt=@time WHERE ReceiptId=@id",c);
     command.Parameters.Add("@time",SqlDbType.DateTimeOffset).Value=futureReceived;command.Parameters.Add("@id",SqlDbType.Char,64).Value=nextSubmission.ReceiptId;await command.ExecuteNonQueryAsync();}
    Check((await worker.ProcessOneAsync()).Status=="Committed","Whole 39-instrument append committed to isolated SQL shadow");
    await using(var c=new SqlConnection(test))
    {await c.OpenAsync();await using var command=new SqlCommand("SELECT ReportUtf8 FROM market_daily.ShadowHistory WHERE ReceiptId=@id",c);
     command.Parameters.Add("@id",SqlDbType.Char,64).Value=nextSubmission.ReceiptId;using var report=JsonDocument.Parse((byte[])(await command.ExecuteScalarAsync())!);
     Check(report.RootElement.GetProperty("inserted").GetInt32()==39,"All 39 synthetic next-session bars appended together");}
    // Run the ACTUAL application CLI against this private DB, not just a test-host service call.
    var cliSubmission=Create(payload,audit+"\n\n\n\n\n\n\n");await store.ReceiveAsync(cliSubmission);
    var start=new System.Diagnostics.ProcessStartInfo("dotnet"){WorkingDirectory=repository.FullName,UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};
    start.ArgumentList.Add(Path.GetFullPath("bin/Release/net10.0/SeasonalityApp.dll"));start.ArgumentList.Add("--process-market-inbox-once");
    start.Environment["ConnectionStrings__DefaultConnection"]=test;start.Environment["MarketDailyInboxWorker__Enabled"]="true";
    start.Environment["MarketDailyInboxWorker__RepositoryRoot"]=repository.FullName;start.Environment["MarketDailyInboxWorker__BootstrapState"]=Path.GetFullPath("data/market-state");
    using(var process=System.Diagnostics.Process.Start(start)!)
    {var stdout=process.StandardOutput.ReadToEndAsync();var stderr=process.StandardError.ReadToEndAsync();await process.WaitForExitAsync();
     var text=await stdout;await stderr;Check(process.ExitCode==0&&text.Contains("\"Status\":\"Committed\""),"Actual opt-in application CLI succeeds");}
    Check(ProductionSnapshot()==before,"Full worker/CLI verification leaves canonical files unchanged");
    // Optional full analytics rehearsal uses the unchanged builders and frozen SQL-derived stock/COT snapshot.
    var analyticsSubmission=Create(payload,audit+"\n\n\n\n\n\n\n\n");await store.ReceiveAsync(analyticsSubmission);
    var beforeAnalyticsHead=(await store.ReadShadowHistoryAsync())!.GenerationId;
    var missingEvidenceWorker=new MarketDailyInboxWorker(store,repository.FullName,Path.GetFullPath("data/market-state"),
        analyticsSnapshot:Path.GetFullPath("data/generated/site"),htfFeed:Path.Combine(repository.FullName,"artifacts","nonexistent-sql-worker-htf-test"));
    await Reject(async()=>{await missingEvidenceWorker.ProcessOneAsync();},"Missing analytics evidence is not a successful generation");
    Check((await store.ReadShadowHistoryAsync())!.GenerationId==beforeAnalyticsHead&&
        (await store.ReceiveAsync(analyticsSubmission)).Status=="PendingValidation","Failed rehearsal preserves prior generation and durable receipt");
    var analyticsWorker=new MarketDailyInboxWorker(store,repository.FullName,Path.GetFullPath("data/market-state"),
        analyticsSnapshot:Path.GetFullPath("data/generated/site"),htfFeed:Path.GetFullPath("artifacts/htf-ohlc"));
    Check((await analyticsWorker.ProcessOneAsync()).Status=="Committed","Existing analytics builders pass isolated SQL worker rehearsal");
    await using(var c=new SqlConnection(test))
    {await c.OpenAsync();await using var command=new SqlCommand("SELECT ReportUtf8 FROM market_daily.ShadowHistory WHERE ReceiptId=@id",c);
     command.Parameters.Add("@id",SqlDbType.Char,64).Value=analyticsSubmission.ReceiptId;using var report=JsonDocument.Parse((byte[])(await command.ExecuteScalarAsync())!);
     Check(report.RootElement.GetProperty("analyticsRehearsal").GetProperty("passed").GetBoolean()&&
        !report.RootElement.GetProperty("analyticsRehearsal").GetProperty("publicationEligible").GetBoolean(),"Rehearsal success never authorizes publication");}
    Check(ProductionSnapshot()==before,"Analytics rehearsal leaves canonical history unchanged");
    await using(var c=new SqlConnection(test))
    {await c.OpenAsync();await using var command=new SqlCommand("SELECT COUNT(*) FROM sys.tables WHERE schema_id=SCHEMA_ID('dbo')",c);
     Check((int)(await command.ExecuteScalarAsync())! == 0,"CLI never initializes stock/COT schemas");}
    await SqlPublicationChecks.RunAsync(store,test);
    await McpSqlChecks.RunAsync(test,Path.GetFullPath(Environment.GetEnvironmentVariable("MARKET_DAILY_PROBE_TEST_BUNDLE")??"artifacts/tradingview-backfill-36-v1/analytics-sources-v1/manifest.json"),payload,audit);
    Console.WriteLine("PASS: real SQL + HTTP/application CLI + Node worker, full analytics rehearsal and freshness checks, 39-bar append/replay/conflict admission, exact bytes, atomic shadow generation/ACK, CAS/lease fencing, crash retry, no canonical file/stock/COT writes or publication. No production receiver/tool enabled.");
}
finally
{
    if(host is not null){await host.StopAsync();await host.DisposeAsync();}
    // Name and destination are fixed by this executable, never supplied by caller/environment.
    if(!System.Text.RegularExpressions.Regex.IsMatch(name,@"\ASeasonalityInboxTest_[0-9a-f]{32}\z"))throw new Exception("Unsafe test database name");
    await Execute(master,$"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{name}];");
}
static string ProductionSnapshot()=>string.Join("\n",Directory.GetFiles("data/market-state","*.json").Order()
    .Select(f=>f+":"+Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(f)))));
static string Digest(byte[] b)=>Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(b)).ToLowerInvariant();
