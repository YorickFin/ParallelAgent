# Changelog

## 1.2.0（已实现，待真机实测与发布）

> 设计见 `adapters/trae/docs/ParallelAgent-v1.2.0设计文档.md`

- **破坏性变更**：`POST /watch` 由「阻塞等待回执」改为「提交后台 job 并立即返回 `job_id`」，响应不再包含 `{完成, 未完成}`
- 新增待处理队列：每轨完成/超时写入 `信号/轮次状态/第N轮-v{M}.json`，字段分 `状态`（pending/done/timeout/failed）与 `处理`（null/pending/notified/done）
- 新增 `GET /watch/status`、`POST /watch/ack`、`POST /watch/cancel`、`GET /watch/jobs`、`POST /bind-arbiter`
- 新增空闲通知器：任务行图标预筛 + `status()` 二次确认 + 输入框判空 → 注入固定话术唤醒仲裁者，注入后切回用户原会话
- 通知去重与降级：`notified` 态 + 合并窗口 + 冷却；重发 2 次无 ack 降级为 VS Code 气泡 + `alert.signal`
- 逐轨入队（`notify=each`，默认）与全齐入队（`notify=all`）可选；`timeout`/`failed` 始终立即告警
- 仲裁者改为消费闭环：单轨增量实检 → `ack` → 剩余队列非空则同回合继续；整轮评估留到全轨终态
- watcher 移除「未完成即写 alert」的副作用，超时判定上移到 job 层
- 新增固定话术 `watch_notify`、`watch_alert`
- 支持多 job 并存（不同轨处于不同轮次）：每个「轮次+版本」独立状态文件；同轮次版本重复 `/watch` 幂等复用并返回 `复用/警告`；同一轨跨 job 未清账时给出警告
- 修复：job 已 `done` 后重复提交会新建 job 并覆盖状态文件；现在复用已完成 job，带新轨时追加并恢复运行，已处理轨不重复入队
- 修复：通知在切到仲裁者后因草稿/忙而跳过时不切回原会话；现在只要切过会话，无论注入、跳过还是失败都会切回
- 输入框有草稿时改为 60 秒长退避，避免每 5 秒来回切会话打扰用户
- 修复「带调试端口重启 Trae」静默失败：WMI 服务的环境没有 PowerShell 的 PATH，`CommandLine` 里只写 `powershell` 会返回 `ReturnValue=9`（Path Not Found），重启脚本从未被拉起。现在改用 `powershell.exe` 绝对路径 + `-EncodedCommand`，并校验 WMI `ReturnValue`，失败时明确报错而不是提示成功
- `restart-with-debug.ps1` 新增 `-LogPath` 参数，重启日志写入扩展 globalStorage（`restart.log`）
- 修复重启脚本真正无法执行的原因：`.ps1` 为 UTF-8 无 BOM，Windows PowerShell 5.1 按 GBK 解析中文注释后语法报错（`Unexpected token ')'`）。改为 UTF-8 with BOM，并已通过语法解析检查
- 重启脚本改为 `-WindowStyle Hidden -NonInteractive` 运行，不再把 PowerShell 控制台窗口显示在前台（实测未隐藏时 `MainWindowHandle` 非 0，隐藏后为 0）
- 通知话术改为指向 `信号/轮次状态/` 目录并提示 `GET /watch/jobs`；`GET /watch/jobs` 返回每个 job 的 `待处理` 列表

## 1.1.3

- 打包内新增 `README.md` 与 `LICENSE`，Marketplace / Open VSX 可展示 Overview
- 版本与 CLI 同步到 1.1.3；扩展逻辑无变更

## 1.1.2

- 修复 CLI 在 Windows 上无法启动 Trae CLI（`.cmd` 需经 shell、`where` 需优先取 `.cmd`）
- 扩展代码无变更，版本与 CLI 对齐

## 1.1.1

- 版本对齐到 1.1.1，与 CLI 同步发布；扩展代码无变更
- 安装链路不再包含 VS Marketplace 兜底（Open VSX → GitHub Release）

## 1.1.0

- 新增就绪握手：轨道启动完成后写 `就绪/T-X.md`，仲裁者用 `POST /wait-ready` 阻塞等待，杜绝「待命轨误读转达单」
- `POST /wait-ready` 支持 `since`（毫秒或 ISO），只认该时点之后写出的就绪回执，历史遗留文件不算数
- 信箱骨架新增 `就绪/` 目录
- watcher 改为每等待独立句柄（局部轮询 + fs.watch），并发等待互不干扰
- 启动顺序改为「先起 HTTP 网关，再连 CDP」：CDP 不可达时 `/health` 仍可访问并返回 `cdp_alive:false`
- `RouteDeps.cdp` 允许为 null，`/ping`、`/dispatch`、`/new`、`/delete` 在 CDP 未连接时返回 `cdp_unavailable` 而非 500
- 重复执行启动命令不再重复监听端口，仅重试 CDP 连接
- 转达/回执改为版本化结构：`转达/第N轮/T-X-v{M}.md`、`回执/第N轮/T-X-v{M}.md`，同轮可多次转达且不覆盖历史
- `/dispatch`、`/watch` 新增 `版本` 入参（默认 1），watch 按「轮次 + 轨 + 版本」精确等待对应回执
- `dispatch_round` 固定话术改为直接给出转达/回执文件指针

## 0.2.0（v1.1.0）

- `restartWithDebug` 改为「增量写 `argv.json` 调试端口 + 重启」：一次配置后任何入口启动 Trae 调试端口自动就绪
- 新增 activate 自检：CDP 不通时弹窗引导一键修复
- restart 脚本迁入扩展 `resources/scripts/`，Trae 路径改用 `process.execPath` 传入，移除全部硬编码绝对路径
- 项目层信箱根默认从 `docs/协调` 迁移到 `.parallel-agent/`，启动编排器时自动创建骨架目录并写入 `.gitignore`（排除 `信号/`）
- argv.json 读写支持 JSONC（保留用户注释与其他键）

## 0.0.1（一期）

- 一期（手动触发版）：CDP 执行器 + HTTP 网关 + 文件信箱 watch，覆盖 /health、/new、/ping、/dispatch、/watch、/delete 全流程
