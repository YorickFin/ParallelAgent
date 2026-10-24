## 改了什么

<!-- 一句话说明这个 PR 的改动范围 -->

## 为什么

<!-- 解决的问题、动机或关联 issue -->

## 怎么验证

<!-- 本地命令、手工步骤、测试结果；协议类改动请说明实机验证方式 -->

## 文档同步

- [ ] 控制信号 / HTTP 端点改动已同步 `adapters/trae/shared/references/协议.md`
- [ ] 仲裁者 / 轨道 Skill 改动已同步 `adapters/trae/skills/*/SKILL.md`
- [ ] 插件行为改动已同步插件 `README.md` 与 `CHANGELOG.md`
- [ ] 不涉及文档（说明原因）

## 检查清单

- [ ] 分支基于最新 `main`
- [ ] `pnpm typecheck` 与 `pnpm build` 本地通过（插件与 CLI）
- [ ] 没有提交 `信号/`、本地日志、`.vsix` 等生成物
- [ ] 提交信息符合 Conventional Commits
