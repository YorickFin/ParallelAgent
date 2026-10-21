# Changelog

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
