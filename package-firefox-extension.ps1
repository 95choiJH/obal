param(
  [string]$OutputPath = "dist\obaengal-firefox.zip"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root "dist"
$stage = Join-Path $dist "firefox-extension"
$zip = if ([System.IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $root $OutputPath }

$allowedFiles = @(
  "manifest.json",
  "background.js",
  "content.js",
  "config.js",
  "streamer-ids.js"
)
$allowedIconFiles = @(
  "icons\icon16.png",
  "icons\icon32.png",
  "icons\icon48.png",
  "icons\icon128.png",
  "icons\on_break.png",
  "icons\on_break-white.png",
  "icons\undetermined.png",
  "icons\undetermined-white.png",
  "icons\naver_cafe.png",
  "icons\video_donation.png",
  "icons\gamepad-icon.svg",
  "icons\calendar-icon.svg",
  "images\gnimti.png",
  "images\gnimti2.png",
  "images\gnimti-btn.png",
  "images\gnimti-logo.png",
  "images\gnimti-logo2.png",
  "images\obal_ios.png",
  "images\obal-android.png",
  "images\gnimti-back.png"
)
$allowedGnimtiFiles = Get-ChildItem -LiteralPath (Join-Path $root "images\gnimti") -Recurse -File -Filter "*.png" | ForEach-Object {
  $_.FullName.Substring($root.Length + 1)
}

if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage "icons") | Out-Null

foreach ($relative in ($allowedFiles + $allowedIconFiles + $allowedGnimtiFiles)) {
  $source = Join-Path $root $relative
  if (-not (Test-Path -LiteralPath $source)) { throw "Missing package file: $relative" }
  $target = Join-Path $stage $relative
  $targetDir = Split-Path -Parent $target
  if (-not (Test-Path -LiteralPath $targetDir)) { New-Item -ItemType Directory -Path $targetDir | Out-Null }
  Copy-Item -LiteralPath $source -Destination $target -Force
}

$manifestPath = Join-Path $stage "manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.PSObject.Properties.Name -contains "minimum_chrome_version") {
  $manifest.PSObject.Properties.Remove("minimum_chrome_version")
}
$manifest.background = [ordered]@{
  scripts = @("streamer-ids.js", "config.js", "background.js")
  service_worker = "background.js"
}
$manifest.browser_specific_settings.gecko.strict_min_version = "140.0"
$dataCollectionPermissions = [ordered]@{
  required = @("personalCommunications", "websiteContent")
}
if ($manifest.browser_specific_settings.gecko.PSObject.Properties.Name -contains "data_collection_permissions") {
  $manifest.browser_specific_settings.gecko.data_collection_permissions = $dataCollectionPermissions
} else {
  $manifest.browser_specific_settings.gecko | Add-Member -NotePropertyName "data_collection_permissions" -NotePropertyValue $dataCollectionPermissions
}
$manifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
$zipDir = Split-Path -Parent $zip
if (-not (Test-Path -LiteralPath $zipDir)) { New-Item -ItemType Directory -Path $zipDir | Out-Null }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($zip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in Get-ChildItem -LiteralPath $stage -Recurse -File) {
    $relativePath = $file.FullName.Substring($stage.Length + 1).Replace("\", "/")
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $relativePath, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $archive.Dispose()
}
Write-Host "Firefox extension package created: $zip"
