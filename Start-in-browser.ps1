$ErrorActionPreference = 'Stop'
$studioRoot = $PSScriptRoot
$configFile = if ($env:BANNER_STUDIO_CONFIG) { $env:BANNER_STUDIO_CONFIG } else { Join-Path $studioRoot 'config.json' }
$config = @{ port = 4318 }
if (Test-Path -LiteralPath $configFile) { try { $saved = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json; if ($saved.port) { $config.port = $saved.port } } catch { } }
if ($env:BANNER_STUDIO_PORT) { $config.port = $env:BANNER_STUDIO_PORT } elseif ($env:TAOM_EDITOR_PORT) { $config.port = $env:TAOM_EDITOR_PORT }
$url = "http://127.0.0.1:$($config.port)"
$ready = $false
try { $ready = (Invoke-RestMethod "$url/api/health" -TimeoutSec 2).app -eq 'taom-banner-editor' } catch {}
if (-not $ready) {
    $node = Join-Path $studioRoot 'runtime/node.exe'
    if (-not (Test-Path -LiteralPath $node)) { $node = (Get-Command node -ErrorAction Stop).Source }
    Start-Process -FilePath $node -ArgumentList 'server.mjs' -WorkingDirectory $studioRoot -WindowStyle Hidden
    for ($i=0; $i -lt 120; $i++) {
        try { $ready = (Invoke-RestMethod "$url/api/health" -TimeoutSec 2).app -eq 'taom-banner-editor' } catch {}
        if ($ready) { break }
        Start-Sleep -Milliseconds 500
    }
}
if (-not $ready) { throw 'The local editor did not start.' }
Start-Process $url
