# ParallelAgent

ParallelAgent 是一套在 Trae Work / VSCode-like IDE 中实现**多 AI 会话并行开发**的模式与工具集：由一个"仲裁者"会话统一决策与持笔，多条"轨道"会话并行干活，全部协作内容走文件信箱留痕，编排器插件只做无脑执行——最终消灭"用户人肉在多个会话之间转发消息"的环节。

本项目为个人实践项目，模式在个人多 AI 并行开发实战中验证后整理开源。

## 核心设计

- **三件套架构**：仲裁者 Skill（决策 + 持笔 + 实检）、轨道 Skill（收活 + 干活 + 回执）、编排器插件（CDP 执行器 + HTTP 网关 + 文件信箱 watch）
- **数据面 100% 文件**：契约、转达、回执、快照、交接手册全部落盘，可溯源、可交接
- **控制面只传信号**：HTTP / 信号文件仅含 `轨号 + 轮次 + 文件指针`，绝不传任务内容
- **三阶段生命周期**：奠基串行 → 并行多轨 → 收尾串行，含拆分判据与收回判据
- **后台等待与唤醒**：`/watch` 提交 job 即返回，不占用 AI 回合；插件在仲裁者空闲且输入框为空时注入固定话术唤醒它
- **待处理队列**：每轨的 `状态` 与 `处理` 写入 `信号/轮次状态/第N轮-v{M}.json`，仲裁者消费后 `ack` 消账
- **fail-stop**：找不到锚点 / 身份断言失败立即停机告警，禁止盲点盲发

```
仲裁者会话（主控） ──控制信号──▶ 编排器插件（CDP/HTTP/watch）
      ▲ 文件                          │ 建/切/派/删
      │                              ▼
      └──── 文件信箱 ◀── 轨道会话 T-A/B/C/D
```

## 安装（v1.2.0+）

前置：Windows + Trae CN + Node.js ≥ 18。

```powershell
npx parallelagent@latest init
```

一条命令完成：从 Open VSX 下载对应版本的 `.vsix` 并本地安装（不依赖 Trae 的商店源；失败时回退 GitHub Release 的 `.vsix`）→ 铺两个全局 Skill 到 `~/.trae-cn/skills/` → 向 `~/.trae-cn/argv.json` 增量写入调试端口 9317。

> Trae 的扩展商店默认同步 VS Code Marketplace，不会同步 Open VSX。因此 CLI 不依赖商店：直接从 Open VSX 拉 `.vsix` 本地安装。若确实要让 Trae 从它自己的商店源安装，加 `--from-store`。

**建议在 Trae 终端里执行，或直接把命令交给 Trae 的 Agent 执行。** 独立 PowerShell 7 窗口 / cmd 窗口疑似不会自动继承 TUN 或系统代理，访问 Open VSX、GitHub 会明显变慢甚至 `fetch failed`；此时可先手动下载 `.vsix`，再用 `init --vsix <路径>` 离线安装（不走任何网络请求）。

之后每次启动 Trae（双击图标 / 开始菜单 / 任务栏均可），调试端口自动就绪。在 Trae 中 `Ctrl+Shift+P → ParallelAgent: 启动编排器` 进入工作流。

其他命令：

```powershell
npx parallelagent@latest doctor   # 环境自检（全绿退出码 0）
npx parallelagent@latest uninit   # 卸载扩展 + 清 Skills + 还原 argv.json（不动项目层 .parallel-agent/ 信箱）
```

> 若已全局安装（`npm i -g parallelagent`），可省略 `npx parallelagent@latest` 前缀，直接 `parallelagent doctor` / `parallelagent uninit`。

> `uninit` 卸载扩展时先试 Trae CLI；部分 Trae 版本的 `--uninstall-extension` 会直接报错，
> 此时自动退回文件级卸载（删 `extensions.json` 条目与扩展目录）。若 Trae 正在运行，
> 建议先关闭窗口再执行，避免运行中的实例回写注册表。

> 一期源码安装方式（克隆 + pnpm build）仍保留给开发者，见 `adapters/trae/`。

## 目录

```
adapters/
└── trae/                    # Trae Work 适配层（未来可平级扩展 cursor/ 等）
    ├── docs/                # 方案设计文档（v1.2.0 设计、定稿、历史设计、生命周期治理）
    ├── plugin/              # 编排器插件（CDP 执行器 + HTTP 网关 + 文件信箱 watch）
    │   └── parallelagent-orchestrator/
    ├── probes/              # 探针脚本（开发期摸清 Trae/CDP 行为，非产品代码）
    ├── shared/              # 两 Skill 共享的协议 reference 与手册模板
    └── skills/              # 仲裁者/轨道 Skill

packages/
└── cli/                     # npm 包 parallelagent：一键安装器

test-docs/                   # 版本测试报告归档
```

## 状态

一期（手动触发版）：**已实现并联调通过**。编排器插件覆盖 /health、/new、/ping、/dispatch、/watch、/delete 全流程，多轨并行切换、建轨与删轨的端到端链路均已实测验证。

v1.1.0：版本化信箱（`转达/第N轮/T-X-v{M}.md`）、开轨就绪握手（`就绪/T-X.md` + `POST /wait-ready`）、单轨单在途消息纪律。

v1.2.0：**等待机制重构**。`/watch` 由阻塞等待改为提交后台 job 并立即返回，等待状态移入插件进程；新增待处理队列（`信号/轮次状态/第N轮-v{M}.json`）、空闲通知（注入固定话术唤醒仲裁者，注入后切回原会话）、ack 消费闭环、多 job 并存（不同轨可处于不同轮次）。基础测试报告见 [test-docs/v1.2.0基础测试报告.md](test-docs/v1.2.0基础测试报告.md)。

修复：带调试端口重启 Trae 的静默失败（WMI 需 powershell 全路径、脚本需 UTF-8 BOM、控制台窗口隐藏）。

## 测试验证项目

[v1.1.0 测试验证项目：slate-desktop](https://github.com/YorickFin/slate-desktop)

一个 pywebview + Vite 前端 + Python 后端的桌面应用，用于在真实多轨开发场景中验证 v1.1.0 的版本化信箱、就绪握手与多轨并行调度。

## License

[Apache License 2.0](LICENSE)
