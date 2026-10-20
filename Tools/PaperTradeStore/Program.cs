using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.SqlClient;

static class Store
{
    static string Hash(string s)=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s))).ToLowerInvariant();
    static bool Terminal(string s)=>s is "tp" or "sl" or "ambiguous" or "cancelled";
    public static void Validate(JsonElement state,JsonElement? old=null)
    {
        if(state.GetProperty("schemaVersion").GetInt32()!=1||state.GetProperty("model").GetString()!="fm-h4-touch-2r-v1")throw new InvalidDataException("Paper model mismatch.");
        var setups=state.GetProperty("setups").EnumerateArray().ToDictionary(s=>s.GetProperty("id").GetString()!);
        if(setups.Count>100000)throw new InvalidDataException("Paper ledger capacity reached.");
        foreach(var (id,s) in setups)
        {
            if(id.Length!=64||id.Any(c=>!Uri.IsHexDigit(c)))throw new InvalidDataException("Paper identity.");
            var f=s.GetProperty("frozen");if(f.GetProperty("id").GetString()!=id||f.GetProperty("provider").GetString()!="OANDA"||f.GetProperty("timeframe").GetString()!="H4")throw new InvalidDataException("Paper feed identity.");
            var entry=f.GetProperty("entry").GetDouble();var sl=f.GetProperty("sl").GetDouble();var tp=f.GetProperty("tp").GetDouble();var risk=f.GetProperty("risk").GetDouble();var sign=f.GetProperty("side").GetString()=="long"?1:-1;
            if(!(entry>0&&sl>0&&tp>0&&risk>0)||Math.Abs(Math.Abs(entry-sl)-risk)>1e-9||Math.Abs((tp-entry)*sign/risk-2)>1e-7||(entry-sl)*sign<=0)throw new InvalidDataException("Paper 2R geometry.");
            if(s.GetProperty("status").GetString() is not ("waiting" or "open" or "needs_data" or "tp" or "sl" or "ambiguous" or "cancelled"))throw new InvalidDataException("Paper status.");
        }
        var events=state.GetProperty("events").EnumerateArray().ToArray();
        for(var i=0;i<events.Length;i++)
        {
            var e=events[i];var raw=e.GetRawText();var split=raw.LastIndexOf(",\"id\":",StringComparison.Ordinal);
            if(e.GetProperty("sequence").GetInt32()!=i+1||!setups.ContainsKey(e.GetProperty("setupId").GetString()!)||split<0||Hash(raw[..split]+"}")!=e.GetProperty("id").GetString())throw new InvalidDataException("Paper event hash/sequence.");
        }
        if(old is not {} prior)return;
        if(prior.GetProperty("config").GetRawText()!=state.GetProperty("config").GetRawText()||prior.GetProperty("startedAt").GetString()!=state.GetProperty("startedAt").GetString())throw new InvalidDataException("Paper frozen policy changed.");
        foreach(var s in prior.GetProperty("setups").EnumerateArray())
        {
            if(!setups.TryGetValue(s.GetProperty("id").GetString()!,out var next)||s.GetProperty("frozen").GetRawText()!=next.GetProperty("frozen").GetRawText())throw new InvalidDataException("Frozen setup changed or removed.");
            if(Terminal(s.GetProperty("status").GetString()!)&&s.GetRawText()!=next.GetRawText())throw new InvalidDataException("Resolved outcome changed.");
            if(next.GetProperty("lastProcessedStart").GetInt64()<s.GetProperty("lastProcessedStart").GetInt64())throw new InvalidDataException("Paper cursor rollback.");
        }
        var oldEvents=prior.GetProperty("events").EnumerateArray().ToArray();if(oldEvents.Length>events.Length)throw new InvalidDataException("Paper events removed.");
        for(var i=0;i<oldEvents.Length;i++)if(oldEvents[i].GetRawText()!=events[i].GetRawText())throw new InvalidDataException("Paper history rewritten.");
    }
    public static async Task<int> Main(string[] args)
    {
        try
        {
            string Arg(string k){var i=Array.IndexOf(args,k);return i>=0&&i+1<args.Length?args[i+1]:throw new ArgumentException("Missing "+k);}
            if(args.Contains("--validate")){using var j=JsonDocument.Parse(await File.ReadAllTextAsync(Arg("--validate")));using var old=args.Contains("--previous")?JsonDocument.Parse(await File.ReadAllTextAsync(Arg("--previous"))):null;Validate(j.RootElement.GetProperty("state"),old?.RootElement.GetProperty("state"));Console.WriteLine("Paper state validation passed.");return 0;}
            var cs=Environment.GetEnvironmentVariable("SEASONALITY_H4_SQL_CONNECTION")??throw new InvalidOperationException("Paper SQL connection required.");var target=new SqlConnectionStringBuilder(cs){ConnectTimeout=120};
            if(target.InitialCatalog!="free-sql-db-2426953"||!new[]{"seasonality.database.windows.net","tcp:seasonality.database.windows.net","seasonality.database.windows.net,1433","tcp:seasonality.database.windows.net,1433"}.Contains(target.DataSource,StringComparer.OrdinalIgnoreCase))throw new InvalidOperationException("Unexpected paper SQL target.");
            await using var db=new SqlConnection(target.ConnectionString);await db.OpenAsync();
            if(args.Contains("--ensure-schema"))
            {
                const string ddl="""
                IF SCHEMA_ID('paper_h4') IS NULL EXEC('CREATE SCHEMA paper_h4');
                IF OBJECT_ID('paper_h4.State','U') IS NULL CREATE TABLE paper_h4.State(
                  Id int NOT NULL PRIMARY KEY CHECK(Id=1),Revision bigint NOT NULL,StateJson nvarchar(max) NOT NULL CHECK(ISJSON(StateJson)=1),StateSha256 char(64) NOT NULL,UpdatedAt datetimeoffset NOT NULL);
                IF OBJECT_ID('paper_h4.Events','U') IS NULL CREATE TABLE paper_h4.Events(
                  Sequence bigint NOT NULL PRIMARY KEY,Id char(64) NOT NULL UNIQUE,SetupId char(64) NOT NULL,Kind varchar(32) NOT NULL,At datetimeoffset NOT NULL,EventJson nvarchar(max) NOT NULL CHECK(ISJSON(EventJson)=1));
                """;
                await using var create=new SqlCommand(ddl,db){CommandTimeout=120};await create.ExecuteNonQueryAsync();
            }
            long revision=0;string? raw=null;string? sha=null;
            await using(var read=new SqlCommand("SELECT Revision,StateJson,StateSha256 FROM paper_h4.State WHERE Id=1",db)){await using var r=await read.ExecuteReaderAsync();if(await r.ReadAsync()){revision=r.GetInt64(0);raw=r.GetString(1);sha=r.GetString(2);if(Hash(raw)!=sha)throw new InvalidDataException("Paper SQL state hash mismatch.");}}
            if(args.Contains("--load")){await Output(Arg("--output"),revision,raw,sha);Console.WriteLine(JsonSerializer.Serialize(new{revision,initialized=raw is not null}));return 0;}
            if(!args.Contains("--save"))throw new ArgumentException("Paper load/save required.");
            var input=await File.ReadAllTextAsync(Arg("--save"));if(Encoding.UTF8.GetByteCount(input)>16*1024*1024)throw new InvalidDataException("Paper state size limit.");using var next=JsonDocument.Parse(input,new JsonDocumentOptions{MaxDepth=64});var expected=next.RootElement.GetProperty("expectedRevision").GetInt64();var state=next.RootElement.GetProperty("state");
            await using var tx=(SqlTransaction)await db.BeginTransactionAsync(IsolationLevel.Serializable);
            await using(var locked=new SqlCommand("SELECT Revision,StateJson FROM paper_h4.State WITH(UPDLOCK,HOLDLOCK) WHERE Id=1",db,tx)){await using var r=await locked.ExecuteReaderAsync();revision=0;raw=null;if(await r.ReadAsync()){revision=r.GetInt64(0);raw=r.GetString(1);}}
            if(revision!=expected)throw new InvalidOperationException("Paper concurrent publication; retry from current SQL state.");
            using var previous=raw is null?null:JsonDocument.Parse(raw);Validate(state,previous?.RootElement);
            var oldCount=previous?.RootElement.GetProperty("events").GetArrayLength()??0;
            foreach(var e in state.GetProperty("events").EnumerateArray().Skip(oldCount))
            {
                await using var insert=new SqlCommand("INSERT INTO paper_h4.Events(Sequence,Id,SetupId,Kind,At,EventJson) VALUES(@n,@id,@s,@k,@at,@json)",db,tx);
                insert.Parameters.AddWithValue("@n",e.GetProperty("sequence").GetInt64());insert.Parameters.AddWithValue("@id",e.GetProperty("id").GetString()!);insert.Parameters.AddWithValue("@s",e.GetProperty("setupId").GetString()!);insert.Parameters.AddWithValue("@k",e.GetProperty("kind").GetString()!);insert.Parameters.AddWithValue("@at",DateTimeOffset.Parse(e.GetProperty("at").GetString()!));insert.Parameters.AddWithValue("@json",e.GetRawText());await insert.ExecuteNonQueryAsync();
            }
            raw=state.GetRawText();sha=Hash(raw);revision++;
            await using(var write=new SqlCommand("IF EXISTS(SELECT 1 FROM paper_h4.State WHERE Id=1) UPDATE paper_h4.State SET Revision=@r,StateJson=@j,StateSha256=@h,UpdatedAt=SYSUTCDATETIME() WHERE Id=1; ELSE INSERT paper_h4.State VALUES(1,@r,@j,@h,SYSUTCDATETIME());",db,tx)){write.Parameters.AddWithValue("@r",revision);write.Parameters.AddWithValue("@j",raw);write.Parameters.AddWithValue("@h",sha);await write.ExecuteNonQueryAsync();}
            await tx.CommitAsync();await Output(Arg("--output"),revision,raw,sha);Console.WriteLine(JsonSerializer.Serialize(new{revision,persisted=true,setups=state.GetProperty("setups").GetArrayLength(),events=state.GetProperty("events").GetArrayLength()}));return 0;
        }
        catch(Exception e){Console.Error.WriteLine(JsonSerializer.Serialize(new{failed=true,type=e.GetType().Name,reason=e is SqlException?"Paper SQL operation failed":e.Message}));return 1;}
    }
    static async Task Output(string path,long revision,string? raw,string? sha)
    {Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);using var j=raw is null?null:JsonDocument.Parse(raw);await File.WriteAllTextAsync(path,JsonSerializer.Serialize(new{schemaVersion=1,revision,stateSha256=sha,state=(JsonElement?)j?.RootElement}),new UTF8Encoding(false));}
}
