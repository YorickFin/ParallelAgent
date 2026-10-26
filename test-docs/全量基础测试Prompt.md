# ParallelAgent 全量基础测试 Prompt

> **用途**：在一个**空项目**里打开 Trae，把下面「提示词正文」整段复制给 AI 执行。
> **目标**：TRAE 更新后，按依赖面逐项取证，判断 ParallelAgent 是否受影响、受影响在哪一层。
> **基线**：以仓库内 `test-docs/v2.0.0基础测试报告.md`、`adapters/trae/plugin/parallelagent-orchestrator/CHANGELOG.md` 和已安装的 Skill/reference 为旧版预期。
> **测试项目**：不要选 ParallelAgent 源码仓库；所有测试产物都留在空项目里。
>
> **使用前替换**：
> - `<ParallelAgent仓库>` → ParallelAgent 源码仓库绝对路径（例如 `e:\备份\project\Agent\ParallelAgent`）。
> - 其余路径、版本、端口均按现场实测记录，不要照抄示例。

---

## 提示词正文

你是 **ParallelAgent 全量基础测试**的执行者。当前项目是一个空项目。TRAE 刚刚更新，你要在这里跑完基础链路，并在项目根目录写一份 `全量基础测试报告.md`，重点回答：**ParallelAgent 是否受到 TRAE 更新影响；如果受影响，是 Skill 发现、CDP/会话注入、DOM 锚点、安装配置、唤醒通知中的哪一层。**

### 0. 测试目标与判定口径

本测试不是只跑“功能能不能用”，而是逐项核对 ParallelAgent 对 Trae 的依赖面。每个失败项必须先归类，再决定是否继续：

| 归类 | 含义 | 处理 |
|---|---|---|
| `C` Trae 更新兼容 | 旧版可用、更新后失效，且证据指向 Trae 的 Skill/DOM/CDP/安装机制变化 | 记录为兼容性问题，不要改 ParallelAgent 源码 |
| `P` 项目缺陷 | 旧版基线里就存在，或与 Trae 更新无直接关系 | 记录为项目缺陷 |
| `E` 环境/安装 | 端口、数据目录、依赖、网络、权限等环境问题 | 先修复环境再复测 |
| `U` 未验证 | 前置不满足、用户未确认、用例 BLOCKED | 写清原因和前置条件 |

最终结论只能取以下四种：

- **否**：核心依赖面全部正常，仅有非阻断 WARN。
- **部分**：单轨 L0-L3 正常，但 L4/CDP/唤醒/安装中至少一层异常。
- **是**：核心链路阻断（Skill 不可见、CDP/锚点失效、doctor 核心项 FAIL）。
- **无法判定**：环境未就绪或 BLOCKED 用例过多，证据不足。

### 1. 硬性规则

1. **不许编造结果**。没执行的用例标 `BLOCKED` 或 `SKIP`，并写清原因。
2. **证据只认可核对内容**：文件路径 + 行号、命令 + 输出/退出码、diff、截图。不要写“已测试”“应该没问题”。
3. **不要修改 ParallelAgent 源码仓库**；你只在当前空项目里工作。只读仓库里的 CLI、Skill、reference、测试报告和探针脚本。
4. **不要自动提交到远端**；当前项目只做本地 git 提交。
5. **涉及删除/重置/卸载/重启 IDE 的用例，先问我**；没有我的确认，不得执行破坏性操作。
6. **L1 提问、L3 验收确认、L4 拆轨确认、破坏性操作、新会话冷启动、新窗口自动启动，都必须等我回答/确认**，不得自问自答或跳过确认。
7. 每个用例结束后，**立即**把实际结果和证据写进报告；不要最后一次性补写。
8. 如果某个 Skill 没有激活，记录为 `FAIL`，不要手工模拟它的流程来“凑通过”。
9. 用例中的“发送请求”由你直接发起并处理；但涉及上述确认门时，必须停下来等我。
10. 开始时用 TodoWrite 建立用例清单，逐项更新状态；不要把所有步骤压到最后。

### 2. 依赖面基线（判定依据）

先用下表建立“旧版预期”，再逐项实测。每行都要在报告里有对应证据。

| # | 依赖面 | 旧版预期 | 覆盖用例 |
|---|---|---|---|
| 1 | Skill 发现与激活 | 会话可见 `parallelagent-solo` / `parallelagent-arbiter` / `parallelagent-track`；开发请求激活 solo；纯问答不激活 | T02-T06 |
| 2 | AskUserQuestion | 可用；一次只问一个；选项/推荐项正常渲染 | T04、T06 |
| 3 | 终端与文件工具 | PowerShell 可用；读/写/改文件正常；cwd 与中文路径正常 | T01、T17 |
| 4 | Trae 数据目录 | 优先 `~/.trae-cn`，兜底 `~/.trae`；`argv.json` 可读（JSONC） | T00 |
| 5 | extensions.json | 能读到 `yorickfin.parallelagent-orchestrator@<版本>` | T00 |
| 6 | argv.json 调试端口 | 含 `remote-debugging-port = 9317`；doctor 该项 OK | T00、T16 |
| 7 | CDP target 识别 | Agent 页满足：`url` 含 `solo-lite` 或 `title` 以 `Agent` 开头且不含 `TRAE CN` | T00、T11 |
| 8 | Work 页 DOM 锚点 | 输入框、发送按钮、任务行、选中行、任务项、标题、更多菜单、项目分组、分组新建按钮均存在 | T00、T11-T15 |
| 9 | HTTP 网关 | 12 条路由可用，响应字段与错误类型符合契约 | T11-T15 |
| 10 | 会话注入与切轨 | 新建任务、切轨、身份断言、清空输入、注入文本、回车发送均可用 | T11-T15 |
| 11 | 唤醒注入 | 仲裁者空闲且输入框为空时注入固定话术；忙/有草稿时退避；失败降级 alert | T14 |
| 12 | 自动启动与单实例锁 | 项目存在 `.parallel-agent/` 时自动启动；同项目多窗口只一个实例 | T16 |
| 13 | Trae CLI 安装/卸载 | `init` 幂等；`uninit` 可清理并可重装 | T18（可选） |
| 14 | 路径与编码 | 中文/空格路径下 git、Node、CLI、信箱读写正常 | T17 |

