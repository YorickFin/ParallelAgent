// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * 项目级单实例锁。
 *
 * 同一项目可能在多个 Trae 窗口中打开，而扩展宿主按窗口独立、信箱目录共享。
 * 锁文件记录持锁扩展宿主的 PID，后来的窗口检测到存活 PID 后静默跳过启动，
 * 避免重复通知、重复 ack、身份表并发写。
 *
 * 文件位于 `信号/` 下，该目录已在 `.parallel-agent/.gitignore` 中排除。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as logger from '../logger';

export interface ProjectLockInfo {
  pid: number;
  port: number;
  workspace: string;
  startedAt: string;
  version: string;
}

/** 锁文件路径：<mailboxRoot>/信号/orchestrator.lock */
export function lockFilePath(mailboxRoot: string): string {
  return path.join(mailboxRoot, '信号', 'orchestrator.lock');
}

/** 读取锁；文件不存在或内容损坏时返回 null */
export function readLock(mailboxRoot: string): ProjectLockInfo | null {
  const p = lockFilePath(mailboxRoot);
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ProjectLockInfo>;
    if (
      typeof parsed.pid !== 'number' ||
      typeof parsed.port !== 'number' ||
      typeof parsed.workspace !== 'string'
    ) {
      return null;
    }
    return {
      pid: parsed.pid,
      port: parsed.port,
      workspace: parsed.workspace,
      startedAt: parsed.startedAt ?? '',
      version: parsed.version ?? '',
    };
  } catch {
    return null;
  }
}

/** 写入锁（自动创建 信号/ 目录） */
export function writeLock(mailboxRoot: string, info: ProjectLockInfo): void {
  const p = lockFilePath(mailboxRoot);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(info, null, 2), 'utf8');
    logger.audit('lock_write', { pid: info.pid, port: info.port });
  } catch (e) {
    logger.error(`写项目锁失败: ${(e as Error).message}`);
  }
}

/** 删除锁；失败只记日志 */
export function clearLock(mailboxRoot: string): void {
  const p = lockFilePath(mailboxRoot);
  try {
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      logger.audit('lock_clear', { path: p });
    }
  } catch (e) {
    logger.warn(`删除项目锁失败: ${(e as Error).message}`);
  }
}

/**
 * 判断 PID 是否存活。
 * ESRCH = 不存在；EPERM = 存在但无权限（视为存活）。
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** 工作区路径比较：Windows 大小写不敏感，忽略末尾分隔符 */
export function sameWorkspace(a: string, b: string): boolean {
  const norm = (p: string): string => {
    if (!p) return '';
    let s = path.resolve(p).replace(/[\\/]+$/, '');
    if (process.platform === 'win32') s = s.toLowerCase();
    return s;
  };
  const na = norm(a);
  const nb = norm(b);
  return na !== '' && na === nb;
}
