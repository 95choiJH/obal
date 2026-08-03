param(
  [string]$OutputPath = "netlify-admin"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = if ([System.IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $root $OutputPath }
$version = "0.0.0"
$manifestPath = Join-Path $root "manifest.json"
if (Test-Path -LiteralPath $manifestPath) {
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $version = $manifest.version
}

$allowedFiles = @(
  "index.html",
  "app.js",
  "config.js",
  "vendor\supabase-2.45.4.min.js"
)

if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Recurse -Force }
New-Item -ItemType Directory -Path $out | Out-Null
New-Item -ItemType Directory -Path (Join-Path $out "vendor") | Out-Null

foreach ($relative in $allowedFiles) {
  $source = Join-Path (Join-Path $root "admin") $relative
  if (-not (Test-Path -LiteralPath $source)) { throw "Missing admin deploy file: $relative" }
  $target = Join-Path $out $relative
  $targetDir = Split-Path -Parent $target
  if (-not (Test-Path -LiteralPath $targetDir)) { New-Item -ItemType Directory -Path $targetDir | Out-Null }
  Copy-Item -LiteralPath $source -Destination $target -Force
}

$headers = @(
  "/*",
  "  X-Frame-Options: DENY",
  "  X-Content-Type-Options: nosniff",
  "  Referrer-Policy: no-referrer",
  "  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()",
  "  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https://ggebdrlvzrgoyumlrnxe.supabase.co wss://ggebdrlvzrgoyumlrnxe.supabase.co; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
)
[System.IO.File]::WriteAllText((Join-Path $out "_headers"), ($headers -join "`n") + "`n", [System.Text.UTF8Encoding]::new($false))

$deployInfo = [ordered]@{
  name = "obaengal-admin"
  source = "admin"
  version = $version
  generatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  files = @($allowedFiles | ForEach-Object { $_.Replace("\", "/") })
}
$deployInfo | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $out "deploy-info.json") -Encoding UTF8

Write-Host "Admin deploy folder created: $out"
