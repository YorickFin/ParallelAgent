# ParallelAgent v3 最小全量测试报告

- 执行日期：2026-10-28
- 执行位置：`<测试项目>`（独立 git 仓库）
- 被测对象：`~/.trae-cn/skills/parallelagent-{solo,arbiter,track}` + `~/.parallel-agent/{references,templates,hosts}`
- 未改动被测对象与 `<ParallelAgentv3仓库>`

## 环境版本

| 项 | 值 |
|---|---|
| 宿主 | Trae CN（能力档案记录 `host_version: 3.4.9`） |
| Node | v24.15.0 |
| Git | 2.46.0.windows.1 |
| 项目根 | `<测试项目>` |
| 分支 | `master` |

## 判定汇总

| 用例 | 判定 |
|---|---|
| M00 环境 | PASS |
| M01 骨架 | PASS |
| M02 L0 | PASS |
| M03 L4 双轨 | PASS |
| M04 冷启动 | PASS（证据为转述） |

**结论：可用**（M00-M04 全 PASS）。

---

## M00 环境取证 — PASS

命令与结果：

```
PROJECT=<测试项目父目录>
NODE=v24.15.0
GIT=git version 2.46.0.windows.1
Skill 存在：parallelagent-arbiter / parallelagent-solo / parallelagent-track
~/.parallel-agent 下存在：install-state.json、references/(分流|台账|协议).md、
  templates/(分流卡|任务卡|契约|转达|回执|快照|交接手册|台账条目).md、
  hosts/(trae-cn.md|能力档案-模板.md)、能力档案/trae-cn.md
```

能力档案 `~/.parallel-agent/能力档案/trae-cn.md`：

- `schema_version: 1` ✅
- `max_concurrency: 5` ✅
- `confidence: 实测` ✅
- `max_mode: L0-L4` ✅
- `install-state.json` 记录 `version: 3.0.0`、`host: trae-cn`，三个 Skill 与全部 references/templates 有哈希登记

判定：PASS，环境满足。

## M01 骨架 — PASS

- `git init` → `Initialized empty Git repository in <测试项目>/.git/`
- 提交：`0f473bd chore: 建立最小测试项目骨架`（3 files changed, 16 insertions）
- `node --test` → `tests 1 / pass 1 / fail 0`，`EXIT=0`

判定：PASS。

## M02 L0 单轨 — PASS

请求原话：把 `src/greeting.js` 里的 `Hello` 改成 `Hi`，保持测试能过。

Skill 激活：`parallelagent-solo` 已调用（本会话入口即加载），按 `references/分流.md` §2 判定为 L0（目标一句话、单文件、低风险），未建轨道、未写任务卡。

执行与证据：

- `git diff --stat` → `src/greeting.js | 2 +-`、`test/greeting.test.js | 2 +-`，2 files changed, 2 insertions(+), 2 deletions(-)
- `node --test` → `tests 1 / pass 1 / fail 0`，`EXIT=0`
- 台账：`.parallel-agent/单轨/台账/2026-10.md`，条目 `S-20261028-001`，含 ID / 时间 / 模式 L0 / 需求 / 目标 / 非目标 / 改动 / 证据 / 结论 / 回滚 / commit
- 提交两次，符合「先提交代码 → 再写台账回填真实 hash」：
  - `bd76a76 fix(S-20261028-001): greeting 改为 Hi 并同步断言`
  - `120df4e docs(S-20261028-001): 记录 L0 单轨台账`

偏差说明：测试断言同步修改属文档预期内的最小连带，不算越界。

判定：PASS。

## M03 L4 双轨 — PASS

请求原话：在 `src/a/` 和 `src/b/` 各加一个独立模块：A 加 `sum.js` 导出 `sum(a,b)`，B 加 `upper.js` 导出 `upper(s)`，各自带一个 `node:test` 测试；两块互不依赖，拆开跑。

Skill 激活：`parallelagent-arbiter` 已调用；能力档案校验通过（`max_mode: L0-L4`、`max_concurrency: 5`）。两轨的执行单元各自调用 `parallelagent-track` 后按契约执行。

三件套确认：用户原话已预置「验收条件与非目标按任务卡执行，我确认；文件边界以任务卡为准」，记录在任务卡「确认记录」段，未重复提问。

产出文件（`git ls-files .parallel-agent` 可复核）：

```
.parallel-agent/分流卡/S-20261028-002.md          （L4，含强拆条件核对 5 项全满足）
.parallel-agent/单轨/任务卡/pa-v3-l4-dual-track.md
.parallel-agent/交接手册/第1版-开轨前.md
.parallel-agent/交接手册/第2版-收尾.md
.parallel-agent/契约/第1轮/T-A-v1.md
.parallel-agent/契约/第1轮/T-B-v1.md
.parallel-agent/转达/第1轮/T-A-v1.md
.parallel-agent/转达/第1轮/T-B-v1.md
.parallel-agent/回执/第1轮/T-A-v1.md
.parallel-agent/回执/第1轮/T-B-v1.md
.parallel-agent/快照.md
.parallel-agent/单轨/台账/2026-10.md              （追加 L4 摘要 S-20261028-003）
```

契约头与 scope（互不相交）：

