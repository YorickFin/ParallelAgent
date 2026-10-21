// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

/** `parallelagent doctor`：环境自检报告 */

import { detectTrae } from '../lib/detectTrae.js';
import { readArgvJson } from '../lib/argvJson.js';
import { isExtensionInstalled } from '../lib/installExtension.js';
import { missingSkills, pingCdp } from '../lib/verify.js';
import * as path from 'node:path';

const CDP_PORT = 9317;

interface CheckResult {
  label: string;
  status: 'OK' | 'WARN' | 'FAIL';
  detail: string;
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

  // 5. 扩展
  if (trae.cliCommand) {
    const installed = isExtensionInstalled(trae.cliCommand);
    results.push({
      label: '扩展安装',
      status: installed ? 'OK' : 'FAIL',
      detail: installed
        ? 'yorickfin.parallelagent-orchestrator'
        : '未找到扩展，运行 parallelagent init 安装',
    });
  } else {
    results.push({
      label: '扩展安装',
      status: 'FAIL',
      detail: '无法检测（CLI 命令未知）',
    });
  }

  // 6. Skills
  if (trae.dataDir) {
    const missing = missingSkills(trae.dataDir);
    if (missing.length === 0) {
      results.push({ label: 'Skills', status: 'OK', detail: '两个 SKILL.md 就位' });
    } else {
      results.push({
        label: 'Skills',
        status: 'FAIL',
        detail: `缺失: ${missing.map((p) => path.basename(path.dirname(p))).join(', ')}`,
      });
    }
  } else {
    results.push({ label: 'Skills', status: 'FAIL', detail: '无法检测（数据目录未知）' });
  }

  // ── 输出 ──
  console.log('');
  console.log('ParallelAgent 环境诊断');
  console.log('='.repeat(60));
  for (const r of results) {
    const icon = r.status === 'OK' ? '✓' : r.status === 'WARN' ? '⚠' : '✗';
    console.log(`${icon} ${r.label.padEnd(14)} ${r.status.padEnd(5)} ${r.detail}`);
  }
  console.log('='.repeat(60));

  const allOk = results.every((r) => r.status === 'OK');
  console.log(allOk ? '\n结论：全部正常' : '\n结论：存在异常，请运行 parallelagent init 修复');
  process.exit(allOk ? 0 : 1);
}
