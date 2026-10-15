# ParallelAgent 第一期实现规划

> 状态：**全部完成**（2026-10-15）——7 个步骤已实现并联调通过，提交 09b896b 已推送 GitHub。
> 实测修正记录：newTask 改走项目分组行新建按钮（一步建轨自动挂项目，弃用面板顶部按钮）；草稿会话时序为"点击→等聚焦→注入→发送→等 sid"（首条消息落库后 sid 才存在）；删除链必须全合成 click（taskMoreBtn 常态 display:none，坐标点击落空）；删除确认弹窗按"确认删除"标题文本检测，不依赖哈希类名。

## Context

ParallelAgent 是 Trae IDE 的并行多 Agent 开发工具。核心模式：仲裁者 Agent 拆分任务给多个轨道 Agent 并行执行，通过文件信箱传递工作内容，通过自动化编排层传递控制信号，消灭用户人肉转发消息。

一期范围（手动触发版）：2 个极薄 Skill + 1 个编排器插件 + 共享协议 reference。方案已冻结在 `adapters/trae/docs/ParallelAgent方案定稿.md`，所有设计决策（CDP 操作、DOM 锚点、HTTP API、文件信箱协议、Skill 内容）均已探针验证。本规划只做工程实现。

## 目标目录结构

```
adapters/trae/
  shared/
    references/
      协议.md                # 唯一源，两个 SKILL.md 引用
    templates/
      轨道启动手册模板.md      # 仲裁者开轨时基于此生成运行时手册
  skills/
    parallelagent-arbiter/
      SKILL.md               # 仲裁者 Skill（极薄）
    parallelagent-track/
      SKILL.md               # 轨道 Skill（极薄）
  plugin/
    parallelagent-orchestrator/
      package.json
      tsconfig.json
      esbuild.build.js
      src/
        extension.ts          # 激活入口
        errors.ts             # 统一错误类型
        cdp/
          cdpClient.ts        # 裸 WebSocket CDP 客户端
          cdpTarget.ts        # target 发现与过滤
          dom.ts              # Runtime.evaluate 封装
          anchors.ts          # DOM 锚点常量（§8.4）
          actions.ts          # 所有 CDP 动作（navigate/identity/input/send/newTask/deleteTask/status）
        http/
          server.ts          # HTTP 网关（127.0.0.1:9318）
          routes.ts          # 路由分发（dispatch/new/watch/ping/delete/health）
        mailbox/
          paths.ts           # 信箱路径解析
          watcher.ts         # 回执 watch（轮询 mtime + fs.watch 唤醒）
          signalIo.ts        # 信号文件读写
        state/
          orbitTable.ts      # 身份表（内存 Map + JSON 持久化）
          config.ts          # 配置读取
        logger.ts            # OutputChannel + 审计日志
```

## 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 语言 | TypeScript | VS Code 扩展标准 |
| CDP 客户端 | `ws` ^8.18.0 直接 WebSocket | 探针已验证；chrome-remote-interface 假设标准 Chrome 对 Electron 衍生可能不兼容 |
| HTTP 网关 | Node.js 内置 `http` | 零依赖，手写极薄 body 解析 |
| 文件 watch | 轮询 `fs.stat` 为主 + `fs.watch` 唤醒 | Windows fs.watch 不稳定；轮询天然拿 mtime 契合"出现+mtime=完成信号"设计 |
| 身份表持久化 | JSON 文件（globalStorageUri） | 可读可恢复，符合可溯源原则 |
| 构建 | esbuild 打包 + tsc --noEmit 类型检查 | 微软官方推荐 VS Code 扩展 esbuild setup |
| 运行时依赖 | 仅 `ws` 一个 | 极简 |

package.json 关键配置：
- `main: "./dist/extension.js"`
- `engines.vscode: "^1.80.0"`（保守，待实测 Trae 实际兼容版本）
- `activationEvents: ["onCommand:parallelagent.start"]`（手动激活）
- `contributes.commands`: start / stop / health / restartWithDebug
- `contributes.configuration`: cdpPort(9317) / httpPort(9318) / mailboxRoot("docs/协调") / pollIntervalMs(1000) / watchTimeoutS(1800)

## 实现步骤

### 步骤 1：脚手架 ✅
- 初始化 `plugin/parallelagent-orchestrator/`：package.json、tsconfig.json、esbuild.build.js
- `src/extension.ts` 骨架（activate 注册命令，暂空实现）
- `src/errors.ts`：AnchorNotFound / IdentityMismatch / CdpDisconnected / WatchTimeout / SignalInvalid
- 初始化 `shared/references/协议.md`（从定稿 §9 抽取）
- 初始化两个 Skill 骨架（SKILL.md frontmatter + 章节标题）
- 初始化 `shared/templates/轨道启动手册模板.md`

