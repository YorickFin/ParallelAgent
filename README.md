# ParallelAgent

把 AI 开发治理收敛成**一套纯文本协议 + 一套模板 + 三个 Skill**：单轨串行打底，多轨交给宿主原生 subagent 并行。v3 不再依赖编排器插件、HTTP 网关或 CDP。

## 快速开始

前置：Node.js ≥ 18（本仓库 CLI）；上游 `npx skills` 需 Node.js ≥ 22.20；Trae CN（一期验证宿主）。

**1）安装三个 Skill**：交给上游安装器，本仓库不再自行实现安装、链接或卸载。

```powershell
npx skills add YorickFin/ParallelAgent -g -a trae-cn
# 或：gh skill install YorickFin/ParallelAgent --scope user --agent trae-cn
```

**2）安装共享数据**：本仓库 CLI 只复制文件，不安装 Skill、不创建链接、不删除任何文件。

```powershell
npx parallelagent@latest init
```

写入 `~/.parallel-agent/`：

- `references/`：`协议.md`、`分流.md`、`台账.md`
- `templates/`：8 份模板
- `hosts/`：能力档案模板 + Trae CN 预置实测值 + 通用 `agents` 占位档案
- `能力档案/`：首次运行后由 Agent 写入
- `install-state.json`：安装版本与文件校验和

常用选项：

| 选项 | 说明 |
|---|---|
| `--root <目录>` | 安装根目录，默认用户主目录 |
| `--dry-run` | 只打印动作，不写文件 |
| `--force` | 覆盖用户改过的文件（默认写 `.new`，不覆盖） |
| `--help` | 显示帮助 |

卸载 Skill 交给上游：

```powershell
npx skills remove --global -a trae-cn parallelagent-*
```

从 v2 升级：v3 不再安装扩展，请先卸载旧的 `yorickfin.parallelagent-orchestrator`，并手动清理 `~/.trae-cn/shared/references/`。旧的 `~/.trae-cn/skills/parallelagent-*` 用 `npx skills remove --global -a trae-cn parallelagent-*` 清理，避免 Trae 同时加载新旧两套。

### 其他宿主

- 支持哪些宿主、装到哪个目录，以上游为准：`npx skills` 覆盖 75+ Agent（含 Trae CN、Cursor、Codex、Gemini CLI、OpenCode 等），完整路径表见 `vercel-labs/skills` 的 `docs/agents.md`。
- 指定宿主：`npx skills add YorickFin/ParallelAgent -g -a <agent 名称>`（可多个）；通用 `.agents/skills` 用 `-a universal`。
- `gh skill` 需 GitHub CLI ≥ 2.90.0（public preview，命令可能变动），目前**没有 `remove` 子命令**；需要卸载时用 `npx skills remove`。
- 只支持 `AGENTS.md` / 规则文件的宿主：没有 Skill 自动激活；在项目规则里要求读取 `~/.parallel-agent/references/分流.md`、`协议.md`、`台账.md` 和 `templates/`，技能内容作为规则注入。
- 能力档案：复制 `~/.parallel-agent/hosts/能力档案-模板.md` 到 `~/.parallel-agent/能力档案/<host>.md` 并按 P1-P6 探测；一期只预置 Trae CN 实测值，`agents` 预置档案为 `confidence: 未验证`（默认 L0-L3、串行）。

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
packages/cli/ # npx 安装器（只装共享数据，零运行时依赖）
docs/         # 设计与实施方案
test-docs/    # 测试模版、报告、评估
```

## 状态

- v3.1.0：Skill 安装/更新/卸载交给上游 `npx skills` 或 `gh skill`；本仓库 CLI 只安装共享数据（references / templates / hosts），不建链接、不删除文件
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
