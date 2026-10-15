// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

import * as fs from 'fs';
import * as path from 'path';
import * as logger from '../logger';

/**
 * 信号文件读写 —— 定稿 §9.5 控制信号格式
 * 信号体只含轨号 + 轮次 + 文件指针 + 固定话术，绝不含任务内容
 */

/** 读信号文件（JSON） */
export function readSignal<T = unknown>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (e) {
    logger.warn(`读取信号失败 ${filePath}: ${(e as Error).message}`);
    return null;
  }
}

/** 写信号文件（原子写：临时文件 + rename） */
export function writeSignal(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
  logger.audit('signal_write', { file: path.basename(filePath) });
}

/** 删除信号文件 */
export function deleteSignal(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    logger.warn(`删除信号失败 ${filePath}: ${(e as Error).message}`);
  }
}