### 步骤 2：CDP 客户端层 ✅
- `cdp/cdpClient.ts`：WebSocket 连接 + 自增 id 计数器 + send(method,params)→Promise + 事件总线 + 断线重连
- `cdp/cdpTarget.ts`：`http://127.0.0.1:9317/json` 枚举 target，过滤 Work 页面（type=page 且 title 含"管理员"或 className 含 solo-lite）
- `cdp/dom.ts`：Runtime.evaluate 薄封装（expression, returnByValue, awaitPromise）
- `cdp/anchors.ts`：定稿 §8.4 全部 DOM 选择器常量
- `state/config.ts`、`logger.ts`
- 验证：VS Code 命令触发 eval，跑探针 JS 确认连接通

### 步骤 3：CDP 动作 ✅
- `cdp/actions.ts` 所有动作（合并为单文件，一期不需要过度拆分）：
  - `status()`：读发送按钮 data-testid（arrow-up=idle / stop=running）
  - `navigate(sid)`：合成 `.taskItem` click → 轮询 `.taskItemSelected` 切换 → 返回当前 sid
  - `assertIdentity(sid)`：读 `.taskItemSelected` 所在 wrapper 的 `data-session-id`，断言匹配
  - `focusInput()` / `clearInput()` / `insertText(text)` / `send()`
  - `newTask()`：记录当前 sid 集合 → 真实点击新建入口 → 轮询新 sid → 返回
  - `deleteTask(sid)`：菜单序列删除
  - `detectDialog()`：扫描非预期弹窗
- 验证：每个动作加 VS Code 命令，肉眼验证 DOM 变化

### 步骤 4：HTTP 网关 ✅
- `http/server.ts`：监听 9318 + body 解析（1MB 限制）+ 统一错误包装
- `state/orbitTable.ts`：内存 Map<sid, Record> + JSON 持久化 + 原子写
- `http/routes.ts`：六个路由
  - `GET /health`：cdp_alive + 轨表
  - `GET /ping?sid=`：切轨 → 读 status → 返回
  - `POST /dispatch`：查轨表 → 切轨 → 断言 → 清空 → 注入话术 → 发送 → 返回 {ok,sid,sent_at}
  - `POST /new`：newTask → 注入首条 → 发送 → 落身份表 → 返回 {ok,sid,named_at}
  - `POST /delete`：deleteTask → 出身份表 → 返回 {ok}
  - `POST /watch`：阻塞监听回执 + 超时 + alert.signal
- 话术模板表（定稿 §9.6 五种）内置在 routes.ts
- 验证：`Invoke-RestMethod` 调每个 endpoint

### 步骤 5：文件信箱 watch ✅
- `mailbox/paths.ts`：workspace 根 + docs/协调/ + 子目录
- `mailbox/watcher.ts`：setInterval 轮询 fs.stat 读 mtime + awaitWriteFinish（连续 2 次 mtime 相同）+ fs.watch 即时唤醒
- `mailbox/signalIo.ts`：dispatch.signal / dispatch.ack / watch.ack / alert.signal / ping.signal / ping.ack
- 验证：手动建回执文件，确认 /watch 返回完成；测超时路径

### 步骤 6：Skill 文件 ✅
- 写 `shared/references/协议.md` 完整内容（从定稿 §9 抽取）
- 写仲裁者 SKILL.md（§7.1 定义的全部章节，极薄——只给协议指针/模板/判据表）
- 写轨道 SKILL.md（§7.2 定义的全部章节）
- 写 `shared/templates/轨道启动手册模板.md`

### 步骤 7：端到端联调与清理 ✅
- 安装插件到 Trae（bump 版本 + 全量重启）
- 跑一期工作流（定稿 §10.1）
- 删除探针扩展（定稿 §14 标注"正式实现后删除"）

## 关键设计约束

1. **控制面绝不传任务内容**：/dispatch 入参只含轨号+轮次+话术模板标识+文件指针
2. **身份断言靠 sid 不靠任务名**：24 位 hex sid 是唯一身份，任务名只作软校验
3. **不硬编码坐标**：所有点击必须 `getBoundingClientRect()` 动态算
4. **fail-stop**：找不到锚点/身份断言失败 → 立即停机告警，不盲发
5. **方案 B 已证伪**：插件绝不直接发会话消息，只走 CDP
6. **Apache 2.0 版权头**：所有新增源文件需保留版权声明头
7. **package.json 改动必须 bump + 全量重启 Trae**

## 验证方式

- **CDP 连通性**：VS Code 命令触发 eval，跑探针 JS 确认返回任务列表
- **HTTP 接口**：`Invoke-RestMethod` 调每个 endpoint，断言返回结构
- **端到端**：按定稿 §10.1 跑完整流程：拆分建议 → 转达单 → dispatch → watch → 实检 → 快照 → 自检
- **异常路径**：身份断言失败 fail-stop + alert.signal 写出
- **Skill**：模拟用户说"拆开跑"，断言仲裁者输出决策建议格式

## 依赖安装

（已完成：pnpm 安装至项目层，运行时依赖仅 `ws` ^8.18.0；开发依赖 typescript ^5.4 / esbuild ^0.24 / @types/ws / @types/node ^18 / @types/vscode ^1.80。）
