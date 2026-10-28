# ParallelAgent CLI 多 Agent 安装器方案

- 状态：草案（待评审）
- 日期：2026-10-28
- 关联分支：`feat/agents-default-host`（`893a102`，已把默认安装目录改为 `~/.agents/skills`）
- 上游版本：v3.0.0
- 调研对象：`vercel-labs/skills`、`obra/superpowers`、`anthropics/skills`、`davila7/claude-code-templates`、`mattpocock/skills`

---

## 1. 目标与非目标

### 1.1 目标

- 从“单宿主复制安装器”升级为“多 Agent 安装器”。
- 以 `~/.agents/skills`（或项目 `.agents/skills`）为 canonical 源，向各 Agent 目录建立链接或副本。
- 支持一次安装到多个 Agent，支持自动检测已安装 Agent。
- 支持 `list`、`check`、`update`、`remove`、`doctor` 的最小生命周期。
- 保持零运行时依赖、纯文件安装、不改宿主配置。
- 只把**验证过**的 Agent 加入默认注册表；未验证的继续走通用 `agents` 或 `--skills-dir`。

### 1.2 非目标

- 不做通用 Skills 市场，不从 GitHub 拉取任意第三方 Skill。
- 不照搬 `vercel-labs/skills` 的 75+ Agent 全量列表。
- 不在本期做 npm 依赖 `sync`、远程 skill pack、telemetry。
- 不在本期为所有宿主维护原生 plugin manifest（P2 再评估）。
- 不改 `references/`、`templates/`、`hosts/` 的协议内容。

---

## 2. 现状与差距

当前 `packages/cli/index.js`：

- 4 个硬编码宿主：`agents`、`trae-cn`、`workbuddy`、`claude-code`
- 一次只装一个目标
- 只复制，不做 symlink/junction
- 只有一个全局 `install-state.json`
- 没有项目级安装、自动检测、`list/check/update/remove/doctor`
- 没有 lockfile 或可复现清单

---

## 3. 调研结论

| 项目 | 安装设计 | 可参考点 |
|---|---|---|
| `vercel-labs/skills`（`npx skills`） | 数据驱动 Agent 注册表；项目/全局路径；自动检测；默认 symlink，`--copy` 回退；`add/find/list/use/check/update/remove/init`；`skills-lock.json` | 我们最应该参考的主线 |
| `obra/superpowers` | 每个宿主独立 plugin 目录和原生市场；README 明确“多宿主需分别安装” | 原生 plugin manifest 的后期路线 |
| `anthropics/skills` | Claude Code `/plugin marketplace add` + 插件安装 | 宿主原生市场分发 |
| `davila7/claude-code-templates` | npm CLI，`bin` 别名、版本同步脚本、`prepublishOnly` | CLI 打包与发布卫生 |
| `mattpocock/skills` | 仓库以 `.agents` 目录为源 | 验证 `.agents` 作为 canonical 源 |

参考链接：

- https://github.com/vercel-labs/skills
- https://github.com/vercel-labs/skills/blob/main/docs/agents.md
- https://github.com/vercel-labs/skills/blob/main/docs/commands.md
- https://github.com/obra/superpowers
- https://github.com/anthropics/skills
- https://github.com/davila7/claude-code-templates
- https://agentskills.io

### 3.1 `vercel-labs/skills` 的关键事实

- Agent 表同时给出 **Project Path** 与 **Global Path**。
- 多个 Agent 共享项目级 `.agents/skills/`，但全局路径各不相同：
  - Claude Code：`.claude/skills/` / `~/.claude/skills/`
  - Cursor：`.agents/skills/` / `~/.cursor/skills/`
  - Codex：`.agents/skills/` / `~/.agents/skills/`
  - Gemini CLI：`.agents/skills/` / `~/.gemini/skills/`
  - OpenCode：`.agents/skills/` / `~/.config/opencode/skills/`
- 默认 symlink，`--copy` 复制；`-g/--global` 切换全局；`--agent` 多选；`--all`；`--skill`；`-y`。
- 自动检测已安装 Agent；检测不到才提示选择。
- `skills-lock.json` + `--frozen-lockfile` 用于 CI 可复现。

### 3.2 结论

参考 `vercel-labs/skills` 的**注册表 + 检测 + canonical + symlink/copy + 生命周期**；参考 `obra/superpowers` 的**per-host 原生打包**作为后期扩展。不要照搬全量 Agent 列表和通用市场能力。

---

## 4. 设计原则

