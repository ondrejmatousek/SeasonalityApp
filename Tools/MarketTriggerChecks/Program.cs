using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using SeasonalityApp.Services;

// Generated ephemeral key + intercepted HTTP only. No GitHub, SQL, or production credentials.
using var rsa = RSA.Create(2048);
var values = new Dictionary<string, string?> {
    ["MarketDailyGitHubTrigger:Enabled"] = "true",
    ["MarketDailyGitHubTrigger:AppId"] = "12345",
    ["MarketDailyGitHubTrigger:InstallationId"] = "67890",
    ["MarketDailyGitHubTrigger:PrivateKeyPemBase64"] = Convert.ToBase64String(Encoding.UTF8.GetBytes(rsa.ExportRSAPrivateKeyPem()))
};
void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
byte[] Decode(string s) => Convert.FromBase64String(s.Replace('-', '+').Replace('_', '/') + new string('=', (4 - s.Length % 4) % 4));
async Task<(MarketDailyGitHubTrigger.Result Result,int Calls)> Run(Dictionary<string,string?> settings,
    string receipt="PendingValidation", HttpStatusCode dispatchStatus=HttpStatusCode.NoContent,
    HttpStatusCode tokenStatus=HttpStatusCode.Created, string tokenBody="{\"token\":\"ephemeral-test-token\"}", bool cancel=false)
{
    var count = 0;
    using var handler = new Intercept(async (request,ct) => {
        count++;
        Check(request.Method == HttpMethod.Post, "POST only");
        Check(request.Headers.GetValues("X-GitHub-Api-Version").Single()=="2026-03-10", "API version pinned");
        if(cancel)throw new OperationCanceledException();
        using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct));
        if(count==1){
            Check(request.RequestUri!.AbsoluteUri=="https://api.github.com/app/installations/67890/access_tokens", "Fixed token destination");
            var jwt=request.Headers.Authorization!.Parameter!.Split('.');
            using var header=JsonDocument.Parse(Decode(jwt[0]));
            using var claims=JsonDocument.Parse(Decode(jwt[1]));
            Check(header.RootElement.GetProperty("alg").GetString()=="RS256", "RS256 JWT");
            Check(rsa.VerifyData(Encoding.ASCII.GetBytes(jwt[0]+"."+jwt[1]),Decode(jwt[2]),HashAlgorithmName.SHA256,RSASignaturePadding.Pkcs1),"JWT signature");
            var c=claims.RootElement;var now=DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            Check(c.GetProperty("iss").GetString()=="12345" && c.GetProperty("iat").GetInt64()<=now && c.GetProperty("exp").GetInt64()<=now+301,"Short lived app JWT");
            Check(body.RootElement.GetProperty("repositories").EnumerateArray().Single().GetString()=="SeasonalityApp","Single repository token");
            Check(body.RootElement.GetProperty("permissions").EnumerateObject().Single().Name=="actions" && body.RootElement.GetProperty("permissions").GetProperty("actions").GetString()=="write","Actions-only token");
            return new HttpResponseMessage(tokenStatus){Content=new StringContent(tokenBody)};
        }
        Check(count==2 && request.RequestUri!.AbsoluteUri==MarketDailyGitHubTrigger.DispatchUrl,"Exactly one fixed workflow dispatch");
        Check(request.Headers.Authorization!.Parameter=="ephemeral-test-token","Installation token, not app JWT");
        Check(body.RootElement.GetProperty("ref").GetString()=="master","Fixed default branch");
        var inputs=body.RootElement.GetProperty("inputs");
        Check(inputs.GetProperty("sql_publish").GetBoolean() && !inputs.GetProperty("sql_inbox_shadow").GetBoolean() && inputs.EnumerateObject().Count()==2,"Existing fenced SQL publication path only");
        return new HttpResponseMessage(dispatchStatus);
    });
    using var client=new HttpClient(handler);
    var config=new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
    var result=await new MarketDailyGitHubTrigger(config,new Factory(client)).RequestAsync(receipt,CancellationToken.None);
    return (result,count);
}
foreach(var status in new[]{HttpStatusCode.OK,HttpStatusCode.NoContent}){
    var r=await Run(values,dispatchStatus:status);Check(r.Result.Requested&&r.Result.Status=="Requested"&&r.Calls==2,"Accepted dispatch is requested, not completed");
}
foreach(var status in new[]{"ShadowAccepted","Blocked","Processing"}){
    var r=await Run(values,status);Check(!r.Result.Requested&&r.Calls==0,"Nonpending receipts do not dispatch");
}
var disabled=new Dictionary<string,string?>(values){["MarketDailyGitHubTrigger:Enabled"]="false"};
Check((await Run(disabled)).Calls==0,"Disabled makes no requests");
foreach(var name in new[]{"AppId","InstallationId","PrivateKeyPemBase64"}){
    var bad=new Dictionary<string,string?>(values){["MarketDailyGitHubTrigger:"+name]="invalid/../"};
    var r=await Run(bad);Check(!r.Result.Requested&&r.Calls==0,"Invalid config fails closed without dispatch");
}
foreach(var status in new[]{HttpStatusCode.Forbidden,HttpStatusCode.TooManyRequests,HttpStatusCode.Redirect,HttpStatusCode.InternalServerError}){
    var r=await Run(values,dispatchStatus:status);Check(!r.Result.Requested&&r.Result.Status=="Unavailable","No false success on dispatch failure");
    r=await Run(values,tokenStatus:status);Check(!r.Result.Requested&&r.Calls==1,"No dispatch after failed token exchange");
}
Check(!(await Run(values,tokenBody:"bad json")).Result.Requested,"Malformed token reply");
Check(!(await Run(values,tokenBody:"{}")).Result.Requested,"Missing token reply");
Check(!(await Run(values,cancel:true)).Result.Requested,"Ambiguous cancellation never claims requested");
var source=File.ReadAllText("Services/MarketDailySubmissionTool.cs");
Check(source.IndexOf("await inbox.ReceiveAsync",StringComparison.Ordinal)<source.IndexOf("await trigger.RequestAsync",StringComparison.Ordinal),"SQL commit before trigger");
Check(source.Contains("workflowRequested=wakeup.Requested")&&source.Contains("receipt.AnalyticsTriggered"),"Receipt preserves distinct dispatch/analytics evidence");
Console.WriteLine("PASS: signed short-lived GitHub App JWT, least-privilege repository token, fixed workflow/branch, post-SQL dispatch, failure/cancellation/config handling; no external requests or SQL writes.");

sealed class Factory(HttpClient client):IHttpClientFactory { public HttpClient CreateClient(string name)=>client; }
sealed class Intercept(Func<HttpRequestMessage,CancellationToken,Task<HttpResponseMessage>> send):HttpMessageHandler {
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancellationToken)=>send(request,cancellationToken);
}
