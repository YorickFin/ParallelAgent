# WorkBuddy 多 Agent 能力评估报告

- 评估日期：2026-10-27
- 执行者：WorkBuddy（deepseek-v4.1-flash）自身实测
- 环境：Windows 10/11 / WorkBuddy 5.8.3（Electron + `codebuddy-lite-wb.mjs` 内核）/ Node 22.22.2
- 观测方式：内核实证（拆 `app.asar` 与 `cli/dist`）+ 行为实测（起团、跑轮次、读落盘文件）
- 评估对象：`E:\备份\project\Agent\ParallelAgent`（作为参照系）

> **这份文档回答什么**：WorkBuddy 内的多 Agent 能力，能不能承载 ParallelAgent 那套「单项目多轨并行 + 文件契据治理」的设计；能承载哪一半，不能承载哪一半，为什么。

---

## 0. 结论摘要

| 能力 | 判定 | 一句话 |
|---|---|---|
| 单项目内多 Agent 并行 | **PASS** | 同一条消息多次 spawn 即真并行，实测双成员并发完成 |
| 团队模式（TeamCreate） | **PASS** | 建团→认领→回传→关闭全链路跑通，产物落盘可查 |
| 成员独立上下文 | **PASS** | 3 轮对话，第 2 轮准确复述未重发的暗号 |
| 成员多轮推进 | **PASS** | idle 后可被 `SendMessage` 反复唤醒，`turns=3` 自证 |
| 成员写文件（契据/台账可落盘） | **PASS** | 成员独立写入 `.workbuddy/probe/track-a.log` |
| 上下文跨销毁复活 | **PASS** | `TeamDelete` 后按 agent id `resume`，仍答出暗号 |
| 进程级轨道隔离（detached-process） | **FAIL** | 桌面端白名单环境，三次尝试均无法注入，无官方入口 |
| 外部控制器（CDP 建/切/派/删轨道） | **FAIL** | 无等价能力，生命周期全绑在主理人回合内 |
| fail-stop 身份断言 / 锚点校验 | **FAIL** | 仅 `name@team` 标识，无断言机制 |
| 声明式 Workflow（深研扇出） | **BLOCKED** | 引擎存在（`deep-research.workflow.js`），但本会话未向模型暴露 Workflow 工具 |
| XERJ MCP 接入 | **PASS** | 补 `mcp.json` 后工具可用，实测 761 命中 |

**总判定**：ParallelAgent 的**数据面协议**（文件契据、主理人中转、轮次推进、上下文持久）可在 WorkBuddy 内复现；**控制面**（进程隔离、外部控制器、身份断言）不可复现。

---

## 1. 用例与结果汇总

| 用例 | 目标 | 预期 | 实际 | 结论 |
|---|---|---|---|---|
| W00 | 团队开关是否生效 | 开启即出现 TeamCreate | 开关写入 `app-config.json`（`disableAgentTeams:false`），但当前会话工具集不变 | FAIL（需重启） |
| W01 | 重启后团队工具可用 | TeamCreate/TeamDelete 可调 | 重启后可用，ToolSearch 命中 | PASS |
| W02 | 团队全链路 | 建团→认领→回传→关闭 | 2 成员并行，任务 1/2 由成员自行改 owner 并完成 | PASS |
| W03 | 团队落盘结构 | 可审计的元数据 | `config.json` / `runtime.json` / `inboxes/*.json` / `tasks/<n>.json` | PASS |
| W04 | 后端类型可切换 | 切到 detached-process | 3 次尝试（setx / 重启 explorer / cmd 启动器）均回落 in-process | FAIL |
| W05 | 成员上下文持久 | 跨轮次记得住 | 第 2 轮准确答出从未重发的 `Q7-KESTREL` | PASS |
| W06 | 上下文隔离 | 成员看不到主理人对话 | 成员自述只能收到路由给它的 teammate 消息 | PASS |
| W07 | 上下文复活 | 销毁后仍可召回 | `TeamDelete` 后 resume 仍答 `Q7-KESTREL` | PASS |
| W08 | 成员写文件 | 能落盘契约/台账 | 成功创建并追加 `.workbuddy/probe/track-a.log` | PASS |
| W09 | XERJ MCP 接入 | 工具可用 | 补 `~/.workbuddy/mcp.json` 后可用；`lib-docs` 761 命中 | PASS |
| W10 | 提示缓存 | 存在前缀缓存 | 内核解析 `cache_read_input_tokens` 等 4 类计费字段 | PASS |
| W11 | Workflow 引擎 | 可运行声明式工作流 | 脚本存在，但 Workflow 工具未挂载到本会话 | BLOCKED |

