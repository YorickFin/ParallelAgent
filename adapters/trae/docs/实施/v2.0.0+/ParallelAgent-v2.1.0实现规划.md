# ParallelAgent v2.1.0 实现规划：编排器项目级自动启动

> 状态：**已实施**（2026-10-26，含 2.1.1 / 2.1.2 / 2.1.3 / 2.1.4 补丁）
> 前置：[ParallelAgent第二期实现规划.md](./ParallelAgent第二期实现规划.md)、[ParallelAgent方案定稿.md](../../设计/ParallelAgent方案定稿.md)、[ParallelAgent生命周期治理初稿.md](../../设计/ParallelAgent生命周期治理初稿.md)
> 版本：**v2.1.0**
> 一句话：把「ParallelAgent: 启动编排器」从手动命令改为**项目级自动启动**，同时保证单实例、静默失败、状态可观测。

---

## 0. 文档定位

本文档是 v2.1.0 的实现规划，只覆盖一件事：

- 编排器（`parallelagent-orchestrator` 扩展）在打开项目时自动启动，不再需要用户每次按 `Ctrl+Shift+P`。

本文档**不覆盖**：

- 多实例 / 动态端口 / 端口发现协议（见 §3 的决策记录）
- 多轨协议、单轨流程、台账格式的任何变更
- 编排器 HTTP API 的语义变更（仅在 `/health` 增加诊断字段）
- 自动开轨（L4 仍需用户确认）

---

## 1. 背景与问题

### 1.1 现状

编排器当前默认不启动（`activationEvents` 只有 `onCommand` 两类），实际有两条启动路径：

1. 用户打开 Trae 后执行 `Ctrl+Shift+P` → `ParallelAgent: 启动编排器`。
2. 仲裁者通过 CDP（9317）合成 `Ctrl+Shift+P` 并选择该命令，等价于手工操作；v2.0.1 回归实测可用。

因此「忘记启动」不是链路永久不可用，而是需要有人先补一次启动动作：用户记得，或仲裁者每次开轨前主动合成。若两边都没做，L4 的 `/new`、`/dispatch` 会因 HTTP 网关不可达而失败，Trae 重启后的 watch 通知链路也不会自动恢复。

### 1.2 实际痛点

| 场景 | 现状 | 期望 |
|---|---|---|
| 打开已用 ParallelAgent 的项目 | 用户手动启动，或仲裁者合成命令面板启动 | 自动启动，无感 |
| Trae 重启后继续 L4 | 仲裁者需重新合成一次启动动作，否则 watch 链路不恢复 | 自动恢复 |
| 打开无关项目 | 扩展不激活 | 不激活、不建目录、无提示 |
| 同一项目开两个窗口 | 两个窗口都可能被启动 → 数据面冲突 | 只允许一个实例 |
| CDP 端口未配置 | 启动后弹错误框 | 静默降级到状态栏 |

---

## 2. 结论先行

1. **做项目级自动启动，不做全局无条件自动启动。**
   - 默认策略 `auto`：项目根存在 `.parallel-agent/` 才自动启动。
   - 打开无关项目时不启动、不创建目录、状态栏不显示。

2. **同一项目只允许一个编排器实例。**
   - 通过项目锁文件（`.parallel-agent/信号/orchestrator.lock`，含 PID）实现。
   - 后打开的窗口检测到存活实例时静默跳过，状态栏提示「已在其他窗口运行」。

3. **固定 9318，不做动态端口。**
   - `arbiter` Skill、`协议.md`、doctor、测试用例全部依赖固定端口；动态端口需要协议级改造。
   - 端口冲突时静默失败并写状态栏，不自动换端口。

4. **失败一律静默，状态栏 + 输出通道承载可观测性。**
   - 自动启动路径不弹 `showErrorMessage` / `showWarningMessage`。
   - 手动启动命令保留现有提示行为。

5. **用户主动停止后，本窗口不再自动启动。**
   - `workspaceState` 记录禁用标记；手动执行启动命令即清除。

---

## 3. 决策记录：为什么不做多实例

评审阶段讨论过「每窗口一个实例 + 动态端口 + 仲裁者按需启动」，结论是**放弃**，原因如下。

### 3.1 扩展宿主隔离成立，但只到「按项目」

- 扩展宿主按窗口独立，`httpServer` / `orbitTable` / `watchJobs` 是模块级变量，进程层面天然隔离。
- 窗口关闭触发 `deactivate()` → `stopOrchestrator()`，端口随窗口释放。
- **但同一项目开两个窗口时**，两者共享同一个 `mailboxRoot`：
  - 同时轮询 `信号/轮次状态/第N轮-v{M}.json` → 同一 job 重复通知；
  - 两个实例都可能对同一回执 `POST /watch/ack` → 消费状态互相覆盖；
  - `OrbitTable` 位于 `globalStorage`（全局），两窗口写同一份身份表。
