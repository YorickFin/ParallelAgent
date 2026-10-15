// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

import * as fs from 'fs';
import * as path from 'path';
import type { MailboxWatcher } from '../http/routes';
import { MailboxPaths } from './paths';
import { writeSignal } from './signalIo';
import * as logger from '../logger';

interface PendingFile {
  orbit: string;
  filePath: string;
  lastMtime: number | null;
  stableCount: number;
}

/**
 * 回执 watcher —— 定稿 §9.3：回执文件的出现与 mtime 即完成信号
 *
 * 策略：轮询 fs.stat 为主 + fs.watch 即时唤醒
 * awaitWriteFinish：连续 2 次 mtime 相同才算写完
 */
export class ReceiptWatcher implements MailboxWatcher {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private fsWatcher: fs.FSWatcher | null = null;

  constructor(
    private readonly paths: MailboxPaths,
    private readonly pollIntervalMs: number,
  ) {}

  async watchReceipts(
    round: number,
    orbits: string[],
    timeoutS: number,
  ): Promise<{ completed: string[]; incomplete: string[] }> {
    // 构建期望的回执文件列表
    const pending: PendingFile[] = orbits.map((orbit) => ({
      orbit,
      filePath: this.paths.receiptFile(orbit, round),
      lastMtime: null,
      stableCount: 0,
    }));

    const completed: string[] = [];
    const deadline = Date.now() + timeoutS * 1000;

    logger.info(
      `watchReceipts: round=${round} orbits=${orbits.join(',')} timeout=${timeoutS}s`,
    );

    return new Promise((resolve) => {
      const check = () => {
        for (const f of pending) {
          if (f.stableCount >= 2) continue; // 已完成
          try {
            const stat = fs.statSync(f.filePath);
            const mtime = stat.mtimeMs;
            if (mtime === f.lastMtime) {
              f.stableCount++;
              if (f.stableCount >= 2) {
                completed.push(f.orbit);
                logger.info(`回执完成: ${f.orbit} (round=${round})`);
              }
            } else {
              f.lastMtime = mtime;
              f.stableCount = 1;
            }
          } catch {
            // 文件尚不存在
            f.lastMtime = null;
            f.stableCount = 0;
          }
        }

        // 全部完成
        if (pending.every((f) => f.stableCount >= 2)) {
          cleanup();
          writeSignal(this.paths.watchAck, {
            round,
            orbits: completed,
            ts: new Date().toISOString(),
          });
          resolve({ completed, incomplete: [] });
          return;
        }

        // 超时
        if (Date.now() >= deadline) {
          cleanup();
          const incomplete = pending
            .filter((f) => f.stableCount < 2)
            .map((f) => f.orbit);
          writeSignal(this.paths.alertSignal, {
            round,
            incomplete,
            ts: new Date().toISOString(),
            reason: 'watch_timeout',
          });
          logger.warn(
            `watch 超时: incomplete=${incomplete.join(',')}`,
          );
          resolve({ completed, incomplete });
          return;
        }
      };

      const cleanup = () => {
        if (this.pollTimer) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
        }
        if (this.fsWatcher) {
          this.fsWatcher.close();
          this.fsWatcher = null;
        }
      };

      // 轮询为主
      this.pollTimer = setInterval(check, this.pollIntervalMs);

      // fs.watch 即时唤醒（Windows 不稳定，失败则依赖轮询）
      const dir = this.paths.receiptDir;
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        this.fsWatcher = fs.watch(
          dir,
          { recursive: false },
          () => check(),
        );
      } catch (e) {
        logger.warn(
          `fs.watch 不可用 (${dir})，依赖轮询: ${(e as Error).message}`,
        );
      }

      // 首次检查
      check();
    });
  }

  dispose(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.fsWatcher) {
      this.fsWatcher.close();
      this.fsWatcher = null;
    }
    logger.debug('ReceiptWatcher disposed');
  }
}