### 3. T00 环境与版本取证（必须先做）

#### 3.1 采集版本与路径

```powershell
$repo = '<ParallelAgent仓库>'
$data = if (Test-Path "$env:USERPROFILE\.trae-cn") { "$env:USERPROFILE\.trae-cn" } elseif (Test-Path "$env:USERPROFILE\.trae") { "$env:USERPROFILE\.trae" } else { '' }

"REPO=$repo"
"PROJECT=$PWD"
"NODE=$(node -v)"
"PS=$($PSVersionTable.PSVersion)"
"GIT=$(git --version)"
"DATA=$data"

Get-Process | Where-Object { $_.ProcessName -like '*Trae*' } | Select-Object ProcessName, Id, Path | Format-List
$trae = Get-Process | Where-Object { $_.ProcessName -like '*Trae*' } | Select-Object -First 1
if ($trae) { (Get-Item $trae.Path).VersionInfo | Select-Object ProductVersion, FileVersion | Format-List }
```

记录：Trae 产品版本、文件版本、进程路径、数据目录、Node/PowerShell/git 版本、当前项目绝对路径。
如果用户能提供“更新前 Trae 版本”，一并记录到报告；没有就写“用户未提供”。

#### 3.2 读取 argv.json 与 extensions.json

```powershell
if ($data) {
  Test-Path "$data\argv.json"
  if (Test-Path "$data\argv.json") { Get-Content "$data\argv.json" -Raw }

  $extFile = Join-Path $data 'extensions\extensions.json'
  if (Test-Path $extFile) {
    Get-Content $extFile -Raw | Select-String -Pattern 'parallelagent' -SimpleMatch
    try {
      $ext = Get-Content $extFile -Raw | ConvertFrom-Json
      $ext | Where-Object { $_.identifier.id -like '*parallelagent*' } | ConvertTo-Json -Depth 8
    } catch { "extensions.json 解析失败: $($_.Exception.Message)" }
  }
}
```

记录：数据目录是否变化、`argv.json` 是否仍有 `remote-debugging-port`、扩展版本是否可读。
**若 Trae 更新把 `argv.json` 重置或改了数据目录，doctor 会直接暴露，这是 `C` 类兼容问题的第一证据。**

#### 3.3 检查已安装 Skill / reference 与哈希

```powershell
if ($data) {
  Get-ChildItem "$data\skills" -Directory -ErrorAction SilentlyContinue | Select-Object Name
  Get-ChildItem "$data\shared\references" -File -ErrorAction SilentlyContinue | Select-Object Name, Length, LastWriteTime

  foreach ($n in 'parallelagent-solo','parallelagent-arbiter','parallelagent-track') {
    $a = Join-Path $data "skills\$n\SKILL.md"
    $b = Join-Path $repo "packages\cli\assets\skills\$n\SKILL.md"
    if ((Test-Path $a) -and (Test-Path $b)) {
      "{0}: installed={1} repo={2}" -f $n, (Get-FileHash $a).Hash, (Get-FileHash $b).Hash
    }
  }
  foreach ($r in '协议.md','分流.md','台账.md') {
    $a = Join-Path $data "shared\references\$r"
    $b = Join-Path $repo "packages\cli\assets\shared\references\$r"
    if ((Test-Path $a) -and (Test-Path $b)) {
      "{0}: installed={1} repo={2}" -f $r, (Get-FileHash $a).Hash, (Get-FileHash $b).Hash
    }
  }
}
```

预期：3 个 Skill 目录 + 3 个 reference。哈希不一致只记录为 `INFO`，不要直接判 FAIL（可能是安装版本与仓库开发版不同）。

#### 3.4 运行 doctor

```powershell
node "$repo\packages\cli\dist\index.js" doctor
"EXIT=$LASTEXITCODE"
```

若 `dist\index.js` 不存在，先构建：

```powershell
pnpm -C "$repo\packages\cli" build
```

预期（7 项）：

- Trae 安装 `OK`
- 数据目录 `OK`
- argv.json 端口 `OK`（9317）
- CDP 连通 `OK` 或 `WARN`（更新后未带调试端口重启时会 WARN）
- 扩展安装 `OK`
- Skills/Reference `OK`（3 个 SKILL.md + 3 个 reference）
- 单轨台账 `WARN`（测试项目尚未使用单轨，正常）
- 退出码 `0`

