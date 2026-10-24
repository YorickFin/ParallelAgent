# 参与 ParallelAgent

## 分支模型

`main` 是受保护分支：

- 禁止直接 push，所有改动必须经 Pull Request
- PR 需要 CI 全绿（`verify-extension`、`verify-cli`）
- 至少 1 个 review approval 才能合并

工作分支命名：

| 前缀 | 用途 | 示例 |
|---|---|---|
| `feat/` | 新功能 | `feat/watch-job-queue` |
| `fix/` | 缺陷修复 | `fix/notifier-restore-focus` |
| `docs/` | 文档、协议、Skill | `docs/v1.3.0-design` |
| `chore/` | 构建、CI、依赖 | `chore/collaboration-infra` |

## 开发环境

- Windows（插件依赖 Trae CN 的 CDP 与 DOM 锚点，其他平台未适配）
- Node.js ≥ 18
- pnpm 10（`corepack enable` 或 `npm i -g pnpm@10`）

## 本地校验

提交 PR 前请在本地跑一遍与 CI 相同的检查：

```powershell
# 插件
pnpm --dir adapters/trae/plugin/parallelagent-orchestrator install
pnpm --dir adapters/trae/plugin/parallelagent-orchestrator typecheck
pnpm --dir adapters/trae/plugin/parallelagent-orchestrator build

# CLI
pnpm --dir packages/cli install
pnpm --dir packages/cli typecheck
pnpm --dir packages/cli build
```

涉及协议、Skill 或行为的改动，必须同步更新对应文档：

| 改动位置 | 必须同步 |
|---|---|
| 控制信号 / HTTP 端点 | `adapters/trae/shared/references/协议.md`、`docs/ParallelAgent方案定稿.md` |
| 仲裁者行为 | `adapters/trae/skills/parallelagent-arbiter/SKILL.md` |
| 轨道行为 | `adapters/trae/skills/parallelagent-track/SKILL.md` |
| 插件行为 | 插件 `README.md` 与 `CHANGELOG.md` |

## Pull Request 流程

1. 从最新 `main` 切出工作分支
2. 提交改动，保持一个 PR 只做一件事
3. push 分支到 origin
4. 开 PR，填清楚：改了什么、为什么、怎么验证
5. 等 CI 全绿 + review approval
6. 由维护者合并（默认 squash merge）
7. 删除远端工作分支

> 合并后本地同步用 `git pull --ff-only`，不要本地 `merge` 后直接 push `main`。

## 发布流程（仅维护者）

发布不是 PR 的一部分，由维护者在合并后单独执行：

1. 在 `main` 上确认 CI 绿
2. 同步版本号：`adapters/trae/plugin/parallelagent-orchestrator/package.json` 与 `packages/cli/package.json` 保持一致
3. 更新插件 `CHANGELOG.md` 与根 `README.md` 的状态段
4. 提交版本变更 PR 并合并
5. 本地 `git pull --ff-only` 拉到最新 `main`
6. 打 tag 并推送：

```powershell
git tag -a v1.3.0 -m "v1.3.0: <一句话主题>"
git push origin refs/tags/v1.3.0
```

7. `release.yml` 自动执行四阶段：打包 vsix → GitHub Release → npm CLI 发布 → Open VSX（受仓库变量 `PUBLISH_OPEN_VSX` 控制）

**注意**：tag 一旦推送就会触发真实发布（npm 不可撤回），推送前务必确认版本号与 CHANGELOG。

## 提交信息

采用 Conventional Commits 前缀：`feat`、`fix`、`docs`、`refactor`、`test`、`chore`。

示例：

```
fix(orchestrator): 通知跳过时切回原会话
docs(skill): 开轨前强制检查交接手册存在
```

## 报告问题

请附上：Trae 版本、插件版本、`/health` 输出、`ParallelAgent` 输出通道的相关日志片段。
不要提交 `.parallel-agent/` 里的 `信号/` 目录内容（已在 `.gitignore` 中排除）。
