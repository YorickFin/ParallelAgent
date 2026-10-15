# ParallelAgent 探针：零依赖 CDP 调用器（PowerShell 7 + ClientWebSocket）
param(
    [int]$Port = 9317,
    [string]$TitleMatch = '管理员',
    [string]$TargetId,
    [string]$Js,
    [string]$JsFile,
    [switch]$AwaitPromise,
    [string]$ClickSelector,
    [string]$ClickAtXY,
    [string]$InsertText,
    [switch]$FocusInput,
    [switch]$PressEnter,
    [switch]$SelectAllAndDelete,
    [int]$TimeoutMs = 30000
)
$ErrorActionPreference = 'Stop'
if ($JsFile) { $Js = Get-Content -Raw -Encoding UTF8 $JsFile }

$targets = Invoke-RestMethod "http://127.0.0.1:$Port/json" -TimeoutSec 5
if ($TargetId) {
    $t = $targets | Where-Object { $_.id -eq $TargetId } | Select-Object -First 1
    if (-not $t) { throw "没找到 TargetId=[$TargetId] 的 page target" }
} else {
    $t = $targets | Where-Object { $_.type -eq 'page' -and $_.title -like "*$TitleMatch*" } | Select-Object -First 1
    if (-not $t) { throw "没找到标题匹配 [$TitleMatch] 的 page target" }
}
Write-Host "== target: $($t.title) (id=$($t.id)) ==" -ForegroundColor DarkGray

$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ws.ConnectAsync([Uri]$t.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait(10000) | Out-Null

$script:nextId = 0
function Send-Cdp($method, $params) {
    $script:nextId++
    $id = $script:nextId
    $payload = @{ id = $id; method = $method; params = $params } | ConvertTo-Json -Depth 20 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
    $ws.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait(5000) | Out-Null
    $deadline = [DateTime]::Now.AddMilliseconds($TimeoutMs)
    $rbuf = New-Object byte[] 4194304
    while ([DateTime]::Now -lt $deadline) {
        $ms = New-Object IO.MemoryStream
        do {
            $r = $ws.ReceiveAsync([ArraySegment[byte]]::new($rbuf), [Threading.CancellationToken]::None).Result
            if ($r.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { throw "WebSocket 被关闭" }
            $ms.Write($rbuf, 0, $r.Count)
        } while (-not $r.EndOfMessage)
        $obj = [Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json
        if ($obj.id -eq $id) { return $obj }
    }
    throw "等待 id=$id 超时"
}

function Eval($expr) {
    $r = Send-Cdp 'Runtime.evaluate' @{ expression = $expr; returnByValue = $true; awaitPromise = [bool]$AwaitPromise }
    if ($r.exceptionDetails) { throw ($r.exceptionDetails | ConvertTo-Json -Depth 10) }
    return $r.result.result.value
}

# 动作序列（按顺序）
if ($ClickSelector) {
    $expr = "(()=>{const el=document.querySelector($([Convert]::ToJson($ClickSelector)));if(!el)return 'MISS';el.scrollIntoView({block:'center'});el.click();return 'CLICKED';})()"
    Write-Host "click -> $(Eval $expr)"
}
if ($FocusInput) {
    Write-Host "focus -> $(Eval "(()=>{const el=document.querySelector('.chat-input-v2-input-box-editable');if(!el)return 'MISS';el.focus();return document.activeElement===el?'FOCUSED':'FOCUS-FAIL';})()")"
}
if ($ClickAtXY) {
    $parts = $ClickAtXY.Split(',')
    $x = [double]$parts[0]; $y = [double]$parts[1]
    foreach ($ev in @(
        @{ type='mouseMoved'; x=$x; y=$y },
        @{ type='mousePressed'; x=$x; y=$y; button='left'; clickCount=1 },
        @{ type='mouseReleased'; x=$x; y=$y; button='left'; clickCount=1 }
    )) { $null = Send-Cdp 'Input.dispatchMouseEvent' ($ev + @{ buttons = 0 }) }
    Write-Host "real-click at $x,$y"
}
if ($InsertText) {
    # 先确认聚焦在输入框，再走 CDP 原生输入管道（Lexical 可识别）
    Write-Host "active -> $(Eval "document.activeElement && document.activeElement.className")"
    $r = Send-Cdp 'Input.insertText' @{ text = $InsertText }
    Write-Host "insertText -> ok"
}
if ($SelectAllAndDelete) {
    # contenteditable 内全选后删除：用 CDP 键事件 Ctrl+A -> Delete
    $null = Send-Cdp 'Input.dispatchKeyEvent' @{ type='keyDown'; key='a'; code='KeyA'; windowsVirtualKeyCode=65; modifiers=2 }
    $null = Send-Cdp 'Input.dispatchKeyEvent' @{ type='keyUp'; key='a'; code='KeyA'; windowsVirtualKeyCode=65; modifiers=2 }
    $null = Send-Cdp 'Input.dispatchKeyEvent' @{ type='keyDown'; key='Delete'; code='Delete'; windowsVirtualKeyCode=46 }
    $null = Send-Cdp 'Input.dispatchKeyEvent' @{ type='keyUp'; key='Delete'; code='Delete'; windowsVirtualKeyCode=46 }
    Write-Host "selectAll+Delete sent"
}
if ($PressEnter) {
    foreach ($ty in @('rawKeyDown','char','keyUp')) {
        $p = @{ type=$ty; key='Enter'; code='Enter'; windowsVirtualKeyCode=13; nativeVirtualKeyCode=13 }
        if ($ty -eq 'char') { $p.text = "`r" }
        $null = Send-Cdp 'Input.dispatchKeyEvent' $p
    }
    Write-Host "enter sent"
}
if ($Js) { Eval $Js | ConvertTo-Json -Depth 30 }

$ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', [Threading.CancellationToken]::None).Wait(3000) | Out-Null
