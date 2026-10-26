# Copyright 2026 ParallelAgent Contributors
# SPDX-License-Identifier: Apache-2.0
#
# ParallelAgent：重启 Trae（调试端口由 argv.json 持久化，无需命令行参数）
# 脱离 Trae 进程树运行（由 WMI Win32_Process.Create 拉起）
# 由扩展侧传入参数：
#   -ExePath  Trae 可执行文件绝对路径（扩展用 process.execPath 获取）
#   -Port     CDP 端口（仅用于重启后连通性自检）
#   -LogPath  日志路径（扩展传入 globalStorage 下的 restart.log）
#   -DelaySeconds  杀进程前的等待秒数（默认 8；错误提示里的「立即重启」传 0）
param(
    [Parameter(Mandatory = $true)][string]$ExePath,
    [Parameter(Mandatory = $true)][int]$Port,
    [string]$LogPath = (Join-Path $env:TEMP 'parallelagent-restart.log'),
    [int]$DelaySeconds = 8
)

$ErrorActionPreference = 'Continue'
$log = $LogPath
$logDir = Split-Path $log -Parent
if ($logDir -and -not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}

"$(Get-Date -Format o) launch, exe=$ExePath port=$Port, wait ${DelaySeconds}s" | Out-File -FilePath $log -Encoding utf8
if (-not (Test-Path $ExePath)) { "$(Get-Date -Format o) FATAL: exe not found: $ExePath" | Out-File -FilePath $log -Append -Encoding utf8; exit 1 }
Start-Sleep -Seconds $DelaySeconds

# 进程名取 exe 文件名去后缀（如 "Trae CN"）
$procName = [System.IO.Path]::GetFileNameWithoutExtension($ExePath)

"$(Get-Date -Format o) stopping $procName" | Out-File -FilePath $log -Append -Encoding utf8
Get-Process -Name $procName -ErrorAction SilentlyContinue | Stop-Process -Force
for ($i = 0; $i -lt 40; $i++) {
    if (-not (Get-Process -Name $procName -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 500
}
Start-Sleep -Seconds 2

# 调试端口已通过 argv.json 持久化，无需命令行参数
"$(Get-Date -Format o) starting $ExePath (port via argv.json)" | Out-File -FilePath $log -Append -Encoding utf8
Start-Process -FilePath $ExePath

Start-Sleep -Seconds 10
try {
    $v = Invoke-RestMethod "http://127.0.0.1:$Port/json/version" -TimeoutSec 5
    "CDP OK: $($v.Browser) $($v.'Protocol-Version')" | Out-File -FilePath $log -Append -Encoding utf8
} catch {
    "CDP FAIL: $($_.Exception.Message)" | Out-File -FilePath $log -Append -Encoding utf8
}
