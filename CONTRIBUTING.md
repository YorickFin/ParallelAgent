# 参与 ParallelAgent

## 分支模型

`main` 是受保护分支：

- 禁止直接 push，所有改动必须经 Pull Request
- PR 需要 CI 全绿（`verify-cli`、`verify-protocol`）
- 至少 1 个 review approval 才能合并

工作分支命名：

| 前缀 | 用途 | 示例 |
|---|---|---|
| `feat/` | 新功能 | `feat/subagent-batching` |
| `fix/` | 缺陷修复 | `fix/receipt-pointer` |
| `docs/` | 文档、协议、Skill | `docs/v3-protocol` |
| `chore/` | 构建、CI、依赖 | `chore/release-workflow` |

## 仓库结构

```
skills/       # 三个 Skill（solo / arbiter / track）
references/   # 协议 / 分流 / 台账
templates/    # 8 份空白模板
hosts/        # 能力档案模板与宿主预置值
packages/cli/ # npx 安装器（零运行时依赖）
docs/         # 设计、实施、归档
test-docs/    # 测试模版、报告、评估、归档
```

## 本地校验

前置：Node.js ≥ 18。v3 CLI 是零依赖纯 JS，不需要编译。

```powershell
node --check packages/cli/index.js
node packages/cli/index.js --help
node packages/cli/index.js init --dry-run --root "$env:TEMP\pa-v3-test" --host trae-cn
node packages/cli/index.js init --root "$env:TEMP\pa-v3-test" --host trae-cn
```

安装后检查：

```powershell
Test-Path "$env:TEMP\pa-v3-test\.trae-cn\skills\parallelagent-solo\SKILL.md"
Test-Path "$env:TEMP\pa-v3-test\.parallel-agent\references\协议.md"
Test-Path "$env:TEMP\pa-v3-test\.parallel-agent\templates\任务卡.md"
Test-Path "$env:TEMP\pa-v3-test\.parallel-agent\hosts\trae-cn.md"
Test-Path "$env:TEMP\pa-v3-test\.parallel-agent\install-state.json"
```

涉及协议、Skill 或行为的改动，必须同步更新对应文档：

| 改动位置 | 必须同步 |
|---|---|
| 协议 / 字段 / 校验 | `references/协议.md` |
| 分流 / 台账规则 | `references/分流.md`、`references/台账.md` |
| 模板 | `templates/*.md` |
| 仲裁者 / 轨道 / 单轨行为 | `skills/*/SKILL.md` |
| 宿主能力与预置值 | `hosts/*.md` |
| CLI | `packages/cli/` 与 `README.md` |
| 设计与实施 | `docs/` |
| 测试 | `test-docs/模版/`、`test-docs/报告/` |

协议类改动至少跑一遍 `test-docs/模版/ParallelAgent v3 最小全量测试.md` 中的 V1-V4。

## 敏感信息自查

提交前确认没有把本机环境或私人数据带进仓库。

### 禁止提交

| 类别 | 示例 | 处理 |
|---|---|---|
| 密钥与凭据 | API key、access token、私钥、`.npmrc` 中的 authToken | 已泄露的先撤销并轮换，不能只删文件 |
| 环境文件 | `.env`、`.env.*`、`*.pem`、`*.key` | 已由 `.gitignore` 排除 |
| 运行产物 | `.parallel-agent/`（契约、台账、回执、信号）、日志、`packages/cli/assets/`、`*.tgz` | 已由 `.gitignore` 排除 |
| 私人内容 | `._private/` 下的博客/投稿草稿、客户或未公开项目资料 | 不要使用 `git add -f` 强行加入 |
| 本机信息 | `C:\Users\<name>`、`E:\...` 绝对路径、系统用户名、机器名、PID、会话标题 | 替换为 `<repo>`、`%USERPROFILE%`、`<宿主目录>` 等占位符 |

### 提交前扫描

在仓库根目录执行：

```powershell
# 绝对路径（按实际盘符调整）
git grep -n -I -E '(C:\\Users\\|D:\\Programs\\|E:\\)'

# 常见密钥形态
git grep -n -I -E '(ghp_|github_pat_|npm_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY)'

# 私有文件与生成物是否被追踪
git ls-files | Select-String -Pattern '(\.env|\.parallel-agent|\._private|\.log$|\.tgz$|packages/cli/assets)'

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
7. 删除远端工作分支（可选）；里程碑或发布分支（如 `release/v2.1.0`）应保留

> 合并后本地同步用 `git pull --ff-only`，不要本地 `merge` 后直接 push `main`。

## 发布流程（仅维护者）

发布不是 PR 的一部分，由维护者在合并后单独执行。

### 发布前复核

- [ ] 全仓无本机绝对路径、系统用户名、真实邮箱、PID、会话标题
- [ ] `git ls-files` 无 `.env`、`.npmrc`、`.parallel-agent/`、日志、`packages/cli/assets/`、`*.tgz`
- [ ] npm 包内容不含私人资料或测试草稿
- [ ] 已确认历史遗留项：删除的文件仍可从旧 commit 取出，必要时评估改写历史
- [ ] GitHub 仓库已开启 Secret Scanning 与 Push Protection

### 步骤

1. 在 `main` 上确认 CI 绿
2. 同步版本号：`packages/cli/package.json` 与 `skills/*/SKILL.md` 的 `version` 保持一致
3. 更新 `README.md`、`docs/` 与 `test-docs/报告/`
4. 提交版本变更 PR 并合并
5. 本地 `git pull --ff-only` 拉到最新 `main`
6. 打 tag 并推送：

```powershell
git tag -a v3.0.0 -m "v3.0.0: 纯文本协议与 subagent 轨道"
git push origin refs/tags/v3.0.0
```

7. `release.yml` 自动执行：`npm pack`（`prepack` 复制 assets）→ GitHub Release → npm CLI 发布（GitHub OIDC Trusted Publisher）

**注意**：tag 一旦推送就会触发真实发布（npm 不可撤回），推送前务必确认版本号与 CHANGELOG。

## 提交信息

采用 Conventional Commits 前缀：`feat`、`fix`、`docs`、`refactor`、`test`、`chore`。

示例：

```
feat(skill): 仲裁者按能力档案分批 spawn
fix(cli): 用户改过的文件写 .new 备份
```

### 身份与署名

- author 与 committer 都必须是本人 GitHub 身份，推荐 `<id>+<username>@users.noreply.github.com`。
- Trae 终端会注入 `GIT_COMMITTER_NAME` / `GIT_COMMITTER_EMAIL`，优先级高于 `.git/config`。提交前先覆盖：

```powershell
$env:GIT_COMMITTER_NAME = '<你的用户名>'
$env:GIT_COMMITTER_EMAIL = '<id>+<username>@users.noreply.github.com'
```

## 报告问题

请附上：宿主类型与版本、能力档案、`install-state.json` 摘要和相关回执片段。
不要提交 `.parallel-agent/` 下的任何内容（已在 `.gitignore` 中整体排除）。