- 因此隔离粒度是「项目」，不是「窗口」；多实例必须先加项目级 leader 锁。

### 3.2 CDP 是 Trae 主进程共享，不随扩展宿主隔离

- 9317 是 Electron 主进程调试端口，`GET /json` 列出所有窗口的页面。
- 现有 `filterWorkTarget` 取第一个 `solo-lite` 页面，不区分窗口。
- 实例 A 完全可能连到窗口 B 的 Work 会话并注入文本；换端口无法解决。
- 多实例方案必须补「CDP target 归属匹配」，成本高于端口发现。

### 3.3 「仲裁者按需启动」有入口，但依赖 CDP 合成

| 入口 | 可行性 | 问题 |
|---|---|---|
| 用户命令 | 现状 | 没解决「不想手动」 |
| 仲裁者 CDP 合成命令面板 | **已实测可用**（v2.0.1 回归） | 依赖 CDP 端口已配置；合成动作会抢焦点/切换当前窗口；`/json` target 归属不确定 |
| URI handler（`trae://...`） | 需验证 Trae 是否注册协议 | 抢焦点；同项目多窗口归属不确定 |
| `onStartupFinished` 静默激活 | 可靠 | 本质就是自动启动 |

说明：CDP 合成启动说明「按需启动」在技术上可行，因此**它不再是否决多实例的理由**；多实例仍被 §3.1（同项目数据面冲突）与 §3.2（CDP 主进程共享）否决。

CDP 合成启动保留为本期自动启动失败时的兜底路径（见 §5.10）。

---

## 4. 目标与非目标

### 4.1 目标

1. 打开含 `.parallel-agent/` 的项目时，编排器自动启动，HTTP 网关与 CDP 就绪。
2. 同一项目多窗口时只启动一个实例，其余窗口静默跳过并给出状态提示。
3. 自动启动的任何失败都不弹窗，状态栏与输出通道可见。
4. 用户停止后本窗口不再自动拉起；手动启动可恢复。
5. 不改变现有 HTTP API 语义、不改变 L4 / 单轨流程。

### 4.2 非目标

- 不做多实例、动态端口、端口发现文件。
- 不做 URI handler、不做开机自启、不做系统服务。
- 不自动绑定仲裁者、不自动开轨。
- 不改 `arbiter` / `track` / `solo` Skill 的行为。
- 不改 `.parallel-agent/` 下除新增锁文件外的任何结构。
- 不改进 CDP target 选择：仍沿用「取第一个 `solo-lite` 页面」的现有逻辑（已确认不纳入本期）。

---

## 5. 详细设计

### 5.1 自动启动判定

配置项（`contributes.configuration`）：

```json
"parallelagent.autoStart": {
  "type": "string",
  "enum": ["auto", "on", "off"],
  "enumDescriptions": [
    "仅当项目存在 .parallel-agent/ 目录时自动启动（默认）",
    "打开该工作区时总是自动启动",
    "仅手动执行“ParallelAgent: 启动编排器”"
  ],
  "default": "auto"
}
```

判定顺序（全部满足才启动）：

1. 扩展已激活（`onStartupFinished`）。
2. 存在工作区根目录（空窗口不启动）。
3. `autoStart !== "off"`。
4. `autoStart === "on"`，或项目根存在 `.parallel-agent/` 目录。
5. `workspaceState` 中没有 `parallelagent.autoStartDisabled` 标记。

任一条不满足 → 不启动、不创建目录、状态栏隐藏。

### 5.2 启动时序

```
onStartupFinished
      │
      ▼
延迟 2500ms（等 Work 页面与工作区就绪）
      │
      ▼
自动启动判定（§5.1）
      │ 不满足 → 结束
      ▼
项目锁检查（§5.3）
      │ 已被占用 → 状态栏「已在其他窗口运行」，结束
      ▼
HTTP 网关 listen 9318（await ready）
      │ 失败 → 状态栏「端口冲突」，结束
      ▼
写项目锁
      ▼
WatchJobManager.start()（恢复历史 running job）
      ▼
CDP 连接（最多 3 次，间隔 2000ms）
      │ 失败 → 状态栏「CDP 未连接」，HTTP 保持可用
      ▼
状态栏「运行中」
```

延迟与重试次数作为初始值，实施后按实测调整。

### 5.3 项目级单实例锁

**文件**：`<workspace>/.parallel-agent/信号/orchestrator.lock`

