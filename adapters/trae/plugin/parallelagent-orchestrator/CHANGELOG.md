# Changelog

## 0.2.0（v1.1.0）

- `restartWithDebug` 改为「增量写 `argv.json` 调试端口 + 重启」：一次配置后任何入口启动 Trae 调试端口自动就绪
- 新增 activate 自检：CDP 不通时弹窗引导一键修复
- restart 脚本迁入扩展 `resources/scripts/`，Trae 路径改用 `process.execPath` 传入，移除全部硬编码绝对路径
- 项目层信箱根默认从 `docs/协调` 迁移到 `.parallel-agent/`，启动编排器时自动创建骨架目录并写入 `.gitignore`（排除 `信号/`）
- argv.json 读写支持 JSONC（保留用户注释与其他键）

## 0.0.1（一期）

- 一期（手动触发版）：CDP 执行器 + HTTP 网关 + 文件信箱 watch，覆盖 /health、/new、/ping、/dispatch、/watch、/delete 全流程
