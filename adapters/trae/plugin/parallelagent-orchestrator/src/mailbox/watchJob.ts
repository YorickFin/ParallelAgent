// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

import * as fs from 'fs';
import * as path from 'path';
import type { MailboxPaths } from './paths';
import { readSignal, writeSignal } from './signalIo';
import * as logger from '../logger';

/**
 * 回执等待 job 管理器 —— v1.2.0 设计 §5/§6
 *
 * 等待状态从 AI 调用栈搬到插件进程：
 * - `/watch` 提交 job 后立即返回，本管理器持续轮询回执 mtime
 * - 每轨两个维度：`状态`（干完没）与 `处理`（仲裁者消费没）
 * - 状态文件 `信号/轮次状态/第N轮-v{M}.json` 是唯一真相源
 */

export type OrbitStatus = 'pending' | 'done' | 'timeout' | 'failed';
export type HandlingState = null | 'pending' | 'notified' | 'done';
export type NotifyMode = 'each' | 'all';
export type JobState = 'running' | 'done' | 'cancelled';

export interface OrbitEntry {
  状态: OrbitStatus;
  回执: string | null;
  mtime: string | null;
  处理: HandlingState;
  通知于: string | null;
  重发次数: number;
  处理于: string | null;
}

export interface RoundState {
  job: string;
  轮次: number;
  版本: number;
  job状态: JobState;
  仲裁者: string | null;
  notify: NotifyMode;
  创建于: string;
  更新于: string;
  轨道: Record<string, OrbitEntry>;
}

/** 通知请求：只含信号，不含任务内容 */
export interface NotifyRequest {
  jobId: string;
  轮次: number;
  版本: number;
  轨: string[];
  类型: 'notify' | 'alert';
  /** true = 已降级，只弹本地气泡，不再注入会话 */
  降级: boolean;
}

/** sent：已注入/已降级；skipped：条件不满足，下轮再试；failed：注入失败 */
export type NotifyOutcome = 'sent' | 'skipped' | 'failed';

export interface WatchJobDeps {
  paths: MailboxPaths;
  pollIntervalMs: number;
  defaultTimeoutS: number;
  notify: (req: NotifyRequest) => Promise<NotifyOutcome>;
  /** 降级通知（VS Code 气泡），由宿主注入 */
  degrade: (req: NotifyRequest) => void;
}

interface JobRuntime {
  state: RoundState;
  orbits: string[];
  deadline: number;
  /** 每轨 mtime 稳定检测：连续 2 次相同才算写完 */
  stable: Map<string, { lastMtime: number | null; count: number }>;
  /** 下一次允许尝试通知的时点（毫秒），用于节流与退避 */
  nextNotifyAt: number;
  ticking: boolean;
}

/** 重发上限：2 次后再失败即降级 */
const MAX_RETRY = 2;
/** notified 超过该秒数仍无 ack → 重发 */
const RETRY_AFTER_S = 120;

/** 稳定的回执判定次数（对应 watcher 的 awaitWriteFinish） */
const STABLE_COUNT = 2;

export interface SubmitResult {
  state: RoundState;
  /** true = 同 (轮次, 版本) 已有 running job，本次直接复用 */
  复用: boolean;
  /** 信号级警告：缺轨、同轨跨 job 未清账等 */
  警告: string[];
}

export class WatchJobManager {
  private readonly jobs = new Map<string, JobRuntime>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(private readonly deps: WatchJobDeps) {}

  /** 启动轮询；同时恢复历史 running job */
  start(): void {
    this.restore();
    if (this.timer) return;
    this.timer = setInterval(() => void this.tickAll(), this.deps.pollIntervalMs);
    logger.info(
      `WatchJobManager 已启动：poll=${this.deps.pollIntervalMs}ms jobs=${this.jobs.size}`,
    );
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.jobs.clear();
    logger.info('WatchJobManager 已停止');
  }