结论取值：PASS / FAIL / BLOCKED / SKIP。

---

## 2. 逐项详情

### W00–W01 团队开关与生效时机

- 方法：设置面板开启「智能体团队管理」→ 查 `~/.workbuddy/app/app-config.json` → 当前会话 ToolSearch 查 `TeamCreate`
- 实际：
  - 配置文件写入 `"disableAgentTeams": false`
  - 当前会话查不到 `TeamCreate`；并行起两个具名子代理自查，均报「无 team 工具、无 teamName、无 channel 身份」
  - 重启 WorkBuddy 后，`TeamCreate` / `TeamDelete` 立即可用
- 归因：**工具集在会话初始化时定型**，中途改配置不热生效
- 证据：`app-config.json`；两次 ToolSearch 结果；子代理自查回报

内核门控（`codebuddy-lite-wb.mjs`）：

```js
shouldShowInToolSearch = () => this.isAgentTeamsEnabled()
isAgentTeamsEnabled() { return !isAgentHomeJobBlockingAgentTeams() && TeamManager.isEnabled() }
```

> 附加约束：作为 Agent Home 的 colleague job 运行时，团队被**显式屏蔽**，与开关状态无关。

### W02 团队全链路

- 方法：`TeamCreate(wb-team-probe)` → `TaskCreate` ×2 → `Agent(name=doc-scout / design-scout)` → 观察认领、执行、回传、关闭
- 实际：
  - 两个成员**自行** `TaskList` 认领任务并 `TaskUpdate` 改 owner → `in_progress`
  - 并行执行后经 `SendMessage` 回传主理人
  - `TaskUpdate` 置 `completed`；`shutdown_request` 均 `approve:true`；`TeamDelete` 清理成功
- 结论：与 `expert-manager/references/team-spec.md` 描述的「主理人建团 → 按 SOP 阶段调度 → 产出经主理人中转」一致
- 证据：`TaskList` 状态流转；两份回传正文；`teams/` 清空

### W03 落盘结构（文件信箱式）

```
~/.workbuddy/teams/<team>/
├── config.json      # name/description/leadAgentId/members(name/agentId/agentType/color/backendType)
├── runtime.json     # status、成员 status、taskId、canResume
└── inboxes/
    ├── team-lead.json
    ├── <member>.json
    └── ...
~/.workbuddy/tasks/<team>/<n>.json
```

- 与 ParallelAgent「数据面 100% 文件」同构，但**只有元数据**，无契约/台账/快照语义，需自建

### W04 后端类型：in-process 是唯一可用形态

三种后端（内核 `this.type`）：`in-process`（默认）/ `detached-process` / `tmux`

选择逻辑：

```js
// inProcessBackend
async isAvailable() {
  return !("1" === process.env.CODEBUDDY_DISABLE_INPROCESS_TEAMMATES
           || process.argv.includes("--swarm"))
}
// autoDetect 顺序：in-process → tmux → detached-process
```

`detached-process` 的实际行为（代码）：

```js
processManager.forkBgSession(args, { name: `teammate-${team}-${name}`, cwd,
  skipPrintMode: true, extraEnv })      // 返回 { pid, logPath }
TeamMailbox.send(team, name, { from: 'team-lead', text: prompt, ... })
// kill: SIGTERM + 等 5s
```

即：独立后台 CLI 进程 + 真实 pid + 日志文件 + 信箱投递。**形态与 ParallelAgent 的轨道高度接近，但拿不到。**

三次尝试与结果：

| 尝试 | 操作 | 结果 |
|---|---|---|
| 1 | `setx` 用户级变量 + 重启 App | 成员仍 in-process |
| 2 | 重启资源管理器 + 重启 App | 成员仍 in-process |
| 3 | `launch-with-detached-team.cmd`（`set` 后 `start`） | 成员仍 in-process |

- 排除项：
  - 进程链正常（WorkBuddy.exe 由 explorer.exe 拉起，CLI 为其孙进程）
  - `--swarm` 仅 CLI argv 生效，桌面端从不传
  - `settings.json` 无 env 注入机制（搜 `settingsEnv` / `envOverrides` / `"env":{` 均为 0 命中）
- 归因：桌面端为 CLI 预热池构造的是**固定环境对象**（`{DISABLE_AUTOUPDATER:'1', ELECTRON_RUN_AS_NODE:'1', CODEBUDDY_*...}`），未展开 `process.env`；外部注入的变量在边界被丢弃
- **判定：桌面版无官方入口，不通过 hook 或改安装文件绕过（升级即失效且污染环境）**

