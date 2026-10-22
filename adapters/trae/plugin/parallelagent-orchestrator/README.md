# ParallelAgent Orchestrator

ParallelAgent 的编排器扩展：CDP 执行器 + HTTP 网关 + 文件信箱 watch，负责把「仲裁者 + 多轨会话」的协作协议真正跑起来。

## 它做什么

- **建轨 / 切轨 / 删轨**：通过 CDP 操作 Trae 的任务会话
- **派发固定话术**：只传轨号、轮次、版本号和文件指针，不传任务内容
- **等待回执**：轮询 `.parallel-agent/回执/第N轮/T-X-v{M}.md`，文件出现且 mtime 稳定即完成
- **开轨握手**：等待 `就绪/T-X.md`，确保轨道启动完成后再派发
- **身份断言**：每次发送前核对任务身份，失败即停机，不盲发

## 安装

推荐使用 CLI 一键安装：

```powershell
npx parallelagent@latest init
```

它会安装本扩展、铺两个全局 Skill，并写入 CDP 调试端口。也可以直接安装本仓库 Release 中的 `.vsix`。

## 使用

1. 重启 Trae
2. `Ctrl+Shift+P` → `ParallelAgent: 启动编排器`
3. 访问 `http://127.0.0.1:9318/health` 确认网关可用

## HTTP 接口

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/health` | 网关与 CDP 状态、轨道表 |
| GET | `/ping?sid=` | 切换轨道并读取状态 |
| POST | `/new` | 新建轨道会话 |
| POST | `/dispatch` | 向指定轨道发送固定话术 |
| POST | `/wait-ready` | 等待轨道写出就绪文件 |
| POST | `/watch` | 等待指定轮次/版本的回执 |
| POST | `/delete` | 删除轨道会话 |

## 配置

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `parallelagent.cdpPort` | `9317` | Trae 的 CDP 调试端口 |
| `parallelagent.httpPort` | `9318` | HTTP 网关端口 |
| `parallelagent.mailboxRoot` | `.parallel-agent` | 文件信箱根目录 |
| `parallelagent.pollIntervalMs` | `1000` | 回执轮询间隔 |
| `parallelagent.watchTimeoutS` | `1800` | watch 默认超时 |

## 链接

- 仓库：https://github.com/YorickFin/ParallelAgent
- 问题反馈：https://github.com/YorickFin/ParallelAgent/issues
- 协议文档：https://github.com/YorickFin/ParallelAgent/blob/main/adapters/trae/shared/references/%E5%8D%8F%E8%AE%AE.md

## License

Apache-2.0