  // ── 提交 / 查询 / 消费 ──────────────────────────────

  submit(input: {
    轮次: number;
    版本: number;
    轨: string[];
    timeout_s?: number;
    notify?: NotifyMode;
    仲裁者?: string | null;
  }): SubmitResult {
    // 1. 同 (轮次, 版本) 已有 running job → 复用，避免覆盖同一个状态文件
    const existing = this.findRunning(input.轮次, input.版本);
    if (existing) {
      const missing = input.轨.filter((o) => !existing.state.轨道[o]);
      const warnings: string[] = [];
      if (missing.length > 0) {
        warnings.push(
          `job ${existing.state.job} 已覆盖第${input.轮次}轮 v${input.版本}，但缺少轨 ${missing.join('/')}；请用新的版本号重新提交`,
        );
      }
      logger.info(
        `复用已有 job ${existing.state.job}（第${input.轮次}轮 v${input.版本}）`,
      );
      return { state: existing.state, 复用: true, 警告: warnings };
    }

    // 2. 单轨单在途的延伸：同一轨不应同时挂在两个未清账的 job 上（只警告，不阻塞）
    const warnings: string[] = [];
    for (const job of this.jobs.values()) {
      if (job.state.job状态 !== 'running') continue;
      for (const orbit of input.轨) {
        const entry = job.state.轨道[orbit];
        if (entry && entry.处理 !== 'done') {
          warnings.push(
            `${orbit} 仍在 job ${job.state.job}（第${job.state.轮次}轮 v${job.state.版本}）未清账`,
          );
        }
      }
    }

    const now = new Date();
    const state: RoundState = {
      job: newJobId(),
      轮次: input.轮次,
      版本: input.版本,
      job状态: 'running',
      仲裁者: input.仲裁者 ?? null,
      notify: input.notify ?? 'each',
      创建于: now.toISOString(),
      更新于: now.toISOString(),
      轨道: {},
    };

    for (const orbit of input.轨) {
      state.轨道[orbit] = {
        状态: 'pending',
        回执: null,
        mtime: null,
        处理: null,
        通知于: null,
        重发次数: 0,
        处理于: null,
      };
    }

    const runtime: JobRuntime = {
      state,
      orbits: [...input.轨],
      deadline:
        now.getTime() + (input.timeout_s ?? this.deps.defaultTimeoutS) * 1000,
      stable: new Map(),
      nextNotifyAt: 0,
      ticking: false,
    };
    for (const orbit of input.轨) {
      runtime.stable.set(orbit, { lastMtime: null, count: 0 });
    }

    this.jobs.set(state.job, runtime);
    this.persist(runtime);
    logger.audit('watch_submit', {
      job: state.job,
      轮次: state.轮次,
      版本: state.版本,
      轨: input.轨,
      notify: state.notify,
      警告: warnings,
    });
    return { state, 复用: false, 警告: warnings };
  }

  /** 查找同 (轮次, 版本) 仍在运行的 job */
  private findRunning(轮次: number, 版本: number): JobRuntime | undefined {
    for (const job of this.jobs.values()) {
      if (
        job.state.job状态 === 'running' &&
        job.state.轮次 === 轮次 &&
        job.state.版本 === 版本
      ) {
        return job;
      }
    }
    return undefined;
  }

  get(jobId: string): RoundState | null {
    return this.jobs.get(jobId)?.state ?? null;
  }

  list(): RoundState[] {
    return Array.from(this.jobs.values()).map((j) => j.state);
  }

  /** 更新所有 running job 的仲裁者 sid（bind-arbiter 后回填） */
  setArbiter(sid: string): void {
    for (const job of this.jobs.values()) {
      if (job.state.job状态 !== 'running') continue;
      if (job.state.仲裁者 === sid) continue;
      job.state.仲裁者 = sid;
      job.state.更新于 = new Date().toISOString();
      this.persist(job);
    }
  }

