# WorkBuddy 多 Agent 能力评估报告

- 评估日期：2026-10-27
- 执行者：WorkBuddy（deepseek-v4.1-flash）自身实测
- 环境：Windows 10/11 / WorkBuddy 5.8.3（Electron + `codebuddy-lite-wb.mjs` 内核）/ Node 22.22.2
- 观测方式：内核实证（拆 `app.asar` 与 `cli/dist`）+ 行为实测（起团、跑轮次、读落盘文件）
- 评估对象：`<ParallelAgent仓库>`（作为参照系）

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
| 外部控制器（跨窗口建/切/派/删） | **FAIL** | 无跨 IDE/跨窗口控制；进程内已有语义等价物（TeamCreate/Agent/SendMessage） |
| fail-stop 身份断言 / 锚点校验 | **FAIL** | 仅 `name@team` 标识，无断言机制 |
| 声明式 Workflow（深研扇出） | **BLOCKED** | 引擎存在（`deep-research.workflow.js`），但本会话未向模型暴露 Workflow 工具 |
| XERJ MCP 接入 | **PASS** | 补 `mcp.json` 后工具可用，实测 761 命中 |

**总判定**（分三层看，不要笼统按「数据面/控制面」切）：

| 层 | 内容 | WorkBuddy 能否承载 |
|---|---|---|
| **治理层**（核心价值） | L0-L4 入口分流、单轨台账、多轨契据/回执/快照、基于文档的可溯源性 | ✅ 能，`SKILL.md` + 成员写文件即可，不需要任何插件 |
| **执行器层**（可替换） | 建/切/派/删轨道会话、唤醒、收工 | ✅ 有对应物：`TeamCreate` / `Agent` / `SendMessage` / `shutdown_request` |
| **隔离与自愈层** | 进程级轨道隔离、外部 `/watch`、崩溃后重建、fail-stop 身份断言 | ❌ 无，且当前无解 |

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

- 初始状态：`~/.workbuddy/mcp.json` 不存在，工具清单无 `xerj_*`；XERJ 节点本身正常（PID <pid>，127.0.0.1:8080/8081/9200，索引 `autoindex-catalog` / `lib-docs` / `.xerj-memory-library-edges` 全 green）
- 处置：照 Trae 配置写入 stdio 形态（`command: <xerj安装目录>\xerj.exe`、`args: ["mcp"]`、`env: XERJ_URL / XERJ_DISABLE_FEEDBACK`）→ 重启 → 生效
- 实测：`xerj_search(index=lib-docs, query="并行")` → 761 命中，首条《多AI并行开发-仲裁体系与轮次转达》
- **遗留**：`xerj_map` 显示仅索引 `lib-docs`（笔记库），**ParallelAgent 仓库未被 autoindex**；检索代码前需 `xerj autoindex "<ParallelAgent仓库>"`

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

### 补充：一套引擎，四种入口（澄清「两套 subAgent」的误解）

确有「团队模式」与「普通子代理」两种用法，但**不是两套实现**，是同一执行引擎的两种入口：

| 证据 | 结论 |
|---|---|
| 两者转写都存在 `projects/<proj>/<sessionId>/subagents/agent-<id>.jsonl`，格式一致（`message` / `reasoning` / `function_call` / `function_call_result`） | 同一套会话存储 |
| 团队成员的 `.jsonl` 里出现 `team` 相关字段 15 次，普通子代理 **0 次** | 差异只是团队注册信息 |
| 团队成员首条 user message 被包成 `<teammate-message teammate_id="team-lead" summary="...">`；普通子代理是裸 prompt | 差异只是**消息信封** |
| 两者都由 `Agent` 工具拉起；带 `name` 时注册进 `TeamManager` 并获得信箱 | 同一入口、不同参数 |

即在引擎之上只加了一层薄壳：`TeamManager`（成员注册）+ `TeamMailbox`（`inboxes/*.json`）+ 空闲跟踪。

除此之外还有两个**并列的面**，但都不是第二套 subAgent：

- **Agent Home**：`colleague` / `channel` / `ChannelTasks`，面向 IM 的多智能体协作面；以 colleague job 身份运行时**会显式禁用团队**（`isAgentHomeJobBlockingAgentTeams`）
- **Workflow 引擎**：声明式编排（`meta` + `phase/agent/parallel/pipeline`），与团队是两套调度，本会话未挂载

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

### 5.1 先纠正一个框架错误（勘误）

本报告初版把 ParallelAgent 的核心价值定在「控制面（CDP）」，由此推出「不要迁到 WorkBuddy」。这个推理是错的，错在**把「WorkBuddy 缺什么」当成了「ParallelAgent 的核心是什么」**——这是两个不同的问题。

按项目自身的表述，CDP 只是 L4 多轨的**执行器**：

