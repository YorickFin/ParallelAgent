// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Trae 用户数据目录探测（Windows-only，v1.1.0）
 *
 * 探测顺序：`~/.trae-cn/` → `~/.trae/` → null
 * argv.json 位于该目录下。
 */
export function detectTraeDataDir(): string | null {
  const candidates = [
    path.join(os.homedir(), '.trae-cn'),
    path.join(os.homedir(), '.trae'),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
    } catch {
      // continue
    }
  }
  return null;
}

/** argv.json 绝对路径；数据目录不存在时返回 null */
export function detectArgvJsonPath(): string | null {
  const dir = detectTraeDataDir();
  return dir ? path.join(dir, 'argv.json') : null;
}