  /**
   * 标记某轨已消费，并带回剩余队列。
   * 幂等：重复 ack 返回同样结果。
   */
  ack(
    jobId: string,
    轨: string,
  ):
    | { ok: true; 剩余待处理: string[]; 未完成: string[]; 全部已处理: boolean }
    | { ok: false; err: string; type: string } {
    const job = this.jobs.get(jobId);
    if (!job) {
      return { ok: false, err: `job 不存在: ${jobId}`, type: 'signal_invalid' };
    }
    const entry = job.state.轨道[轨];
    if (!entry) {
      return { ok: false, err: `该 job 无轨道 ${轨}`, type: 'signal_invalid' };
    }
    if (entry.状态 === 'pending') {
      return {
        ok: false,
        err: `轨道 ${轨} 回执尚未出现，禁止 ack`,
        type: 'signal_invalid',
      };
    }

    if (entry.处理 !== 'done') {
      entry.处理 = 'done';
      entry.处理于 = new Date().toISOString();
      job.state.更新于 = entry.处理于;
      logger.audit('watch_ack', { job: jobId, 轨 });
    }

    this.finishIfDrained(job);
    this.persist(job);
    return { ok: true, ...this.snapshot(job) };
  }

  cancel(jobId: string): { ok: boolean; err?: string } {
    const job = this.jobs.get(jobId);
    if (!job) return { ok: false, err: `job 不存在: ${jobId}` };
    job.state.job状态 = 'cancelled';
    job.state.更新于 = new Date().toISOString();
    this.persist(job);
    this.jobs.delete(jobId);
    logger.audit('watch_cancel', { job: jobId });
    return { ok: true };
  }

  // ── 轮询主循环 ──────────────────────────────────────

