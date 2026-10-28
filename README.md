# ParallelAgent

在 Trae 中实现 **AI 开发治理**：单轨串行打底，多轨并行加速。入口按需求清晰度与规模自动分流；单轨改动必须落台账，多轨由仲裁者统一决策并落笔契约，协作内容全部走文件信箱，编排器插件只负责执行动作。

## 🚀 快速开始

前置：Windows + Trae CN + Node.js ≥ 18。

```powershell
npx parallelagent@latest init
```

一条命令完成四件事：

- 从 Open VSX 下载 `.vsix` 并本地安装（失败回退 GitHub Release）
- 铺三个全局 Skill 到 `~/.trae-cn/skills/`
- 铺共享 reference 到 `~/.trae-cn/shared/references/`
- 向 `~/.trae-cn/argv.json` 写入调试端口 9317

> 在 Trae 终端执行，或把命令交给 Trae 的 Agent 执行。独立 PowerShell / cmd 窗口可能不走 TUN 或系统代理，下载易失败；此时先手动下载 `.vsix`，再用 `init --vsix <路径>` 离线安装。

之后：

- **单轨（L0-L3）**：直接在 Trae 里提开发请求，由 `parallelagent-solo` 分流并执行，无需启动编排器。
- **多轨（L4）**：`Ctrl+Shift+P → ParallelAgent: 启动编排器`，再对仲裁者说“拆开跑”。

| 命令 | 作用 |
|---|---|
| `npx parallelagent@latest init` | 安装（幂等） |
| `npx parallelagent@latest doctor` | 环境自检，全绿时退出码 0 |
| `npx parallelagent@latest uninit` | 卸载扩展 + 清 Skills + 还原 argv.json |

## 🧩 设计

- **入口分流**：按清晰度 / 规模 / 风险判定 L0-L4；单轨 L0-L3 不依赖插件
- **单轨治理**：L0 直做、L1 问清、L2 探路、L3 立规；小改动不写 PRD，但每次改动必须写入单轨台账
- **多轨三件套**：仲裁者 Skill（决策、落笔、实检）、轨道 Skill（接收任务、执行、回执）、编排器插件（CDP + HTTP 网关 + 信箱 watch）
- **数据面 100% 文件**：契约、转达、回执、快照、交接手册、单轨台账全部落盘
- **控制面只传信号**：仅含轨号 + 轮次 + 文件指针，绝不传任务内容
- **后台等待**：`/watch` 提交 job 即返回；仲裁者空闲且输入框为空时注入固定话术唤醒
- **fail-stop**：找不到锚点或身份断言失败立即停机，不做未校验的下发

```
用户请求 ──▶ 入口分流（L0-L3 单轨 / L4 多轨）
                │
                ├─ L0-L3：当前会话 ──▶ 单轨台账
                │
                └─ L4：仲裁者会话（主控） ──控制信号──▶ 编排器插件（CDP/HTTP/watch）
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
    ├── shared/              # 共享 reference（协议 / 分流 / 台账）
    └── skills/              # 仲裁者 / 轨道 / 单轨 Skill

packages/
└── cli/                     # npm 包 parallelagent

test-docs/                   # 版本测试报告
```

## 📌 状态

- 一期：编排器插件全流程（`/health` `/new` `/ping` `/dispatch` `/watch` `/delete`）联调通过
- v1.1.0：版本化信箱、开轨就绪握手、单轨单在途消息
- v1.2.0：`/watch` 改为后台 job + 待处理队列 + 空闲唤醒 + ack 闭环，多 job 并存（[测试报告](test-docs/v1.2.0基础测试报告.md)）
- v1.2.x：安装链路持续加固（Open VSX 直链、稳定缓存、直连 exe、磁盘校验）
- v2.0.0：
  - 入口分流（L0-L4）+ 单轨流程（L0-L3）+ 单轨台账；CLI 安装 3 个 Skill 与共享 reference
  - 修复 D-01 `/dispatch` 命中旧 sid、D-03 台账误报、D-04 回执计数不一致
  - 编排器项目级自动启动（存在 `.parallel-agent/` 时自动启动）+ 项目级单实例锁 + 静默失败状态栏
  - Agent 页 target 识别（兼容 `solo-lite` 与 `Agent [管理员]` 形态），自动/手动重连均有等待窗口
  - CDP 端口绑定失败时提示「立即重启 / 忽略」，所有重启入口统一立即执行
- v2.1.0：
  - 修复 D-04 `/bind-arbiter` 绑定 active 轨道、D-01 `doctor` 更正条目误判、D-02 `/delete` 失效 sid 返回码
  - 新增 TRAE 更新后全量基础测试 Prompt、最小功能可用性全量测试与全量基础测试报告
  - TRAE 3.4.8 全量基础测试通过（T00-T15、T17；T16 部分平台限制 BLOCKED）

真实多轨验证项目：[slate-desktop](https://github.com/YorickFin/slate-desktop)。

## 📄 License

[Apache License 2.0](LICENSE)
