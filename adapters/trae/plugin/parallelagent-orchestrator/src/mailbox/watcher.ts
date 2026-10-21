// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

import * as fs from 'fs';
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

interface WaiterHandle {
  cleanup(): void;
}

/**
 * 回执 / 就绪 watcher —— 定稿 §9.3：文件出现 + mtime 即信号
 *
 * 策略：轮询 fs.stat 为主 + fs.watch 即时唤醒
 * awaitWriteFinish：连续 2 次 mtime 相同才算写完
 * 每个等待使用独立句柄，互不干扰（dispose 时统一清理）
 */
export class ReceiptWatcher implements MailboxWatcher {
  private readonly waiters = new Set<WaiterHandle>();

  constructor(
    private readonly paths: MailboxPaths,
    private readonly pollIntervalMs: number,
  ) {}

  async watchReceipts(
    round: number,
    orbits: string[],
    timeoutS: number,
    version = 1,
  ): Promise<{ completed: string[]; incomplete: string[] }> {
    // 构建期望的回执文件列表：回执/第N轮/T-X-v{M}.md
    const pending: PendingFile[] = orbits.map((orbit) => ({
      orbit,
      filePath: this.paths.receiptFile(round, orbit, version),
      lastMtime: null,
      stableCount: 0,
    }));

    logger.info(
      `watchReceipts: round=${round} version=v${version} orbits=${orbits.join(',')} timeout=${timeoutS}s`,
    );

    const result = await this.awaitStableFiles(
      pending,
      this.paths.receiptRoundDir(round),
      timeoutS,
    );

    if (result.incomplete.length === 0) {
      writeSignal(this.paths.watchAck, {
        round,
        version,
        orbits: result.completed,
        ts: new Date().toISOString(),
      });
    } else {
      writeSignal(this.paths.alertSignal, {
        round,
        version,
        incomplete: result.incomplete,
        ts: new Date().toISOString(),
        reason: 'watch_timeout',
      });
      logger.warn(`watch 超时: incomplete=${result.incomplete.join(',')}`);
    }

    return result;
  }

  /**
   * 等待轨道写出「就绪回执」。
   * sinceMs：只认 mtime >= sinceMs 的文件，避免上一会话/上一轮遗留的就绪文件被误判。
   */
  async watchReady(
    orbits: string[],
    sinceMs: number,
    timeoutS: number,
  ): Promise<{ ready: string[]; notReady: string[] }> {
    const pending: PendingFile[] = orbits.map((orbit) => ({
      orbit,
      filePath: this.paths.readyFile(orbit),
      lastMtime: null,
      stableCount: 0,
    }));

    logger.info(
      `watchReady: orbits=${orbits.join(',')} since=${new Date(sinceMs).toISOString()} timeout=${timeoutS}s`,
    );

    const result = await this.awaitStableFiles(
      pending,
      this.paths.readyDir,
      timeoutS,
      sinceMs,
    );

    return { ready: result.completed, notReady: result.incomplete };
  }

  dispose(): void {
    for (const waiter of [...this.waiters]) {
      waiter.cleanup();
    }
    logger.debug('ReceiptWatcher disposed');
  }

  /** 等待一组文件稳定出现；sinceMs > 0 时忽略更早的旧文件 */
  private awaitStableFiles(
    files: PendingFile[],
    watchDir: string,
    timeoutS: number,
    sinceMs = 0,
  ): Promise<{ completed: string[]; incomplete: string[] }> {
    const deadline = Date.now() + timeoutS * 1000;

    return new Promise((resolve) => {
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let fsWatcher: fs.FSWatcher | null = null;
      let settled = false;

      const handle: WaiterHandle = { cleanup: () => finish() };
      const finish = () => {
        if (settled) return;
        settled = true;
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        if (fsWatcher) {
          try {
            fsWatcher.close();
          } catch {
            // 已关闭，忽略
          }
          fsWatcher = null;
        }
        this.waiters.delete(handle);
      };
      this.waiters.add(handle);

      const check = () => {
        if (settled) return;

        for (const f of files) {
          if (f.stableCount >= 2) continue;
          try {
            const stat = fs.statSync(f.filePath);
            // 旧文件不算数
            if (stat.mtimeMs < sinceMs) {
              f.lastMtime = null;
              f.stableCount = 0;
              continue;
            }
            if (stat.mtimeMs === f.lastMtime) {
              f.stableCount++;
            } else {
              f.lastMtime = stat.mtimeMs;
              f.stableCount = 1;
            }
          } catch {
            // 文件尚不存在
            f.lastMtime = null;
            f.stableCount = 0;
          }
        }

        if (files.every((f) => f.stableCount >= 2)) {
          const completed = files.map((f) => f.orbit);
          finish();
          resolve({ completed, incomplete: [] });
          return;
        }

        if (Date.now() >= deadline) {
          const completed = files
            .filter((f) => f.stableCount >= 2)
            .map((f) => f.orbit);
          const incomplete = files
            .filter((f) => f.stableCount < 2)
            .map((f) => f.orbit);
          finish();
          resolve({ completed, incomplete });
        }
      };

      // 轮询为主
      pollTimer = setInterval(check, this.pollIntervalMs);

      // fs.watch 即时唤醒（Windows 不稳定，失败则依赖轮询）
      try {
        if (!fs.existsSync(watchDir)) {
          fs.mkdirSync(watchDir, { recursive: true });
        }
        fsWatcher = fs.watch(watchDir, { recursive: false }, () => check());
      } catch (e) {
        logger.warn(
          `fs.watch 不可用 (${watchDir})，依赖轮询: ${(e as Error).message}`,
        );
      }

      // 首次检查
      check();
    });
  }
}
