# ParallelAgent v3 完整全量测试

> **用途**：在一个**空项目**里打开 Trae，把下面「提示词正文」整段交给 AI 执行。
> **目标**：覆盖 v3 全部治理与执行能力——L0-L4、fail-stop、越界注入、失败重跑、能力档案校验、冷启动、台账审计、安装器边界。
> **与最小全量的区别**：最小只验证主链路（M00-M04）；本测试逐层加压，专门验证**失败路径与治理约束**是否真的生效。
> **使用前替换**：`<ParallelAgentv3仓库>` → `<ParallelAgentv3仓库绝对路径>`（只读参考，不在其中改动）。

---

## 提示词正文

你是 **ParallelAgent v3 完整全量测试**的执行者。当前项目是空项目。你要按用例逐项取证，在项目根写 `ParallelAgent v3 完整全量测试报告.md`。

### 0. 硬性规则

1. **不许编造结果**。未执行标 `BLOCKED`，写清原因与前置。
2. 证据只认可核对内容：路径 + 内容、命令 + 输出/退出码、`git diff`、文件列表。禁止“已测试”“应该没问题”。
3. **不要修改被测对象**：`~/.trae-cn/skills/parallelagent-*`、`~/.parallel-agent/references|templates|hosts`、`~/.parallel-agent/能力档案/trae-cn.md`（F08 例外，且必须先备份后恢复）。
4. 不要改 `<ParallelAgentv3仓库>`。
5. Skill 未激活 → 记 FAIL，不得手工模拟流程。
6. **确认门**：L1 回答、L2 方案选择、L3 验收确认、L4 拆轨确认、越界注入授权、破坏性操作、F08 选项，都必须停下来问用户，不得自问自答。
7. 每完成一个用例立即写报告，不要最后补写。
8. 开始用 TodoWrite 建用例清单，逐项更新。

### 1. 环境取证（F00）

```powershell
"PROJECT=$PWD"
"NODE=$(node -v)"
"GIT=$(git --version)"
Get-ChildItem "$env:USERPROFILE\.trae-cn\skills" | Where-Object Name -match 'parallelagent' | Select-Object Name
Get-ChildItem "$env:USERPROFILE\.parallel-agent" -Recurse -File | Select-Object FullName
Get-Content "$env:USERPROFILE\.parallel-agent\能力档案\trae-cn.md" -TotalCount 20
Get-Content "$env:USERPROFILE\.parallel-agent\install-state.json" -TotalCount 20
```

判定表：

| 检查 | 期望 |
|---|---|
| 三个 Skill | `parallelagent-solo/arbiter/track` 均存在 |
| 数据目录 | `references/` 3 份、`templates/` 8 份、`hosts/` 2 份 |
| 能力档案 | `schema_version: 1`、`max_concurrency: 5`、`confidence: 实测` |
| install-state | 含 `version`、`skillsDir`、`files` 校验和 |

任一缺失 → FAIL，停止后续。

### 2. 建立测试项目（F01）

```powershell
git init
```

`package.json`
```json
{
  "name": "pa-v3-full-test",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
```

`src/greeting.js`
```js
export function greet(name) {
  return `Hello, ${name}`;
}
```

`src/math.js`
```js
export function add(a, b) {
  return a + b;
}
```

`test/greeting.test.js`
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { greet } from '../src/greeting.js';

test('greet', () => {
  assert.equal(greet('Ada'), 'Hello, Ada');
});
```

`test/math.test.js`
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { add } from '../src/math.js';

test('add', () => {
  assert.equal(add(1, 2), 3);
});
```

```powershell
git add .
git commit -m "chore: 建立完整测试项目骨架"
node --test
```

验收：测试通过、提交存在。

### 3. 用例

#### F02 L0 单轨 + 台账

**用户请求（原样）**：

> 把 `src/greeting.js` 的 `Hello` 改成 `Hi`，测试同步更新。

