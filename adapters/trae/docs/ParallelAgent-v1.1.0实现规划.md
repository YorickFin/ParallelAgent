# ParallelAgent v1.1.0 实现规划

> 状态：**待开工**
> 前置：一期（手动触发版）已完成并联调通过，见 [ParallelAgent第一期实现规划.md](ParallelAgent第一期实现规划.md)
> 目标：把"源码安装"变成 **`npx parallelagent init`** 一键安装

## Context

一期交付的 ParallelAgent 在功能上已闭环，但分发形态是源码：

- 用户要克隆仓库 → `pnpm install` → `pnpm build` → 手动把扩展装进 Trae → 手动复制 SKILL.md 到全局 skills → 手动搞清楚怎么带调试端口启动 Trae
- `restartWithDebug` 命令硬编码了 `D:\Programs\Trae\Trae CN.exe` 和工作区探针脚本路径，换台机器即废

v1.1.0 只解决"安装/启动"这一件事，不动一期的运行时逻辑。

## 用户视角目标

```
安装：
  npx parallelagent@latest init        ← 一次性，完成全部配置

启动 Trae（之后每次）：
  双击图标 / 开始菜单 / 任务栏 / 任何入口，调试端口自动就绪

进入工作流：
  Ctrl+Shift+P → ParallelAgent: 启动编排器
```

不新建快捷方式、不修改现有快捷方式、不写注册表启动项、不要求用户记忆任何参数。

## 关键决策（已与用户对齐）

| 决策点 | 结论 |
|---|---|
| 扩展分发通道 | **Open VSX 主通道**（Trae 默认拉取源）+ **GitHub Release 直链 .vsix** 兜底 |
| Skill 安装位置 | **用户级全局 skills 目录** `~/.trae-cn/skills/<name>/SKILL.md` |
| 调试端口方案 | **`argv.json`**（已实测验证通过，见下） |
| 项目层信箱目录 | **`<workspace>/.parallel-agent/`**（一期默认 `docs/协调/` 废弃，不污染用户 docs） |

### argv.json 实测验证记录（2026-10-20）

- 路径：`C:\Users\Anni\.trae-cn\argv.json`（**不是** `%APPDATA%\Trae CN\`）
- 写入 `"remote-debugging-port": "9317"` 后正常重启 Trae
- `http://127.0.0.1:9317/json/version` 返回：
  - Browser: `Chrome/142.0.7444.235`
  - Protocol-Version: `1.3`
  - User-Agent 含 `TraeCN/1.107.1 Electron/39.2.7`
- 结论：**VS Code 系 argv.json 机制在 Trae CN 上完整保留**

## 关键路径速查

| 用途 | 路径（Windows） |
|---|---|
| argv.json（CDP 端口持久化） | `~/.trae-cn/argv.json` |
| 全局 skills 根 | `~/.trae-cn/skills/` |
| 仲裁者 Skill | `~/.trae-cn/skills/parallelagent-arbiter/SKILL.md` |
| 轨道 Skill | `~/.trae-cn/skills/parallelagent-track/SKILL.md` |
| 项目层信箱根 | `<workspace>/.parallel-agent/`（每个项目独立，入 git） |
| 国际版 Trae 候选前缀 | `~/.trae/`（探测用，当前不实测） |

CLI 探测顺序：`~/.trae-cn/` → `~/.trae/` → 报错退出并提示用户指定。

### 项目层信箱结构（`.parallel-agent/`）

```
.parallel-agent/
  轨道启动手册.md            # 新会话首条消息指向
  契约块.md                  # 最终结论，嵌代码注释
  快照.md                    # 仲裁者每批后回写
  转达/第N轮/T-X-v{M}.md     # 仲裁者按轨独立写（同轮可多次转达，M 从 1 递增）
  回执/第N轮/T-X-v{M}.md     # 各轨收工自写（含自检字段，与转达对称）
  交接手册/第N版-*.md        # 冷启动入口
  信号/                      # dispatch.signal / watch.ack 等临时信号
  .gitignore                 # 内容只一行：信号/（临时信号不入 git）
```

除 `信号/` 外全部入 git，保证可溯源、可交接。

## 目标目录结构