`信号/` 已在 `.parallel-agent/.gitignore` 中排除，锁文件不会进入 git。

**内容**：

```json
{
  "pid": 12345,
  "port": 9318,
  "workspace": "e:\\备份\\project\\Temp",
  "startedAt": "2026-10-26T08:30:00.000Z",
  "version": "2.1.0"
}
```

**获取规则**：

| 情况 | 处理 |
|---|---|
| 锁文件不存在 | 写入锁，继续启动 |
| 锁存在，`pid` 存活且 `pid !== process.pid` | 视为同项目已有实例 → 静默跳过 |
| 锁存在，`pid` 不存活 | 视为崩溃残留 → 覆盖写入，继续启动 |
| 锁存在但 JSON 解析失败 | 视为残留 → 覆盖写入 |
| 锁存在，`pid === process.pid` | 本实例重复启动 → 覆盖写入 |

**写入与释放时机**：

- 写入：HTTP 网关 `listen` 成功之后。
- 释放：`stopOrchestrator()` 与 `deactivate()` 中删除。
- 释放失败（文件被占用）只记日志，不影响退出。

**PID 存活检测**：`process.kill(pid, 0)`；抛 `ESRCH` 视为不存活，`EPERM` 视为存活。

**已知限制**：持锁窗口关闭后，其他已打开的同项目窗口不会自动接管，需要用户点击启动或重开窗口。自动接管列为待验证项（§10）。

### 5.4 端口占用处理

固定 `parallelagent.httpPort`（默认 9318）。启动前与 `listen` 失败时分别处理：

| 探测结果 | 判定 | 动作 |
|---|---|---|
| `/health` 可达，`workspace` 与本项目相同 | 本项目的另一个实例（锁丢失） | 补写锁；状态栏「运行中（另一窗口）」；本窗口不启动 |
| `/health` 可达，`workspace` 不同 | 其他项目的 ParallelAgent 实例 | 状态栏「端口被其他项目占用」；不启动 |
| `/health` 不可达，`listen` 成功 | 端口空闲 | 正常启动 |
| `/health` 不可达，`listen` 报 `EADDRINUSE` | 被其他程序占用 | 状态栏「端口 9318 被占用」；不启动 |

状态栏提示文案固定，不弹窗。

### 5.5 `/health` 诊断字段

为支持 §5.4 的归属判定，`GET /health` 增加两个只读字段（向后兼容）：

```json
{
  "ok": true,
  "cdp_alive": true,
  "workspace": "e:\\备份\\project\\Temp",
  "pid": 12345,
  "轨表": []
}
```

- `workspace`：当前窗口工作区根绝对路径；空窗口为空字符串。
- `pid`：扩展宿主进程 PID。
- 现有消费方（测试 Prompt、人工检查）只读 `ok` / `cdp_alive` / `轨表`，不受影响。

### 5.6 静默策略

| 路径 | 弹窗 | 状态栏 | 输出通道 |
|---|---|---|---|
| 自动启动成功 | 无 | 运行中 | 记录 |
| 自动启动失败 | 无 | 失败原因 | 记录 |
| 手动启动成功 | 信息框（现状） | 运行中 | 记录 |
| 手动启动失败 | 警告框（现状） | 失败原因 | 记录 |
| 激活期 CDP 预检 | **不再弹窗**（改为状态栏 + 日志） | CDP 未连接 | 记录 |

移除 `precheckCdp` 的 `showErrorMessage` 与「立即修复」按钮；修复入口保留为命令 `ParallelAgent: 带调试端口重启 Trae`，状态栏 tooltip 提示该命令。

### 5.7 状态栏

新增 `StatusBarItem`（优先级中等，仅当项目与本扩展相关时显示）：

| 状态 | 图标 | 文本 | 显示条件 |
|---|---|---|---|
| 运行中 | `$(check)` | `PA · 127.0.0.1:9318` | 网关已启动 |
| CDP 未连接 | `$(warning)` | `PA · CDP 未连接` | 网关已启动、CDP 失败 |
| 已在其他窗口运行 | `$(circle-slash)` | `PA · 已在其他窗口运行` | 项目锁被占用 |
| 端口冲突 | `$(error)` | `PA · 端口 9318 被占用` | listen 失败或探测为异项目实例 |
| 已停止 | `$(circle-slash)` | `PA · 已停止` | 用户主动停止 |
| 隐藏 | — | — | 项目无 `.parallel-agent/` 且未手动启动 |

点击状态栏执行 `parallelagent.start`（已运行时重试 CDP）。

### 5.8 用户停止与恢复

