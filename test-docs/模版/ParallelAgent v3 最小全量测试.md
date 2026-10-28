# ParallelAgent v3 最小全量测试

> **用途**：在一个**空项目**里打开 Trae，把下面「提示词正文」整段交给 AI 执行。
> **目标**：用最少用例覆盖 v3 的完整链路——Skill 激活 → 单轨台账 → L4 双轨并行 → 冷启动。全部通过即说明一期主链路可用。
> **使用前替换**：`<ParallelAgentv3仓库>` → `<ParallelAgentv3仓库绝对路径>`（只读参考，不在其中改动）。

---

## 提示词正文

你是 **ParallelAgent v3 最小全量测试**的执行者。当前项目是空项目，你要在这里跑完最小完整链路，并在项目根写 `ParallelAgent v3 最小全量测试报告.md`。

### 0. 硬性规则

1. **不许编造结果**。未执行的用例标 `BLOCKED`，写清原因与前置条件。
2. 证据只认可核对内容：文件路径、命令 + 输出/退出码、`git diff`、文件内容。禁止写“已测试”“应该没问题”。
3. **不要修改** `~/.trae-cn/skills/parallelagent-*` 与 `~/.parallel-agent/references|templates|hosts`（那是被测对象）。
4. 不要改 `<ParallelAgentv3仓库>`；报告写完后由**用户手动**复制到 `<ParallelAgentv3仓库>\test-docs\报告\`，执行者不代做。
5. **Skill 未激活就记 FAIL**，不要手工模拟它的流程来凑通过。
6. 涉及删除、重置、卸载的操作先问我；本测试默认不需要。
7. 每完成一个用例立即把结果与证据写进报告，不要最后补写。
8. 开始用 TodoWrite 建用例清单，逐项更新。

### 1. 环境取证（M00）

```powershell
"PROJECT=$PWD"
"NODE=$(node -v)"
"GIT=$(git --version)"
Get-ChildItem "$env:USERPROFILE\.trae-cn\skills" | Where-Object Name -match 'parallelagent' | Select-Object Name
Get-ChildItem "$env:USERPROFILE\.parallel-agent" -Recurse -File | Select-Object FullName
Get-Content "$env:USERPROFILE\.parallel-agent\能力档案\trae-cn.md" -TotalCount 12
```

判定：

- 三个 Skill 存在（`parallelagent-solo/arbiter/track`）
- `~/.parallel-agent` 下存在 `references/` `templates/` `hosts/` `install-state.json`
- 能力档案存在且 `schema_version: 1`、`max_concurrency: 5`、`confidence: 实测`
- 任一项缺失 → 记录 FAIL 并停止后续（环境不满足）

### 2. 建立最小测试项目（M01，由你执行）

```powershell
git init
```

创建以下文件并提交：

`package.json`
```json
{
  "name": "pa-v3-min-test",
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

`test/greeting.test.js`
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { greet } from '../src/greeting.js';

test('greet', () => {
  assert.equal(greet('Ada'), 'Hello, Ada');
});
```

```powershell
git add .
git commit -m "chore: 建立最小测试项目骨架"
node --test
```

验收：`node --test` 通过，`git log --oneline -1` 有提交。

### 3. 用例

#### M02 L0 单轨（验证 solo 激活 + 台账）

**发送这条用户请求**（原样）：

> 把 `src/greeting.js` 里的 `Hello` 改成 `Hi`，保持测试能过。

预期：

- 激活 `parallelagent-solo`，给出 L0 分级判定并落台账（L0 不强制单列分流卡文件；台账条目的「模式」字段即分级依据）
- 只改 `src/greeting.js`
- 同步更新 `test/greeting.test.js` 的断言（否则测试失败）——这是允许的最小连带
- 运行 `node --test` 通过
- 写 `.parallel-agent/单轨/台账/YYYY-MM.md`，条目含 ID（`S-YYYYMMDD-NNN`）、证据、结论、commit hash
- 产生一次 git 提交

证据：`git diff --stat`、`node --test` 输出、台账文件内容、`git log --oneline -2`。

#### M03 L4 双轨并行（验证契约/回执/快照/扫描/统一提交）

**发送这条用户请求**（原样）：

> 在 `src/a/` 和 `src/b/` 各加一个独立模块：A 加 `sum.js` 导出 `sum(a,b)`，B 加 `upper.js` 导出 `upper(s)`，各自带一个 `node:test` 测试；两块互不依赖，拆开跑。
>
> 验收条件与非目标按任务卡执行，我确认；文件边界以任务卡为准。

预期：

- 激活 `parallelagent-arbiter`（或 solo 判定 L4 后移交仲裁者）
- 派发前完成 §1.4 三件套确认（验收条件 / 非目标 / 文件边界；本条已在提示词中预置确认语句）
- 写 `.parallel-agent/分流卡/`、`任务卡`、`交接手册/第1版-开轨前.md`
- 写 2 份契约：`契约/第1轮/T-A-v1.md`、`T-B-v1.md`，`scope` 互不相交
- 同一批次并行派发 2 个子代理（不是串行两次）
- 收齐 2 份回执：`回执/第1轮/T-A-v1.md`、`T-B-v1.md`，frontmatter 含 `kind: 回执`、`contract_version: v1`、`result: ok`
- 写快照：`快照.md`，含轨道状态、越界扫描结果、实检结论、`handover_version`
- 越界扫描无命中
- `node --test` 全部通过
- 收尾时出 `交接手册/第2版-收尾.md`（更新轨道状态与欠账；未出新版视为收尾未完成）
- 由仲裁者提交两次：产物提交 A → 快照/手册/台账补全（只记 A）→ 元文件提交（hash 不进文档）；轨道不得各自 commit，文档里不得出现「待提交」

证据：

- `git ls-files .parallel-agent` 或文件列表（证明契约/回执/快照存在）
- 两份契约与回执的 frontmatter（`kind/track/round/contract_version/result/artifacts/scope`）
- `git log --oneline -3`
- `node --test` 输出
- 快照正文

#### M04 冷启动（我另开新会话执行）

在我新开的会话里发送：

> 读 `.parallel-agent/` 下的台账、快照与交接手册，说明当前完成态、欠账和下一步。

判定：能准确说出已完成项、引用文件路径、给出下一步；不重复问已记录的问题。

证据：粘贴新会话回复（由我提供），标注为转述。

### 4. 判定与报告

| 用例 | 判定 |
|---|---|
| M00 环境 | PASS/FAIL |
| M01 骨架 | PASS/FAIL |
| M02 L0 | PASS/FAIL |
| M03 L4 双轨 | PASS/FAIL |
| M04 冷启动 | PASS/BLOCKED |

结论取值：

- **可用**：M00-M03 全 PASS
- **部分可用**：M00 通过，M02/M03 至少一项 FAIL
- **不可用**：M00 FAIL

报告必须含：环境版本、每个用例的实际结果与证据、失败项归类（缺陷 / 环境 / 未验证）、下一步建议。报告写在项目根，归档到 `<ParallelAgentv3仓库>\test-docs\报告\` 由用户手动完成。