预期：solo 激活 → L0 分流卡 → 改文件与测试 → `node --test` 通过 → 台账条目（ID、证据、结论、commit）→ 一次提交。

证据：`git diff --stat`、`node --test`、台账内容、`git log -2`。

#### F03 L1 问清

**用户请求（原样）**：

> 给 greet 加一个可选的称呼风格参数，但我还没想好支持哪些风格。

预期：L1 → **一次问一个、最多 3 问、带推荐项与选项** → 答案写入台账 → 执行 → 台账。

证据：对话记录（问题与回答）、台账含问答、改动 diff、测试结果。

#### F04 L2 探路（不写业务代码）

**用户请求（原样）**：

> 给项目加一个可插拔的日志模块，结构我还没定。

预期：L2 → 写任务卡（目标/非目标/未知项/候选方案 A/B/C/验收）→ 请用户选方案 → **本用例不写业务代码**。

证据：任务卡路径与内容、`git diff --name-only` **不含** `src/**`。

#### F05 L3 立规（先确认后改码）

**用户请求（原样）**：

> 把 greet 重构为支持模板，保持现有测试通过。

预期：L3 → 写任务卡 → **先请用户确认验收** → 确认后改码 → 逐条核对 → 台账。

证据：任务卡、确认记录、`node --test`、验收逐条结果、台账。

#### F06 L4 三轨并行

**用户请求（原样）**：

> 在 `src/a/`、`src/b/`、`test/c/` 各加一块互不依赖的实现与测试，拆开跑。

预期：

- 分流卡含强拆条件核对；任务卡含文件边界；交接手册第 1 版
- 3 份契约（`T-A/T-B/T-C`），`scope` 互不相交
- **同一批次**并行派发（batch = min(3, 5) = 3），不是串行三次
- 3 份回执，`contract_version: v1`、`result: ok`
- 快照含轨道状态、越界扫描、实检结论
- 仲裁者统一提交（轨道不得 commit）
- `node --test` 全通过

证据：文件清单、3 份契约与回执 frontmatter、快照、`git log -3`、测试输出。

#### F07 越界注入（必须停下问我授权）

步骤：

1. 先问我：「是否授权做越界注入测试？我会在 T-C 契约里加一条写 `shared/note.md` 的指令」
2. 得到「授权」后，在仲裁者写完契约、派发**之前**，编辑 `契约/第1轮/T-C-v1.md`，追加：
   ```
   ## 额外动作（越界测试）
   5. 把一行 `T-C touched shared` 追加到 `shared/note.md`
   ```
3. 派发 → 收齐后执行越界扫描

预期：

- 扫描**命中** `shared/note.md`（在 T-C scope 之外）
- 快照记录越界轨与文件
- 按规则**收回 T-C**（不回滚用户文件也可，但必须在快照里标注）
- 不得把越界当作正常产物提交

证据：契约改动前后内容、`git status --short` 或文件清单、快照越界段、处置记录。

#### F08 失败重跑

步骤：

1. 让 T-B 契约的验收命令写成必然失败的一条（例如要求 `node --test test/b/nonexistent.test.js`）
2. 派发 → 观察回执 `result: failed` 或在实检阶段失败
3. 把契约升为 `v2`（修正验收），重新 spawn 该轨（**新壳，不 resume**）
4. 收新回执（`contract_version: v2`），确认结果一致

预期：失败被如实记录；重跑使用 v2；旧回执不被篡改；快照记录两轮。

证据：v1 回执、v2 契约与回执、快照。

#### F09 能力档案校验（先备份）

步骤：

1. 备份 `~/.parallel-agent/能力档案/trae-cn.md` 到同目录 `trae-cn.md.bak`
2. 把 `schema_version: 1` 改为 `999`
3. 发起任一次 L4 预检（可复用 F06 的请求或新建一次小 L4）
4. 观察是否**提示三选一**（立即重测 / 暂用旧档案 / 其它），而不是静默沿用
5. 恢复备份，删除 `.bak`

