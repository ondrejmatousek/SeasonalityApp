using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Data.SqlClient;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using SeasonalityApp.Services;

// HTTP/MCP + real isolated LocalDB. No fake store, no Azure auth/SQL requests, no test keys in production.
internal static class McpSqlChecks
{
    public static async Task RunAsync(string connection,string bundle,string daily,string audit)
    {
        const string issuer="https://isolated-inbox.eu.auth0.com/",owner="auth0|isolated-inbox-owner",client="isolated-inbox-client";
        using var rsa=RSA.Create(2048);var key=new RsaSecurityKey(rsa){KeyId=Guid.NewGuid().ToString()};
        void Check(bool ok,string label){if(!ok)throw new Exception(label);}
        string Token(string scope,string? subject=null,string? azp=null,bool expired=false)
        {
            var jwt=new JwtSecurityToken(issuer,MarketDailyMcp.Resource,[new Claim("sub",subject??owner),new("azp",azp??client),new("scope",scope)],
                DateTime.UtcNow.AddHours(-1),DateTime.UtcNow.AddMinutes(expired?-5:5),new SigningCredentials(key,SecurityAlgorithms.RsaSha256));
            return new JwtSecurityTokenHandler().WriteToken(jwt);
        }
        async Task<int> Count()
        {await using var c=new SqlConnection(connection);await c.OpenAsync();await using var cmd=new SqlCommand("SELECT COUNT(*) FROM market_daily.Inbox",c);return (int)(await cmd.ExecuteScalarAsync())!;}
        var initialCount=await Count();
        async Task<(WebApplication App,HttpClient Http)> Start(bool writes,string? mode="shadow",string? provider="Auth0")
        {
            var b=WebApplication.CreateBuilder(new WebApplicationOptions{EnvironmentName="Development"});
            b.Logging.ClearProviders();b.WebHost.UseUrls("http://127.0.0.1:0");
            b.Configuration.AddInMemoryCollection(new Dictionary<string,string?> {
                ["MarketDailyMcp:Enabled"]="true",["MarketDailyMcp:Provider"]=provider,
                ["MarketDailyMcp:Auth0Domain"]="isolated-inbox.eu.auth0.com",["MarketDailyMcp:Audience"]=MarketDailyMcp.Resource,
                ["MarketDailyMcp:AllowedSubject"]=owner,["MarketDailyMcp:AllowedClientId"]=client,
                ["MarketDailyInbox:Enabled"]=writes.ToString(),["MarketDailyInbox:Mode"]=mode,
                ["ConnectionStrings:DefaultConnection"]=connection,["MarketData:BundlePath"]=bundle,["MarketDailyProbe:AllowLocalHttp"]="true"
            });
            MarketDailyProbe.Register(b.Services);var ready=MarketDailyMcp.Register(b.Services,b.Configuration);
            if(ready)b.Services.PostConfigure<JwtBearerOptions>(MarketDailyMcp.Scheme,o=>{
                o.Configuration=new OpenIdConnectConfiguration{Issuer=issuer};o.Configuration.SigningKeys.Add(key);
                o.ConfigurationManager=new StaticConfigurationManager<OpenIdConnectConfiguration>(o.Configuration);o.RefreshOnIssuerKeyNotFound=false;
            });
            var app=b.Build();app.UseRouting();app.UseRateLimiter();MarketDailyMcp.Map(app,ready);await app.StartAsync();
            var url=app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
            return(app,new HttpClient{BaseAddress=new Uri(url),Timeout=TimeSpan.FromSeconds(30)});
        }
        async Task<HttpResponseMessage> Rpc(HttpClient h,string method,object? parameters,string? token,int id=1)
        {
            using var request=new HttpRequestMessage(HttpMethod.Post,MarketDailyMcp.Path){Content=new StringContent(JsonSerializer.Serialize(new{jsonrpc="2.0",id,method,@params=parameters}),Encoding.UTF8,"application/json")};
            request.Headers.Accept.ParseAdd("application/json, text/event-stream");request.Headers.Add("MCP-Protocol-Version","2025-11-25");
            if(token is not null)request.Headers.Authorization=new AuthenticationHeaderValue("Bearer",token);
            return await h.SendAsync(request,HttpCompletionOption.ResponseHeadersRead);
        }
        async Task<JsonElement> Json(HttpResponseMessage r)
        {
            if(r.Content.Headers.ContentType?.MediaType=="text/event-stream")
            {
                using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(30));
                using var reader=new StreamReader(await r.Content.ReadAsStreamAsync(timeout.Token));
                while(await reader.ReadLineAsync(timeout.Token) is { } line)
                    if(line.StartsWith("data: ")){using var value=JsonDocument.Parse(line[6..]);return value.RootElement.Clone();}
                throw new Exception("MCP event stream had no response");
            }
            using var doc=JsonDocument.Parse(await r.Content.ReadAsStringAsync());return doc.RootElement.Clone();
        }
        async Task<JsonElement> Call(HttpClient h,string name,object args,string token)
        {using var r=await Rpc(h,"tools/call",new{name,arguments=args},token);Check(r.IsSuccessStatusCode,"MCP call transport");return(await Json(r)).GetProperty("result").Clone();}
        var submit=new{dailyJson=daily,completionAuditJson=audit+"\n\n\n\n\n\n\n\n\n\n"};
        var (disabled,d)=await Start(false);
        try
        {
            using var list=await Rpc(d,"tools/list",null,Token(MarketDailyMcp.Scope));
            Check((await Json(list)).GetProperty("result").GetProperty("tools").GetArrayLength()==1,"Default config exposes no write tool");
            using var forbidden=await Rpc(d,"tools/list",null,Token(MarketDailyMcp.IngestScope));Check(forbidden.StatusCode==HttpStatusCode.Forbidden,"Write token cannot activate disabled endpoint");
            using var unknown=await Rpc(d,"tools/call",new{name="submit_market_daily",arguments=submit},Token(MarketDailyMcp.Scope));
            var result=await Json(unknown);Check(result.TryGetProperty("error",out _)||result.GetProperty("result").GetProperty("isError").GetBoolean(),"Hidden write cannot be invoked by name");
        }
        finally{d.Dispose();await disabled.StopAsync();await disabled.DisposeAsync();}
        foreach(var mode in new string?[]{null,"production"})
        {var (app,h)=await Start(true,mode);try{using var r=await Rpc(h,"tools/list",null,Token("market.validate market.ingest"));Check(r.StatusCode==HttpStatusCode.ServiceUnavailable,"Invalid write mode fails closed");}finally{h.Dispose();await app.StopAsync();await app.DisposeAsync();}}
        var (enabled,http)=await Start(true);
        try
        {
            using var noAuth=await Rpc(http,"tools/list",null,null);Check(noAuth.StatusCode==HttpStatusCode.Unauthorized,"No anonymous SQL writes");
            using var metadata=await http.GetAsync(MarketDailyMcp.MetadataPath);var meta=await Json(metadata);
            Check(meta.GetProperty("scopes_supported").EnumerateArray().Any(s=>s.GetString()==MarketDailyMcp.IngestScope),"Write scope advertised only when enabled");
            using var list=await Rpc(http,"tools/list",null,Token(MarketDailyMcp.Scope));var tools=(await Json(list)).GetProperty("result").GetProperty("tools");
            Check(tools.GetArrayLength()==2,"Read and write tools are separate");
            var tool=tools.EnumerateArray().Single(t=>t.GetProperty("name").GetString()=="submit_market_daily");
            Check(!tool.GetProperty("annotations").GetProperty("readOnlyHint").GetBoolean()&&tool.GetProperty("annotations").GetProperty("idempotentHint").GetBoolean(),"Honest write annotations");
            Check(tool.GetProperty("_meta").GetProperty("securitySchemes")[0].GetProperty("scopes")[0].GetString()==MarketDailyMcp.IngestScope,"Per-tool write scope metadata");
            Check(tool.GetProperty("inputSchema").GetProperty("properties").EnumerateObject().Select(x=>x.Name).Order().SequenceEqual(new[]{"completionAuditJson","dailyJson"}),"No credential/path/config/context tool arguments");
            foreach(var token in new[]{Token(MarketDailyMcp.IngestScope,subject:"auth0|wrong"),Token(MarketDailyMcp.IngestScope,azp:"wrong"),Token("other")})
            {using var r=await Rpc(http,"tools/call",new{name="submit_market_daily",arguments=submit},token);Check(r.StatusCode==HttpStatusCode.Forbidden,"Owner/client/scope write isolation");}
            using(var r=await Rpc(http,"tools/call",new{name="submit_market_daily",arguments=submit},Token(MarketDailyMcp.IngestScope,expired:true)))Check(r.StatusCode==HttpStatusCode.Unauthorized,"Expired write token rejected");
            var denied=await Call(http,"submit_market_daily",submit,Token(MarketDailyMcp.Scope));
            Check(denied.GetProperty("isError").GetBoolean()&&denied.GetProperty("_meta").GetProperty("mcp/www_authenticate")[0].GetString()!.Contains("market.ingest"),"Read token gets reauthorization challenge, no SQL write");
            var readDenied=await Call(http,"validate_market_daily",new{dailyJson=daily},Token(MarketDailyMcp.IngestScope));
            Check(readDenied.GetProperty("isError").GetBoolean(),"Write scope does not imply validation scope");
            Check(await Count()==initialCount,"All denied calls leave SQL unchanged");
            var malformed=await Call(http,"submit_market_daily",new{dailyJson="{",completionAuditJson=audit},Token(MarketDailyMcp.IngestScope));Check(malformed.GetProperty("isError").GetBoolean(),"Invalid JSON rejected");
            var missing=await Call(http,"submit_market_daily",new{dailyJson=daily,completionAuditJson="{}"},Token(MarketDailyMcp.IngestScope));Check(missing.GetProperty("isError").GetBoolean(),"Incomplete audit rejected");
            var partial=JsonNode.Parse(daily)!;partial["bars"]!.AsArray().RemoveAt(0);
            Check((await Call(http,"submit_market_daily",new{dailyJson=partial.ToJsonString(),completionAuditJson=audit},Token(MarketDailyMcp.IngestScope))).GetProperty("isError").GetBoolean(),"Incomplete batch rejected before SQL");
            Check((await Call(http,"submit_market_daily",new{dailyJson=daily,completionAuditJson=new string(' ',262145)},Token(MarketDailyMcp.IngestScope))).GetProperty("isError").GetBoolean(),"Audit size cap");
            Check(await Count()==initialCount,"Malformed calls leave no partial SQL rows");
            var accepted=await Call(http,"submit_market_daily",submit,Token(MarketDailyMcp.IngestScope));
            Check(!accepted.GetProperty("isError").GetBoolean(),"Real scoped MCP submission succeeds");
            var receipt=accepted.GetProperty("structuredContent");
            Check(receipt.GetProperty("persisted").GetBoolean()&&!receipt.GetProperty("historyAccepted").GetBoolean()&&!receipt.GetProperty("analyticsTriggered").GetBoolean()&&!receipt.GetProperty("completionValidated").GetBoolean()&&receipt.GetProperty("status").GetString()=="PendingValidation","Receipt truthfully describes SQL quarantine only");
            var again=(await Call(http,"submit_market_daily",submit,Token("market.validate market.ingest"))).GetProperty("structuredContent");
            Check(again.GetProperty("duplicate").GetBoolean()&&again.GetProperty("receiptId").GetString()==receipt.GetProperty("receiptId").GetString()&&await Count()==initialCount+1,"MCP retry is idempotent in actual SQL");
            using var oversized=await Rpc(http,"tools/call",new{name="submit_market_daily",pad=new string(' ',1048577)},Token(MarketDailyMcp.IngestScope));Check(oversized.StatusCode==HttpStatusCode.RequestEntityTooLarge,"Enabled transport remains bounded");
        }
        finally{http.Dispose();await enabled.StopAsync();await enabled.DisposeAsync();}
        Console.WriteLine("PASS: real scoped MCP -> SQL quarantine, disabled/fail-closed writes, separate scopes, metadata/challenge, owner/client/expiry isolation, malformed/partial/size rejection, exact idempotent receipt; no worker/publication automatically triggered.");
    }
}