- README：「**单轨 L0-L3 不依赖插件**」——治理规则完全跑在 CDP 之外
- README：「多轨三件套」里，CDP 只是第三件（编排器插件）的实现手段
- 定稿方案：数据面标注为「100% 文件，**可溯源**」

也就是说，CDP 是 **Trae 未提供会话 API 时的补丁**：因为无法用 API 建/切/派会话，才退回用 CDP 驱动 UI。换一个宿主，这个补丁本该被换掉，而不是被当成价值本身。

### 5.2 三层重新定位

| 层 | 是不是核心价值 | WorkBuddy 承载情况 |
|---|---|---|
| 治理层：入口分流 + 单轨台账 + 多轨契据/回执/快照 + 文档可溯源 | **是核心** | ✅ 能承载。`SKILL.md` 表达流程，成员自由读写仓库文件，台账/契据/回执全部可落盘（W08 已验证） |
| 执行器层：建/切/派/删轨道、唤醒、收工 | 不是核心，是可替换件 | ✅ 有替代物。`TeamCreate` / `Agent(name=)` / `SendMessage` / `shutdown_request`，语义等价 |
| 隔离与自愈层：进程级隔离、外部 `/watch`、崩溃重建、fail-stop 断言 | 服务于「溯源可信」，是**加固**而非目的 | ❌ 缺失，且当前无解（W04） |

### 5.3 修正后的建议

1. **ParallelAgent 的核心（工作流 + 基于文档的可溯源性）在 WorkBuddy 内是可承载的**，且不需要 CDP——因为 WorkBuddy 自带会话调度，补丁本身没有存在必要。
2. **真正无法搬运的是「隔离与自愈」**：主进程一死全部轨道同死，没有外部调度器在崩溃后按文件重建轨道，没有身份断言拦截越界下发。这会让「溯源」从「强保证」降级为「事后可查」。
3. 换句话说：**迁过去会丢掉的是「可信度等级」，不是「工作流本身」**。评估重点应从「能不能并行」转为「治理强度能保住几成」。
4. 若坚持进程级隔离：当前只能留在 Trae + 编排器插件，或在 WorkBuddy 外另起宿主自建 API 调度。

### 5.4 给本项目后续评估的口径建议

| 要问的问题 | 不该用的口径 | 应改用的口径 |
|---|---|---|
| 能不能搬 | 「WorkBuddy 有没有 CDP」 | 「治理规则能不能用文档表达、产物能不能落盘」 |
| 搬了损失什么 | 「少了控制面」 | 「可溯源性从强制降级为事后可查、崩溃后无人自愈」 |
| 要不要两套 | —— | 数据面统一用文件，宿主只提供调度，宿主可替换 |


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

## 7. 设计建议：轨道执行单元应选哪种 Agent

### 7.1 结论

**ParallelAgent 的轨道执行单元，应当用一次性（空壳）subagent，而不是常驻多轨会话或团队模式。**

判据不是「哪个能力强」，而是「哪个与治理模型同构」：ParallelAgent 的前提是**契据文件是唯一事实源**，而常驻会话会引入第二个事实源。

### 7.2 为什么空壳更契合

**① 单一事实源（决定性理由）**

常驻会话里，轨道「记得」上一版契约。一旦契约升级到 v2，而轨道的上下文里还留着 v1，产物就会依据旧版本生成——**而产物本身看不出它依据的是哪一版**。这正是「可溯源」要防的事，却被常驻上下文变成了不可审计的旁路。

空壳 subagent 只有本次 prompt 里给定的契据文件：依据哪一版，写在输入里，可复现、可比对。

**② 成本**

一次性执行 = 单轨 O(N)，N 为本次任务的轮数。
常驻会话 = 每轮重付全部历史，N 轮 O(N²)（见 §4 实测：3 轮 46,809 字符）。

多轨并行时这个差距会被轨道数放大。

**③ 隔离**

空壳天然无历史污染：不会把上一轮的错误结论带进下一轮。常驻会话的「上下文惯性」是隐性风险，尤其在返工轮次。

### 7.3 代价与前提：轨道身份必须外化

用空壳，会失去「轨道是一个活着的实体」这层语义：T-A 不再是一个可被反复指派的会话，而退化为**一次执行**。

这不是缺陷，而是要求：**把轨道身份从运行时搬到文件**。

| 原本由会话承载 | 改为由文件承载 |
|---|---|
| 我是哪条轨（T-A） | 回执/契约头部的 `track: T-A` |
| 我做到第几轮 | 台账/回执的 `round: n` |
| 我上一轮收到什么 | 上一轮回执文件 |
| 我的领地边界 | 契约里的 `scope.paths` |
| 我是否越界 | 执行后 diff 校验，写回回执 |

这与 README 的「数据面 100% 文件」完全一致——身份本来就该是文件里的字段，不该是某个还活着的对象。

### 7.4 什么时候该用常驻