- 命令 `parallelagent.stop`：停止编排器 → 删除项目锁 → 写 `workspaceState.parallelagent.autoStartDisabled = true` → 状态栏「已停止」。
- 命令 `parallelagent.start`：清除禁用标记 → 正常启动 → 删除锁释放逻辑照旧。
- 窗口关闭（`deactivate`）：停止并释放锁，**不写禁用标记**。
- 用户可通过配置 `autoStart=on/off` 覆盖自动判定，配置优先于禁用标记。

### 5.9 与 watch 恢复的关系

自动启动会调用 `WatchJobManager.start()`，恢复历史 `running` job（与手动启动一致）：

- 未绑定仲裁者时，通知按现有逻辑跳过，不会误注入。
- 超时告警仍按现有逻辑处理；若产生本地气泡，视为可接受噪音，列入实测观察项。
- 不改变 ack / 状态文件语义。

### 5.10 兜底：仲裁者 CDP 合成启动

自动启动未启用或失败时，仲裁者仍可沿用现有路径：通过 CDP（9317）合成 `Ctrl+Shift+P` 并选择「ParallelAgent: 启动编排器」（v2.0.1 回归已实测可用）。本期不修改该路径，仅作为兜底：

- 自动启动成功 → 仲裁者无需合成，流程少一步。
- 自动启动被禁用或失败 → 仲裁者按现有方式补一次启动动作。
- 状态栏的失败提示用于判断是否需要兜底。

兜底路径的前提是 CDP 端口已配置；CDP 不可用时，先由用户执行「带调试端口重启 Trae」。

---

## 6. 文件与接口变更清单

### 6.1 扩展

| 文件 | 变更 |
|---|---|
| `package.json` | `activationEvents` 增加 `onStartupFinished`；新增 `parallelagent.autoStart` 配置；版本 `2.1.0` |
| `src/state/config.ts` | `ParallelAgentConfig` 增加 `autoStart: 'auto' \| 'on' \| 'off'`；增加 `workspaceRoot` 字段 |
| `src/state/projectLock.ts` | **新增**：锁文件读写、PID 存活检测、路径归一化 |
| `src/http/server.ts` | `createHttpServer` 返回 `{ close, ready }`；`listen` 错误通过 `ready` 拒绝，调用方不再只能读日志 |
| `src/http/routes.ts` | `RouteDeps` 增加 `workspace`；`/health` 返回 `workspace`、`pid` |
| `src/extension.ts` | `activate` 注册 `onStartupFinished` 自动启动；`startOrchestrator` 增加 `{ silent, cdpRetries }`；新增状态栏、锁获取/释放、端口冲突处理；移除 `precheckCdp` 弹窗 |

### 6.2 CLI / Skill / 文档

| 文件 | 变更 |
|---|---|
| `packages/cli/package.json` | 版本 `2.1.0`（与扩展对齐） |
| `adapters/trae/plugin/parallelagent-orchestrator/CHANGELOG.md` | 新增 `2.1.0` 条目 |
| `README.md` | 版本列表增加 v2.1.0；安装说明补充「项目存在 `.parallel-agent/` 时自动启动」 |
| 插件 `README.md` | 补充自动启动策略、状态栏、单实例限制 |
| 本文档 | 实施后回写状态与实测结果 |

### 6.3 不改动

- `协议.md`：HTTP API 语义不变（`/health` 只增字段）。
- `arbiter` / `track` / `solo` SKILL：零改动。
- 单轨台账、任务卡、转达/回执/快照格式：零改动。

---

## 7. 实施步骤

### A. 扩展基础改造

1. `package.json`：`activationEvents` + `autoStart` 配置 + 版本。
2. `config.ts`：增加 `autoStart` 与 `workspaceRoot`。
3. 新增 `state/projectLock.ts`：读写锁、PID 存活、路径比较。
4. `http/server.ts`：暴露 `ready`，区分启动成功/端口冲突。
5. `http/routes.ts`：`/health` 增加 `workspace`、`pid`。

### B. 启动逻辑改造

6. `extension.ts`：
   - `activate` 注册命令、创建状态栏、安排延迟自动启动。
   - `startOrchestrator(context, opts)`：锁检查 → 端口探测 → listen → 写锁 → jobs → CDP 重试。
   - `stopOrchestrator({ userInitiated })`：释放锁、更新状态栏、写禁用标记。
   - 移除激活期 CDP 弹窗。
7. 自动启动失败路径的状态栏与日志埋点（`auto_start_skip`、`lock_conflict`、`port_conflict`、`cdp_unavailable`）。

### C. 发布与文档