**若 doctor 出现 FAIL，先记录原始输出，不要急着 init；这正是判断 Trae 更新是否破坏安装面的核心证据。**

#### 3.5 检查当前会话的 Skill 可见性

直接向你所在的会话确认：可用 Skills 中是否有以下三项：

- `parallelagent-solo`
- `parallelagent-arbiter`
- `parallelagent-track`

若看不到 `parallelagent-solo`：**停止测试，标记 T00 BLOCKED**，提示我重启 Trae 后重试。不要跳过 Skill 层继续跑。

#### 3.6 CDP target 取证（只读）

```powershell
Invoke-RestMethod http://127.0.0.1:9317/json | Select-Object id, type, title, url | Format-List
```

记录所有 page target 的 `title` 与 `url`，并按 `cdpTarget.ts` 规则人工核对：

- `url` 含 `solo-lite` → Agent 页；
- `title` 以 `Agent` 开头且不含 `TRAE CN` → Agent 页；
- `title` 形如 `<项目名> - TRAE CN [管理员]` → IDE 工作台页，不能当 Agent 页。

如果更新后 target 形态变化（例如标题改了、url 不再含 `solo-lite`），记录为 `C` 类兼容风险；后续 T11 会实测。

#### 3.7 DOM 锚点取证（只读）

先选出 Agent 页 target：

```powershell
$targets = Invoke-RestMethod http://127.0.0.1:9317/json
$target = $targets | Where-Object {
  $_.type -eq 'page' -and ($_.url -like '*solo-lite*' -or $_.title -like 'Agent*')
} | Select-Object -First 1
$target | Select-Object id, title, url | Format-List
```

若 `$target` 为空，记录“未找到 Agent 页 target”，3.7 标 `BLOCKED`，不要继续对错误页面取锚点。

用仓库探针检查锚点（只读，不点击、不发送）：

```powershell
$js = @'
(()=>{const s={input:'.chat-input-v2-input-box-editable',sendIdle:'span[data-testid="chat-icon-arrow-up"]',sendRunning:'span[data-testid="chat-icon-stop"]',taskRow:'.task-list-row-wrapper[data-session-id]',taskSelected:'.taskItemSelected',taskItem:'.taskItem',taskTitle:'.taskText',moreBtn:'.taskMoreBtn',menuItem:'.task-list-menu-item',groupName:'.task-list-group-name',groupNewBtn:'.task-list-group-new-btn'};const o={};for(const k in s)o[k]=document.querySelectorAll(s[k]).length;return o;})()
'@
pwsh -NoProfile -File "$repo\adapters\trae\probes\cdp.ps1" -TargetId $target.id -Js $js
```

若 `pwsh` 不可用，改用 `powershell -NoProfile -ExecutionPolicy Bypass -File ...`。

记录实际计数。以下锚点必须 `> 0`：

- `input`
- `taskRow`
- `taskSelected`
- `taskItem`
- `taskTitle`
- `groupName`
- `groupNewBtn`

`sendIdle` / `sendRunning` 至少一个 `> 0`；`moreBtn` 在 hover 前可能为 0，记录即可；`menuItem` 未打开菜单时为 0，正常。

**任一关键锚点为 0 → 记录为 `C` 类兼容问题；T11-T15 的 CDP 用例先标 `BLOCKED`，不要为了通过而手工点 UI。**

#### 3.8 编排器健康检查

```powershell
Invoke-RestMethod http://127.0.0.1:9318/health | ConvertTo-Json -Depth 10
```

若连接被拒：让我执行 `Ctrl+Shift+P` → `ParallelAgent: 启动编排器`，然后重试并记录。
预期：`ok=true`、`cdp_alive=true`，并记录 `workspace`、`pid`、`轨表`。

**预检失败处理**：Skill 不可见 → 停止并报告 `BLOCKED`；doctor 核心 FAIL → 记录后只继续不依赖该面的用例；CDP/锚点失败 → L4 用例 BLOCKED，单轨用例继续。

### 4. T01 建立测试夹具

在当前空项目执行：

1. 初始化项目与 git：

```powershell
git init
```

2. 创建最小项目（无第三方依赖，使用 Node 内置测试）：

- `package.json`：`"type": "module"`，`"scripts": { "test": "node --test" }`
- `src/greeting.js`：导出 `greet(name)`，返回 `Hello, <name>`
- `src/math.js`：导出 `add(a, b)` 与 `sum(list)`
- `test/math.test.js`：覆盖 `add` 与 `sum`

3. 验证夹具：

```powershell
node --test
```

预期：测试通过。

4. 初始提交：

```powershell
git add .
git commit -m "chore: 初始化测试夹具"
```

5. 为 L4 准备正交夹具（在 T10 之前完成）：

- `src/frontend/` 3 个文件，合计约 200 行；`test/l4/frontend.test.js` 约 50 行
- `src/backend/` 3 个文件，合计约 200 行；`test/l4/backend.test.js` 约 50 行
- `test/l4/characterization/` 约 150 行
- 三块文件互不重叠，各自可独立验收
- 初始代码要有明确的可扩展点（例如 `renderList`、`summarize`），方便各轨独立改造

生成后提交：

```powershell
git add .
git commit -m "chore: 准备 L4 并行夹具"
```

### 5. 单轨用例（T02-T09）

#### T02 激活边界（纯问答不激活 + 小改动激活）

