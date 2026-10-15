# 通过 CDP 重载指定窗口（Page.reload）
param(
    [int]$Port = 9317,
    [string]$TitleMatch = 'TRAE CN',
    [string]$UrlMatch = ''
)
$ErrorActionPreference = 'Stop'
$targets = Invoke-RestMethod "http://127.0.0.1:$Port/json" -TimeoutSec 5
if ($UrlMatch) {
    $t = $targets | Where-Object { $_.type -eq 'page' -and $_.url -like "*$UrlMatch*" } | Select-Object -First 1
} else {
    $t = $targets | Where-Object { $_.type -eq 'page' -and $_.title -like "*$TitleMatch*" -and $_.url -like '*workbench.html*' } | Select-Object -First 1
    if (-not $t) { $t = $targets | Where-Object { $_.type -eq 'page' -and $_.title -like "*$TitleMatch*" } | Select-Object -First 1 }
}
if (-not $t) { throw 'target not found' }
Write-Host "reload target: $($t.title)"

$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ws.ConnectAsync([Uri]$t.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait(10000) | Out-Null
$payload = @{ id = 1; method = 'Page.enable'; params = @{} } | ConvertTo-Json -Compress
$b = [Text.Encoding]::UTF8.GetBytes($payload)
$ws.SendAsync([ArraySegment[byte]]::new($b), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait(5000) | Out-Null
Start-Sleep -Milliseconds 300
$payload = @{ id = 2; method = 'Page.reload'; params = @{ ignoreCache = $false } } | ConvertTo-Json -Compress
$b = [Text.Encoding]::UTF8.GetBytes($payload)
$ws.SendAsync([ArraySegment[byte]]::new($b), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait(5000) | Out-Null
Write-Host 'reload sent'
$ws.Dispose()