1. **单一源**：`~/.agents/skills`（全局）或 `./.agents/skills`（项目）是 canonical 内容。
2. **链接优先**：默认向 Agent 目录建链接；Windows 用 junction；失败再复制。
3. **零依赖**：只用 Node 内置 `fs/os/path`。
4. **可逆**：所有安装、链接、删除都记录在状态文件；`remove` 只删除自己管理的内容。
5. **验证优先**：未验证 Agent 不进入默认 `--all`，避免“装了但宿主不识别”。
6. **共享数据独立**：`~/.parallel-agent` 继续存放 references/templates/hosts/能力档案，与 Agent 安装位置解耦。

---

## 5. 目标设计

### 5.1 Agent 注册表

建议拆成 `packages/cli/lib/agents.js`：

```js
{
  name: 'claude-code',
  label: 'Claude Code',
  projectSkillsDir: '.claude/skills',
  globalSkillsDir: '.claude/skills',
  detect: () => existsSync(join(home, '.claude')),
  verified: true,
  link: 'symlink'
}
```

首批注册表：

| Agent | Project | Global | 状态 |
|---|---|---|---|
| `agents` | `.agents/skills` | `~/.agents/skills` | 已验证（Trae 会扫描全局） |
| `trae-cn` | — | `~/.trae-cn/skills` | 已验证 |
| `workbuddy` | — | `~/.workbuddy/skills` | 已验证预设 |
| `claude-code` | `.claude/skills` | `~/.claude/skills` | 已验证预设 |
| `cursor` | `.agents/skills` | `~/.cursor/skills` | 候选，待实机验证 |
| `codex` | `.agents/skills` | `~/.agents/skills` | 候选，待实机验证 |
| `gemini-cli` | `.agents/skills` | `~/.gemini/skills` | 候选，待实机验证 |
| `opencode` | `.agents/skills` | `~/.config/opencode/skills` | 候选，待实机验证 |

规则：

- `verified: true` 才进入默认 `--all`。
- 候选 Agent 可以显式 `--agent cursor`，但输出“未验证”提示，并要求 `--force` 或确认。
- 未列入注册表的宿主继续使用 `--host <name> --skills-dir <dir>`。

### 5.2 安装布局

全局（默认）：

```
~/.agents/skills/                     # canonical
~/.trae-cn/skills/parallelagent-*     # junction/symlink -> canonical
~/.claude/skills/parallelagent-*      # junction/symlink -> canonical
~/.parallel-agent/                    # 共享 references/templates/hosts/能力档案
~/.parallel-agent/install-state.json  # 安装状态（按 agent + scope 分条）
```

项目（`--project`）：

```
<project>/.agents/skills/             # canonical
<project>/.claude/skills/...          # 链接或副本
```

### 5.3 命令与参数

```text
parallelagent init [--agent <name...>] [--all]
                   [--global|--project] [--copy|--link]
                   [--skills-dir <dir>] [--dry-run] [--force] [-y]
parallelagent list
parallelagent check
parallelagent update [--agent ...] [--all]
parallelagent remove [--agent ...] [--all] [-y]
parallelagent doctor
```

- `init` 默认 `agents` + 全局；`--all` 安装到全部 `verified` Agent。
- `--agent` 可多选：`--agent trae-cn claude-code`。
- `--copy` 强制复制；默认 `link`。
- `--skills-dir` 保留，用于未注册宿主或覆盖目标。
- `list` 显示 Agent、scope、路径、链接/副本、版本。
- `check` 检查缺失、断链、哈希变化、共享数据缺失。
- `update` 按状态重装/重建链接；不覆盖用户改过的文件（写 `.new`）。
- `remove` 只删除状态文件中记录的本工具管理内容。
- `doctor` 汇总检查，退出码 0/1，便于 CI。

### 5.4 状态文件

`~/.parallel-agent/install-state.json` 升级为：

```json
{
  "schema_version": 2,
  "version": "3.1.0",
  "mode": "link",
  "agents": {
    "agents": { "scope": "global", "skillsDir": "~/.agents/skills", "files": {} },
    "trae-cn": { "scope": "global", "skillsDir": "~/.trae-cn/skills", "files": {} }
  },
  "shared": { "dataDir": "~/.parallel-agent", "files": {} }
}
```

- 按 Agent 分条，解决当前“只记录最后一次 host”的问题。
- 保留 `installedAt`、文件哈希、源版本。
- `schema_version: 1` 的旧状态自动迁移；`能力档案` 永不覆盖。