```
adapters/trae/
  plugin/parallelagent-orchestrator/
    resources/
      scripts/
        restart-with-debug.ps1      # 从 probes/ 迁入，改为读 argv.json + process.execPath
    src/
      extension.ts                  # 改：activate 自检 + 一键修复引导
      cdp/precheck.ts               # 新：CDP 连通性预检
      state/argvJson.ts             # 新：argv.json 读-改-写
      state/traePaths.ts            # 新：Trae 用户数据目录探测
  shared/                           # 不变
  skills/                           # 不变（发布时由 CLI 铺到全局）

packages/
  cli/                              # 新建：npm 包 parallelagent
    package.json                    # name=parallelagent, bin=parallelagent
    tsconfig.json
    src/
      index.ts                      # 入口 + 子命令分发
      commands/
        init.ts                     # 装扩展 + 铺 skills + 写 argv.json + 验证
        doctor.ts                   # 环境自检报告
        uninit.ts                   # 逆向清理
      lib/
        detectTrae.ts               # 探测 Trae 用户数据目录 + CLI 命令名
        argvJson.ts                 # argv.json 读-改-写（与插件侧同逻辑，注意保持同步）
        installExtension.ts         # Open VSX / GitHub Release 下载 + trae --install-extension
        installSkills.ts            # 铺 SKILL.md 到全局 skills
        verify.ts                   # ping CDP / 检查 skills 就位
    assets/
      skills/                       # 打包时从 adapters/trae/skills/ 拷贝
        parallelagent-arbiter/SKILL.md
        parallelagent-track/SKILL.md

.github/
  workflows/
    release.yml                     # tag 推送 → vsce package → GitHub Release + Open VSX
```

## 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| CLI 语言 | TypeScript + esbuild 打包为单文件 ESM | 与插件同栈，零学习成本 |
| CLI 参数解析 | Node 原生 `util.parseArgs` | 零依赖；只有 3 个子命令，不需要 commander |
| CLI 运行依赖 | **零运行时依赖** | npx 首次执行速度最优 |
| HTTP 请求 | Node 18+ 内置 `fetch` | 零依赖 |
| npm 包名 | 优先 `parallelagent`；被占用则 `@yorickfin/parallelagent` | 发布前需 `npm view` 检查 |
| 扩展打包 | `@vscode/vsce`（devDependency） | VS Code 扩展标准 |
| Open VSX 发布 | `ovsx` CLI（CI 里 npx 调用） | Open VSX 官方工具 |
| CI | GitHub Actions | 与仓库同平台 |

## 实现步骤

### A. 插件侧修复（4 步）

#### 步骤 A1：迁移 restart 脚本，改用 `process.execPath`
- 把 `adapters/trae/probes/restart-with-debug.ps1` 移到 `plugin/parallelagent-orchestrator/resources/scripts/restart-with-debug.ps1`
- 移除硬编码 `D:\Programs\Trae\Trae CN.exe`：扩展侧通过 `process.execPath` 拿到 Trae exe 绝对路径，作为参数传给脚本
- 移除硬编码 `$port = 9317`：作为参数传入
- `esbuild.build.js` 加 `copyPlugin` 把 `resources/` 拷进 `dist/`（或改 `package.json` 的 `files` 字段，vsce 打包时包含）
- [extension.ts:178-200](../../plugin/parallelagent-orchestrator/src/extension.ts) `findRestartScript` 改为从 `context.extensionPath` 定位

#### 步骤 A2：`restartWithDebug` 改为"写 argv.json + 重启"
- 新建 `src/state/traePaths.ts`：
  - `detectTraeDataDir(): string` —— 探测 `~/.trae-cn/` / `~/.trae/`，返回 argv.json 所在目录
- 新建 `src/state/argvJson.ts`：
  - `readArgvJson(path)` / `writeArgvJson(path, patch)` —— **增量合并**，绝不覆盖用户已有键
  - `ensureRemoteDebuggingPort(port: number)` —— 幂等写入
- 改 `restartWithDebug`：
  1. 探测 argv.json 路径
  2. 增量写入 `remote-debugging-port`
  3. 调 restart 脚本（WMI 拉起，脱离 Trae 进程树）
  4. 提示用户 8 秒后 Trae 将重启
- 保持 CDP 断线时不清空 argv.json（用户可能主动停编排器）

#### 步骤 A3：activate 自检 + 一键修复引导
- 新建 `src/cdp/precheck.ts`：
  - `pingCdp(port, timeoutMs=2000): Promise<boolean>` —— fetch `http://127.0.0.1:${port}/json/version`
- 改 `activate`：
  - 注册命令后立即 ping CDP（不阻塞 activate 返回）
  - 不通 → `showErrorMessage` 带两个按钮：`立即修复`（触发 `restartWithDebug`）/ `仅本次忽略`
  - 通 → 静默
- 保留现有 `parallelagent.start` 的 fail-stop 行为不变

