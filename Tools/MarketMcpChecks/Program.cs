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
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Tokens;
using SeasonalityApp.Services;

// The test host loads the real MCP/validator, not SQL or a substitute database.
// Only this separate test executable pins a locally generated RSA signing key.
var repository = new DirectoryInfo(Directory.GetCurrentDirectory());
while (repository is not null && !File.Exists(Path.Combine(repository.FullName, "SeasonalityApp.csproj"))) repository = repository.Parent;
if (repository is null) throw new Exception("Run this check from the SeasonalityApp repository.");
Directory.SetCurrentDirectory(repository.FullName);
const string tenant = "10000000-0000-0000-0000-000000000001";
const string audience = "10000000-0000-0000-0000-000000000002";
const string owner = "10000000-0000-0000-0000-000000000003";
const string clientId = "10000000-0000-0000-0000-000000000004";
var issuer = $"https://login.microsoftonline.com/{tenant}/v2.0";
var bundle = Path.GetFullPath(Environment.GetEnvironmentVariable("MARKET_DAILY_PROBE_TEST_BUNDLE") ??
    "artifacts/tradingview-backfill-36-v1/analytics-sources-v1/manifest.json");
var input = File.ReadAllText("data/market-daily/latest.json");
var before = Snapshot();
using var rsa = RSA.Create(2048);
var key = new RsaSecurityKey(rsa) { KeyId = Guid.NewGuid().ToString() };
void Check(bool ok, string label) { if (!ok) throw new Exception(label); }
string Token(string scope = "market.validate", string aud = audience, string oid = owner,
    string azp = clientId, string? iss = null, bool expired = false, SecurityKey? signingKey = null)
{
    var jwt = new JwtSecurityToken(iss ?? issuer, aud,
        [new("tid", tenant), new("oid", oid), new("azp", azp), new("ver", "2.0"), new("scp", scope)],
        DateTime.UtcNow.AddHours(-1), expired ? DateTime.UtcNow.AddMinutes(-5) : DateTime.UtcNow.AddMinutes(5),
        new SigningCredentials(signingKey ?? key, SecurityAlgorithms.RsaSha256));
    return new JwtSecurityTokenHandler().WriteToken(jwt);
}
async Task<(WebApplication App, HttpClient Http)> Start(bool enabled, bool configured = true)
{
    var b = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Development" });
    b.Logging.ClearProviders(); b.WebHost.UseUrls("http://127.0.0.1:0");
    b.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
    {
        ["MarketDailyMcp:Enabled"] = enabled.ToString(), ["MarketDailyMcp:TenantId"] = configured ? tenant : null,
        ["MarketDailyMcp:Audience"] = audience, ["MarketDailyMcp:AllowedObjectId"] = owner,
        ["MarketDailyMcp:AllowedClientId"] = clientId, ["MarketData:BundlePath"] = bundle,
        ["MarketDailyProbe:AllowLocalHttp"] = "true"
    });
    MarketDailyProbe.Register(b.Services);
    var ready = MarketDailyMcp.Register(b.Services, b.Configuration);
    if (ready) b.Services.PostConfigure<JwtBearerOptions>(MarketDailyMcp.Scheme, options =>
    {
        options.Configuration = new OpenIdConnectConfiguration { Issuer = issuer };
        options.Configuration.SigningKeys.Add(key);
        options.ConfigurationManager = new StaticConfigurationManager<OpenIdConnectConfiguration>(options.Configuration);
        options.RefreshOnIssuerKeyNotFound = false;
    });
    var app = b.Build(); app.UseRouting(); app.UseRateLimiter(); MarketDailyMcp.Map(app, ready);
    await app.StartAsync();
    var url = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
    return (app, new HttpClient { BaseAddress = new Uri(url), Timeout = TimeSpan.FromSeconds(20) });
}
async Task<HttpResponseMessage> Rpc(HttpClient http, object rpc, string? token, string? origin = null)
{
    var request = new HttpRequestMessage(HttpMethod.Post, MarketDailyMcp.Path);
    request.Content = new StringContent(JsonSerializer.Serialize(rpc), Encoding.UTF8, "application/json");
    request.Headers.Accept.ParseAdd("application/json, text/event-stream");
    request.Headers.Add("MCP-Protocol-Version", "2025-11-25");
    if (token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
    if (origin is not null) request.Headers.Add("Origin", origin);
    return await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
}
async Task<JsonElement> Json(HttpResponseMessage r)
{
    var body = await r.Content.ReadAsStringAsync();
    if (r.Content.Headers.ContentType?.MediaType == "text/event-stream")
        body = string.Join("\n", body.Split('\n').Where(l => l.StartsWith("data: ")).Select(l => l[6..]));
    using var json = JsonDocument.Parse(body); return json.RootElement.Clone();
}
var init = new { jsonrpc = "2.0", id = 1, method = "initialize", @params = new
{ protocolVersion = "2025-11-25", capabilities = new { }, clientInfo = new { name = "isolated-regression", version = "1.0" } } };
foreach (var state in new[] { (false, true), (true, false) })
{
    var (app, http) = await Start(state.Item1, state.Item2);
    try { using var response = await Rpc(http, init, null); Check(response.StatusCode == HttpStatusCode.ServiceUnavailable, "Disabled/missing config fails closed"); }
    finally { http.Dispose(); await app.StopAsync(); await app.DisposeAsync(); }
}
var (host, h) = await Start(true);
try
{
    using var noAuth = await Rpc(h, init, null);
    Check(noAuth.StatusCode == HttpStatusCode.Unauthorized, "Unauthenticated MCP returns 401");
    Check(noAuth.Headers.WwwAuthenticate.ToString().Contains(MarketDailyMcp.MetadataPath), "OAuth metadata discovery challenge");
    using var metaResponse = await h.GetAsync(MarketDailyMcp.MetadataPath);
    var meta = await Json(metaResponse);
    Check(meta.GetProperty("resource").GetString() == MarketDailyMcp.Resource, "Canonical resource URL");
    Check(meta.GetProperty("authorization_servers")[0].GetString() == issuer, "Entra discovery issuer");
    foreach (var invalid in new[] { "shared-probe-token", Token(aud: "wrong"), Token(iss: "https://wrong.example"), Token(expired: true) })
    { using var r = await Rpc(h, init, invalid); Check(r.StatusCode == HttpStatusCode.Unauthorized, "Invalid token rejected"); }
    using var otherRsa = RSA.Create(2048);
    using (var r = await Rpc(h, init, Token(signingKey: new RsaSecurityKey(otherRsa)))) Check(r.StatusCode == HttpStatusCode.Unauthorized, "Invalid signature rejected");
    foreach (var forbidden in new[] { Token(scope: "other"), Token(oid: clientId), Token(azp: owner) })
    { using var r = await Rpc(h, init, forbidden); Check(r.StatusCode == HttpStatusCode.Forbidden, "Scope/owner/client isolation: " + (int)r.StatusCode); }
    var auth = Token();
    using (var r = await Rpc(h, init, auth, "https://untrusted.example")) Check(r.StatusCode == HttpStatusCode.Forbidden, "Browser Origin rejected");
    using (var r = await Rpc(h, init, auth)) Check(r.IsSuccessStatusCode && (await Json(r)).TryGetProperty("result", out _), "Real SDK initialize");
    using (var r = await Rpc(h, new { jsonrpc = "2.0", id = 2, method = "tools/list" }, auth))
    {
        var tools = (await Json(r)).GetProperty("result").GetProperty("tools");
        Check(tools.GetArrayLength() == 1 && tools[0].GetProperty("name").GetString() == "validate_market_daily", "Exactly one validation tool; no writes exposed");
    }
    // Test fixture changes envelope time only, not any provider bar or stored source file.
    var payload = JsonNode.Parse(input)!; payload["fetchedAt"] = DateTimeOffset.UtcNow.ToString("O");
    var daily = payload.ToJsonString();
    async Task<JsonElement> Call(string text)
    {
        using var r = await Rpc(h, new { jsonrpc = "2.0", id = 3, method = "tools/call", @params = new
        { name = "validate_market_daily", arguments = new { dailyJson = text } } }, auth);
        Check(r.IsSuccessStatusCode, "MCP transport success"); return (await Json(r)).GetProperty("result").Clone();
    }
    var result = await Call(daily);
    using var receiptDoc = JsonDocument.Parse(result.GetProperty("content")[0].GetProperty("text").GetString()!);
    var receipt = receiptDoc.RootElement;
    Check(receipt.GetProperty("receivedBars").GetInt32() == 39 && !receipt.GetProperty("persisted").GetBoolean() &&
        !receipt.GetProperty("analyticsTriggered").GetBoolean() && !receipt.GetProperty("completionValidated").GetBoolean(), "39 bars validated without ingestion or jobs");
    Check(receipt.GetProperty("payloadSha256").GetString() == Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(daily))).ToLowerInvariant(), "Exact byte checksum");
    Check((await Call("{")).GetProperty("isError").GetBoolean(), "Malformed payload rejected");
    payload["bars"]![0]!["provider"] = "Yahoo";
    Check((await Call(payload.ToJsonString())).GetProperty("isError").GetBoolean(), "Provider splice rejected");
    payload = JsonNode.Parse(daily)!; payload["bars"]![0]!["close"] = 999999;
    Check((await Call(payload.ToJsonString())).GetProperty("isError").GetBoolean(), "Bad OHLC rejected");
    payload = JsonNode.Parse(daily)!; payload["fetchedAt"] = DateTimeOffset.UtcNow.AddDays(-2).ToString("O");
    Check((await Call(payload.ToJsonString())).GetProperty("isError").GetBoolean(), "Stale input rejected");
    payload = JsonNode.Parse(daily)!; payload["bars"]!.AsArray().RemoveAt(0);
    Check((await Call(payload.ToJsonString())).GetProperty("isError").GetBoolean(), "Incomplete 39-symbol collection rejected");
    Check((await Call(new string(' ', 262145))).GetProperty("isError").GetBoolean(), "Tool argument size cap");
    using var oversized = await Rpc(h, new { jsonrpc = "2.0", id = 4, method = "tools/call", pad = new string(' ', 524289) }, auth);
    Check(oversized.StatusCode == HttpStatusCode.RequestEntityTooLarge, "Transport size cap");
    var limited = false;
    for (var i = 0; i < 31; i++) { using var r = await Rpc(h, init, null); if ((int)r.StatusCode == 429) { limited = true; break; } }
    Check(limited, "Rate limiting");
    Check(Snapshot() == before, "No stored market data changed");
    Console.WriteLine("PASS: real stateless MCP initialize/list/call, 39-bar validation, JWT signature/issuer/audience/expiry/scope/owner/client checks, fail-closed config, limits, no SQL/files/jobs writes. OAuth interactive login NOT tested.");
}
finally { h.Dispose(); await host.StopAsync(); await host.DisposeAsync(); }

static string Snapshot() => string.Join("\n", new[] { "data/market-state", "data/commodity-research/validated" }
    .SelectMany(d => Directory.GetFiles(d, "*.json")).Order().Select(p => p + ":" + Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p)))));
