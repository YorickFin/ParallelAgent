---
host: Trae CN
host_version: 3.4.9
probed_at: 2026-10-27T20:40:00+08:00
probe_cost: 8
schema_version: 1
confidence: 实测
stale_after_version_change: true

subagent:
  tool: Agent(subagent_type, prompt)
  nested: no
  resume: yes
  background: yes
  max_concurrency: 5
  result_granularity: 完整
  max_total_per_session: unknown

sandbox:
  shell: yes
  fs_write: yes

fs:
  guard: no

isolation:
  process: in-process

vcs:
  git: yes

skills:
  install_path: ~/.trae-cn/skills
  trigger: 描述自动激活

max_mode: L0-L4
notes: 并发第 6 个硬失败：Subagent start failed: concurrent subagent limit reached (limit: 5)。
---

# 能力档案：Trae CN 3.4.9

来源：2026-10-27 对照实验实测（`test-docs/评估/Trae侧轨道执行单元对照评估.md`）。

关键结论：

- 单批最多 **5** 个子代理，超限**硬失败不排队** → 分批必须由编排层负责
- 子代理**不能再派子代理**（仅一级）
- `resume` 可用，但会保留已作废契约的记忆 → 默认不 resume
- 越界**无事前拦截**（`fs.guard: no`）→ 必须事后扫描
- 与宿主同进程（`in-process`）→ 宿主崩溃则全部轨道同死

升级 Trae 后：比对 `host_version`，不一致则提示用户重测（三选一）。
