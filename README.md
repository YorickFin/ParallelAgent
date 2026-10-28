# ParallelAgent

把 AI 开发治理收敛成**一套纯文本协议 + 一套模板 + 三个 Skill**：单轨串行打底，多轨交给宿主原生 subagent 并行。v3 不再依赖编排器插件、HTTP 网关或 CDP。

## 快速开始

前置：Node.js ≥ 18；Trae CN（一期验证宿主）。

```powershell
npx parallelagent@latest init
```

默认安装到 Trae CN：

- `~/.trae-cn/skills/`：`parallelagent-solo`、`parallelagent-arbiter`、`parallelagent-track`
- `~/.parallel-agent/references/`：`协议.md`、`分流.md`、`台账.md`
- `~/.parallel-agent/templates/`：8 份模板
- `~/.parallel-agent/hosts/`：能力档案模板 + Trae CN 预置实测值
- `~/.parallel-agent/能力档案/`：首次运行后由 Agent 写入
- `~/.parallel-agent/install-state.json`：安装版本与文件校验和

常用选项：

| 选项 | 说明 |
|---|---|
| `--host <trae-cn\|workbuddy\|claude-code>` | 目标宿主，默认 `trae-cn` |
| `--root <目录>` | 安装根目录，默认用户主目录 |
| `--skills-dir <目录>` | 覆盖 Skill 安装目录 |
| `--dry-run` | 只打印动作，不写文件 |
| `--force` | 覆盖用户改过的产品文件 |
| `--help` | 显示帮助 |

从 v2 升级：v3 不再安装扩展，请先卸载旧的 `yorickfin.parallelagent-orchestrator`，并手动清理 `~/.trae-cn/shared/references/`；v3 会把三个 Skill 覆盖到 `~/.trae-cn/skills/`。

## 设计

- **治理层**：L0-L4 分流、单轨台账、多轨契约/回执/快照，全部纯文本
- **执行器层**：宿主原生 subagent；按「能力档案」参数化，默认单批 ≤ 5
- **加固层**：隔离、围观、中断等能力按宿主提供情况降级或明确拒绝
- **入口分流**：L0-L3 单轨；L4 由仲裁者读能力档案、写契约、分批 spawn、扫描越界、落快照
- **数据面 100% 文件**：契约、转达、回执、快照、交接手册、台账全部落盘
- **无插件、无 HTTP、无 CDP**：不注册服务，不改宿主配置

```
用户请求 ──▶ 入口分流（L0-L3 单轨 / L4 多轨）
                │
                ├─ L0-L3：当前会话 ──▶ 单轨台账
                │
                └─ L4：仲裁者会话
                          │ 读能力档案
                          ├─ 默认：subagent 执行器
                          └─ 可选：加固层执行器（待定）
                                     │
                          文件信箱 ◀──┴──▶ 轨道
```

## 目录

```
skills/       # 三个 Skill（solo / arbiter / track）
references/   # 协议 / 分流 / 台账
templates/    # 8 份空白模板
hosts/        # 能力档案模板与宿主预置值
packages/cli/ # npx 安装器（零运行时依赖）
docs/         # 设计与实施方案
test-docs/    # 测试模版、报告、评估
```

## 状态

- v3.0.0：纯文本协议 + 三 Skill + 能力档案 + 零依赖安装器；subagent 轨道，无插件
- v2.1.0 及更早版本保留在 `v2.1.0` tag 与 `release/v2.1.0` 分支

## 文档

- [v3 方案设计](docs/设计/ParallelAgent%20v3%20方案设计.md)
- [v3 生命周期治理方案](docs/设计/ParallelAgent%20v3%20生命周期治理方案.md)
- [v3 一期实施方案](docs/实施/ParallelAgent%20v3%20一期实施方案.md)
- [v3 最小全量测试](test-docs/模版/ParallelAgent%20v3%20最小全量测试.md)
- [v3 完整全量测试](test-docs/模版/ParallelAgent%20v3%20完整全量测试.md)

## License

[Apache License 2.0](LICENSE)