只有一种情形值得：**同一轨道对同一个产物做多轮微调**（例如连续三轮修同一处 bug、逐步收紧同一份实现）。

即使如此，也可用「多次 spawn，每次带最新回执」替代，代价是重读成本，换来确定性与可复现。**默认选一次性，例外才复用。**

### 7.5 概念映射

| ParallelAgent 概念 | WorkBuddy 一次性 subagent 对应物 |
|---|---|
| 轨道执行一次 | `Agent(subagent_type=general-purpose, prompt=契据路径+要求)` |
| 回执 | subagent 的最终返回文本 + 它写入的回执文件 |
| 多轨并行 | 同一条消息里多次 `Agent` 调用 |
| 契约传递 | prompt 里给文件路径，成员自己 `Read` |
| 越界检测 | 执行后主理人 `git diff --name-only` 对照 `scope.paths` |
| 中途 checkpoint | subagent 写 `checkpoint.json`；主理人轮询（**未验证可行性**） |
| 崩溃恢复 | 无进程可恢复；重跑即可（无状态 = 天然幂等的前提） |

**关键收益**：这条路**不需要团队模式**，因此不依赖「智能体团队管理」开关，也不受 in-process/detached 后端限制（W04 的阻塞点被绕开）。

### 7.6 补测结果与剩余未验证

**① 并发上限（已测）**

内核常量与实现：

```js
let s = 5, c = 20, h = 200,
    p = "CODEBUDDY_CODE_MAX_CONCURRENT_SUBAGENTS",
    S = "CODEBUDDY_CODE_MAX_SUBAGENTS_PER_SESSION";
getMaxConcurrentSubagents() { ...默认 return c /* 20 */ }
getMaxSubagentsPerSession()  { ...默认 return h /* 200 */ }
// 超限抛错：Subagent concurrency limit reached (n of 20 agents running)
```

- **并发默认 20**，**单会话累计默认 200**，两者都可用环境变量覆盖
- 实测：一条消息里同时拉起 **8 个** subagent，各自 `sleep 4`
  - `t0` 跨度 895ms（1793102768127 → 1793102769022），单个耗时约 4.44s，整体墙钟约 5.3s
  - 若串行需 32s，故 **8 个确为真并行**，无排队
- 结论：多轨并行在 20 以内不受限；超出会硬失败而非排队，编排层需自行控制批量

**② 一次性 subagent 的返回值（已澄清）**

普通 subagent **有返回值**——它的最终回复文本就是返回值。回执有两种落法：

| 落法 | 做法 | 取舍 |
|---|---|---|
| 成员自写 | subagent 自己 `Write` 回执文件，只返回「路径 + 状态」 | 主理人上下文最省；但「落笔权」在成员手上 |
| 主理人落笔 | subagent 只返回结构化文本，主理人校验后写文件 | 与 ParallelAgent 的「仲裁者落笔」一致，可审计性更强 |

建议：**成员写文件 + 只返回短指针**（路径、状态、`git diff --name-only` 结果、契约版本号），避免把回执正文塞进主理人上下文——否则多轨并行时主理人自己的上下文会先爆。

注意：无 schema 强制（结构化输出在该模型上不可用），回执格式靠 prompt 约束 + 主理人校验。

**③ resume 复用是否引入旧契约污染（已测，结论：没有）**

实验：

| 轮次 | 契约 | 要求 |
|---|---|---|
| v1 | snake_case | 写 `api.py`：`def get_user_name():` |
| v2（同 agent `resume`） | camelCase，**v1 作废** | 整体覆盖为 `def getUserName():` |

实际结果：

```python
def getUserName():
    return "name"
```

- 文件按 v2 正确覆盖，未残留 v1 命名
- 该 agent 自述「依据版本：v2」

**结论：在契约被明确标注「作废」并给出完整新内容时，resume 未出现旧契约污染。** 但这不等于常驻会话安全——本次 v2 是**显式覆盖**，若 v2 只做增量修改（未重述全部约束），旧约束是否残留仍未验证。§7.2 的「第二事实源」风险依然成立，只是可以被「每轮给全量契约」这一纪律压住。

**仍剩余未验证**

- 长任务中途 checkpoint 的可行性（一次性 subagent 无主动上报通道）
- 会话累计 200 的实测（仅读码确认）
- v2 为增量而非全量覆盖时，旧约束是否残留


---

## 附录：环境限制（非产品能力）

- `reg.exe` 被安全中心程序黑名单拦截，无法通过命令行读写注册表；PowerShell 的注册表 provider 调用会挂起。涉及注册表操作需用户手动执行。
- 右键菜单清理脚本（`.workbuddy/tools/remove-workbuddy-*.ps1`）属一次性排查产物，已删除。
- `<WorkBuddy安装目录>\launch-with-detached-team.cmd` 保留但**已验证无效**（见 W04），确认无用后可删。
