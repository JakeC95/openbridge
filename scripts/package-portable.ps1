# Builds the portable Windows app.
#
# Why this exists: electron-builder rewrites electron.exe (icon/version resources),
# which invalidates its Authenticode/reputation hash. On machines with Windows
# Smart App Control / WDAC, the rewritten exe is blocked while the untouched
# Electron binary is allowed. This script keeps the Electron binary byte-for-byte
# intact, copies it to OpenBridge.exe, and points it at resources/app.
param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path $ProjectRoot).Path
$dist = Join-Path $root "dist"
$package = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$version = $package.version
$name = "OpenBridge-$version-win-x64-portable"
$target = Join-Path $dist $name
$electron = Join-Path $root "node_modules\electron\dist"

if (!(Test-Path -LiteralPath $electron)) {
  throw "Electron runtime not found at $electron. Run npm install and node node_modules/electron/install.js."
}
if (!(Test-Path -LiteralPath (Join-Path $root "out\main\index.js"))) {
  throw "Build output not found. Run npm run build first."
}

New-Item -ItemType Directory -Path $dist -Force | Out-Null
if (Test-Path -LiteralPath $target) {
  Remove-Item -LiteralPath $target -Recurse -Force
}
New-Item -ItemType Directory -Path $target -Force | Out-Null

Write-Host "Copying Electron runtime (unmodified)..."
Copy-Item -Path (Join-Path $electron "*") -Destination $target -Recurse -Force

Write-Host "Assembling resources/app..."
$app = Join-Path $target "resources\app"
New-Item -ItemType Directory -Path $app -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root "out") -Destination (Join-Path $app "out") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $root "package.json") -Destination (Join-Path $app "package.json") -Force
Copy-Item -LiteralPath (Join-Path $root "LICENSE") -Destination (Join-Path $target "LICENSE") -Force

# Keep the exe bytes identical to electron.exe. Only the file name changes.
Copy-Item -LiteralPath (Join-Path $target "electron.exe") -Destination (Join-Path $target "OpenBridge.exe") -Force
Remove-Item -LiteralPath (Join-Path $target "electron.exe") -Force

$readme = @"
OpenBridge $version (portable, Windows x64)

Run OpenBridge.exe.

Settings, the Epic session and the library cache are stored in:
  %APPDATA%\openbridge

The portable build keeps Electron's original executable bytes so it is accepted
by Windows Smart App Control / WDAC. The application code lives in
resources\app. See README.md and docs\ in the source repository.

This build uses the legacy Quixel service configuration from the build machine.
Public releases should provide their own Epic OAuth client ID and Algolia keys.
"@
Set-Content -LiteralPath (Join-Path $target "README.txt") -Value $readme -Encoding UTF8

$zip = Join-Path $dist "$name.zip"
if (Test-Path -LiteralPath $zip) {
  Remove-Item -LiteralPath $zip -Force
}

Write-Host "Creating $zip ..."
if (Get-Command tar.exe -ErrorAction SilentlyContinue) {
  tar.exe -a -c -f $zip -C $dist $name
  if ($LASTEXITCODE -ne 0) { throw "tar failed to create $zip" }
} else {
  Compress-Archive -Path (Join-Path $target "*") -DestinationPath $zip -CompressionLevel Optimal
}

Write-Host "Portable build: $target"
Write-Host "Portable zip:   $zip"
