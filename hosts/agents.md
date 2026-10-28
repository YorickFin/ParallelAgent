---
host: <宿主名>
host_version: <版本>
probed_at: <ISO 时间>
probe_cost: <spawn 次数>
schema_version: 1
confidence: 未验证
stale_after_version_change: true

subagent:
  tool: <工具名与参数形态>
  nested: unknown
  resume: unknown
  background: unknown
  max_concurrency: 1
  result_granularity: unknown
  max_total_per_session: unknown

sandbox:
  shell: unknown
  fs_write: unknown

fs:
  guard: unknown

isolation:
  process: unknown

vcs:
  git: unknown

skills:
  install_path: ~/.agents/skills
  trigger: 描述自动激活

max_mode: L0-L3
notes: 通用 Agent Skills 宿主预置，未验证；请按 P1-P6 探测后覆盖。若宿主是 Trae CN，可直接参考 hosts/trae-cn.md 的实测值。
---

# 能力档案：<宿主名>（通用占位）

这是安装到 `~/.agents/skills` 的通用宿主占位档案。`confidence: 未验证` 时：

- `max_mode: L0-L3`，L4 需先探测；
- `max_concurrency: 1`，按串行执行；
- 完成 P1-P6 后覆盖本文件，并把 `confidence` 改为 `实测`。

如果宿主是 Trae CN，可直接参考 `hosts/trae-cn.md` 的实测值。
