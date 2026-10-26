// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

/** 安装结果验证：ping CDP / 检查 skills 就位 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { SKILL_NAMES, REFERENCE_FILES } from './installSkills.js';

/** ping CDP 端口（Trae 未运行时返回 false，调用方自行决定是否视为失败） */
export async function pingCdp(port: number, timeoutMs = 2000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: controller.signal,
    });
    if (!resp.ok) return false;
    const body = (await resp.json()) as { Browser?: string };
    return typeof body.Browser === 'string';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** 检查三个 SKILL.md 是否在位，返回缺失项（空数组 = 全在位） */
export function missingSkills(dataDir: string): string[] {
  const missing: string[] = [];
  for (const name of SKILL_NAMES) {
    const p = path.join(dataDir, 'skills', name, 'SKILL.md');
    if (!fs.existsSync(p)) missing.push(p);
  }
  return missing;
}

/** 检查三个共享 reference 是否在位，返回缺失项（空数组 = 全在位） */
export function missingReferences(dataDir: string): string[] {
  const missing: string[] = [];
  for (const name of REFERENCE_FILES) {
    const p = path.join(dataDir, 'shared', 'references', name);
    if (!fs.existsSync(p)) missing.push(p);
  }
  return missing;
}
