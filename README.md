# ParallelAgent

在 Trae 中实现**多 AI 会话并行开发**：仲裁者会话统一决策并落笔契约，多条轨道会话并行执行，协作内容全部走文件信箱，编排器插件只负责执行动作。

## 🚀 快速开始

前置：Windows + Trae CN + Node.js ≥ 18。

```powershell
npx parallelagent@latest init
```

一条命令完成三件事：

- 从 Open VSX 下载 `.vsix` 并本地安装（失败回退 GitHub Release）
- 铺两个全局 Skill 到 `~/.trae-cn/skills/`
- 向 `~/.trae-cn/argv.json` 写入调试端口 9317

> 在 Trae 终端执行，或把命令交给 Trae 的 Agent 执行。独立 PowerShell / cmd 窗口可能不走 TUN 或系统代理，下载易失败；此时先手动下载 `.vsix`，再用 `init --vsix <路径>` 离线安装。

之后在 Trae 中 `Ctrl+Shift+P → ParallelAgent: 启动编排器` 开始工作。

| 命令 | 作用 |
|---|---|
| `npx parallelagent@latest init` | 安装（幂等） |
| `npx parallelagent@latest doctor` | 环境自检，全绿时退出码 0 |
| `npx parallelagent@latest uninit` | 卸载扩展 + 清 Skills + 还原 argv.json |

## 🧩 设计

- **三件套**：仲裁者 Skill（决策、落笔、实检）、轨道 Skill（接收任务、执行、回执）、编排器插件（CDP + HTTP 网关 + 信箱 watch）
- **数据面 100% 文件**：契约、转达、回执、快照、交接手册全部落盘
- **控制面只传信号**：仅含轨号 + 轮次 + 文件指针，绝不传任务内容
- **后台等待**：`/watch` 提交 job 即返回；仲裁者空闲且输入框为空时注入固定话术唤醒
- **fail-stop**：找不到锚点或身份断言失败立即停机，不做未校验的下发

```
仲裁者会话（主控） ──控制信号──▶ 编排器插件（CDP/HTTP/watch）
      ▲ 文件                          │ 建/切/派/删
      │                              ▼
      └──── 文件信箱 ◀── 轨道会话 T-A/B/C/D
```

## 📁 目录

```
adapters/
└── trae/                    # Trae 适配层
    ├── docs/                # 方案与设计文档
    ├── plugin/              # 编排器插件
    ├── probes/              # 开发期探针脚本
    ├── shared/              # 两 Skill 共享的协议 reference
    └── skills/              # 仲裁者 / 轨道 Skill

packages/
└── cli/                     # npm 包 parallelagent

test-docs/                   # 版本测试报告
```

## 📌 状态

- 一期：编排器插件全流程（`/health` `/new` `/ping` `/dispatch` `/watch` `/delete`）联调通过
- v1.1.0：版本化信箱、开轨就绪握手、单轨单在途消息
- v1.2.0：`/watch` 改为后台 job + 待处理队列 + 空闲唤醒 + ack 闭环，多 job 并存（[测试报告](test-docs/v1.2.0基础测试报告.md)）
- v1.2.x：安装链路持续加固（Open VSX 直链、稳定缓存、直连 exe、磁盘校验）

真实多轨验证项目：[slate-desktop](https://github.com/YorickFin/slate-desktop)。

## 📄 License

[Apache License 2.0](LICENSE)
