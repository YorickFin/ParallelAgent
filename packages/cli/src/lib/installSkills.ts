// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

/** 铺 SKILL.md 到用户级全局 skills 目录 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_NAMES = [
  'parallelagent-arbiter',
  'parallelagent-track',
] as const;

/** CLI 包内 assets/skills/ 绝对路径（dist/index.js → ../assets/skills） */
export function assetsSkillsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, '..', 'assets', 'skills');
}

/**
 * 把 assets/skills/ 下两个 Skill 目录拷到 `<dataDir>/skills/`。
 * 已存在则覆盖（版本化由 CLI 版本号承担）。幂等。
 */
export function installSkills(dataDir: string): string[] {
  const srcRoot = assetsSkillsDir();
  const destRoot = path.join(dataDir, 'skills');
  const installed: string[] = [];

  for (const name of SKILL_NAMES) {
    const src = path.join(srcRoot, name);
    const dest = path.join(destRoot, name);
    if (!fs.existsSync(src)) {
      throw new Error(`CLI 包缺失 Skill 资源: ${src}`);
    }
    fs.cpSync(src, dest, { recursive: true, force: true });
    installed.push(dest);
  }
  return installed;
}

/** 移除两个 Skill 目录（uninit 用） */
export function removeSkills(dataDir: string): string[] {
  const removed: string[] = [];
  for (const name of SKILL_NAMES) {
    const dest = path.join(dataDir, 'skills', name);
    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
      removed.push(dest);
    }
  }
  return removed;
}
