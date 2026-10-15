using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace SeasonalityApp.Services;

// Wake-up only, AFTER durable SQL reception. SQL admission/fencing still own all publication decisions.
// No caller-controlled destination, branch, workflow, token scope, or dispatch inputs.
public sealed class MarketDailyGitHubTrigger(IConfiguration config, IHttpClientFactory clients)
{
    public const string ClientName = "MarketDailyGitHubTrigger";
    public const string DispatchUrl = "https://api.github.com/repos/ondrejmatousek/SeasonalityApp/actions/workflows/seasonality-update.yml/dispatches";
    public sealed record Result(string Status, bool Requested = false);

    public async Task<Result> RequestAsync(string receiptStatus, CancellationToken cancellationToken)
    {
        if (!config.GetValue<bool>("MarketDailyGitHubTrigger:Enabled")) return new("Disabled");
        // An identical retry can re-attempt the wake-up, but never reopen a blocked/accepted receipt.
        if (receiptStatus != "PendingValidation") return new("NotPending");
        try
        {
            var appId = config["MarketDailyGitHubTrigger:AppId"];
            var installationId = config["MarketDailyGitHubTrigger:InstallationId"];
            if (!PositiveId(appId) || !PositiveId(installationId)) return new("ConfigurationRequired");
            var pem = Encoding.UTF8.GetString(Convert.FromBase64String(config["MarketDailyGitHubTrigger:PrivateKeyPemBase64"] ?? ""));
            using var rsa = RSA.Create();
            rsa.ImportFromPem(pem);
            if (rsa.KeySize < 2048) return new("ConfigurationRequired");
            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var header = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new { alg = "RS256", typ = "JWT" }));
            var payload = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new { iat = now - 60, exp = now + 300, iss = appId }));
            var unsigned = header + "." + payload;
            var jwt = unsigned + "." + Base64Url(rsa.SignData(Encoding.ASCII.GetBytes(unsigned), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(8));
            var client = clients.CreateClient(ClientName);
            using var tokenRequest = Request($"https://api.github.com/app/installations/{installationId}/access_tokens", jwt,
                new { repositories = new[] { "SeasonalityApp" }, permissions = new { actions = "write" } });
            using var tokenResponse = await client.SendAsync(tokenRequest, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            if (tokenResponse.StatusCode != HttpStatusCode.Created) return new("Unavailable");
            await tokenResponse.Content.LoadIntoBufferAsync(65536, timeout.Token);
            using var tokenJson = JsonDocument.Parse(await tokenResponse.Content.ReadAsStringAsync(timeout.Token));
            var token = tokenJson.RootElement.GetProperty("token").GetString();
            if (string.IsNullOrWhiteSpace(token)) return new("Unavailable");
            using var dispatch = Request(DispatchUrl, token,
                new { @ref = "master", inputs = new { sql_publish = true, sql_inbox_shadow = false } });
            using var response = await client.SendAsync(dispatch, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            // Accepted dispatch is NOT a completed run, SQL history acceptance, or successful deployment.
            return response.StatusCode is HttpStatusCode.OK or HttpStatusCode.NoContent
                ? new("Requested", true) : new("Unavailable");
        }
        catch (Exception e) when (e is HttpRequestException or OperationCanceledException or JsonException
            or CryptographicException or ArgumentException or FormatException or InvalidOperationException or KeyNotFoundException)
        {
            // SQL is already committed. Do not lose/deny the receipt or leak tokens, PEMs, or HTTP bodies.
            // An ambiguous timeout may have dispatched; existing SQL leases/fences make duplicate runs safe.
            return new("Unavailable");
        }
    }

    private static bool PositiveId(string? value) => value is { Length: > 0 and <= 19 }
        && value.All(char.IsAsciiDigit) && long.TryParse(value, out var id) && id > 0;
    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static HttpRequestMessage Request(string url, string token, object body)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.UserAgent.ParseAdd("Seasonality-SQL-Trigger/1.0");
        request.Headers.Accept.ParseAdd("application/vnd.github+json");
        request.Headers.Add("X-GitHub-Api-Version", "2026-03-10");
        request.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        return request;
    }
}
