param(
    [Parameter(Mandatory=$true)][string[]]$ReceiptIds,
    [string]$NodeExecutable = 'node'
)
$ErrorActionPreference = 'Stop'
# Read-only SQL evidence replay into a fresh private directory. No receive/requeue,
# history commit, market-state write, analytics, provider call or publication.
if (!$ReceiptIds.Count -or @($ReceiptIds | Where-Object { $_ -cnotmatch '^[a-f0-9]{64}$' }).Count) { throw 'Exact receipt IDs required' }
$builder = [System.Data.SqlClient.SqlConnectionStringBuilder]::new($env:ConnectionStrings__DefaultConnection)
if ($builder.get_InitialCatalog() -ne 'seasonality-free-20261022') { throw 'Unexpected SQL target' }
$builder.set_ApplicationIntent([System.Data.SqlClient.ApplicationIntent]::ReadOnly)
$db = [System.Data.SqlClient.SqlConnection]::new($builder.get_ConnectionString())
$replayRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('seasonality-d1-replay-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $replayRoot | Out-Null
$previousState = $null
try {
    $db.Open()
    foreach ($receipt in $ReceiptIds) {
        $cmd = $db.CreateCommand()
        $cmd.CommandText = 'SELECT DailyUtf8,AuditUtf8,PayloadSha256,AuditSha256,ReceivedAt FROM market_daily.Inbox WHERE ReceiptId=@id'
        $cmd.Parameters.Add('@id',[System.Data.SqlDbType]::Char,64).Value = $receipt
        $reader = $cmd.ExecuteReader()
        try {
            if (!$reader.Read()) { throw 'Receipt not found' }
            $dailyBytes = [byte[]]$reader[0]; $auditBytes = [byte[]]$reader[1]
            $payloadHash = [string]$reader[2]; $auditHash = [string]$reader[3]
            $receivedAt = $reader.GetFieldValue[DateTimeOffset](4)
        } finally { $reader.Dispose(); $cmd.Dispose() }
        function Digest([byte[]]$bytes) { [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant() }
        if ((Digest $dailyBytes) -ne $payloadHash -or (Digest $auditBytes) -ne $auditHash -or (Digest ([Convert]::FromHexString($payloadHash+$auditHash))) -ne $receipt) { throw 'Stored evidence hashes do not match' }
        $daily = [System.Text.Encoding]::UTF8.GetString($dailyBytes) | ConvertFrom-Json
        $work = Join-Path $replayRoot $receipt
        New-Item -ItemType Directory -Path (Join-Path $work 'audit') | Out-Null
        [System.IO.File]::WriteAllBytes((Join-Path $work 'latest.json'),$dailyBytes)
        [System.IO.File]::WriteAllBytes((Join-Path $work ('audit/'+$daily.runDate+'.json')),$auditBytes)
        if ($null -ne $previousState) { [System.IO.File]::WriteAllText((Join-Path $work 'previous-state.json'),($previousState | ConvertTo-Json -Depth 10)) }
        $request = @{ work=$work; runDate=$daily.runDate; state=($null -ne $previousState); bootstrapState=(Join-Path (Get-Location).Path 'data/market-state'); receivedAt=$receivedAt.ToUnixTimeMilliseconds() }
        $requestPath = Join-Path $work 'request.json'
        [System.IO.File]::WriteAllText($requestPath,($request | ConvertTo-Json -Compress))
        & $NodeExecutable Tools/market-daily-sql-worker.cjs $requestPath
        if ($LASTEXITCODE -ne 0) { throw 'Isolated worker replay failed' }
        $result = Get-Content (Join-Path $work 'result.json') -Raw | ConvertFrom-Json
        $report = $result.report
        [pscustomobject]@{ receiptId=$receipt; accepted=$report.accepted; receivedBars=$report.receivedBars; inserted=$report.inserted; duplicates=$report.duplicates; failed=$report.failed; failures=@($report.instruments | Where-Object failed); productionChanged=$false; replayDirectory=$work } | ConvertTo-Json -Depth 6 -Compress
        if (!$report.accepted) { throw 'Original receipt does not pass repaired worker; no SQL state changed' }
        $previousState = $result.state
    }
} finally { $db.Dispose() }
