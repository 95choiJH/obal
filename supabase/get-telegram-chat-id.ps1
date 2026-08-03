$secureToken = Read-Host "Paste the bot token from BotFather" -AsSecureString
$tokenPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)

try {
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPtr)
  $response = Invoke-RestMethod -Method Get -Uri ("https://api.telegram.org/bot{0}/getUpdates" -f $token)

  $chats = @($response.result | ForEach-Object {
    if ($_.message -and $_.message.chat) { $_.message.chat }
  } | Sort-Object id -Unique)

  if ($chats.Count -eq 0) {
    Write-Host "No chat found. Send /start to your bot in Telegram, then run this script again." -ForegroundColor Yellow
    exit 1
  }

  Write-Host "`nTelegram chat ID:" -ForegroundColor Green
  $chats | Select-Object id, type, username, first_name | Format-Table -AutoSize
} catch {
  Write-Host ("Request failed: " + $_.Exception.Message) -ForegroundColor Red
  exit 1
} finally {
  if ($tokenPtr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPtr)
  }
  Remove-Variable token -ErrorAction SilentlyContinue
}