#### 步骤 A4：信箱根迁移 `docs/协调/` → `.parallel-agent/`，插件启动时自动创建
- 改 `package.json` `parallelagent.mailboxRoot` 默认值：`docs/协调` → `.parallel-agent`
- 改 `src/mailbox/paths.ts`：如存在硬编码路径一并替换
- 改 `startOrchestrator`：启动编排器时幂等执行
  - `mkdir -p <workspace>/.parallel-agent/{转达,回执,交接手册,信号}`
  - 写 `<workspace>/.parallel-agent/.gitignore`，内容只一行：`信号/`
- 同步全文替换 `docs/协调` → `.parallel-agent`（影响面）：
  - `adapters/trae/skills/parallelagent-arbiter/SKILL.md`
  - `adapters/trae/skills/parallelagent-track/SKILL.md`
  - `adapters/trae/shared/references/协议.md`
  - `adapters/trae/shared/templates/轨道启动手册模板.md`
  - 根 `README.md` 如有提及
- 一期未正式发布，无存量用户，**不做旧路径迁移兼容**

### B. CLI 包（4 步）

#### 步骤 B1：`packages/cli/` 脚手架
- `package.json`：
  - `name: parallelagent`（先 `npm view parallelagent` 检查占用）
  - `bin: { "parallelagent": "./dist/index.js" }`
  - `type: module`，`engines.node: ">=18"`
  - `files: ["dist", "assets"]`
- esbuild 打包为单文件 ESM，shebang `#!/usr/bin/env node`
- 构建时把 `adapters/trae/skills/*/SKILL.md` 拷到 `packages/cli/assets/skills/`

#### 步骤 B2：`init` 命令
执行序列（每步失败即 fail-stop，打印可操作的下一步）：
1. **探测**：`detectTrae()` → 返回 `{ dataDir, cliCommand, exePath }`
   - `dataDir`：`~/.trae-cn` 或 `~/.trae`
   - `cliCommand`：PATH 上查 `trae-cn` / `trae`；查不到则试 `${exePath 同级}/bin/trae-cn.cmd`
   - `exePath`：注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\*` 读 InstallLocation；fallback 常见路径 `%LOCALAPPDATA%\Programs\Trae CN\Trae CN.exe`
2. **装扩展**：
   - 首选 `trae --install-extension yorickfin.parallelagent-orchestrator`（Trae 默认从 Open VSX 拉）
   - 失败 → 从 GitHub Release 下载 .vsix 到 `%TEMP%`，再 `trae --install-extension <vsix路径>`
3. **铺 skills**：把 `assets/skills/` 下两个目录拷到 `<dataDir>/skills/`，已存在则覆盖（版本化由 CLI 版本号承担）
4. **写 argv.json**：`ensureRemoteDebuggingPort(9317)`，增量合并
5. **验证**：
   - 检查 skills 文件存在
   - ping CDP（如 Trae 未运行则跳过，提示"下次启动 Trae 生效"）
6. **打印成功面板**：下一步操作 + 文档链接

幂等：任何一步重跑都安全（覆盖写 / 合并写 / 跳过已装）。

#### 步骤 B3：`doctor` 命令
输出表格：
- Trae 安装路径 / 版本（从 exe 资源或 `--version`）
- 数据目录位置
- argv.json 是否含 `remote-debugging-port`、值是多少
- CDP 端口实测通否（如 Trae 在运行）
- 扩展是否已装（`trae --list-extensions` 查 `yorickfin.parallelagent-orchestrator`）
- 两个 SKILL.md 是否在位、大小是否正常
- 结论：OK / 问题清单 + 修复建议（`parallelagent init` 重跑）

退出码：全绿 0，有问题 1（CI 友好）。

#### 步骤 B4：`uninit` 命令
- 删 `~/.trae-cn/skills/parallelagent-arbiter/` 和 `parallelagent-track/`
- argv.json 移除 `remote-debugging-port` 键（**只删这一个键**，其他键保留）
- 提示用户手动 `trae --uninstall-extension yorickfin.parallelagent-orchestrator`（CLI 不主动卸载，避免误删用户数据）
- 不动项目层 `<workspace>/.parallel-agent/` 信箱目录（项目数据，用户自行处理）

### C. CI（1 步）

#### 步骤 C1：`.github/workflows/release.yml`
触发：`push: tags: ["v*"]`

Job 1 `package-extension`：
- `pnpm install` 插件目录
- `pnpm typecheck && pnpm build`
- `npx vsce package --out parallelagent-orchestrator.vsix`
- 上传 artifact

Job 2 `release-github`（needs: package-extension）：
- `gh release create ${{ github.ref_name }} ./parallelagent-orchestrator.vsix --generate-notes`

Job 3 `publish-open-vsx`（needs: package-extension）：
- `npx ovsx publish ./parallelagent-orchestrator.vsix -p ${{ secrets.OPEN_VSX_TOKEN }}`

Job 4 `publish-cli`（独立触发，也可同 workflow）：
- `packages/cli/` 构建 + `npm publish --access public`
- 需 secret `NPM_TOKEN`

## 关键设计约束

1. **不污染用户系统**：不新建快捷方式、不修改现有快捷方式、不写注册表启动项、不写系统环境变量
2. **argv.json 增量合并**：读-改-写单键，绝不整文件覆盖；写前备份为 `argv.json.parallelagent-bak`
3. **CLI 幂等**：重复执行 `init` 结果与执行一次相同
4. **探测优先，零硬编码**：Trae 路径、CLI 命令名、数据目录全部运行时探测，禁止硬编码绝对路径
5. **fail-stop**：任何一步失败立即退出，打印可操作修复建议，不留半成品状态
6. **零运行时依赖**：CLI 只用 Node 18+ 内置 API（`fetch` / `fs` / `util.parseArgs` / `child_process`）
7. **Apache 2.0 版权头**：所有新增源文件保留版权声明头
8. **package.json 改动必须 bump**：扩展版本 `0.0.1 → 0.2.0`；CLI 从 `0.1.0` 起步；项目整体 release tag 用 `v1.1.0`
9. **Windows-only**：v1.1.0 不支持 macOS/Linux（Trae CN 当前仅 Windows 实机验证过）
10. **信箱目录独立**：项目层信箱统一放 `<workspace>/.parallel-agent/`，不污染 `docs/` 或其他用户常用目录；插件启动时自动创建并写 `.gitignore` 排除 `信号/`

## 验证方式

- **插件单测**：`precheck.pingCdp` / `argvJson.ensureRemoteDebuggingPort` 纯函数可测
- **插件集成**：开发机跑一次 `restartWithDebug`，确认 argv.json 被写、Trae 重启、CDP 通
- **CLI 干跑**：`parallelagent init --dry-run` 打印将执行的动作但不落地（开发期验证用）
- **CLI 实跑**：干净 Windows 沙箱/VM 跑一次完整 init，断言：
  - `~/.trae-cn/skills/parallelagent-*/SKILL.md` 存在
  - `~/.trae-cn/argv.json` 含 `"remote-debugging-port": "9317"`
  - `trae --list-extensions` 含 `yorickfin.parallelagent-orchestrator`
  - 重启 Trae 后 `curl http://127.0.0.1:9317/json/version` 返回 JSON