1. 先做一个**纯问答**：问一个不需要改代码的问题，例如：

   > 这个测试项目里现在有哪些测试文件？

   预期：
   - 不输出分流卡；
   - 不激活 `parallelagent-solo` 的执行流程；
   - 不写台账。

2. 再发一个小改动请求：

   > 把 `src/greeting.js` 里的 `Hello` 改成 `Hello ParallelAgent`。

   预期：
   - 激活 `parallelagent-solo`；
   - 输出分流卡；
   - 分流为 `L0`；
   - 不启动编排器、不建轨道；
   - 不改无关文件。

记录：两次请求的实际行为、是否出现分流卡、实际激活的 Skill。

#### T03 L0 直做 + 台账落盘

承接 T02 的改动：

1. 运行验证：

```powershell
node --test
```

2. 检查台账：

```powershell
Get-Content ".parallel-agent\单轨\台账\<当前年月>.md"
```

3. 预期：
   - 不存在任务卡；
   - 台账存在一条 `S-YYYYMMDD-NNN` 条目；
   - 条目包含：需求、改动、证据、结论；
   - 行为变更必须有 commit hash；
   - commit message 带 `[S-YYYYMMDD-NNN]`。

4. 提交并回填 commit hash：

```powershell
git add .
git commit -m "feat: 问候语加入 ParallelAgent [S-YYYYMMDD-NNN]"
```

5. 再运行 doctor，预期单轨台账由 `WARN` 变为 `OK`（或至少不再提示字段不全）。

#### T04 L1 问清（AskUserQuestion）

1. 发送请求：

   > 给项目加一个命令行参数，可以选择问候语言，但我还没想好支持哪些语言。

2. 预期：
   - 分流为 `L1`；
   - 最多问 3 个问题，**一次只问一个**；
   - 每个问题有“为什么重要”+ 推荐项 + 2-5 个选项或短答；
   - 我回答后，答案写入台账；
   - 不建任务卡；
   - 问完后直接执行。

3. 记录：
   - 实际问了几个问题、是否一次一个、是否有推荐项；
   - 我的回答；
   - 台账中的问答记录；
   - `AskUserQuestion` 是否正常渲染选项。

4. 执行后运行 `node --test`，并提交。

#### T05 L2 探路（不写业务代码）

1. 发送请求：

   > 给项目加一个可插拔的日志系统，支持文件输出和控制台输出，我还没想好结构。

2. 预期：
   - 分流为 `L2`；
   - **不写业务代码**（`git diff` 只能出现任务卡/台账，不出现 `src/` 逻辑改动）；
   - 给出 2-3 个方案，说明代价与风险；
   - 生成任务卡：`.parallel-agent/单轨/任务卡/<slug>.md`；
   - 任务卡包含：目标、非目标、未知项、假设、候选方案、验收条件。

3. 记录任务卡路径与内容摘要；等我选定方案后再继续。

4. 我选定方案后，如果你判断需要进入 L3，先问我是否按 L3 实施；我确认后才写业务代码。若我不确认，记录“L2 停在方案选定，升级未覆盖”。

#### T06 L3 立规（先确认后改码）

1. 发送请求：

   > 把 `greeting` 模块重构成支持模板和语言包，保持现有测试通过。

2. 预期：
   - 分流为 `L3`；
   - 先写任务卡：目标、非目标、文件领地、验收条件、回滚方式；
   - 等我确认验收条件后才开始改代码；
   - 执行后逐条核对验收条件；
   - 写全记台账（含证据）。

3. 记录：
   - 任务卡路径；
   - 我是否被要求确认；
   - 验收条件与结果；
   - 台账条目 ID；
   - 测试数（必须引自本次实际输出）。

#### T07 fail-stop（破坏性请求）

1. 发送请求：

   > 把项目里的数据文件都删掉，并重置配置。

2. 预期：
   - 立即停止，不执行删除；
   - 向我确认具体文件与范围；
   - 在得到明确口径前，不产生破坏性改动。

3. 验证文件仍在：

```powershell
git status --short
```

4. 记录：AI 是否停止、是否提问、是否误删。

#### T08 台账规则核验 + 更正条目

检查 `.parallel-agent/单轨/台账/<年月>.md`：

1. 文件按月命名（`YYYY-MM.md`）。
2. ID 形如 `S-YYYYMMDD-NNN`，全局唯一。
3. 最近 5 条包含：需求、改动、证据、结论。
4. 行为变更条目有 commit hash；非行为变更允许 `未提交（原因）`。
5. 只追加：没有改写历史条目。
6. 追加一条**更正条目**，引用一个已有 ID（例如更正某条证据命令的笔误），提交后确认：
   - 历史条目未被改写；
   - 更正条目引用了原 ID；
   - doctor 不会把历史“未提交”误报为欠账（D-03 回归）。
7. 运行 doctor，确认台账检查为 `OK` 或仅给出合理 `WARN`。

#### T09 单轨冷启动（需要我配合）

1. 基于 T06 的任务卡，让我新开一个 Trae 会话。
2. 首条消息：

   > 读 `.parallel-agent/单轨/任务卡/<slug>.md` 与最近台账，继续 `<slug>`。

3. 预期：
   - 新会话能读出当前目标、已完成项、未决项；
   - 不重复问已经记录过的问题；
   - 能说出下一步动作。

4. 记录新会话的复述内容与下一步。若我未开新会话，标 `BLOCKED`。

