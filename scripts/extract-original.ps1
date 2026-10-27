# Rebuilds the analysis/ tree from an installed Quixel Bridge (Windows).
# Usage: powershell -ExecutionPolicy Bypass -File scripts\extract-original.ps1
param(
  [string]$BridgeDir = "C:\Program Files\Bridge",
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
$asar = Join-Path $BridgeDir "resources\app.asar"
if (!(Test-Path -LiteralPath $asar)) {
  throw "app.asar not found at $asar. Install Bridge or pass -BridgeDir."
}

$tools = Join-Path $ProjectRoot "tools"
$nodeDir = Get-ChildItem $tools -Directory -Filter "node-v*-win-x64" | Select-Object -First 1
if (!$nodeDir) {
  throw "Portable Node.js not found under $tools. See docs/BUILD.md."
}
$node = Join-Path $nodeDir.FullName "node.exe"
$npx = Join-Path $nodeDir.FullName "npx.cmd"
$jq = Join-Path $tools "jq.exe"
$analysis = Join-Path $ProjectRoot "analysis"
$extract = Join-Path $analysis "asar"

New-Item -ItemType Directory -Path $analysis -Force | Out-Null
if (Test-Path -LiteralPath $extract) {
  Write-Host "Removing previous extraction..."
  Remove-Item -LiteralPath $extract -Recurse -Force
}

Write-Host "Extracting app.asar..."
$env:Path = "$($nodeDir.FullName);$env:Path"
& $npx --yes @electron/asar extract $asar $extract
if ($LASTEXITCODE -ne 0) { throw "asar extraction failed" }

Write-Host "Recovering renderer sourcesContent..."
python (Join-Path $analysis "tools\dump_map.py") `
  (Join-Path $extract "app\dist\renderer.prod.js.map") `
  (Join-Path $analysis "renderer-src")

Write-Host "Prettifying main process bundle..."
& $npx prettier --parser babel (Join-Path $extract "app\main.prod.js") > (Join-Path $analysis "main.pretty.js")

Write-Host "Version metadata:"
& $jq '{name, version, productName, main}' (Join-Path $extract "package.json")

Write-Host "Done. Extracted tree: $extract"
