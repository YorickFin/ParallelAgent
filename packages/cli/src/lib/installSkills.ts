// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

/** 铺 SKILL.md 与共享 reference 到用户级目录 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_NAMES = [
  'parallelagent-arbiter',
  'parallelagent-track',
  'parallelagent-solo',
] as const;

/**
 * 共享 reference。安装到 `<dataDir>/shared/references/`，
 * 与 Skill 内的 `../../shared/references/` 引用路径一致。
 */
export const REFERENCE_FILES = ['协议.md', '分流.md', '台账.md'] as const;

/** CLI 包内 assets/skills/ 绝对路径（dist/index.js → ../assets/skills） */
export function assetsSkillsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, '..', 'assets', 'skills');
}

/** CLI 包内 assets/shared/references/ 绝对路径 */
export function assetsReferencesDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, '..', 'assets', 'shared', 'references');
}

/**
 * 把 assets/skills/ 下三个 Skill 目录拷到 `<dataDir>/skills/`。
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

/**
 * 把 shared/references 下三个文件拷到 `<dataDir>/shared/references/`。
 * 已存在则覆盖。幂等。
 */
export function installReferences(dataDir: string): string[] {
  const srcRoot = assetsReferencesDir();
  const destRoot = path.join(dataDir, 'shared', 'references');
  fs.mkdirSync(destRoot, { recursive: true });

  const installed: string[] = [];
  for (const name of REFERENCE_FILES) {
    const src = path.join(srcRoot, name);
    if (!fs.existsSync(src)) {
      throw new Error(`CLI 包缺失 reference 资源: ${src}`);
    }
    const dest = path.join(destRoot, name);
    fs.cpSync(src, dest, { force: true });
    installed.push(dest);
  }
  return installed;
}

/** 移除三个 Skill 目录（uninit 用） */
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

/** 移除三个共享 reference 文件（uninit 用；不删用户的其他文件） */
export function removeReferences(dataDir: string): string[] {
  const destRoot = path.join(dataDir, 'shared', 'references');
  const removed: string[] = [];

  for (const name of REFERENCE_FILES) {
    const dest = path.join(destRoot, name);
    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { force: true });
      removed.push(dest);
    }
  }

  // 只清理空目录，避免误删用户其他内容
  try {
    if (fs.existsSync(destRoot) && fs.readdirSync(destRoot).length === 0) {
      fs.rmdirSync(destRoot);
    }
    const sharedRoot = path.join(dataDir, 'shared');
    if (fs.existsSync(sharedRoot) && fs.readdirSync(sharedRoot).length === 0) {
      fs.rmdirSync(sharedRoot);
    }
  } catch {
    // 目录被占用或非空：保留，不影响卸载结果
  }

  return removed;
}
