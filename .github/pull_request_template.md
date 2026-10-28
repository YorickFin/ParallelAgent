## 改了什么

<!-- 一句话说明这个 PR 的改动范围 -->

## 为什么

<!-- 解决的问题、动机或关联 issue -->

## 怎么验证

<!-- 本地命令、手工步骤、测试结果；协议类改动请说明实机验证方式 -->

## 文档同步

- [ ] 协议 / 字段 / 校验改动已同步 `references/协议.md`
- [ ] 分流 / 台账改动已同步 `references/分流.md`、`references/台账.md`
- [ ] 模板改动已同步 `templates/*.md`
- [ ] Skill 改动已同步 `skills/*/SKILL.md`
- [ ] 宿主能力改动已同步 `hosts/*.md`
- [ ] CLI 改动已同步 `packages/cli/` 与 `README.md`
- [ ] 不涉及文档（说明原因）

## 检查清单

- [ ] 分支基于最新 `main`
- [ ] `node --check packages/cli/index.js` 通过
- [ ] `node packages/cli/index.js init --dry-run --root <临时目录> --host trae-cn` 通过
- [ ] 没有提交 `packages/cli/assets/`、`*.tgz`、`.parallel-agent/`、日志等生成物
- [ ] 提交信息符合 Conventional Commits