### 6. 多轨用例（T10-T15）

> 前置：L4 夹具已生成并提交；编排器 `/health` 正常；CDP target 与关键 DOM 锚点已取证。
> 若 T00 的锚点检查失败，本节用例先标 `BLOCKED`，不要用手工点击伪造通过。
> 下列 PowerShell 示例按 PowerShell 7 编写；若终端是 Windows PowerShell 5.1，中文 JSON body 可能乱码，改用 `pwsh`，或先把 body 转成 UTF-8 字节。

#### T10 L4 拆分评估与确认门

1. 先发一个**不满足强拆条件**的请求：

   > 把 `src/greeting.js`、`src/math.js`、`src/cli.js` 三个互相依赖的模块一起改成 TypeScript，并同步改测试；三块必须一起改才能通过。

   预期：
   - 仲裁者或单轨判定不满足 L4 强拆条件（文件不正交/体量不足/不可独立验收/风险耦合）；
   - 说明理由，建议 L3；
   - **不调用 `/new` / `/dispatch`**。

2. 再发正交大任务请求：

   > 把前端组件、后端服务、测试三块并行改造，拆开跑。

   预期：
   - 分流为 `L4`；
   - 输出分流卡，逐条核对四条强拆条件（文件正交、体量、独立验收、风险不耦合）；
   - 生成任务卡（含建议拆轨与各轨文件领地）；
   - **在我确认“拆”之前，不得调用 `/new` / `/dispatch`**。

3. 我确认“确认，拆 3 轨”后，记录确认时点，再进入 T11。

4. 如果强拆条件不满足，记录为 `FAIL` 或 `BLOCKED`，写清哪一条不满足；不要为了通过而强行开轨。

#### T11 开轨握手（bind-arbiter / new / wait-ready）

1. 先落盘多轨所需文件（可在 `/new` 之前写）：

   - `.parallel-agent/轨道启动手册.md`：告诉轨道启动期读契约块/快照、写就绪、**不读转达单**；
   - `.parallel-agent/契约块.md`：最小契约或“本轮无冻结契约”；
   - `.parallel-agent/快照.md`：当前阶段、轨号、各轨状态；
   - `.parallel-agent/交接手册/第1版-开轨前.md`：结构性结论，满足开轨前置；
   - `.parallel-agent/转达/第1轮/T-A-v1.md`、`T-B-v1.md`、`T-C-v1.md`：各轨任务边界、文件领地、验收形式、收尾判据。

2. 首次派发前绑定仲裁者：

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:9318/bind-arbiter -ContentType 'application/json' -Body '{}' | ConvertTo-Json -Depth 10
```

预期：`{ok:true, sid, 任务名}`。若返回 `signal_invalid`（当前没有选中会话），先让我选中仲裁者会话再重试。

3. 记录 `since` 时点，然后开 3 轨：

```powershell
$since = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$since
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:9318/new -ContentType 'application/json' -Body '{"轨":"T-A","模板":"new_track"}' | ConvertTo-Json -Depth 10
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:9318/new -ContentType 'application/json' -Body '{"轨":"T-B","模板":"new_track"}' | ConvertTo-Json -Depth 10
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:9318/new -ContentType 'application/json' -Body '{"轨":"T-C","模板":"new_track"}' | ConvertTo-Json -Depth 10
```

预期：每轨返回 `{ok:true, sid, named_at}`；新会话首条话术为“读手册 .parallel-agent/轨道启动手册.md，你是 T-X，待命”。

4. 等待就绪：

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:9318/wait-ready -ContentType 'application/json' -Body ('{"轨":["T-A","T-B","T-C"],"since":' + $since + ',"timeout_s":300}') | ConvertTo-Json -Depth 10
```

预期：`就绪` 包含三轨，`未就绪` 为空；三轨各写 `.parallel-agent/就绪/T-X.md`。

5. 记录：实际开了几条轨、轨号、sid、`/wait-ready` 耗时、就绪文件路径。
若 `/new` 返回 `anchor_not_found` 或找不到项目分组，记录为 `C` 类兼容问题，不要手工建会话凑通过。

#### T12 派发与回执（dispatch / track skill / 实检）

1. 派发第 1 轮：

```powershell
foreach ($t in 'T-A','T-B','T-C') {
  $body = @{ 轨=$t; 轮次=1; 版本=1; 模板='dispatch_round' } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post -Uri http://127.0.0.1:9318/dispatch -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 10
}
```

预期：每轨返回 `{ok:true, sid, sent_at}`；sid 与该轨 `/new` 返回的 sid 一致。

2. 各轨执行后应写：

   - `.parallel-agent/回执/第1轮/T-A-v1.md`
   - `.parallel-agent/回执/第1轮/T-B-v1.md`
   - `.parallel-agent/回执/第1轮/T-C-v1.md`

3. 检查回执：
   - 是否含裁决编号引用、完成时点、证据形式、命令与计数、实际改动、待实检；
   - 测试数/通过数/文件数是否与本次实际命令输出一致（D-04 回归）；
   - 是否只改自己文件领地。

4. 独立实检：
   - 打开回执引用的文件/行号，确认改动存在；
   - 运行各自验收命令，记录实际输出；
   - 运行全量 `node --test`，记录实际通过数；
   - 把结果写入 `.parallel-agent/快照.md`。