8. 更新 CHANGELOG / README / 插件 README。
9. 版本对齐：CLI `2.1.0`、扩展 `2.1.0`；重新生成 vsix。
10. `typecheck` + `build` + `init --vsix` 验证。

---

## 8. 验收用例

| # | 前置 | 操作 | 期望 |
|---|---|---|---|
| A1 | 项目含 `.parallel-agent/` | 打开 Trae | 自动启动；`/health` 返回 `ok`；无弹窗；状态栏「运行中」 |
| A2 | 项目无 `.parallel-agent/` | 打开 Trae | 不启动；不创建目录；状态栏隐藏 |
| A3 | 同项目已开窗口 A | 打开窗口 B | B 不启动；状态栏「已在其他窗口运行」；A 的 `/health` 正常 |
| A4 | 窗口 A 持锁 | 关闭 A，重开窗口 | 锁被释放；新窗口自动启动 |
| A5 | 9318 被其他程序占用 | 打开项目 | 状态栏「端口被占用」；不弹窗；手动启动给出警告 |
| A6 | CDP 端口未配置 | 打开项目 | HTTP 启动；状态栏「CDP 未连接」；不弹窗；修复端口后手动启动可重试 |
| A7 | 已自动启动 | 执行停止 → 关闭并重开窗口 | 状态栏「已停止」；重开不自动启动；手动启动恢复 |
| A8 | 锁文件 PID 已不存在 | 打开项目 | 视为残留并覆盖；正常启动 |
| A9 | 自动启动完成 | 跑一轮 L4 | `/new`、`/dispatch`、`/watch`、ack 全链路与手动启动一致 |
| A10 | 自动启动完成 | 跑 L0-L3 单轨 | 单轨不依赖插件，行为不变 |
| A11 | `autoStart=off` | 打开含 `.parallel-agent/` 项目 | 不自动启动；命令可用 |
| A12 | 空窗口（无工作区） | 打开 Trae | 不启动；不写锁；状态栏隐藏 |
| A13 | 多窗口不同项目 | 分别打开 | 只有先启动者占用 9318；后启动者状态栏提示端口冲突（已知限制） |
| A14 | 自动启动被禁用或失败 | 仲裁者通过 CDP 合成 `Ctrl+Shift+P` 启动 | 编排器正常启动，`/health` 可达（兜底路径不回退） |

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| `onStartupFinished` 在 Trae 的兼容性未知 | 自动启动不触发 | 实施第一步先在真机验证激活时机；不兼容则回退 `*` 激活 + 延迟 |
| 扩展宿主 PID 与窗口生命周期不一致 | 锁残留或误判 | `process.kill(pid, 0)` 校验；解析失败视为残留并覆盖 |
| 持锁窗口关闭后无人接管 | 其他窗口需手动启动 | 列为已知限制；后续可加锁轮询接管 |
| 同项目多窗口数据面冲突 | 重复通知/ack | 项目锁从源头阻止第二个实例启动 |
| 端口冲突在多项目下成为硬限制 | 同一时间只能服务一个项目 | 明示为路线 A 的边界；多项目并行留给后续多实例方案 |
| 自动启动恢复旧 job 产生气泡 | 打扰 | 未绑定仲裁者时跳过注入；实测后决定是否延迟恢复 |
| 状态栏在无关项目误显示 | 视觉噪音 | 显示条件绑定 `.parallel-agent/` 或手动启动 |
| 静默失败导致用户不知道未启动 | 排障困难 | 状态栏 + 输出通道 + 审计日志三处可见；仲裁者仍可 CDP 合成启动兜底 |
| CDP target 仍取第一个 `solo-lite` 页面 | 可能连到其他窗口 | 已确认不纳入本期，作为已知风险接受；误连时在目标窗口手动重启编排器，或等后续「CDP 归属匹配」补丁 |

---

## 10. 待实践验证的问题

1. Trae 的 `onStartupFinished` 是否在 Work 页面渲染后触发？2500ms 延迟是否足够？
2. 扩展宿主 PID 是否随窗口关闭可靠退出？
3. 持锁窗口关闭后，其他窗口自动接管是否需要（按实际使用频率决定）。
4. 自动启动恢复旧 job 时，超时气泡是否造成困扰？
5. 多项目同时打开时，用户对「只有一个项目能跑编排器」的接受度。
6. 状态栏在无关项目隐藏后，用户是否还能发现扩展已安装。
7. CDP 合成启动在多窗口下的目标归属是否稳定（与 §3.2 的 target 选择问题同源；本期只观察，不修复）。

---

## 11. 后续路线（不在本期）