  private async tickAll(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      // 已完成的 job 保留 10 分钟供查询，之后清理
      const now = Date.now();
      for (const [id, job] of [...this.jobs.entries()]) {
        if (job.state.job状态 !== 'done') continue;
        const t = Date.parse(job.state.更新于);
        if (Number.isFinite(t) && now - t > 10 * 60 * 1000) {
          this.jobs.delete(id);
        }
      }

      for (const job of [...this.jobs.values()]) {
        if (job.state.job状态 !== 'running') continue;
        if (job.ticking) continue;
        job.ticking = true;
        try {
          await this.tickJob(job);
        } catch (e) {
          logger.error(`job ${job.state.job} tick 异常: ${(e as Error).message}`);
        } finally {
          job.ticking = false;
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private async tickJob(job: JobRuntime): Promise<void> {
    let changed = false;
    const now = Date.now();

    // 1. 扫描回执 mtime，连续 2 次相同即认为写完
    for (const orbit of job.orbits) {
      const entry = job.state.轨道[orbit];
      if (entry.状态 !== 'pending') continue;

      const file = this.deps.paths.receiptFile(
        job.state.轮次,
        orbit,
        job.state.版本,
      );
      const probe = job.stable.get(orbit) ?? { lastMtime: null, count: 0 };

      try {
        const stat = fs.statSync(file);
        if (stat.mtimeMs === probe.lastMtime) {
          probe.count += 1;
        } else {
          probe.lastMtime = stat.mtimeMs;
          probe.count = 1;
        }
      } catch {
        probe.lastMtime = null;
        probe.count = 0;
      }
      job.stable.set(orbit, probe);

      if (probe.count >= STABLE_COUNT) {
        entry.状态 = 'done';
        entry.回执 = this.relativeReceipt(job.state.轮次, orbit, job.state.版本);
        entry.mtime = new Date(probe.lastMtime ?? now).toISOString();
        changed = true;
        logger.audit('watch_receipt', { job: job.state.job, 轨: orbit });
        continue;
      }

      if (now >= job.deadline) {
        entry.状态 = 'timeout';
        changed = true;
        logger.warn(`job ${job.state.job}: ${orbit} 超时`);
      }
    }

    // 2. 入队：done/timeout/failed 转为待处理
    const allTerminal = job.orbits.every(
      (o) => job.state.轨道[o].状态 !== 'pending',
    );
    for (const orbit of job.orbits) {
      const entry = job.state.轨道[orbit];
      if (entry.处理 !== null) continue;

      if (entry.状态 === 'done') {
        if (job.state.notify === 'each' || allTerminal) {
          entry.处理 = 'pending';
          changed = true;
        }
      } else if (entry.状态 === 'timeout' || entry.状态 === 'failed') {
        entry.处理 = 'pending';
        changed = true;
      }
    }

    if (changed) {
      job.state.更新于 = new Date().toISOString();
      this.persist(job);
    }

    // 3. 通知（节流）：优先告警，其次普通待处理
    if (now < job.nextNotifyAt) return;

    const alertOrbits = job.orbits.filter((o) => {
      const e = job.state.轨道[o];
      return (
        e.处理 === 'pending' &&
        (e.状态 === 'timeout' || e.状态 === 'failed')
      );
    });
    const pendingOrbits = job.orbits.filter(
      (o) => job.state.轨道[o].处理 === 'pending',
    );

    const target = alertOrbits.length > 0 ? alertOrbits : pendingOrbits;
    if (target.length === 0) {
      // 没有待注入的项，但可能有需要重发的 notified
      await this.retryNotified(job, now);
      return;
    }

    const outcome = await this.safeNotify(job, target, alertOrbits.length > 0 ? 'alert' : 'notify');
    this.applyOutcome(job, target, outcome, now);
  }

  /** notified 超时未 ack → 重发，超过上限则降级为本地气泡 */
  private async retryNotified(job: JobRuntime, now: number): Promise<void> {
    const stale = job.orbits.filter((o) => {
      const e = job.state.轨道[o];
      if (e.处理 !== 'notified' || !e.通知于) return false;
      const notifiedAt = Date.parse(e.通知于);
      return Number.isFinite(notifiedAt) && now - notifiedAt >= RETRY_AFTER_S * 1000;
    });
    if (stale.length === 0) return;

    const type: 'notify' | 'alert' = stale.some((o) => {
      const s = job.state.轨道[o].状态;
      return s === 'timeout' || s === 'failed';
    })
      ? 'alert'
      : 'notify';

    const giveUp = stale.filter((o) => job.state.轨道[o].重发次数 >= MAX_RETRY);
    if (giveUp.length > 0) {
      this.deps.degrade(this.buildRequest(job, giveUp, type, true));
      for (const o of giveUp) {
        const e = job.state.轨道[o];
        e.重发次数 = MAX_RETRY + 1; // 标记已降级，不再重试
      }
      job.state.更新于 = new Date().toISOString();
      this.persist(job);
      job.nextNotifyAt = now + 30_000;
      logger.warn(`job ${job.state.job}: ${giveUp.join(',')} 通知降级`);
      return;
    }

    const outcome = await this.safeNotify(job, stale, type);
    if (outcome === 'sent') {
      for (const o of stale) {
        const e = job.state.轨道[o];
        e.重发次数 += 1;
        e.通知于 = new Date().toISOString();
      }
      job.state.更新于 = new Date().toISOString();
      this.persist(job);
    }
    this.applyOutcome(job, [], outcome, now);
  }

  private async safeNotify(
    job: JobRuntime,
    orbits: string[],
    type: 'notify' | 'alert',
  ): Promise<NotifyOutcome> {
    try {
      return await this.deps.notify(this.buildRequest(job, orbits, type, false));
    } catch (e) {
      logger.error(`通知注入异常: ${(e as Error).message}`);
      return 'failed';
    }
  }

  private buildRequest(
    job: JobRuntime,
    orbits: string[],
    type: 'notify' | 'alert',
    degraded: boolean,
  ): NotifyRequest {
    return {
      jobId: job.state.job,
      轮次: job.state.轮次,
      版本: job.state.版本,
      轨: orbits,
      类型: type,
      降级: degraded,
    };
  }

  /** 根据注入结果更新状态并设置节流窗口 */
  private applyOutcome(
    job: JobRuntime,
    orbits: string[],
    outcome: NotifyOutcome,
    now: number,
  ): void {
    if (outcome === 'sent') {
      const at = new Date().toISOString();
      for (const o of orbits) {
        const e = job.state.轨道[o];
        if (e.处理 === 'pending') {
          e.处理 = 'notified';
          e.通知于 = at;
        }
      }
      job.state.更新于 = at;
      this.persist(job);
      job.nextNotifyAt = now + 1000;
      return;
    }
    if (outcome === 'skipped') {
      // 仲裁者忙 / 有草稿：保持 pending，退避后重试
      job.nextNotifyAt = now + 5000;
      return;
    }
    // failed：fail-stop，不盲发，长退避
    writeSignal(this.deps.paths.alertSignal, {
      job: job.state.job,
      轨: orbits,
      reason: 'notify_failed',
      ts: new Date().toISOString(),
    });
    job.nextNotifyAt = now + 30_000;
  }

  // ── 快照 / 持久化 / 恢复 ────────────────────────────

  private snapshot(job: JobRuntime): {
    剩余待处理: string[];
    未完成: string[];
    全部已处理: boolean;
  } {
    const 剩余待处理 = job.orbits.filter((o) => {
      const e = job.state.轨道[o];
      return e.处理 === 'pending' || e.处理 === 'notified';
    });
    const 未完成 = job.orbits.filter(
      (o) => job.state.轨道[o].状态 === 'pending',
    );
    const 全部已处理 =
      job.orbits.every(
        (o) =>
          job.state.轨道[o].状态 !== 'pending' &&
          job.state.轨道[o].处理 === 'done',
      );
    return { 剩余待处理, 未完成, 全部已处理 };
  }

  private finishIfDrained(job: JobRuntime): void {
    if (!this.snapshot(job).全部已处理) return;
    job.state.job状态 = 'done';
    job.state.更新于 = new Date().toISOString();
    logger.audit('watch_done', { job: job.state.job });
  }

  private persist(job: JobRuntime): void {
    writeSignal(this.stateFilePath(job.state.轮次, job.state.版本), job.state);
  }

  private stateFilePath(round: number, version: number): string {
    return this.deps.paths.roundStateFile(round, version);
  }

  private relativeReceipt(round: number, orbit: string, version: number): string {
    return `.parallel-agent/回执/第${round}轮/${orbit}-v${version}.md`;
  }

  /** 从状态文件恢复 running job（插件重载不丢等待） */
  private restore(): void {
    const dir = this.deps.paths.roundStateDir;
    let files: string[] = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch {
      return;
    }

    for (const file of files) {
      const state = readSignal<RoundState>(path.join(dir, file));
      if (!state || state.job状态 !== 'running') continue;
      if (!state.轨道 || typeof state.轨道 !== 'object') continue;

      const orbits = Object.keys(state.轨道);
      if (orbits.length === 0) continue;

      const createdAt = Date.parse(state.创建于);
      const runtime: JobRuntime = {
        state,
        orbits,
        deadline:
          (Number.isFinite(createdAt) ? createdAt : Date.now()) +
          this.deps.defaultTimeoutS * 1000,
        stable: new Map(),
        nextNotifyAt: 0,
        ticking: false,
      };
      for (const orbit of orbits) {
        runtime.stable.set(orbit, { lastMtime: null, count: 0 });
      }
      this.jobs.set(state.job, runtime);
      logger.info(`恢复 watch job: ${state.job}（${orbits.join(',')}）`);
    }
  }
}

function newJobId(): string {
  const ts = Date.now().toString(36).slice(-5);
  const rand = Math.random().toString(36).slice(2, 5);
  return `w-${ts}${rand}`;
}
