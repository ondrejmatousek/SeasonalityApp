using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.SqlClient;

// Isolated research state ONLY. No SQL statement targets paper_h4 or candle tables.
static class ResearchStore
{
 static string Hash(string text)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();
 static bool Hex(string? s)=>s?.Length==64&&s.All(Uri.IsHexDigit);
 public static void Validate(JsonElement state,JsonElement? previous=null)
 {
  if(state.GetProperty("schemaVersion").GetInt32()!=1||state.GetProperty("model").GetString()!="fm-h4-research-v1"||!Hex(state.GetProperty("implementationSha256").GetString())||!Hex(state.GetProperty("baselineSha256").GetString()))throw new InvalidDataException("Research identity/hash.");
  var started=DateTimeOffset.Parse(state.GetProperty("startedAt").GetString()!);var now=DateTimeOffset.Parse(state.GetProperty("lastRunAt").GetString()!);
  if(now<started)throw new InvalidDataException("Research clock.");
  var setups=state.GetProperty("simulations").EnumerateArray().ToDictionary(s=>s.GetProperty("id").GetString()!);
  if(setups.Count>100000)throw new InvalidDataException("Research capacity.");
  foreach(var (id,s) in setups){var f=s.GetProperty("frozen");var rr=f.GetProperty("rr").GetDouble();var entry=f.GetProperty("entry").GetDouble();var risk=f.GetProperty("risk").GetDouble();var sl=f.GetProperty("sl").GetDouble();var tp=f.GetProperty("tp").GetDouble();var sign=f.GetProperty("side").GetString()=="long"?1:-1;
   if(!Hex(id)||f.GetProperty("id").GetString()!=id||f.GetProperty("provider").GetString()!="OANDA"||f.GetProperty("side").GetString() is not ("long" or "short")||f.GetProperty("variant").GetString() is not ("tp3r" or "sl10" or "sfp15")||rr is not (2 or 3)||Math.Min(entry,Math.Min(sl,tp))<=0||!(risk>0)||Math.Abs(Math.Abs(entry-sl)-risk)>1e-9||Math.Abs((tp-entry)*sign/risk-rr)>1e-7||DateTimeOffset.Parse(f.GetProperty("registeredAt").GetString()!)<started)throw new InvalidDataException("Research frozen geometry.");
   if(s.GetProperty("status").GetString() is not ("waiting" or "open" or "needs_data" or "tp" or "sl" or "ambiguous" or "cancelled"))throw new InvalidDataException("Research status.");
   if(s.GetProperty("status").GetString() is "tp" or "sl"){
    var gross=s.GetProperty("grossR").GetDouble();var cost=s.GetProperty("costR").GetDouble();var net=s.GetProperty("netR").GetDouble();
    if(!double.IsFinite(gross)||!double.IsFinite(net)||!double.IsFinite(cost)||cost<0||Math.Abs(net-(gross-cost))>1e-9||DateTimeOffset.Parse(s.GetProperty("enteredAt").GetString()!)<DateTimeOffset.Parse(f.GetProperty("registeredAt").GetString()!)||DateTimeOffset.Parse(s.GetProperty("resolvedAt").GetString()!)<DateTimeOffset.Parse(s.GetProperty("enteredAt").GetString()!))throw new InvalidDataException("Research result.");
   }
   if(s.TryGetProperty("fill",out var fill)){var p=fill.GetProperty("entry").GetDouble();var r=fill.GetProperty("risk").GetDouble();if(!(p>0&&r>0&&fill.GetProperty("tp").GetDouble()>0&&fill.GetProperty("sl").GetDouble()>0)||Math.Abs(Math.Abs(p-fill.GetProperty("sl").GetDouble())-r)>1e-9||Math.Abs((fill.GetProperty("tp").GetDouble()-p)*sign/r-rr)>1e-7)throw new InvalidDataException("Research SFP fill.");}
  }
  var events=state.GetProperty("events").EnumerateArray().ToArray();
  for(var i=0;i<events.Length;i++){var e=events[i];var raw=e.GetRawText();var end=raw.LastIndexOf(",\"id\":",StringComparison.Ordinal);if(end<0||Hash(raw[..end]+"}")!=e.GetProperty("id").GetString()||e.GetProperty("sequence").GetInt32()!=i+1||!setups.ContainsKey(e.GetProperty("setupId").GetString()!))throw new InvalidDataException("Research event audit.");}
  var reports=state.GetProperty("checkpoints").EnumerateArray().ToArray();if(reports.Length>2||reports.Select(c=>c.GetProperty("id").GetString()).Distinct().Count()!=reports.Length)throw new InvalidDataException("Research checkpoint identity.");
  foreach(var c in reports){var raw=c.GetRawText();var end=raw.LastIndexOf(",\"sha256\":",StringComparison.Ordinal);if(end<0||Hash(raw[..end]+"}")!=c.GetProperty("sha256").GetString())throw new InvalidDataException("Research checkpoint hash.");}
  var report=state.GetProperty("report");
  foreach(var key in new[]{"model","plan","startedAt","baselineRevision","baselineSha256","checkpoints"})if(report.GetProperty(key).GetRawText()!=state.GetProperty(key).GetRawText())throw new InvalidDataException("Research public report differs from audited state: "+key);
  if(previous is not {} old)return;
  foreach(var key in new[]{"startedAt","plan","implementationSha256"})if(old.GetProperty(key).GetRawText()!=state.GetProperty(key).GetRawText())throw new InvalidDataException("Research plan changed.");
  if(DateTimeOffset.Parse(old.GetProperty("lastRunAt").GetString()!)>now||old.GetProperty("baselineRevision").GetInt64()>state.GetProperty("baselineRevision").GetInt64())throw new InvalidDataException("Research cursor rollback.");
  foreach(var s in old.GetProperty("simulations").EnumerateArray()){
   if(!setups.TryGetValue(s.GetProperty("id").GetString()!,out var next)||s.GetProperty("frozen").GetRawText()!=next.GetProperty("frozen").GetRawText())throw new InvalidDataException("Research frozen setup changed.");
   if(s.GetProperty("status").GetString() is "tp" or "sl" or "ambiguous" or "cancelled"){if(s.GetRawText()!=next.GetRawText())throw new InvalidDataException("Research resolved outcome changed.");}
   if(next.GetProperty("lastProcessedStart").GetInt64()<s.GetProperty("lastProcessedStart").GetInt64())throw new InvalidDataException("Research candle cursor rollback.");
   if(s.TryGetProperty("fill",out var fill)&&(!next.TryGetProperty("fill",out var nextFill)||fill.GetRawText()!=nextFill.GetRawText()))throw new InvalidDataException("Research executed entry changed.");
  }
  void Prefix(string key){var before=old.GetProperty(key).EnumerateArray().ToArray();var after=state.GetProperty(key).EnumerateArray().ToArray();if(before.Length>after.Length||before.Where((v,i)=>v.GetRawText()!=after[i].GetRawText()).Any())throw new InvalidDataException("Research history rewritten: "+key);}
  Prefix("events");Prefix("checkpoints");
 }
 public static async Task<int> Main(string[] args)
 {
  try{
   string Arg(string key){var i=Array.IndexOf(args,key);return i>=0&&i+1<args.Length?args[i+1]:throw new ArgumentException("Missing "+key);}
   if(args.Contains("--validate")){using var next=JsonDocument.Parse(await File.ReadAllTextAsync(Arg("--validate")));using var old=args.Contains("--previous")?JsonDocument.Parse(await File.ReadAllTextAsync(Arg("--previous"))):null;Validate(next.RootElement.GetProperty("state"),old?.RootElement.GetProperty("state"));Console.WriteLine("Research state validation passed.");return 0;}
   var cs=new SqlConnectionStringBuilder(Environment.GetEnvironmentVariable("SEASONALITY_H4_SQL_CONNECTION")){ConnectTimeout=120};
   if(cs.InitialCatalog!="seasonality-free-20261022"||!new[]{"seasonality.database.windows.net","tcp:seasonality.database.windows.net","seasonality.database.windows.net,1433","tcp:seasonality.database.windows.net,1433"}.Contains(cs.DataSource,StringComparer.OrdinalIgnoreCase))throw new InvalidOperationException("Unexpected research SQL target.");
   await using var db=new SqlConnection(cs.ConnectionString);await db.OpenAsync();
   if(args.Contains("--ensure-schema")){await using var cmd=new SqlCommand("IF SCHEMA_ID('paper_research') IS NULL EXEC('CREATE SCHEMA paper_research'); IF OBJECT_ID('paper_research.State','U') IS NULL CREATE TABLE paper_research.State(Id int NOT NULL PRIMARY KEY CHECK(Id=1),Revision bigint NOT NULL,StateJson nvarchar(max) NOT NULL CHECK(ISJSON(StateJson)=1),StateSha256 char(64) NOT NULL,UpdatedAt datetimeoffset NOT NULL);",db){CommandTimeout=120};await cmd.ExecuteNonQueryAsync();}
   long revision=0;string? raw=null;
   if(args.Contains("--load")){await using var read=new SqlCommand("SELECT Revision,StateJson,StateSha256 FROM paper_research.State WHERE Id=1",db);await using var r=await read.ExecuteReaderAsync();if(await r.ReadAsync()){revision=r.GetInt64(0);raw=r.GetString(1);if(Hash(raw)!=r.GetString(2))throw new InvalidDataException("Research SQL hash mismatch.");}await Output(Arg("--output"),revision,raw);return 0;}
   if(!args.Contains("--save"))throw new ArgumentException("Research load/save required.");
   var text=await File.ReadAllTextAsync(Arg("--save"));if(Encoding.UTF8.GetByteCount(text)>32*1024*1024)throw new InvalidDataException("Research state size limit.");using var input=JsonDocument.Parse(text,new(){MaxDepth=64});var state=input.RootElement.GetProperty("state");
   await using var tx=(SqlTransaction)await db.BeginTransactionAsync(IsolationLevel.Serializable);
   await using(var read=new SqlCommand("SELECT Revision,StateJson FROM paper_research.State WITH(UPDLOCK,HOLDLOCK) WHERE Id=1",db,tx)){await using var r=await read.ExecuteReaderAsync();if(await r.ReadAsync()){revision=r.GetInt64(0);raw=r.GetString(1);}}
   if(input.RootElement.GetProperty("expectedRevision").GetInt64()!=revision)throw new InvalidOperationException("Concurrent research update; reload current state.");
   using var previous=raw is null?null:JsonDocument.Parse(raw);Validate(state,previous?.RootElement);raw=state.GetRawText();revision++;
   await using(var write=new SqlCommand("IF EXISTS(SELECT 1 FROM paper_research.State WHERE Id=1) UPDATE paper_research.State SET Revision=@r,StateJson=@j,StateSha256=@h,UpdatedAt=SYSUTCDATETIME() WHERE Id=1; ELSE INSERT paper_research.State VALUES(1,@r,@j,@h,SYSUTCDATETIME());",db,tx)){write.Parameters.AddWithValue("@r",revision);write.Parameters.AddWithValue("@j",raw);write.Parameters.AddWithValue("@h",Hash(raw));await write.ExecuteNonQueryAsync();}
   await tx.CommitAsync();await Output(Arg("--output"),revision,raw);Console.WriteLine(JsonSerializer.Serialize(new{revision,persisted=true,baselineChanged=false}));return 0;
  }catch(Exception e){Console.Error.WriteLine(JsonSerializer.Serialize(new{failed=true,type=e.GetType().Name,reason=e is SqlException?"Research SQL operation failed":e.Message}));return 1;}
 }
 static async Task Output(string file,long revision,string? raw){Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(file))!);using var doc=raw is null?null:JsonDocument.Parse(raw);await File.WriteAllTextAsync(file,JsonSerializer.Serialize(new{schemaVersion=1,revision,state=(JsonElement?)doc?.RootElement}),new UTF8Encoding(false));}
}