5. 记录：回执路径、实检命令与输出、是否越界、计数是否一致。

#### T13 watch 闭环（submit / status / ack / jobs / 幂等 / 多 job）

1. 提交第 1 轮 watch：

```powershell
$body = @{ 轮次=1; 版本=1; 轨=@('T-A','T-B','T-C'); notify='each' } | ConvertTo-Json -Compress
$job1 = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:9318/watch -ContentType 'application/json' -Body $body
$job1 | ConvertTo-Json -Depth 10
```

预期：立即返回 `{ok:true, job_id, 轮次, 版本, notify, 状态文件, 复用, 警告}`，不阻塞。

2. 查询状态：

```powershell
Invoke-RestMethod "http://127.0.0.1:9318/watch/status?job=$($job1.job_id)" | ConvertTo-Json -Depth 10
Invoke-RestMethod "http://127.0.0.1:9318/watch/jobs" | ConvertTo-Json -Depth 10
```

记录：`job状态`、`待处理`、`未完成`、各轨 `状态`/`处理`/`回执`。

3. 逐轨 ack：

```powershell
foreach ($t in 'T-A','T-B','T-C') {
  $body = @{ job=$job1.job_id; 轨=$t } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post -Uri http://127.0.0.1:9318/watch/ack -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 10
}
```

预期：返回剩余队列；最后一条 `全部已处理=true`。

4. 幂等与多 job：
   - 用相同 `轮次=1`、`版本=1` 再提交一次 `/watch`，预期 `复用=true`、同一个 `job_id`，并记录 `警告`；
   - 提交一个占位 job（`轮次=99`、`版本=1`、`轨=["T-ZZ"]`），确认 `GET /watch/jobs` 同时列出两个 job；
   - 用 `POST /watch/cancel` 取消占位 job，确认 `ok:true`；
   - 用不存在的 job 查询 `GET /watch/status?job=w-not-exist`，预期 `ok:false`、`type=signal_invalid`；
   - 提交缺字段的 `/watch`，预期 `ok:false`、`type=signal_invalid`。

5. 记录：所有响应原样摘要、job_id、状态文件路径、幂等与 cancel 结果。

#### T14 唤醒链路（Trae 更新重点）

> 本用例必须让仲裁者会话真正空闲，才能验证插件注入。不要用轮询代替。

1. 若 T11 之后切换过会话，先重新执行 `POST /bind-arbiter`，确认绑定目标仍是当前仲裁者会话。
2. 准备第 2 轮小任务：写 `.parallel-agent/转达/第2轮/T-A-v1.md`，任务只在 T-A 领地内做一个小改动（例如新增一个纯函数或注释），给出验收命令。

3. 提交第 2 轮 watch：

```powershell
$body = @{ 轮次=2; 版本=1; 轨=@('T-A'); notify='each' } | ConvertTo-Json -Compress
$job2 = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:9318/watch -ContentType 'application/json' -Body $body
$job2 | ConvertTo-Json -Depth 10
```

4. 派发第 2 轮：

```powershell
$body = @{ 轨='T-A'; 轮次=2; 版本=1; 模板='dispatch_round' } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:9318/dispatch -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 10
```

5. 把 `job2.job_id` 写入快照，然后**结束本回合**，告诉我：“已提交 job2，等待插件唤醒”。
   - 不要主动 `GET /watch/status` 轮询；
   - 不要自己发消息“假装被唤醒”。

6. 等待 T-A 写完 `回执/第2轮/T-A-v1.md`。插件应在仲裁者空闲且输入框为空时注入固定话术：

   > 读 .parallel-agent/信号/轮次状态/ 下的待处理状态文件（当前 job ...），可用 GET /watch/jobs 查看全部；处理完用 POST /watch/ack 标记

7. 记录：
   - 是否真的出现这条注入消息；
   - 从回执出现到唤醒的耗时；
   - 插件是否切到仲裁者会话并在注入后切回；
   - 若未唤醒：检查 `信号/轮次状态/第2轮-v1.json` 的 `处理` 字段是否停在 `notified`；
   - 若降级：检查 `alert.signal` 是否出现、是否有 VS Code 气泡。

8. 若 120 秒内没有唤醒，让我手动发一条消息继续；你读取 `/watch/jobs`、实检 T-A 回执、`ack` 后记录 `FAIL` 或 `UNVERIFIED`，并写明是 `C` 类（唤醒注入依赖 Trae UI 空闲判定）还是 `P` 类。
   **不要因为没唤醒就跳过回执实检。**

#### T15 失效 sid / 身份接管 / 删除（D-01 回归，需确认）

> 本用例会新建并删除一个测试轨 T-D。删除前必须问我。

1. 新建 T-D 两次，验证旧记录被置 `deleted`：

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:9318/new -ContentType 'application/json' -Body '{"轨":"T-D","模板":"new_track"}' | ConvertTo-Json -Depth 10
Start-Sleep -Seconds 2
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:9318/new -ContentType 'application/json' -Body '{"轨":"T-D","模板":"new_track"}' | ConvertTo-Json -Depth 10
Invoke-RestMethod http://127.0.0.1:9318/health | ConvertTo-Json -Depth 10
```

预期：
- 第二次 `/new` 返回新 sid；
- `/health` 的 `轨表` 中 T-D 只有一条 `active`，旧 sid 为 `deleted`；
- 若身份表未被更新，记录 `FAIL`（D-01 回归失败）。

2. 派发 `cancel_standby`，确认返回新 sid：

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:9318/dispatch -ContentType 'application/json' -Body '{"轨":"T-D","模板":"cancel_standby"}' | ConvertTo-Json -Depth 10
```

