$ErrorActionPreference = 'Stop'
$studioRoot = $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $studioRoot 'config.json') -Raw | ConvertFrom-Json
$url = "http://127.0.0.1:$($config.port)"
$ready = $false
try { $ready = (Invoke-RestMethod "$url/api/health" -TimeoutSec 2).app -eq 'taom-banner-editor' } catch {}
if (-not $ready) {
    $node = (Get-Command node -ErrorAction Stop).Source
    Start-Process -FilePath $node -ArgumentList 'server.mjs' -WorkingDirectory $studioRoot -WindowStyle Hidden
    for ($i=0; $i -lt 120; $i++) {
        try { $ready = (Invoke-RestMethod "$url/api/health" -TimeoutSec 2).app -eq 'taom-banner-editor' } catch {}
        if ($ready) { break }
        Start-Sleep -Milliseconds 500
    }
}
if (-not $ready) { throw 'The local editor did not start.' }
Start-Process $url
