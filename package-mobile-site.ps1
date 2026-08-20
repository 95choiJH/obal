param(
  [string]$OutputPath = "netlify-mobile"
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

$mobileFiles = @(
  "index.html",
  "app.js",
  "styles.css",
  "config.js",
  "manifest.webmanifest",
  "service-worker.js"
)

if (Test-Path -LiteralPath $out) {
  Remove-Item -LiteralPath $out -Recurse -Force
}

$mobileOut = Join-Path $out "mobile"
$iconsOut = Join-Path $out "icons"
New-Item -ItemType Directory -Path $mobileOut -Force | Out-Null
New-Item -ItemType Directory -Path $iconsOut -Force | Out-Null

foreach ($relative in $mobileFiles) {
  $source = Join-Path (Join-Path $root "mobile") $relative
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Missing mobile deploy file: $relative"
  }
  Copy-Item -LiteralPath $source -Destination (Join-Path $mobileOut $relative) -Force
}

$iconsRoot = Join-Path $root "icons"
if (-not (Test-Path -LiteralPath $iconsRoot)) {
  throw "Missing icons directory"
}
Get-ChildItem -LiteralPath $iconsRoot -File | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $iconsOut $_.Name) -Force
}

$headers = @(
  "/*",
  "  X-Frame-Options: DENY",
  "  X-Content-Type-Options: nosniff",
  "  Referrer-Policy: no-referrer",
  "  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()",
  "  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self' https://ggebdrlvzrgoyumlrnxe.supabase.co wss://ggebdrlvzrgoyumlrnxe.supabase.co; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
)
[System.IO.File]::WriteAllText((Join-Path $out "_headers"), ($headers -join "`n") + "`n", [System.Text.UTF8Encoding]::new($false))

$redirects = @(
  "/ /mobile/ 302",
  "/mobile/* /mobile/:splat 200"
)
[System.IO.File]::WriteAllText((Join-Path $out "_redirects"), ($redirects -join "`n") + "`n", [System.Text.UTF8Encoding]::new($false))

$deployInfo = [ordered]@{
  name = "obaengal-mobile"
  source = "mobile"
  version = $version
  generatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  files = @($mobileFiles | ForEach-Object { "mobile/$_" }) + @(Get-ChildItem -LiteralPath $iconsRoot -File | ForEach-Object { "icons/$($_.Name)" })
}
[System.IO.File]::WriteAllText((Join-Path $out "deploy-info.json"), ($deployInfo | ConvertTo-Json -Depth 5) + "`n", [System.Text.UTF8Encoding]::new($false))

Write-Host "Mobile deploy folder created: $out"
Write-Host "Publish directory: $out"
Write-Host "Entry URL after deploy: /mobile/"
