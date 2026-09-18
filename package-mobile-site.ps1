param(
  [string]$OutputPath = "netlify-mobile",
  [string]$RiotVerificationFile = (Join-Path $PSScriptRoot "riot.txt")
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = if ([System.IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $root $OutputPath }

$version = "1.3.0"

$mobileFiles = @(
  "index.html",
  "app.js",
  "header.js",
  "lol.html",
  "lol.js",
  "lol.css",
  "styles.css",
  "config.js",
  "manifest.webmanifest",
  "service-worker.js",
  "about\about.css",
  "about\terms.html",
  "about\privacy.html"
)
$mobileVersion = "unknown"
$mobileAppPath = Join-Path (Join-Path $root "mobile") "app.js"
$mobileAppSource = Get-Content -LiteralPath $mobileAppPath -Raw -Encoding UTF8
if ($mobileAppSource -match 'MOBILE_APP_VERSION\s*=\s*"([^"]+)"') {
  $mobileVersion = $Matches[1]
}

$out = [System.IO.Path]::GetFullPath($out)
$workspacePrefix = [System.IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
if (-not $out.StartsWith($workspacePrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw "OutputPath must be inside the workspace." }
$verificationText = $null
if ($RiotVerificationFile) {
  $verificationText = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $RiotVerificationFile).Path)
  if (-not $verificationText -or $verificationText -ne $verificationText.Trim() -or $verificationText.Contains("`n") -or $verificationText.Contains("`r")) { throw "Verification token must not contain surrounding whitespace or newlines." }
}
if (Test-Path -LiteralPath $out) {
  Remove-Item -LiteralPath $out -Recurse -Force
}

New-Item -ItemType Directory -Path $out -Force | Out-Null
if ($null -ne $verificationText) { [System.IO.File]::WriteAllText((Join-Path $out "riot.txt"), $verificationText, [System.Text.UTF8Encoding]::new($false)) }
$mobileOut = Join-Path $out "mobile"
$iconsOut = Join-Path $out "icons"
New-Item -ItemType Directory -Path $mobileOut -Force | Out-Null
New-Item -ItemType Directory -Path $iconsOut -Force | Out-Null

foreach ($relative in $mobileFiles) {
  $source = Join-Path (Join-Path $root "mobile") $relative
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Missing mobile deploy file: $relative"
  }
  $target = Join-Path $mobileOut $relative
  New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $target -Force
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
  "  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self' https://ggebdrlvzrgoyumlrnxe.supabase.co wss://ggebdrlvzrgoyumlrnxe.supabase.co; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "",
  "/riot.txt",
  "  Content-Type: text/plain; charset=utf-8",
  "  Cache-Control: no-cache, no-store, must-revalidate",
  "",
  "/mobile/lol.html/riot.txt",
  "  Content-Type: text/plain; charset=utf-8",
  "  Cache-Control: no-cache, no-store, must-revalidate",
  "",
  "/mobile/service-worker.js",
  "  Cache-Control: no-cache, no-store, must-revalidate",
  "",
  "/mobile/index.html",
  "  Cache-Control: no-cache, no-store, must-revalidate",
  "",
  "/mobile/about/*",
  "  Cache-Control: no-cache, must-revalidate",
  "",
  "/deploy-info.json",
  "  Cache-Control: no-cache, no-store, must-revalidate"
)
[System.IO.File]::WriteAllText((Join-Path $out "_headers"), ($headers -join "`n") + "`n", [System.Text.UTF8Encoding]::new($false))

$redirects = @(
  "/mobile/lol.html/riot.txt /riot.txt 200!",
  "/ /mobile/lol.html 302",
  "/mobile/about /mobile/lol.html 301",
  "/mobile/about/ /mobile/lol.html 301",
  "/mobile/about/index.html /mobile/lol.html 301",
  "/mobile/about/demo.html /mobile/lol.html 301",
  "/mobile/about/review.html /mobile/lol.html 301",
  "/mobile/* /mobile/:splat 200"
)
[System.IO.File]::WriteAllText((Join-Path $out "_redirects"), ($redirects -join "`n") + "`n", [System.Text.UTF8Encoding]::new($false))

$deployInfo = [ordered]@{
  name = "obaengal-mobile"
  source = "mobile"
  version = $version
  mobileVersion = $mobileVersion
  generatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  productPath = "/mobile/lol.html"
  files = @(if ($null -ne $verificationText) { "riot.txt" }) + @($mobileFiles | ForEach-Object { ("mobile/$_").Replace("\", "/") }) + @(Get-ChildItem -LiteralPath $iconsRoot -File | ForEach-Object { "icons/$($_.Name)" })
}
[System.IO.File]::WriteAllText((Join-Path $out "deploy-info.json"), ($deployInfo | ConvertTo-Json -Depth 5) + "`n", [System.Text.UTF8Encoding]::new($false))

Write-Host "Mobile deploy folder created: $out"
Write-Host "Publish directory: $out"
Write-Host "Entry URL after deploy: /mobile/"
