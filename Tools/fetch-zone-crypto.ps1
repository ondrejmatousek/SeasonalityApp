param([Parameter(Mandatory=$true)][string]$OutputDir)
$ErrorActionPreference='Stop'
$zoneCryptoRoot=[System.IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Path $zoneCryptoRoot -Force | Out-Null
$zoneCryptoSources=node -e "console.log(JSON.stringify(require('./wwwroot/js/cfd-instruments.js').crypto));" | ConvertFrom-Json
foreach($zoneCryptoProperty in $zoneCryptoSources.PSObject.Properties) {
    $zoneCryptoSymbol=$zoneCryptoProperty.Value
    $zoneCryptoUri='https://query1.finance.yahoo.com/v8/finance/chart/'+[Uri]::EscapeDataString($zoneCryptoSymbol)+'?range=5y&interval=1d'
    $zoneCryptoEnvelope=@{key=$zoneCryptoProperty.Name;symbol=$zoneCryptoSymbol;provider='Yahoo Finance';url=$zoneCryptoUri;observedAt=[DateTimeOffset]::UtcNow.ToString('o')}
    try {
        $zoneCryptoResponse=Invoke-RestMethod -Uri $zoneCryptoUri -Headers @{'User-Agent'='Mozilla/5.0 SeasonalityApp zone reference'} -TimeoutSec 30
        if(!$zoneCryptoResponse.chart.result){throw 'No Yahoo crypto OHLC returned'}
        $zoneCryptoEnvelope.payload=$zoneCryptoResponse
    } catch {$zoneCryptoEnvelope.error=$_.Exception.Message;Write-Warning ('Crypto OHLC unavailable: '+$zoneCryptoProperty.Name)}
    $zoneCryptoEnvelope | ConvertTo-Json -Depth 30 -Compress | Set-Content -LiteralPath (Join-Path $zoneCryptoRoot ($zoneCryptoProperty.Name+'.json')) -Encoding utf8
}