- **端到端**：init 后按 [方案定稿 §10.1](ParallelAgent方案定稿.md) 跑完整一期工作流
- **幂等**：连续跑两次 `init`，结果一致无报错
- **uninit**：跑完后 argv.json 干净、skills 目录清空、扩展仍在（由用户手动卸）

## 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| `npm view parallelagent` 已被占用 | CLI 无法发布 | fallback `@yorickfin/parallelagent`，文档同步改 |
| Trae CLI 命令名不是 `trae-cn` / `trae` | init 第 2 步失败 | doctor 打印实际探测到的命令名；init 允许 `--trae-cli <path>` 显式指定 |
| Open VSX 发布需注册 namespace `yorickfin` | CI 卡住 | 发布前手动到 open-vsx.org 注册 + 创建 token，写进 GitHub Secrets |
| argv.json 数值/字符串格式（`"9317"` vs `9317`） | CDP 不开 | 已实测字符串形式可用；CLI 统一写字符串；doctor 检测时两种都认 |
| Trae 国际版路径未实测 | 国际版用户失败 | v1.1.0 README 明确标注"仅 Trae CN 实测"；issue 收集国际版路径 |
| 用户已有 `remote-debugging-port` 指向其他端口 | 端口冲突 | init 检测到非 9317 时提示用户选择：覆盖 / 保留并同步改扩展配置 |
| 项目层旧 `docs/协调/` 残留 | 用户迁移后看到两个信箱目录 | 一期未正式发布无存量用户；v1.1.0 README 附手动清理说明 |

## 发布清单（Release Checklist）

- [ ] 扩展 `package.json` bump 到 `0.2.0`
- [ ] 插件 `CHANGELOG.md` 补 0.2.0 条目
- [ ] CLI `package.json` bump 到 `0.1.0`
- [ ] 根 `README.md` 安装章节改为 `npx parallelagent init`
- [ ] 所有 `docs/协调` 引用全局替换为 `.parallel-agent`（SKILL.md ×2 / 协议.md / 轨道启动手册模板.md / README.md）
- [ ] git tag `v1.1.0` 推送，观察 CI 四个 job 全绿
- [ ] 手动在干净 Windows 机器跑 `npx parallelagent@latest init` 做发布验证
- [ ] Open VSX 页面确认扩展可见
- [ ] npm 页面确认 CLI 可见