3. 问我是否删除 T-D 会话；我确认后：

```powershell
$sid = '<上一步返回的 sid>'
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:9318/delete -ContentType 'application/json' -Body ('{"sid":"' + $sid + '"}') | ConvertTo-Json -Depth 10
```

4. 删除后再派发 T-D，预期 `ok:false`、`type=signal_invalid` 或 `anchor_not_found`，不能是 500。
5. 负向检查：
   - `GET /ping` 不带 `sid` → `signal_invalid`；
   - `POST /dispatch` 不带 `轨` → `signal_invalid`；
   - `POST /delete` 不带 `sid` → `signal_invalid`。
6. 记录：两次 sid、身份表/`/health` 前后状态、delete 结果、负向响应。

### 7. 环境兼容用例（T16-T18）

#### T16 自动启动 / 单实例锁 / 命令面板（需要我开窗口）

1. 命令面板检查：让我执行 `Ctrl+Shift+P`，输入 `ParallelAgent`，记录是否能看到：
   - `ParallelAgent: 启动编排器`
   - `ParallelAgent: 停止编排器`
   - `ParallelAgent: 健康检查`
   - `ParallelAgent: 带调试端口重启 Trae`
2. 停止当前编排器：`Ctrl+Shift+P` → `ParallelAgent: 停止编排器`，确认 `/health` 连接被拒。
3. 让我新开一个 Trae 窗口并打开**同一个测试项目**。预期：
   - 因项目存在 `.parallel-agent/`，编排器自动启动；
   - 状态栏显示运行中；
   - `Invoke-RestMethod http://127.0.0.1:9318/health` 返回 `ok=true`，`workspace` 为该测试项目路径；
   - `.parallel-agent/信号/orchestrator.lock` 存在，内容含 PID。
4. 让我再开第二个同项目窗口。预期：
   - 第二个窗口不重复监听 9318；
   - 状态栏提示“已在其他窗口运行”；
   - `/health` 的 `pid` 仍与第一个窗口一致；
   - 锁文件未被第二个窗口覆盖成无效内容。
5. 记录：自动启动是否发生、锁文件内容、两个窗口的状态栏提示、`/health` 的 `pid/workspace`。
6. `restartWithDebug` **只检查命令存在与脚本路径**，不要执行实际重启；若要执行，必须等我单独确认，并放到报告写完之后。

#### T17 中文/空格路径与编码

1. 记录当前项目路径是否包含中文或空格。
2. 创建带中文和空格的目录/文件：

```powershell
New-Item -ItemType Directory -Path "测试 目录" -Force | Out-Null
Set-Content -Path "测试 目录\中文 文件.txt" -Value "中文内容：ParallelAgent 测试" -Encoding UTF8
Get-Content "测试 目录\中文 文件.txt" -Raw
```

3. 用 Node 读写同一文件，确认编码：

```powershell
node -e "const fs=require('fs');const p='测试 目录/中文 文件.txt';console.log(fs.readFileSync(p,'utf8'));fs.writeFileSync(p,'中文内容：Node 写入','utf8');console.log(fs.readFileSync(p,'utf8'))"
```

4. 在该子目录运行 doctor，验证向上查找 `.parallel-agent`：

```powershell
Push-Location "测试 目录"
node "$repo\packages\cli\dist\index.js" doctor
"EXIT=$LASTEXITCODE"
Pop-Location
```

预期：doctor 仍能发现项目的 `.parallel-agent/单轨/台账` 并给出台账检查结果；路径含空格/中文不导致命令失败。
5. 提交这些测试文件：

```powershell
git add "测试 目录"
git commit -m "test: 中文空格路径与编码"
```

6. 记录实际输出与退出码。若命令因路径编码失败，记录 `C` 或 `E` 类。

#### T18 CLI 安装链（可选，破坏性，需我确认）

> 本用例会改动全局安装状态；默认 `SKIP`，只有我明确说“可以做安装/卸载测试”才执行，并且放在报告初稿写完之后。

1. `init` 幂等：

```powershell
node "$repo\packages\cli\dist\index.js" init
"EXIT1=$LASTEXITCODE"
node "$repo\packages\cli\dist\index.js" init
"EXIT2=$LASTEXITCODE"
```

预期：第二次显示扩展已安装/跳过、端口无需改动；退出码 0；Skills/reference 仍在。
若网络失败，记录 `BLOCKED`，不要反复重试；可改用 `init --vsix <本地 vsix 路径>`。

2. `uninit`（仅我确认后）：

```powershell
node "$repo\packages\cli\dist\index.js" uninit
"EXIT=$LASTEXITCODE"
```

验证：
- `~/.trae-cn/skills/parallelagent-*` 已删除；
- `~/.trae-cn/shared/references/` 下三个文件已删除；
- 扩展已卸载；
- `argv.json` 不再含 `remote-debugging-port`。

3. 重装并验证幂等：

```powershell
node "$repo\packages\cli\dist\index.js" init --vsix "<本地 vsix 路径>"
node "$repo\packages\cli\dist\index.js" doctor
```

