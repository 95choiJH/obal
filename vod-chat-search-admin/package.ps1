param([string]$OutputPath = "..\dist\vod-chat-search-admin.zip")
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspace = Split-Path -Parent $root
$zip = if ([System.IO.Path]::IsPathRooted($OutputPath)) { $OutputPath } else { [System.IO.Path]::GetFullPath((Join-Path $root $OutputPath)) }
$workspaceFull = [System.IO.Path]::GetFullPath($workspace)
if (-not $zip.StartsWith($workspaceFull + [System.IO.Path]::DirectorySeparatorChar)) { throw "Output path must stay inside the workspace." }
$files = @("manifest.json", "background.js", "content.js", "README.md")
$zipDir = Split-Path -Parent $zip
if (-not (Test-Path -LiteralPath $zipDir)) { New-Item -ItemType Directory -Path $zipDir | Out-Null }
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($zip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($name in $files) {
    $source = Join-Path $root $name
    if (-not (Test-Path -LiteralPath $source)) { throw "Missing package file: $name" }
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $source, $name, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $archive.Dispose() }
Write-Host "Admin VOD chat search package created: $zip"
