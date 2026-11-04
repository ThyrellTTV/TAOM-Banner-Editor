param([string]$OutputDirectory = (Join-Path $PSScriptRoot 'dist'))
$ErrorActionPreference = 'Stop'
$studioRoot = $PSScriptRoot
$destination = [IO.Path]::GetFullPath($OutputDirectory)
$version = (Get-Content -LiteralPath (Join-Path $studioRoot 'package.json') -Raw | ConvertFrom-Json).version
$name = "TAOM-Banner-Studio-$version-win-x64-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$stage = Join-Path $destination $name
if (Test-Path -LiteralPath $stage) { throw "Package folder already exists: $stage" }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

# Copy only application sources. Local settings, game assets and working data
# never enter the package, even when they live beside the source checkout.
$files = @('server.mjs','configuration.mjs','profiles.mjs','atlas-manager.mjs','asset-validation.mjs','library.mjs','source-store.mjs','prepare-assets.mjs',
  'atlas-builder.mjs','atlas-registration.mjs','build-atlas.mjs','regenerate-atlases.mjs','resource-compiler.mjs','texture-encoding.mjs','game-deployment.mjs','compile-game-resources.mjs',
  'package.json','package-lock.json','config.example.json','README.md','Start-Banner-Editor.cmd','Start-in-browser.ps1')
foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $studioRoot $file) -Destination $stage }
Copy-Item -LiteralPath (Join-Path $studioRoot 'public') -Destination $stage -Recurse
New-Item -ItemType Directory -Path (Join-Path $stage 'licenses') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $studioRoot 'third_party/TpacTool/LICENSE') -Destination (Join-Path $stage 'licenses/TpacTool-LICENSE')

dotnet publish (Join-Path $studioRoot 'desktop-shell/BannerStudio.csproj') -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:DebugType=None -o (Join-Path $stage 'app') --nologo -v quiet
if ($LASTEXITCODE -ne 0) { throw 'Desktop app publication failed.' }
dotnet publish (Join-Path $studioRoot 'extractor/Extractor.csproj') -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:DebugType=None -o (Join-Path $stage 'tools/extractor') --nologo -v quiet
if ($LASTEXITCODE -ne 0) { throw 'Extractor publication failed.' }
dotnet build (Join-Path $studioRoot 'sprite-packer/SpritePacker.csproj') -c Release -o (Join-Path $stage 'tools/sprite-packer') --nologo -v quiet
if ($LASTEXITCODE -ne 0) { throw 'Sprite packer build failed.' }
dotnet publish (Join-Path $studioRoot 'texture-encoder/TextureEncoder.csproj') -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:DebugType=None -o (Join-Path $stage 'tools/texture-encoder') --nologo -v quiet
if ($LASTEXITCODE -ne 0) { throw 'Texture encoder publication failed.' }
$nugetRoot = ((& dotnet nuget locals global-packages --list --force-english-output) -replace '^[^:]+:\s*','').Trim()
$packages = @{}
foreach ($project in @('desktop-shell','extractor','texture-encoder')) {
    $assets = Get-Content -LiteralPath (Join-Path $studioRoot "$project/obj/project.assets.json") -Raw | ConvertFrom-Json
    foreach ($library in $assets.libraries.psobject.Properties) {
        if ($library.Value.type -eq 'package') { $packages[$library.Name.ToLowerInvariant()] = $true }
    }
}
foreach ($runtime in @('microsoft.netcore.app.runtime.win-x64','microsoft.windowsdesktop.app.runtime.win-x64')) {
    $versionFolder = Get-ChildItem -LiteralPath (Join-Path $nugetRoot $runtime) -Directory | Where-Object { $_.Name -match '^10\.\d+\.\d+$' } | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
    if ($versionFolder) { $packages["$runtime/$($versionFolder.Name)"] = $true }
}
foreach ($package in $packages.Keys) {
    $folder = Join-Path $nugetRoot $package
    if (Test-Path -LiteralPath $folder) {
        $licenseFolder = Join-Path $stage "licenses/nuget/$package"
        New-Item -ItemType Directory -Path $licenseFolder -Force | Out-Null
        Get-ChildItem -LiteralPath $folder -File | Where-Object { $_.Name -match '^(license|third.*notices|notice)' -or $_.Extension -eq '.nuspec' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $licenseFolder }
    }
}
Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/MiloszKrajewski/lz4net/master/LICENSE.md' -OutFile (Join-Path $stage 'licenses/lz4net-LICENSE.md')
Invoke-WebRequest -Uri 'https://licenses.nuget.org/Unlicense' -OutFile (Join-Path $stage 'licenses/BCnEncoder-Unlicense.html')
Invoke-WebRequest -Uri 'https://licenses.nuget.org/MIT' -OutFile (Join-Path $stage 'licenses/MIT.html')
Push-Location $stage
try {
    npm ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Production dependency installation failed.' }
} finally { Pop-Location }

$node = (Get-Command node -ErrorAction Stop).Source
$nodeVersion = & $node -p 'process.version'
if ([int](& $node -p 'process.versions.node.split(".")[0]') -lt 22) { throw 'Node.js 22+ is required for packaging.' }
New-Item -ItemType Directory -Path (Join-Path $stage 'runtime') -Force | Out-Null
Copy-Item -LiteralPath $node -Destination (Join-Path $stage 'runtime/node.exe')
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/nodejs/node/$nodeVersion/LICENSE" -OutFile (Join-Path $stage 'licenses/Node-LICENSE')
@"
TAOM Banner Studio $version - Windows x64

1. Extract the whole ZIP into a writable local folder.
2. Run Start-Banner-Editor.cmd.
3. Choose your module and Bannerlord game folders in Module settings.
4. Expand Files, asset folders and atlas naming for a different mod layout.

Node.js $nodeVersion and .NET are included. Microsoft Edge WebView2 Runtime
must be available (normally included with Windows). No developer SDK is needed.
Your Bannerlord installation and mod assets are required locally.
The first asset-cache build can take a few minutes.

Settings are saved locally in config.json after validation. This ZIP includes
no developer settings, mod artwork, game files, drafts, caches or backups.
Use the same clean ZIP to send the editor to someone else.

See README.md for editing, saving, atlas imports and supported mod formats.
"@ | Set-Content -LiteralPath (Join-Path $stage 'START-HERE.txt') -Encoding utf8
$zip = "$stage.zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage,$zip,[IO.Compression.CompressionLevel]::Optimal,$true)
Write-Output "PACKAGE=$zip"
Write-Output "FOLDER=$stage"
