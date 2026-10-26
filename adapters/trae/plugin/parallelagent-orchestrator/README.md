# ParallelAgent Orchestrator

ParallelAgent 的编排器扩展：CDP 执行器 + HTTP 网关 + 文件信箱 watch，负责把「仲裁者 + 多轨会话」的协作协议真正落地。

## 它做什么

- **建轨 / 切轨 / 删轨**：通过 CDP 操作 Trae 的任务会话
- **派发固定话术**：只传轨号、轮次、版本号和文件指针，不传任务内容
- **等待回执**：后台 job 轮询 `.parallel-agent/回执/第N轮/T-X-v{M}.md`，文件出现且 mtime 稳定即入队
- **待处理队列**：把每轨的完成状态写进 `信号/轮次状态/第N轮-v{M}.json`，仲裁者 ack 消账
- **空闲通知**：仲裁者空闲且输入框为空时注入固定话术唤醒，注入后切回用户原会话
- **开轨握手**：等待 `就绪/T-X.md`，确保轨道启动完成后再派发
- **身份断言**：每次发送前核对任务身份，失败即停机，不做未校验的下发

## 安装

推荐使用 CLI 一键安装：

```powershell
npx parallelagent@latest init
```

它会安装本扩展、铺三个全局 Skill 与共享 reference，并写入 CDP 调试端口。也可以直接安装本仓库 Release 中的 `.vsix`。

## 使用

安装后重启 Trae：

- 项目根存在 `.parallel-agent/` 时，编排器自动启动（默认 `autoStart=auto`），无需手动执行命令。
- 其他项目默认不启动，也不会创建 `.parallel-agent/` 目录。
- `Ctrl+Shift+P` → `ParallelAgent: 启动编排器` 可手动启动；`ParallelAgent: 停止编排器` 停止并让本窗口不再自动启动。
- 访问 `http://127.0.0.1:9318/health` 确认网关可用。

**单实例**：同一项目在多个窗口打开时，只有先启动的窗口运行编排器，其余窗口状态栏显示「已在其他窗口运行」。锁文件为 `.parallel-agent/信号/orchestrator.lock`。

**状态栏**：显示 运行中 / CDP 未连接 / 已在其他窗口运行 / 端口被占用 / 已停止；点击可手动启动。自动启动失败不弹窗。

**已知限制**：同一时间只支持一个项目占用 9318；多项目并行未支持。

## HTTP 接口

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/health` | 网关与 CDP 状态、轨道表 |
| GET | `/ping?sid=` | 切换轨道并读取状态 |
| POST | `/new` | 新建轨道会话 |
| POST | `/dispatch` | 向指定轨道发送固定话术 |
| POST | `/wait-ready` | 等待轨道写出就绪文件 |
| POST | `/watch` | 提交回执等待 job，返回 `job_id`（不阻塞） |
| GET | `/watch/status` | 查询 job 的待处理队列 |
| POST | `/watch/ack` | 标记某轨已消费，并返回剩余队列 |
| POST | `/watch/cancel` | 取消 job |
| GET | `/watch/jobs` | 列出全部 job |
| POST | `/bind-arbiter` | 绑定当前选中会话为通知目标 |
| POST | `/delete` | 删除轨道会话 |

## 配置

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `parallelagent.cdpPort` | `9317` | Trae 的 CDP 调试端口 |
| `parallelagent.autoStart` | `auto` | 自动启动策略：`auto` 项目有 `.parallel-agent/` 才启动；`on` 总是启动；`off` 仅手动 |
| `parallelagent.httpPort` | `9318` | HTTP 网关端口 |
| `parallelagent.mailboxRoot` | `.parallel-agent` | 文件信箱根目录 |
| `parallelagent.pollIntervalMs` | `1000` | 回执轮询间隔 |
| `parallelagent.watchTimeoutS` | `1800` | 单轨 job 超时（超时即置 `timeout` 并入队告警） |

## 链接

- 仓库：https://github.com/YorickFin/ParallelAgent
- 问题反馈：https://github.com/YorickFin/ParallelAgent/issues
- 协议文档：https://github.com/YorickFin/ParallelAgent/blob/main/adapters/trae/shared/references/%E5%8D%8F%E8%AE%AE.md

## License

Apache-2.0