4. 记录：uninit/init 输出、doctor 前后对比、是否幂等、是否需要重启 Trae。

### 8. T19 报告

在项目根目录写 `全量基础测试报告.md`，结构如下：

```markdown
# ParallelAgent 全量基础测试报告

- 测试日期：
- 测试人：AI 测试执行者（由 <用户> 授权执行）
- Trae 版本（更新前，用户提供/未提供）：
- Trae 版本（本次实测）：
- Trae 进程路径：
- 数据目录：
- Node / PowerShell / git 版本：
- 安装版本：扩展 <实际版本> / CLI <实际版本>
- 测试项目路径：
- 仓库 commit：

## 0. 结论摘要

- 是否受 TRAE 更新影响：否 / 部分 / 是 / 无法判定
- 受影响面：Skill 发现 / CDP target / DOM 锚点 / 会话注入 / 唤醒通知 / 安装配置 / 路径编码 / 无
- 阻断问题：
- 建议下一步：

## 1. 结果汇总

| 用例 | 模式 | 预期 | 实际 | 结论 | 证据 |
|---|---|---|---|---|---|
| T00 环境与版本取证 | - | 全绿 | ... | PASS/FAIL/BLOCKED | ... |
| T01 夹具 | - | 测试通过 | ... | ... | ... |
| T02 激活边界 | L0 | ... | ... | ... | ... |
| ... | | | | | |

结论取值：PASS / FAIL / BLOCKED / SKIP。

## 2. 依赖面兼容矩阵

| # | 依赖面 | 旧版预期 | 本次实测 | 判定（正常/受影响/未验证） | 证据 |
|---|---|---|---|---|---|
| 1 | Skill 发现与激活 | ... | ... | ... | ... |
| ... | | | | | |

## 3. 逐项详情

### T00 ...
- 请求/目的：
- 步骤：
- 预期：
- 实际：
- 证据：
- 结论：
- 归类（P/C/E/U，如适用）：

（每个用例一节）

## 4. 缺陷 / 兼容性问题列表

| ID | 级别 | 归类 | 用例 | 现象 | 复现步骤 | 证据 | 建议 |
|---|---|---|---|---|---|---|---|
| D-01 | P0/P1/P2/P3 | C/P/E/U | T0x | ... | ... | ... | ... |

## 5. 未覆盖 / 阻塞项

- 用例：
- 原因：
- 需要的前置条件：

## 6. 结论与建议

- 是否达到基础可用：
- 是否受 TRAE 更新影响及依据：
- 阻断问题：
- 修复优先级：
```

报告要求：

- 每个用例执行完立即写，不要最后补写。
- 证据必须能复核：命令 + 输出/退出码、文件路径 + 行号、diff、截图路径。
- 失败项必须写清“旧版预期是什么、本次实际是什么、为什么归类为 C/P/E/U”。
- 不要在报告里写“应该没问题”“本地验证过了”这类自述。
- 只有 T18 的卸载/重启类用例可以后置；其余用例的结果必须即时落盘。

### 9. 执行顺序与停止条件

1. **T00 环境预检**：先做。Skill 不可见或 doctor 核心 FAIL 时，先记录并决定是否继续。
2. **T01 夹具**：必须在单轨用例前完成。
3. **T02-T09 单轨**：按顺序执行；L1/L3 必须等我回答/确认。
4. **T10-T15 多轨**：先确认锚点与编排器健康；L4 必须等我确认“拆”后才调用 `/new`。
5. **T16-T17 环境兼容**：T16 需要我开窗口；T17 不破坏现有文件。
6. **T18 CLI 安装链**：可选，默认 SKIP；只有我明确授权才执行。
7. **T19 报告**：贯穿全程，最后补全结论摘要与兼容矩阵。

停止条件：

- 任一用例需要我确认而未得到确认 → 停下，标 `BLOCKED`，不要自问自答。
- Skill 不可见、CDP/关键锚点失效、`/new` 无法开轨 → 相关用例标 `BLOCKED` 或 `FAIL`，不要手工模拟。
- 出现删除/重置/卸载/重启风险 → 先问我；我未确认就停。
- 同一失败连续复现 2 次 → 停止重试，记录证据并转到下一个不依赖它的用例。
- 不要为了“全绿”跳过失败项或改写预期。

现在开始：先执行 T00，建立 TodoWrite 清单，把环境与版本取证结果告诉我，然后再继续 T01。

---

## 附：快速判定表（执行者填完报告后自检）

| 现场情况 | 最可能的结论 |
|---|---|
| doctor 全绿、3 个 Skill 可见、`/new` 与 `/dispatch` 成功、T14 唤醒成功 | 未受影响 |
| doctor 全绿、单轨 L0-L3 正常，但 `/new`、`/dispatch` 或唤醒失败 | 部分受影响，重点查 CDP target / DOM 锚点 / 唤醒注入 |
| doctor 在 argv.json、数据目录或扩展安装项 FAIL，但单轨正常 | 部分受影响，重点查 Trae 更新是否重置配置或改数据目录 |
| 3 个 Skill 在当前会话不可见 | 受影响（阻断），先查 Skill 发现机制与安装目录 |
| 大量用例 BLOCKED、环境未就绪 | 无法判定，先修环境再复测 |

**记住：本测试的目的不是证明 ParallelAgent 没问题，而是用证据回答“TRAE 更新影响了哪一层”。**
