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

提交 PR 前请在本地执行与 CI 相同的检查：

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
| 控制信号 / HTTP 端点 | `adapters/trae/shared/references/协议.md`、`adapters/trae/docs/设计/ParallelAgent方案定稿.md` |
| 分流 / 台账规则 | `adapters/trae/shared/references/分流.md`、`台账.md` |
| 仲裁者行为 | `adapters/trae/skills/parallelagent-arbiter/SKILL.md` |
| 轨道行为 | `adapters/trae/skills/parallelagent-track/SKILL.md` |
| 单轨行为 | `adapters/trae/skills/parallelagent-solo/SKILL.md` |
| 插件行为 | 插件 `README.md` 与 `CHANGELOG.md` |

## 敏感信息自查（提交前必做）

提交前确认没有把本机环境或私人数据带进仓库。

### 禁止提交

| 类别 | 示例 | 处理 |
|---|---|---|
| 密钥与凭据 | API key、access token、私钥、`.npmrc` 中的 authToken | 已泄露的先撤销并轮换，不能只删文件 |
| 环境文件 | `.env`、`.env.*`、`*.pem`、`*.key` | 已由 `.gitignore` 排除 |
| 运行产物 | `.parallel-agent/`（契约、台账、回执、信号）、日志、`*.vsix`、`dist/` | 已由 `.gitignore` 排除 |
| 私人内容 | `._private/` 下的博客/投稿草稿、客户或未公开项目资料 | 不要使用 `git add -f` 强行加入 |
| 本机信息 | `C:\Users\<name>`、`E:\...` 绝对路径、系统用户名、机器名、PID、会话标题 | 替换为 `<repo>`、`%USERPROFILE%`、`<Trae安装目录>` 等占位符 |

### 提交前扫描

在仓库根目录执行：

```powershell
# 绝对路径（按实际盘符调整）
git grep -n -I -E '(C:\\Users\\|D:\\Programs\\|E:\\)'

# 常见密钥形态
git grep -n -I -E '(ghp_|github_pat_|npm_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY)'

# 私有文件与生成物是否被追踪
git ls-files | Select-String -Pattern '(\.env|\.parallel-agent|\._private|\.log$|\.vsix$)'

# 提交身份（author/committer 应为本人）
git log -1 --format='A: %an <%ae> | C: %cn <%ce>'
```

命中项必须处理完再提交；无法确认的，在 PR 描述里说明。

> 删除文件不会清理 git 历史。误提交过敏感信息时，先轮换凭据，再评估是否需要改写历史。

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

发布不是 PR 的一部分，由维护者在合并后单独执行。

### 发布前复核

- [ ] 全仓无本机绝对路径、系统用户名、真实邮箱、PID、会话标题
- [ ] `git ls-files` 无 `.env`、`.npmrc`、`.parallel-agent/`、日志、`.vsix`
- [ ] npm 包与 vsix 的发布内容不含私人资料或测试草稿
- [ ] 已确认历史遗留项：删除的文件仍可从旧 commit 取出，必要时评估改写历史
- [ ] GitHub 仓库已开启 Secret Scanning 与 Push Protection

### 步骤

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

### 身份与署名

- author 与 committer 都必须是本人 GitHub 身份，推荐 `<id>+<username>@users.noreply.github.com`。
- Trae 终端会注入 `GIT_COMMITTER_NAME` / `GIT_COMMITTER_EMAIL`，优先级高于 `.git/config`。提交前先覆盖：

```powershell
$env:GIT_COMMITTER_NAME = '<你的用户名>'
$env:GIT_COMMITTER_EMAIL = '<id>+<username>@users.noreply.github.com'
```

## 报告问题

请附上：Trae 版本、插件版本、`/health` 输出、`ParallelAgent` 输出通道的相关日志片段。
不要提交 `.parallel-agent/` 下的任何内容（已在 `.gitignore` 中整体排除）。
