# ParallelAgent

ParallelAgent 是一套在 Trae Work / VSCode-like IDE 中实现**多 AI 会话并行开发**的模式与工具集：由一个"仲裁者"会话统一决策与持笔，多条"轨道"会话并行干活，全部协作内容走文件信箱留痕，编排器插件只做无脑执行——最终消灭"用户人肉在多个会话之间转发消息"的环节。

本项目为个人实践项目，模式在个人多 AI 并行开发实战中验证后整理开源。

## 核心设计

- **三件套架构**：仲裁者 Skill（决策 + 持笔 + 实检）、轨道 Skill（收活 + 干活 + 回执）、编排器插件（CDP 执行器 + HTTP 网关 + 文件信箱 watch）
- **数据面 100% 文件**：契约、转达、回执、快照、交接手册全部落盘，可溯源、可交接
- **控制面只传信号**：HTTP / 信号文件仅含 `轨号 + 轮次 + 文件指针`，绝不传任务内容
- **三阶段生命周期**：奠基串行 → 并行多轨 → 收尾串行，含拆分判据与收回判据
- **fail-stop**：找不到锚点 / 身份断言失败立即停机告警，禁止盲点盲发

```
仲裁者会话（主控） ──控制信号──▶ 编排器插件（CDP/HTTP/watch）
      ▲ 文件                          │ 建/切/派/删
      │                              ▼
      └──── 文件信箱 ◀── 轨道会话 T-A/B/C/D
```

## 目录

```
adapters/
└── trae/                    # Trae Work 适配层（未来可平级扩展 cursor/ 等）
    ├── docs/                # 方案设计文档（定稿、历史设计、生命周期治理）
    ├── plugin/              # 编排器插件（CDP 执行器 + HTTP 网关 + 文件信箱 watch）
    │   └── parallelagent-orchestrator/
    ├── probes/              # 探针脚本（开发期摸清 Trae/CDP 行为，非产品代码）
    ├── shared/              # 两 Skill 共享的协议 reference 与手册模板
    └── skills/              # 仲裁者/轨道 Skill
```

## 状态

一期（手动触发版）：**已实现并联调通过**。编排器插件覆盖 /health、/new、/ping、/dispatch、/watch、/delete 全流程，多轨并行切换、建轨与删轨的端到端链路均已实测验证。

## License

[Apache License 2.0](LICENSE)