| 路线 | 内容 | 前置条件 |
|---|---|---|
| 路线 B 多实例 | 动态端口 + `.parallel-agent/信号/orchestrator.json` 端口发现 + 项目锁 + CDP 归属匹配 | 先完成本期项目锁与 `/health` 诊断字段；需改 `arbiter` 8 处端口硬编码、`协议.md`、测试矩阵 |
| 锁接管 | 其他窗口轮询锁文件，持锁实例退出后自动接管 | 本期锁格式稳定后 |
| CDP 归属匹配 | 按窗口标题/项目名选择 `solo-lite` 页面 | 独立于自动启动，可作为小版本补丁 |

---

## 12. 版本与发布口径

- 项目版本：`2.1.0`（新增自动启动能力，属功能级变更）。
- CLI 与扩展同版本发布，`EXPECTED_EXTENSION_VERSION` 依赖 CLI 自身版本。
- 发布前必须完成 §8 全部用例，并在 `test-docs/` 增加 `v2.1.0基础测试报告.md`。
- 回滚方式：配置 `parallelagent.autoStart = "off"` 即可退回手动启动行为，无需降级版本。

---

## 13. 已确认口径（2026-10-26）

| 编号 | 问题 | 选定 | 生效位置 |
|---|---|---|---|
| Q1 | `autoStart` 默认值 | **`auto`**（项目存在 `.parallel-agent/` 才自动启动） | §5.1 |
| Q2 | CDP target 归属匹配 | **不纳入本期**，沿用取第一个 `solo-lite` 页面 | §4.2 / §9 |
| Q3 | 多实例 / 动态端口 | **不做**，留作后续路线 B | §3 / §11 |

---

## 14. 术语

| 术语 | 含义 |
|---|---|
| 项目级自动启动 | 仅当当前工作区存在 `.parallel-agent/`（或配置 `on`）时自动启动编排器 |
| 项目锁 | `信号/orchestrator.lock`，记录持锁扩展宿主 PID 与端口，保证同一项目单实例 |
| 静默失败 | 自动启动路径不弹窗，只写状态栏与输出通道 |
| 状态栏 | VS Code 状态栏项，显示运行中 / CDP 未连接 / 端口冲突 / 已在其他窗口运行 / 已停止 |
| 路线 A | 本期方案：固定端口 + 项目锁 + 静默自动启动 |
| 路线 B | 后续方案：多实例 + 动态端口 + 端口发现，本期不做 |

---

## 15. 实施记录（2026-10-26）

### 15.1 已落地

| 类型 | 文件 |
|---|---|
| 新增 | `src/state/projectLock.ts` |
| 修改 | 插件 `package.json`（`onStartupFinished`、`autoStart` 配置、版本 2.1.0） |
| 修改 | `src/state/config.ts`（`autoStart`、`workspaceRoot`） |
| 修改 | `src/http/server.ts`（`HttpServerHandle.ready`） |
| 修改 | `src/http/routes.ts`（`/health` 增加 `workspace`、`pid`） |
| 修改 | `src/extension.ts`（自动启动、状态栏、单实例锁、静默失败、停止语义、CDP 重试） |
| 修改 | 插件 `CHANGELOG.md` / 插件 `README.md` / 根 `README.md` |
| 修改 | `packages/cli/package.json`（2.1.0） |
| 产物 | `parallelagent-orchestrator-2.1.0.vsix` |

### 15.2 已完成的验证

| 项 | 结果 |
|---|---|
| 插件 `typecheck` | 通过 |
| 插件 `build` | 通过 |
| CLI `typecheck` / `build` | 通过 |
| 锁模块离线测试（esbuild 打包 + stub logger） | 通过：读写回环、PID 存活/不存在、路径归一化、损坏锁返回 null、`clearLock` |
| `init --vsix ...2.1.0.vsix` | 扩展 2.1.0；3 Skill + 3 reference 就位 |
| vsix 内容核对 | manifest 与 `package.json` 均为 2.1.0；`dist/extension.js` 含 `orchestrator.lock`、`auto_start_skip` |

### 15.3 真机验证结果（2026-10-26，用户实测）

| 项 | 结果 |
|---|---|
| 项目自动启动触发 | 通过 |
| 停止后重开窗口 | 通过（不再自动启动；手动启动恢复） |
| 状态栏显示 | 通过 |
| 其他项目端口冲突警告 | 通过（手动启动时提示端口被占用） |
| 关闭占用窗口后端口释放 | 通过 |
| 新窗口手动启动 | 通过 |
| 同项目双窗口 | 未触发：Trae 会复用同一项目窗口，不会产生双实例；项目锁保留为异常兜底 |
| L4 全链路 | 通过（5 步全过，含唤醒链路） |

