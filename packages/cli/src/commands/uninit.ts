// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

/** `parallelagent uninit`：逆向清理（保留项目层 .parallel-agent/） */

import * as path from 'node:path';
import { detectTrae, detectDataDir } from '../lib/detectTrae.js';
import { removeRemoteDebuggingPort } from '../lib/argvJson.js';
import { removeSkills } from '../lib/installSkills.js';

export function runUninit(): void {
  const trae = detectTrae();
  const dataDir = trae.dataDir ?? detectDataDir();
  if (!dataDir) {
    console.error('未探测到 Trae 用户数据目录，无内容可清理。');
    process.exit(1);
  }

  console.log('');
  console.log('ParallelAgent 清理');
  console.log('');

  // 1. 移除 skills
  const removed = removeSkills(dataDir);
  if (removed.length) {
    for (const p of removed) console.log(`  ✓ 已删除 ${p}`);
  } else {
    console.log('  （Skills 目录不存在，跳过）');
  }

  // 2. argv.json 移除 remote-debugging-port
  const argvPath = path.join(dataDir, 'argv.json');
  const changed = removeRemoteDebuggingPort(argvPath);
  console.log(
    changed
      ? `  ✓ 已清理 argv.json（remote-debugging-port 已移除）`
      : `  （argv.json 不含 remote-debugging-port，跳过）`,
  );

  console.log('');
  console.log('⚠ 扩展请手动卸载：');
  console.log(`   trae --uninstall-extension yorickfin.parallelagent-orchestrator`);
  console.log('');
  console.log('项目层信箱目录 .parallel-agent/ 已保留，如需删除请手动处理。');
  console.log('');
}
