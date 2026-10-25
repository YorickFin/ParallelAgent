# Changelog

## 2.0.2

- 修复 D-04：回执计数与实检不一致。回执模板新增「命令与计数」必填项，测试数/通过数/文件数/行数必须引自本次实际命令输出，禁止估算或沿用上一轮结果；仲裁者实检时核对并记入快照
- 单轨台账证据规则同步禁止“估算/沿用旧结果”的计数
- 扩展代码无变更，版本与 CLI 对齐

## 2.0.1

- 修复 D-01：存在历史 active 轨记录时，`/dispatch` 会命中旧 sid 并返回 `anchor_not_found`。现在新建同名轨时旧记录自动置 `deleted`；`/dispatch` 按创建时点倒序尝试候选 sid，失效记录自动清理后继续下一条
- 修复 D-03：`doctor` 台账检查改为按条目判断真实未回填，已被后续条目回填的历史“未提交”措辞不再误报
- 扩展与 CLI 版本对齐 2.0.1

## 2.0.0

> 设计见 `adapters/trae/docs/实施/v2.0.0+/ParallelAgent第二期实现规划.md`

- 新增入口分流（L0-L4）：单轨与多轨共用同一份判据，用户不必先说“拆开跑”
- 新增 `parallelagent-solo` Skill：L0 直做、L1 问清、L2 探路、L3 立规；L4 只写任务卡并移交仲裁者
- 新增单轨台账 `.parallel-agent/单轨/台账/YYYY-MM.md`：小改动不写 PRD，但每次改动必须留痕（需求/改动/证据/结论）
- 新增共享 reference `分流.md`、`台账.md`；仲裁者 §0 先分流，§4 强拆判据改为引用同一份文件
- 协议目录新增 `单轨/`，明确单轨只写单轨目录、多轨只写转达/回执/快照
- CLI：安装 3 个 Skill；同时安装共享 reference 到 `~/.trae-cn/shared/references/`，修复已装 Skill 引用缺失
- CLI：`doctor` 增加单轨台账校验（Q3=B：只告警，不改变退出码）
- CLI：`uninit` 同步清理新增 Skill 与共享 reference
- 扩展代码无变更，版本与 CLI 对齐

## 1.2.6

- `uninit` 现在会真正卸载扩展：先试 `trae --uninstall-extension`；该命令在部分 Trae 版本上会报 `Cannot read properties of undefined (reading 'isProtectedExtension')`，此时自动退回文件级卸载（删 `extensions.json` 条目、扩展目录、`.obsolete` 中的旧登记）
- 文件级卸载后仍登记在册时明确报错并提示关闭 Trae 后重试，不再假装成功
- README 补充安装建议：优先在 Trae 终端执行或交给 Agent 执行；独立 PowerShell 7 / cmd 窗口疑似不走 TUN 或系统代理，易出现下载超时与 `fetch failed`，可改用 `init --vsix` 离线安装
- 扩展代码无变更，版本与 CLI 对齐

## 1.2.5

- 修复直连 exe 偶发 `spawnSync ... EACCES`（杀软/占用导致的瞬时拒绝拉起）直接中断安装：现在会重试 3 次（间隔 0.8s / 1.6s），仍失败则自动回退 `.cmd` 经 shell 调用
- 网络请求增加重试：Open VSX 查询/下载与 GitHub Release 下载在代理/TUN 环境下偶发 `fetch failed`，现重试 3 次再判失败
- 失败输出新增 `code=`（如 EACCES / FETCH_FAILED），便于区分「进程起不来」与「网络不通」
- 扩展代码无变更，版本与 CLI 对齐

## 1.2.4

- 调用链路去掉 `cmd.exe` 与 `trae-cn.cmd` 批处理层：CLI 直接以 `ELECTRON_RUN_AS_NODE=1` 启动 `Trae CN.exe` 并运行 `resources/app/out/cli.js`；探测不到 `cli.js` 时才回退 `.cmd` 经 shell 调用
- 版本探测改为磁盘优先：直接读 `~/.trae-cn/extensions/extensions.json`（并排除 `.obsolete` 条目），不再靠拉起 Trae 进程跑 `--list-extensions`；`doctor` 同步改为此方式
- 安装后轮询改为每 300ms 读 `extensions.json`，替代原先每 2 秒拉起一次 Trae 进程（串行时单次约 5 秒）的做法
- 所有安装命令追加 `--force`，避免已安装同/旧版本时被静默 no-op 后误判为超时
- 失败输出带子进程 `exit=...` 与原始 stdout/stderr；失败提示新增「若 Trae 正在运行，请先关闭后重试」
- 扩展代码无变更，版本与 CLI 对齐

## 1.2.3

- 修复 CLI 安装时报 `ENOENT`：下载的 vsix 放在 `%TEMP%`，安装时文件可能已被清理。改存 `%LOCALAPPDATA%\parallelagent\cache`，安装前校验存在且非空
- 安装失败时保留 vsix 并提示可用 `--vsix <路径>` 离线安装
- 失败输出打印前 4 行完整错误，不再只给一行摘要
- 扩展代码无变更，版本与 CLI 对齐

## 1.2.2

- 修复 CLI 安装后立即校验版本导致的误判：Trae 运行时 `--install-extension` 会立即返回、异步完成安装，现在安装后每 2 秒轮询、最长 30 秒等待版本达标
- 每次安装尝试都会打印具体失败原因，不再笼统报「未取得目标版本」
- 新增 `init --vsix <path>`：离线安装本地 vsix，完全跳过网络请求
- 扩展代码无变更，版本与 CLI 对齐

## 1.2.1

- 修复 CLI 安装顺序：改为从 Open VSX 查询目标版本并下载 `.vsix` 本地安装，不再先走 Trae 商店源（Trae 默认同步 VS Code Marketplace，扩展未上架时该路径必然失败并多等一轮）
- 新增 `--from-store`：仅在显式指定时才尝试 Trae 商店源
- 扩展代码无变更，版本与 CLI 对齐

## 1.2.0（已实现，待真机实测与发布）

> 设计见 `adapters/trae/docs/实施/v1.0.0+/ParallelAgent-v1.2.0设计文档.md`

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
