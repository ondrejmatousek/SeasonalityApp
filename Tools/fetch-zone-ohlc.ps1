# Shared OHLC evidence for Obchodni zony; no retired confluence calculation.
param([Parameter(Mandatory=$true)][string]$OutputDir)
$ErrorActionPreference='Stop'
$htfRoot=[System.IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Path $htfRoot -Force | Out-Null
$htfSources = node -e "const r=require('./wwwroot/js/core-market-registry.js');console.log(JSON.stringify([...new Map(Object.values(r.entries).filter(m=>m.scope==='core'&&m.priceKind==='etf').map(m=>[m.priceKey,{key:m.priceKey,...m.chartSource}])).values()]));" | ConvertFrom-Json
foreach ($htfSource in $htfSources) {
    $htfUri='https://query1.finance.yahoo.com/v8/finance/chart/'+[Uri]::EscapeDataString($htfSource.symbol)+'?range=5y&interval=1d&events=splits'
    $htfEnvelope=@{key=$htfSource.key;symbol=$htfSource.symbol;provider=$htfSource.provider;url=$htfUri;observedAt=[DateTimeOffset]::UtcNow.ToString('o')}
    try {
        $htfResponse=Invoke-RestMethod -Uri $htfUri -Headers @{'User-Agent'='Mozilla/5.0 SeasonalityApp HTF research'} -TimeoutSec 30
        if (!$htfResponse.chart.result) { throw 'Provider returned no chart' }
        $htfEnvelope.payload=$htfResponse
    } catch { $htfEnvelope.error=$_.Exception.Message; Write-Warning ('OHLC unavailable: '+$htfSource.key) }
    $htfEnvelope | ConvertTo-Json -Depth 30 -Compress | Set-Content -LiteralPath (Join-Path $htfRoot ($htfSource.key+'.json')) -Encoding utf8
}