| 轨 | `contract_version` | `scope` |
|---|---|---|
| T-A | v1 | `src/a/**`、`test/a/**`、`.parallel-agent/回执/第1轮/T-A-v1.md` |
| T-B | v1 | `src/b/**`、`test/b/**`、`.parallel-agent/回执/第1轮/T-B-v1.md` |

回执 frontmatter（实读文件）：

```
T-A: kind: 回执 / track: T-A / round: 1 / contract_version: v1 / result: ok
     artifacts: ["src/a/sum.js", "test/a/sum.test.js"]
T-B: kind: 回执 / track: T-B / round: 1 / contract_version: v1 / result: ok
     artifacts: ["src/b/upper.js", "test/b/upper.test.js"]
```

并行派发：同一条消息内同时启动 2 个子代理（`batch = min(2, 5) = 2`），非串行两次；返回各一行指针 `T-A ok …` / `T-B ok …`。子代理 prompt 只给契约路径、回执路径、返回格式，且明确禁止运行 git。

越界扫描（协议 §6，文件系统为准）：

- 派发前基线：`git status --porcelain` 5 项（`.parallel-agent/` 下 交接手册、分流卡、单轨/任务卡、契约、转达，均为仲裁者文档，属基线）
- 派发后：10 项；差集为 `回执/`、`src/a/`、`src/b/`、`test/a/`、`test/b/`
- 白名单核对：差集全部命中「各轨 scope + `回执/**` + `快照.md` + `交接手册/**`」
- 仓库无 `.gitignore`；另用文件系统全量列目录复核，共 16 个文件，无白名单外新增/修改/删除
- 命中：**无**

实检：

- `node --test` → `tests 5 / pass 5 / fail 0`（`sum 正数`、`sum 负数`、`upper 将小写字符串转为大写`、`upper 保持数字并转大写字母`、`greet`），`EXIT=0`
- 版本一致性：通过（回执 `contract_version: v1` 与契约一致，字段齐全，artifacts 均在 scope 内且不含回执自身与 `.parallel-agent/` 元文件）

两次提交（由仲裁者执行，轨道未提交）：

```
cfc9baa feat(pa-v3-l4-dual-track): 双轨新增 sum/upper 模块及测试   ← 产物提交 hash A（含契约/转达/回执/分流卡/任务卡/手册第1版）
9727c53 docs(pa-v3-l4-dual-track): 落快照/交接手册第2版/台账摘要（引 cfc9baa）  ← 元文件提交，hash 未写入任何文档
```

快照 `.parallel-agent/快照.md`：`handover_version: 2` 与交接手册最新版 `第2版-收尾.md` 一致；提交字段只填真实产物 hash `cfc9baa`，无「待提交」字样；收尾时已出第 2 版交接手册（阶段改收尾、轨道状态改已完成、欠账勾销）。

判定：PASS。

## M04 冷启动 — PASS

证据来源：用户另开新会话执行后贴回的接管摘要（**转述证据**；原文由用户提供，本会话未直接读取该会话，按用例规则标注为转述）。

首次尝试时本会话无法代执行，记为 BLOCKED；用户按其建议的冷启动首条消息在新会话运行后，回填如下结果。

逐条核对：

| 判定标准 | 新会话实际输出 | 结论 |
|---|---|---|
| 准确说出已完成项 | T-A、T-B 均「已完成，回执 `T-A-v1.md` / `T-B-v1.md`，`result: ok`，artifacts 均落在 scope」 | ✅ |
| 引用文件路径 | 交接手册 `第2版-收尾.md`、`.parallel-agent/快照.md`、契约/回执 `第1轮/T-A-v1.md`、台账、本报告 | ✅ |
| 引用可核对事实 | `node --test` 复跑 5/5 通过、退出码 0；提交 `cfc9baa`（产物）/`9727c53`（元文件）/`7b28e97`（报告）；`git status --porcelain` 为空；`handover_version: 2` 与手册最新版一致 | ✅ |
| 给出下一步 | 指出收尾动作全部落地、无待补业务动作，唯一未闭环项即 M04 本身，并给出「回填 PASS」与「仅归档」二选一 | ✅ |
| 不重复问已记录的问题 | 未重问技术栈、目录、测试命令、轨道范围；只就「报告是否回填 M04」征求决策 | ✅ |

一致性抽查：新会话报的能力档案值（`schema_version: 1`、`max_mode: L0-L4`、`max_concurrency: 5`、`confidence: 实测`）与 M00 实读一致；自检摘要（批次 1、失败率 0/2、重试 0、越界 0、版本错配 0）与 M03 记录一致，无矛盾。

已知局限：新会话说明「`host_version: 3.4.9` 无法直接核验，按暂用旧档案处理」，不影响已收尾结论，但升级 Trae 后应重测能力档案。

判定：PASS。

## 失败项归类

| 项 | 归类 |
|---|---|
| 无 | 无缺陷项，无环境阻塞项 |

## 下一步建议

1. M04 已由用户新会话闭环并回填 PASS，本次测试全链路（M00-M04）通过，无待办用例。
2. 建议在被测仓库补一条 `.parallel-agent/` 的约定说明，避免首次使用时误把元文件当业务产物提交。
3. 升级 Trae 后比对能力档案 `host_version`（当前 3.4.9），不一致时重测三选一。
4. 本次未复制报告到 `<ParallelAgentv3仓库>\test-docs\报告\`：测试提示词 §0.4 明确不得改动该仓库。如需归档，由仓库维护者自行复制。
