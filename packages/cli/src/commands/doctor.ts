// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

/** `parallelagent doctor`：环境自检报告 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { detectTrae } from '../lib/detectTrae.js';
import { readArgvJson } from '../lib/argvJson.js';
import { readInstalledFromDisk } from '../lib/installExtension.js';
import { missingReferences, missingSkills, pingCdp } from '../lib/verify.js';

const CDP_PORT = 9317;

interface CheckResult {
  label: string;
  status: 'OK' | 'WARN' | 'FAIL';
  detail: string;
  /** true = 只提示，不影响退出码（Q3=B） */
  advisory?: boolean;
}

/** 从当前目录向上查找项目信箱根 */
function findMailboxRoot(start: string): string | null {
  let dir = path.resolve(start);
  while (true) {
    const candidate = path.join(dir, '.parallel-agent');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** 单轨台账检查：只告警，不阻断 */
function checkLedger(): CheckResult {
  const mailboxRoot = findMailboxRoot(process.cwd());
  if (!mailboxRoot) {
    return {
      label: '单轨台账',
      status: 'WARN',
      advisory: true,
      detail: '未发现 .parallel-agent（尚未使用单轨/多轨）',
    };
  }

  const ledgerDir = path.join(mailboxRoot, '单轨', '台账');
  if (!fs.existsSync(ledgerDir)) {
    return {
      label: '单轨台账',
      status: 'WARN',
      advisory: true,
      detail: '未发现 .parallel-agent/单轨/台账（尚未使用单轨）',
    };
  }

  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const file = path.join(ledgerDir, `${month}.md`);
  if (!fs.existsSync(file)) {
    return {
      label: '单轨台账',
      status: 'WARN',
      advisory: true,
      detail: `当月台账 ${month}.md 未创建`,
    };
  }

  const content = fs.readFileSync(file, 'utf8');
  const entries = content.split(/^## /m).slice(1);
  const recent = entries.slice(-5);
  if (recent.length === 0) {
    return {
      label: '单轨台账',
      status: 'WARN',
      advisory: true,
      detail: `${month}.md 尚无条目`,
    };
  }

  const required = ['需求', '改动', '证据', '结论'];
  const incomplete = recent.filter((entry) => !required.every((field) => entry.includes(field)));
  if (incomplete.length > 0) {
    return {
      label: '单轨台账',
      status: 'WARN',
      advisory: true,
      detail: `最近 ${recent.length} 条中有 ${incomplete.length} 条字段不全`,
    };
  }

  if (content.includes('未提交')) {
    return {
      label: '单轨台账',
      status: 'WARN',
      advisory: true,
      detail: '存在未提交条目，请回填 commit hash',
    };
  }

  return {
    label: '单轨台账',
    status: 'OK',
    detail: `${month}.md 正常（${recent.length} 条）`,
  };
}

export async function runDoctor(): Promise<void> {
  const results: CheckResult[] = [];

  const trae = detectTrae();

  // 1. Trae 安装路径
  if (trae.exePath) {
    results.push({ label: 'Trae 安装', status: 'OK', detail: trae.exePath });
  } else {
    results.push({
      label: 'Trae 安装',
      status: 'FAIL',
      detail: '未探测到 Trae 安装路径',
    });
  }

  // 2. 数据目录位置
  if (trae.dataDir) {
    results.push({ label: '数据目录', status: 'OK', detail: trae.dataDir });
  } else {
    results.push({
      label: '数据目录',
      status: 'FAIL',
      detail: '未探测到 ~/.trae-cn 或 ~/.trae',
    });
  }

  // 3. argv.json 端口
  if (trae.dataDir) {
    const argv = readArgvJson(`${trae.dataDir}/argv.json`);
    const port = argv['remote-debugging-port'];
    if (port === CDP_PORT || port === String(CDP_PORT)) {
      results.push({
        label: 'argv.json 端口',
        status: 'OK',
        detail: `remote-debugging-port = ${port}`,
      });
    } else if (port !== undefined) {
      results.push({
        label: 'argv.json 端口',
        status: 'WARN',
        detail: `remote-debugging-port = ${port}（期望 ${CDP_PORT}）`,
      });
    } else {
      results.push({
        label: 'argv.json 端口',
        status: 'FAIL',
        detail: `未设置 remote-debugging-port`,
      });
    }
  } else {
    results.push({
      label: 'argv.json 端口',
      status: 'FAIL',
      detail: '无法读取（数据目录未知）',
    });
  }

  // 4. CDP 端口实测
  const cdpOk = await pingCdp(CDP_PORT);
  results.push({
    label: 'CDP 连通',
    status: cdpOk ? 'OK' : 'WARN',
    detail: cdpOk ? `端口 ${CDP_PORT} 可达` : `端口 ${CDP_PORT} 暂不通（重启 Trae 后生效）`,
  });

  // 5. 扩展（读 extensions.json，不需要拉起 Trae 进程）
  const extVersion = readInstalledFromDisk(trae.dataDir);
  if (extVersion) {
    results.push({
      label: '扩展安装',
      status: 'OK',
      detail: `yorickfin.parallelagent-orchestrator@${extVersion}`,
    });
  } else if (!trae.dataDir) {
    results.push({
      label: '扩展安装',
      status: 'FAIL',
      detail: '无法检测（数据目录未知）',
    });
  } else {
    results.push({
      label: '扩展安装',
      status: 'FAIL',
      detail: '未找到扩展，运行 parallelagent init 安装',
    });
  }

  // 6. Skills + 共享 reference
  const dataDir = trae.dataDir;
  if (dataDir) {
    const missing = [...missingSkills(dataDir), ...missingReferences(dataDir)];
    if (missing.length === 0) {
      results.push({
        label: 'Skills/Reference',
        status: 'OK',
        detail: '3 个 SKILL.md + 3 个 reference 就位',
      });
    } else {
      results.push({
        label: 'Skills/Reference',
        status: 'FAIL',
        detail: `缺失: ${missing.map((p) => path.relative(dataDir, p)).join(', ')}`,
      });
    }
  } else {
    results.push({
      label: 'Skills/Reference',
      status: 'FAIL',
      detail: '无法检测（数据目录未知）',
    });
  }

  // 7. 单轨台账（只告警，不阻断）
  results.push(checkLedger());

  // ── 输出 ──
  console.log('');
  console.log('ParallelAgent 环境诊断');
  console.log('='.repeat(60));
  for (const r of results) {
    const icon = r.status === 'OK' ? '✓' : r.status === 'WARN' ? '⚠' : '✗';
    console.log(`${icon} ${r.label.padEnd(16)} ${r.status.padEnd(5)} ${r.detail}`);
  }
  console.log('='.repeat(60));

  const failed = results.some((r) => r.status === 'FAIL');
  const blockingWarn = results.some((r) => r.status === 'WARN' && !r.advisory);
  const hasAdvisoryWarn = results.some((r) => r.status === 'WARN' && r.advisory);
  const ok = !failed && !blockingWarn;

  if (!ok) {
    console.log('\n结论：存在异常，请运行 parallelagent init 修复');
  } else if (hasAdvisoryWarn) {
    console.log('\n结论：安装正常（存在台账提示，不影响退出码）');
  } else {
    console.log('\n结论：全部正常');
  }
  process.exit(ok ? 0 : 1);
}
