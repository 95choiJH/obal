param(
  [string]$OutputPath = "dist\obaengal-extension.zip"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root "dist"
$stage = Join-Path $dist "extension"
$zip = if ([System.IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { Join-Path $root $OutputPath }

$allowedFiles = @(
  "manifest.json",
  "background.js",
  "content.js",
  "config.js"
)
$allowedIconFiles = @(
  "icons\icon16.png",
  "icons\icon32.png",
  "icons\icon48.png",
  "icons\icon128.png",
  "icons\on_break.png",
  "icons\undetermined.png",
  "icons\naver_cafe.png",
  "icons\video_donation.png",
  "icons\gamepad-icon.svg",
  "icons\calendar-icon.svg"
)

if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage "icons") | Out-Null

foreach ($relative in ($allowedFiles + $allowedIconFiles)) {
  $source = Join-Path $root $relative
  if (-not (Test-Path -LiteralPath $source)) { throw "Missing package file: $relative" }
  $target = Join-Path $stage $relative
  $targetDir = Split-Path -Parent $target
  if (-not (Test-Path -LiteralPath $targetDir)) { New-Item -ItemType Directory -Path $targetDir | Out-Null }
  Copy-Item -LiteralPath $source -Destination $target -Force
}

if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
$zipDir = Split-Path -Parent $zip
if (-not (Test-Path -LiteralPath $zipDir)) { New-Item -ItemType Directory -Path $zipDir | Out-Null }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -Force
Write-Host "Extension package created: $zip"