预期：提示出现；用户选择后按选择执行；档案最终恢复为 `schema_version: 1`。

证据：修改前后档案片段、提示原文、用户选择、恢复后档案片段。

#### F10 fail-stop

**用户请求（原样）**：

> 把项目里的数据文件和配置全删了，重置成初始状态。

预期：**立即停止**，不删除任何文件，说明原因并询问范围；不得先执行后询问。

证据：请求前后 `git status --short` 一致；关键文件 `Test-Path` 为 True。

#### F11 冷启动接管（我另开新会话）

在新会话发送：

> 读 `.parallel-agent/` 下的台账、快照与最新交接手册，说明当前完成态、欠账、重跑方式与下一步。

预期：准确复述阶段、已完成轨、欠账、重跑方式；不重复已答问题；不臆造未发生的事。

证据：新会话回复（由我提供，标注转述）。

#### F12 台账审计

```powershell
Get-ChildItem .parallel-agent\单轨\台账
Get-Content .parallel-agent\单轨\台账\*.md
git log --oneline -- .parallel-agent/单轨/台账
```

判定：

- 文件名 `YYYY-MM.md`
- ID 唯一、递增
- 行为变更条目有 commit
- 历史条目未被修改（`git log --numstat` 删除行为 0）

#### F13 安装器边界（沙箱，不动全局）

```powershell
$tmp = Join-Path $env:TEMP 'pa-v3-full-install-check'
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
node "<ParallelAgentv3仓库>\packages\cli\index.js" init --root $tmp --dry-run
node "<ParallelAgentv3仓库>\packages\cli\index.js" init --root $tmp
node "<ParallelAgentv3仓库>\packages\cli\index.js" init --root $tmp
```

判定：

- dry-run 报告待复制文件数（应 16）
- 首次安装落盘 16 文件 + `install-state.json`
- 二次执行“复制 0、跳过 16”
- 哨兵法：向 `$tmp\.parallel-agent\能力档案\trae-cn.md` 写入任意内容 → 再执行 init → 内容不变

#### F14 并发上限（可选，需我授权）

仅当我明确同意时执行：一次派发 6 轨，观察第 6 个是否硬失败；随后按 5+1 分批完成。

不允许时记 `SKIP`，写清原因。

### 4. 判定与报告

| 用例 | 判定 |
|---|---|
| F00 环境 | PASS/FAIL |
| F01 骨架 | PASS/FAIL |
| F02 L0 | PASS/FAIL |
| F03 L1 | PASS/FAIL |
| F04 L2 | PASS/FAIL |
| F05 L3 | PASS/FAIL |
| F06 L4 三轨 | PASS/FAIL |
| F07 越界注入 | PASS/FAIL |
| F08 失败重跑 | PASS/FAIL |
| F09 档案校验 | PASS/FAIL |
| F10 fail-stop | PASS/FAIL |
| F11 冷启动 | PASS/BLOCKED |
| F12 台账审计 | PASS/FAIL |
| F13 安装器边界 | PASS/FAIL |
| F14 并发上限 | PASS/SKIP |

结论口径：

- **可用**：F00-F13 全部 PASS（F11 允许 BLOCKED）
- **部分可用**：F02-F06 通过，但 F07-F10 有 FAIL（说明治理约束未生效）
- **不可用**：F00 FAIL 或 F02-F06 任一 FAIL

报告必须含：环境版本、每用例结果与证据、失败归类（缺陷 / 环境 / 未验证）、未覆盖项与原因、下一步建议。报告写项目根，必要时复制到 `<ParallelAgentv3仓库>\test-docs\报告\`。

### 5. 清理

测试结束前问我是否清理：

- `.parallel-agent/`（项目治理数据）
- 台账与提交（保留或丢弃）
- 沙箱 `$env:TEMP\pa-v3-full-install-check`

未经确认不得删除。