### W05–W07 上下文持久、隔离与复活

实验设计（关键：暗号只发一次，且明令禁止回显与写文件）：

| 轮次 | 指令 | 观测 |
|---|---|---|
| 1 | 记住暗号 `Q7-KESTREL`，**不许复述、不许写文件**，只回「第1轮完成」 | 成员回「第1轮完成」 |
| 2 | 「第 1 轮我给你的暗号是什么？」+ 要求写入 `track-a.log` | 准确答出 `Q7-KESTREL`；文件写入成功 |
| 3 | 要求追加一行并自述轮次数、隔离性 | `round3 by=track-a turns=3`；自述看不到主理人与用户的对话 |

落盘证据：

```
round2 token=Q7-KESTREL by=track-a
round3 by=track-a turns=3
```

复活实验：`shutdown`（accepted）→ 移出团队 → `TeamDelete` 删目录 → `Agent(resume="agent-49c13bd4-...")` 追问 → **仍答 `Q7-KESTREL`**

- 原因：成员转写持久化在 `~/.workbuddy/projects/<proj>/<sessionId>/subagents/agent-<id>.jsonl`
- 该成员记录规模：**26 条 / 46,809 字符**，构成为 `function_call 17,978` > `message 10,959` > `function_call_result 10,711` > `reasoning 7,161`

**重要澄清**：`resume` 恢复的是**对话历史**，不恢复团队关系、信箱、任务归属、进程内状态（文件快照、已读缓存、todo、已加载 skill）。即「记得说过什么，但手上什么都没有」。

### W08 成员写文件能力

- 成员可自由 `Read` / `Write` / `Bash`，与主理人权限一致（`general-purpose` 类型）
- 结论：ParallelAgent 的**契约、台账、回执、交接手册全部可以落盘**，缺的不是数据面

### W09 XERJ MCP 接入

- 初始状态：`~/.workbuddy/mcp.json` 不存在，工具清单无 `xerj_*`；XERJ 节点本身正常（PID 5936，127.0.0.1:8080/8081/9200，索引 `autoindex-catalog` / `lib-docs` / `.xerj-memory-library-edges` 全 green）
- 处置：照 Trae 配置写入 stdio 形态（`command: D:\Programs\xerj\xerj.exe`、`args: ["mcp"]`、`env: XERJ_URL / XERJ_DISABLE_FEEDBACK`）→ 重启 → 生效
- 实测：`xerj_search(index=lib-docs, query="并行")` → 761 命中，首条《多AI并行开发-仲裁体系与轮次转达》
- **遗留**：`xerj_map` 显示仅索引 `lib-docs`（笔记库），**ParallelAgent 仓库未被 autoindex**；检索代码前需 `xerj autoindex "E:/备份/project/Agent/ParallelAgent"`

### W10 提示缓存

内核解析的计费字段（证明存在前缀缓存，非会话缓存）：

| 字段 | 风格 |
|---|---|
| `cache_creation_input_tokens` / `cache_read_input_tokens` | Anthropic |
| `ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens` | Anthropic TTL |
| `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` | DeepSeek |
| `cached_tokens` | OpenAI |

另有 `CacheControlFormatRule.CACHE_CONTROL = { type: "ephemeral" }`，以及按 `prompt_cache_stability === "stable"` 排序工具列表以**稳定前缀**。

### W11 Workflow 引擎（BLOCKED）

- 内置 `cli/builtin/workflows/deep-research.workflow.js`（485 行）：`meta{name,phases}` + `phase()` / `agent()` / `parallel()` / `pipeline()`
- 能力：分阶段、并行扇出（5 路搜索）、URL 去重、3 票对抗验证、合成带引用报告；有 runId/journal、`/workflows`、`workflow/control` 暂停跳过、定时 workflow；自定义脚本目录 `.codebuddy/workflows/`
- **但本会话未向模型暴露 Workflow 工具**（`CODEBUDDY_DISABLE_WORKFLOWS` 未设置，属未启用），只能以 Agent + 任务列表手写等价编排

---

## 3. 与 ParallelAgent 的架构对比

