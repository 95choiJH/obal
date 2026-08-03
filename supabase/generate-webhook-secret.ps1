$bytes = New-Object byte[] 32
$generator = [Security.Cryptography.RandomNumberGenerator]::Create()

try {
  $generator.GetBytes($bytes)
  $secret = [Convert]::ToBase64String($bytes)
  Set-Clipboard -Value $secret
  Write-Host "Webhook secret copied to clipboard." -ForegroundColor Green
} finally {
  $generator.Dispose()
  [Array]::Clear($bytes, 0, $bytes.Length)
  Remove-Variable secret -ErrorAction SilentlyContinue
}
