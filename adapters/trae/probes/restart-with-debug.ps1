# ParallelAgent 探针专用：带 CDP 调试端口重启 Trae
# 脱离 Trae 进程树运行（由 WMI Win32_Process.Create 拉起）
$ErrorActionPreference = 'Continue'
$port = 9317
$exe  = 'D:\Programs\Trae\Trae CN.exe'
$log  = Join-Path $env:TEMP 'parallelagent-restart.log'

"$(Get-Date -Format o) launch, wait 8s" | Out-File -FilePath $log -Encoding utf8
if (-not (Test-Path $exe)) { "$(Get-Date -Format o) FATAL: exe not found: $exe" | Out-File -FilePath $log -Append -Encoding utf8; exit 1 }
Start-Sleep -Seconds 8

"$(Get-Date -Format o) stopping Trae CN" | Out-File -FilePath $log -Append -Encoding utf8
Get-Process -Name 'Trae CN' -ErrorAction SilentlyContinue | Stop-Process -Force
for ($i = 0; $i -lt 40; $i++) {
    if (-not (Get-Process -Name 'Trae CN' -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 500
}
Start-Sleep -Seconds 2

"$(Get-Date -Format o) starting with --remote-debugging-port=$port" | Out-File -FilePath $log -Append -Encoding utf8
Start-Process -FilePath $exe -ArgumentList "--remote-debugging-port=$port"

Start-Sleep -Seconds 10
try {
    $v = Invoke-RestMethod "http://127.0.0.1:$port/json/version" -TimeoutSec 5
    "CDP OK: $($v.Browser) $($v.'Protocol-Version')" | Out-File -FilePath $log -Append -Encoding utf8
} catch {
    "CDP FAIL: $($_.Exception.Message)" | Out-File -FilePath $log -Append -Encoding utf8
}