### 5.5 Windows 链接策略

- 目录链接优先 `fs.symlink(target, path, 'junction')`，避免管理员权限问题。
- junction 失败再尝试普通 symlink；仍失败则复制并记录 `mode: copy`。
- `check` 能识别断链并提示 `update`。
- CI 增加 Windows job 验证 junction/copy。

### 5.6 安全与边界

- 只安装随包资产，不执行远程代码。
- 不修改宿主配置、不注册服务。
- `remove` 不删除 `能力档案`、不删除非本工具管理的文件。
- 所有路径使用 `path.resolve`，拒绝 `..` 越界。
- `--dry-run` 不写任何文件。

---

## 6. 分阶段实施

### P0（先做）

- Agent 注册表 + `verified` 标记。
- `--agent` 多选、`--all`（仅 verified）。
- canonical `.agents/skills` + symlink/junction + copy fallback。
- 状态文件按 Agent 分条。
- `list`、`doctor`。
- CI 覆盖：默认 agents、`trae-cn`、`claude-code`、`--all`、Windows junction。

### P1

- `check`、`update`、`remove`。
- `--project` 作用域。
- 旧 `install-state.json` 迁移。
- 候选 Agent 实机验证后转 `verified`。

### P2

- 原生 plugin manifest（Claude Code / Cursor / Codex 等）。
- 可选 `skills-lock.json` / `--frozen-lockfile`。
- 更多宿主验证。

---

## 7. 验收标准

- `node --check packages/cli/index.js` 通过。
- `init --dry-run` 默认 `agents`，输出不写文件。
- `init` 默认在 `~/.agents/skills` 生成 3 个 Skill；向 `trae-cn`/`claude-code` 建链接（或复制）。
- `--agent trae-cn claude-code --all` 均可用。
- `list` 能列出每个 Agent 的 scope、路径、link/copy 状态。
- `check` 能发现断链/缺失/哈希变化。
- `update` 幂等；`remove` 只删除管理内容，保留 `能力档案`。
- Windows 上 junction 失败时自动回退复制。
- CI 在 Ubuntu 与 Windows 均通过。

---

## 8. 迁移与回滚

- 旧 `install-state.json`（`schema_version: 1`）读取后迁移；`能力档案` 不覆盖。
- 当前 `agents` 默认安装的用户：第一次 `init` 会补建链接；旧 `trae-cn` 副本可按需 `remove`。
- 回滚：`git revert` 实施提交；或 `npx parallelagent@3.0.0 init --host trae-cn` 回到旧布局。
- 版本建议：行为变更较大，实施时 bump 到 `3.1.0`，并同步 `skills/*/SKILL.md` 的 `version`。

---

## 9. 风险与取舍

| 风险 | 对策 |
|---|---|
| Windows symlink 权限 | junction 优先，失败复制 |
| 多 Agent 状态复杂 | 按 Agent 分条 + `doctor` |
| 未验证路径误导用户 | `verified` 标记，候选需显式选择 |
| 链接断裂/宿主不识别 | `check` + `update` |
| 用户手改文件被覆盖 | 哈希检测，写 `.new` |
| 维护 75+ Agent 成本 | 只维护验证过的 + 通用 `agents` |

---

## 10. 待确认问题

1. 默认作用域：全局（当前）还是项目？（建议保持全局，项目作为 `--project` 可选）
2. 默认安装方式：symlink/junction 还是 copy？（建议链接优先，复制回退）
3. `--all` 是否只包含 verified？（建议是）
4. 候选 Agent（cursor/codex/gemini/opencode）是否本期实机验证？（建议 P1 再做）
5. 是否本期 bump `3.1.0`？（建议实施时 bump）
6. 是否本期做原生 plugin manifest？（建议 P2）

---

## 11. 任务卡字段

- **任务 ID**：`S-20261028-002`
- **模式**：L2 探路
- **目标**：产出 CLI 多 Agent 安装器方案，明确注册表、链接策略、命令、状态与分阶段计划。
- **非目标**：本阶段不改业务代码，不安装到真实宿主，不发布新版本。
- **文件领地（实施阶段）**：`packages/cli/`、`README.md`、`CONTRIBUTING.md`、`.github/workflows/ci.yml`、`docs/`。
- **验收条件**：方案评审通过；P0/P1/P2 边界明确；验收标准可执行。
- **回滚方式**：`git revert` 实施提交；保留 v3.0.0 tag。
