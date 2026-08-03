$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8001

$server = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), $port)
$server.Start()

$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'
  '.png' = 'image/png'
  '.ico' = 'image/x-icon'
  '.svg' = 'image/svg+xml'
}

while ($true) {
  $client = $server.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $stream.ReadTimeout = 1000
    $buf = New-Object byte[] 8192
    $n = $stream.Read($buf, 0, $buf.Length)
    $req = [System.Text.Encoding]::ASCII.GetString($buf, 0, $n)
    $first = ($req -split "`r?`n")[0]
    $target = '/'
    if ($first -match '^[A-Z]+\s+(\S+)') {
      $target = $Matches[1]
    }

    $pathOnly = ($target -split '\?')[0].TrimStart('/')
    $pathOnly = [Uri]::UnescapeDataString($pathOnly)
    if ([string]::IsNullOrWhiteSpace($pathOnly)) {
      $pathOnly = 'index.html'
    }

    $file = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $pathOnly))
    if (-not $file.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
      $status = '403 Forbidden'
      $body = [System.Text.Encoding]::UTF8.GetBytes('Forbidden')
      $ctype = 'text/plain; charset=utf-8'
    } elseif (-not [System.IO.File]::Exists($file)) {
      $status = '404 Not Found'
      $body = [System.Text.Encoding]::UTF8.GetBytes('Not found')
      $ctype = 'text/plain; charset=utf-8'
    } else {
      $status = '200 OK'
      $body = [System.IO.File]::ReadAllBytes($file)
      $ext = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
      $ctype = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
    }

    $header = "HTTP/1.1 $status`r`nContent-Type: $ctype`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
    $hb = [System.Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($hb, 0, $hb.Length)
    $stream.Write($body, 0, $body.Length)
  } catch {
  } finally {
    $client.Close()
  }
}