### 15.4 最小 L4 回归结果（2026-10-26）

| 步骤 | 结果 | 关键证据 |
|---|---|---|
| `GET /health` | PASS | `ok=true`、`cdp_alive=true`、`workspace=e:\备份\project\Temp`、`pid=11248` |
| `POST /new` | PASS | 建轨成功，sid `6adea13010ab37552fa0eca9`；轨道写出 `就绪/T-X.md` |
| `POST /wait-ready` | PASS | 阻塞 50 s，`就绪=["T-X"]`、`未就绪=[]` |
| `POST /dispatch` | PASS | `ok=true`、sid 一致；12 s 后写出 T-X 回执，无源码改动、计数一致 |
| `POST /watch` → 通知 → ack | PASS | job `w-j6jaouc4`；`notify_injected` 于 00:43:10.965；ack 于 00:43:25.253；`全部已处理=true`、`剩余待处理=[]`、job 状态 `done` |

状态文件 `第2轮-v1.json` 完整记录了 `pending → notified → done` 流转。

### 15.5 观察项：Agent 页晚于编排器启动

- **现象**：首次 `/new` 返回 `anchor_not_found`。编排器启动时 `GET /json` 中尚无 `solo-lite` 的 Agent 页，`filterWorkTarget` 回退到 title 含「管理员」的 IDE 工作台页；该页没有任务列表。重跑一次「ParallelAgent: 启动编排器」后 CDP 重连到 Agent 页，后续全部通过。
- **根因**：`filterWorkTarget` 的兜底分支不区分「Work 对话页」与「IDE 工作台页」；自动启动发生在 `onStartupFinished`，早于用户打开 Agent 页。
- **影响**：首次 L4 需要额外执行一次启动命令；不影响 2.1.0 的自动启动、单实例与状态栏行为。
- **候选修复（不纳入本期，待确认）**：
  1. 启动时若只有非 `solo-lite` 页，先等待一段时间（如 30 s）再回退，期间出现 Agent 页则连它。
  2. 连到兜底页后后台轮询，发现 `solo-lite` 页出现即自动重连。
  3. `/new`、`/dispatch` 命中 `anchor_not_found` 时自动重新发现 target 并重试一次。

**已采纳方案 1**（自动启动只认 Agent 页 + 等待窗口），实施记录见 §16。

### 15.6 待验证项

1. Agent 页晚于编排器启动时的 CDP target 重选（见 §15.5，已在 2.1.1 修复，待真机复测）。
2. `onStartupFinished` 的 2500ms 延迟在冷启动与热启动下是否都足够（当前实测通过，保留观察）。

---

## 16. 2.1.1 补丁记录（2026-10-26）

| 缺陷 | 修复 | 验证 |
|---|---|---|
| 自动启动首连错页：Agent 页晚于编排器启动时，CDP 回退到 IDE 工作台页，首次 `/new` 返回 `anchor_not_found` | 自动启动只接受 `url` 含 `solo-lite` 的 Agent 页，等待约 30 秒（15 次 × 2 秒）；超时保持 HTTP 可用、状态栏提示打开 Agent 页；手动启动保留「管理员」兜底 | `cdpTarget.filterWorkPageOnly`；`extension` 自动路径 `requireWorkPage=true`、`cdpRetries=15`；插件 `typecheck` / `build` 通过 |

- 版本：扩展 / CLI `2.1.1`；vsix `parallelagent-orchestrator-2.1.1.vsix`。
- 待真机复测：先启动编排器、后打开 Agent 页，确认 30 秒内自动连上；以及超时路径的状态栏提示。
- **后续修正**：真机发现只认 `url` 含 `solo-lite` 会漏掉 `Agent [管理员]` 形态，见 §17。

---

## 17. 2.1.2 补丁记录（2026-10-26）

| 缺陷 | 修复 | 验证 |
|---|---|---|
| 2.1.1 的 Agent 页识别过窄：只认 `url` 含 `solo-lite`，实际 Agent 页 target 常显示为 `Agent [管理员]`，被过滤后自动启动空等 30 秒；手动重连经旧兜底反而成功，表现为「自动连不上、手动能连上」 | 新增 `isAgentTarget`：`url` 含 `solo-lite`，或 title 以 `Agent` 开头且不含 `TRAE CN`；手动与自动共用该判定，旧版兜底排除 IDE 工作台页 | `audit.log` 历史 target 形态（`Agent [管理员]` / `<项目名> - TRAE CN [管理员]` / `solo-lite.html`）；插件 `typecheck` / `build` 通过；待真机复测 |