| 设计要素 | ParallelAgent | WorkBuddy in-process 团队 |
|---|---|---|
| 轨道实体 | 独立 Trae 会话窗口（真进程） | 同进程协程 |
| 建/切/派/删 | 编排器插件（CDP + HTTP 网关） | 主理人调 `Agent` / `SendMessage` |
| 数据面 | 文件信箱（契约/回执/快照/台账） | 框架元数据 json + 成员可任意读写文件 |
| 控制面 | 只传信号（轨号+轮次+文件指针） | 消息内容全量传递（无信号/内容分离） |
| 成员通信 | 禁止直连，必经仲裁者 | 框架**允许** peer DM；不直连只是纪律 |
| 轮次推进 | `/watch` 后台 job + 空闲唤醒 | `SendMessage` 唤醒 idle 成员 |
| 崩溃恢复 | 文件可续，编排器重建轨道 | 上下文可 `resume`，但无人自动拉起 |
| 身份校验 | fail-stop 身份断言 + 锚点 | 仅 `name@team`，无断言 |
| 成本模型 | 短命轨道，状态靠文件传递 | 常驻协程，状态靠历史累积 |

---

## 4. Token 成本实测

单轮输入 = **全量重发历史**，与普通会话完全相同（协议无状态，客户端维护数组）。

3 轮简单任务实测：**26 条记录 / 46,809 字符 ≈ 21k token**

```
function_call         17,978 字符  (38%)  ← 工具参数，永久留在历史
message               10,959 字符  (23%)
function_call_result  10,711 字符  (23%)
reasoning              7,161 字符  (15%)
```

推论：

- 单轮输入随轮次线性增长，**N 轮总输入 O(N²)**
- 与普通会话的差别**不在 token 数**，而在缓存命中率（热 ≈1/10 价，冷全价）与首 token 延迟
- `resume` 隔久了（`ephemeral` 5 分钟 TTL 过期）= 冷启动全价重算
- `autoCompact` 存在（内核 22 处引用）；`CODEBUDDY_REPLAY_SHOW_PRE_COMPACT` 默认 false，即重放读取的是**压缩后**历史，不回退到压缩前

**反直觉结论**：ParallelAgent 的「短命轨道 + 契据交接」在 token 上更省——用**文件替代历史**，天然规避上下文膨胀；常驻协程则是用 token 换连续性。

---

## 5. 结论与选型建议

### 可复现（数据面）

- 文件契约、台账、回执、快照的落盘与读取
- 主理人调度多成员、按轮次推进、汇总产出
- 成员产出经主理人中转（**靠纪律约束，非机制强制**）
- 上下文持久化与按 id 复活

### 不可复现（控制面）

- 进程级轨道隔离：主进程一死，全部轨道同时死；无法外部单独 kill/重启某条轨
- 外部控制器：无 CDP，无跨窗口/跨 IDE 操作
- fail-stop：无身份断言，无锚点校验
- 后台 job 与唤醒话术注入

### 建议

1. **不要把 ParallelAgent 迁到 WorkBuddy 的团队模式上**。控制面是它的核心价值，而不是数据面。
2. 若只需「单项目内多 Agent 并行 + 文档驱动流程」，WorkBuddy 原生够用，无需 CDP 插件：`TeamCreate` + `Agent` + `SKILL.md` 即可。
3. 两者可互补：WorkBuddy 承担「调研/写作/文档处理」类串行深任务，ParallelAgent 承担「代码多轨并行交付」。数据面都走文件，交接成本低。
4. 若追求进程隔离且必须留在 WorkBuddy 内：**当前无解**，等官方开放后端开关。不推荐改安装文件或 hook 进程。

---

## 6. 未验证项与风险

| 项 | 说明 |
|---|---|
| 团队跨会话存活 | 未测团队在主理人会话结束后是否可被新会话接管 |
| 成员数量上限 | 未压测（本次最多 2 成员并行） |
| autoTeam / Agent Home | 内核存在自动建团与频道/职位板机制，本次未启用验证 |
| 定时 workflow | 引擎声称支持，工具未挂载，未验证 |
| 模型覆盖 | 成员与主理人同为 `deepseek-v4.1-flash`；是否可按成员指定模型未验证 |
| 升级风险 | 本次结论基于 5.8.3；桌面端环境构造逻辑一变，后端判定可能失效 |

---

## 附录：环境限制（非产品能力）

- `reg.exe` 被安全中心程序黑名单拦截，无法通过命令行读写注册表；PowerShell 的注册表 provider 调用会挂起。涉及注册表操作需用户手动执行。
- 右键菜单清理脚本（`.workbuddy/tools/remove-workbuddy-*.ps1`）属一次性排查产物，已删除。
- `D:\Programs\WorkBuddy\launch-with-detached-team.cmd` 保留但**已验证无效**（见 W04），确认无用后可删。