- 版本：扩展 / CLI `2.1.2`；vsix `parallelagent-orchestrator-2.1.2.vsix`。
- 观测增强：`cdp_connect` 记录 `url`，下次可直接确认 Agent 页 target 的 url 形态。

---

## 18. 2.1.3 补丁记录（2026-10-26）

| 缺陷 | 修复 | 验证 |
|---|---|---|
| 自动启动 30 秒超时后，打开 Agent 页再点状态栏重连仍失败并提示「CDP 仍不可达」：手动路径只重试 1 次，Agent 页 target 尚未进入 `/json` 时一次瞬败 | 手动 `parallelagent.start` 的 CDP 重试从 1 次提升到 10 次（约 20 秒）；点击后状态栏立即显示「启动中」；连接失败写入 `cdp_connect_fail` 审计 | `typecheck` / `build` 通过；待真机复测 |

- 版本：扩展 / CLI `2.1.3`；vsix `parallelagent-orchestrator-2.1.3.vsix`。
- 诊断增强：`cdp_connect_fail` 的 `err` 可区分「枚举 targets 失败（端口不通）」「找不到 Agent 页 target（页面未就绪）」「WebSocket 连接失败」。

---

## 19. 现象归因：Trae 启动间隔过短（2026-10-26）

真机复现中出现的「自动启动 30 秒内有时成功、30 秒后失败」「手动重连时好时坏」「打开 Agent 页有时能救」等不稳定现象，经 9317 端口采样（每 2 秒一次，覆盖多轮 Trae 重启）归因如下。

| 观测 | 结果 |
|---|---|
| 端口状态与 Trae 主进程 pid | 一一对应：换 pid 即换端口状态 |
| 启动间隔 < 10 秒的实例 | 几乎全部 `FAIL`（`ECONNREFUSED`） |
| 启动间隔 > 40 秒的实例 | 全部 `OK` |
| 同一实例内等待 | 绑定失败后不会自愈，等待与重试均无效 |
| 是否打开 Agent 页 | 与端口状态无因果关系 |

**机制**：

1. 9317 由 Trae 主进程在启动时**一次性绑定**；绑定失败后运行期不重试。
2. 旧 Trae 实例退出后端口不会立即释放；新实例在窗口期内启动即绑定失败。
3. 因此启动间隔过短时，新实例从启动起就没有 9317，直到下次完整重启。

**结论**：此前观察到的自动启动不稳定，主因是测试期间频繁快速重启 Trae，而非自动启动逻辑或 target 识别缺陷。2.1.1–2.1.3 的 target 识别与重连窗口修正仍然有效，但无法修复 Trae 的一次性端口绑定。

**操作约束**：

- 绑定失败的实例不会自愈，继续等待或重试无效；**下次完整重启即可恢复**，无需固定等待 60 秒。
- 避免在同一实例上反复重试；重启时确认所有 `Trae CN.exe` 进程已退出，避免新旧实例并存。
- 2.1.4 起，检测到 `ECONNREFUSED` 会直接提示「立即重启 / 忽略」。

**诊断工具**：`%TEMP%\pa-9317-sampler*.log`（后台 WMI 独立进程，每 2 秒记录端口状态与主进程 pid）。

---

## 20. 2.1.4 补丁记录（2026-10-26）

| 缺陷 | 修复 | 验证 |
|---|---|---|
| CDP 端口未监听（`ECONNREFUSED`）时缺少可操作的恢复入口，用户只能自行排查重启 | 识别 `ECONNREFUSED` 后弹出「频繁重启导致 CDP 端口绑定失败，下次重启后恢复」，提供「立即重启 / 忽略」；「立即重启」复用重启脚本并传 `-DelaySeconds 0`；提示 30 秒冷却 | `typecheck` / `build` 通过；待真机复测 |

- 版本：扩展 / CLI `2.1.4`；vsix `parallelagent-orchestrator-2.1.4.vsix`。
- 行为：命令面板的「带调试端口重启 Trae」仍等待 8 秒；错误提示中的「立即重启」不等待（2.1.5 起统一立即执行，见 §21）。

---

## 21. 2.1.5 补丁记录（2026-10-26）

| 变更 | 说明 |
|---|---|
| 移除重启等待 | 命令面板的「带调试端口重启 Trae」与错误提示中的「立即重启」统一为立即执行 |
| 重启脚本 | 删除 `-DelaySeconds` 参数与等待；日志改为 `restart immediately` |
| 提示文案 | 统一为「ParallelAgent 已写入调试端口配置，正在重启 Trae」 |

- 版本：扩展 / CLI `2.1.5`；vsix `parallelagent-orchestrator-2.1.5.vsix`。
