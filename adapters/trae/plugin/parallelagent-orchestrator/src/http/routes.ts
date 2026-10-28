// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

import type { CdpClient } from '../cdp/cdpClient';
import type { OrbitTable } from '../state/orbitTable';
import type { WatchJobManager } from '../mailbox/watchJob';
import * as actions from '../cdp/actions';
import { AnchorNotFound, ParallelAgentError } from '../errors';
import * as logger from '../logger';

// ── 话术模板表（定稿 §9.6 + v1.2.0 两条） ─────────────

/** 话术模板标识 */
export type PhraseTemplateId =
  | 'new_track'
  | 'dispatch_round'
  | 'cancel_standby'
  | 'arbiter_ii'
  | 'track_ii'
  | 'watch_notify'
  | 'watch_alert';

/** 话术参数 */
export interface PhraseParams {
  /** 轨道号，如 "T-A" */
  轨?: string;
  /** 轮次 */
  轮次?: number;
  /** 转达/回执版本号 v{M}，派发轮次用，默认 1 */
  版本?: number;
  /** 交接手册版本号（第二任用） */
  手册版本?: string;
  /** 承接的轨道列表（第二任仲裁者用） */
  轨道们?: string[];
  /** 等待 job id（通知话术用） */
  job?: string;
}

/** 根据模板 + 参数生成固定话术 */
export function buildPhrase(
  template: PhraseTemplateId,
  params: PhraseParams,
): string {
  switch (template) {
    case 'new_track':
      return `读手册 .parallel-agent/轨道启动手册.md，你是 ${params.轨}，待命`;
    case 'dispatch_round': {
      const version = params.版本 ?? 1;
      return `读 .parallel-agent/转达/第${params.轮次}轮/${params.轨}-v${version}.md，执行，写 .parallel-agent/回执/第${params.轮次}轮/${params.轨}-v${version}.md`;
    }
    case 'cancel_standby':
      return `本轮无 ${params.轨} 任务，待命`;
    case 'arbiter_ii':
      return `读交接手册第${params.手册版本}版 .parallel-agent/交接手册/第${params.手册版本}版-*.md，你是仲裁者 II 世，承接 ${params.轨道们?.join('/') ?? ''} 收尾`;
    case 'track_ii':
      return `读交接手册第${params.手册版本}版 .parallel-agent/交接手册/第${params.手册版本}版-*.md，你是 ${params.轨} II 世，承接 ${params.轨} 身份`;
    case 'watch_notify':
      return `读 .parallel-agent/信号/轮次状态/ 下的待处理状态文件（当前 job ${params.job}），可用 GET /watch/jobs 查看全部；处理完用 POST /watch/ack 标记`;
    case 'watch_alert':
      return `读 .parallel-agent/信号/轮次状态/ 下的待处理状态文件（当前 job ${params.job}），有轨超时或失败，优先处理；可用 GET /watch/jobs 查看全部`;
  }
}

// ── 文件信箱 watch 接口（步骤 5 实现） ────────────────

export interface MailboxWatcher {
  watchReceipts(
    round: number,
    orbits: string[],
    timeoutS: number,
    version?: number,
  ): Promise<{ completed: string[]; incomplete: string[] }>;

  /** 等待轨道写出就绪回执；sinceMs 之前的旧文件不算数 */
  watchReady(
    orbits: string[],
    sinceMs: number,
    timeoutS: number,
  ): Promise<{ ready: string[]; notReady: string[] }>;
}

/** 正整数校验（版本号、轮次） */
function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

// ── 路由依赖 ──────────────────────────────────────────

export interface RouteDeps {
  /** CDP 客户端；先起 HTTP 网关时为 null，连接成功后由启动方回填 */
  cdp: CdpClient | null;
  orbit: OrbitTable;
  watcher: MailboxWatcher | null;
  /** 回执等待 job 管理器（v1.2.0） */
  jobs: WatchJobManager | null;
  /** 目标项目名（新建轨道会话时自动挂该项目） */
  projectName: string;
  /** 当前窗口工作区根绝对路径（空窗口为空字符串），/health 诊断用 */
  workspace: string;
}

// ── HTTP body 解析结果 ────────────────────────────────

export interface ParsedRequest {
  method: string;
  url: string;
  query: Record<string, string>;
  body: unknown;
}

export type RouteHandler = (
  req: ParsedRequest,
  deps: RouteDeps,
) => Promise<unknown>;

// ── 路由表 ────────────────────────────────────────────

interface RouteEntry {
  method: string;
  path: string;
  handler: RouteHandler;
}

export function buildRoutes(): RouteEntry[] {
  return [
    { method: 'GET', path: '/health', handler: handleHealth },
    { method: 'GET', path: '/ping', handler: handlePing },
    { method: 'POST', path: '/dispatch', handler: handleDispatch },
    { method: 'POST', path: '/new', handler: handleNew },
    { method: 'POST', path: '/delete', handler: handleDelete },
    { method: 'POST', path: '/wait-ready', handler: handleWaitReady },
    { method: 'POST', path: '/watch', handler: handleWatchSubmit },
    { method: 'GET', path: '/watch/status', handler: handleWatchStatus },
    { method: 'POST', path: '/watch/ack', handler: handleWatchAck },
    { method: 'POST', path: '/watch/cancel', handler: handleWatchCancel },
    { method: 'GET', path: '/watch/jobs', handler: handleWatchJobs },
    { method: 'POST', path: '/bind-arbiter', handler: handleBindArbiter },
  ];
}

// ── 各路由 handler ────────────────────────────────────

/** GET /health — cdp_alive + 轨表 */
async function handleHealth(
  _req: ParsedRequest,
  deps: RouteDeps,
): Promise<unknown> {
  const cdpAlive = deps.cdp?.isConnected() ?? false;
  const orbits = deps.orbit.list();
  return {
    ok: true,
    cdp_alive: cdpAlive,
    workspace: deps.workspace,
    pid: process.pid,
    轨表: orbits,
  };
}

/** GET /ping?sid=xxx — 切轨 → 读 status → 返回 */
async function handlePing(
  req: ParsedRequest,
  deps: RouteDeps,
): Promise<unknown> {
  const sid = req.query.sid;
  if (!sid) {
    return { ok: false, err: '缺少 sid 参数', type: 'signal_invalid' };
  }
  const cdp = deps.cdp;
  if (!cdp) {
    return { ok: false, err: 'CDP 未连接', type: 'cdp_unavailable' };
  }

  // 切到该 sid
  await actions.navigateTo(cdp, sid);
  // 读状态
  const s = await actions.status(cdp);

  return {
    ok: true,
    状态: s.state,
    任务名: s.title,
    sid: s.sid,
  };
}

/** POST /dispatch — 查轨表 → 切轨 → 断言 → 清空 → 注入话术 → 发送 */
async function handleDispatch(
  req: ParsedRequest,
  deps: RouteDeps,
): Promise<unknown> {
  const body = req.body as {
    轨?: string;
    轮次?: number;
    版本?: number;
    手册版本?: string;
    模板?: PhraseTemplateId;
    话术?: string;
  };

  if (!body.轨) {
    return { ok: false, err: '缺少 轨 字段', type: 'signal_invalid' };
  }

  const version = body.版本 ?? 1;
  if (!isPositiveInt(version)) {
    return { ok: false, err: '版本 必须为正整数', type: 'signal_invalid' };
  }
  if (!body.话术 && body.模板 === 'dispatch_round' && !isPositiveInt(body.轮次)) {
    return { ok: false, err: '派发轮次时 轮次 必须为正整数', type: 'signal_invalid' };
  }

  const cdp = deps.cdp;
  if (!cdp) {
    return { ok: false, err: 'CDP 未连接', type: 'cdp_unavailable' };
  }

  // 查轨表：按创建时点倒序，优先最新记录
  const candidates = deps.orbit.getActiveBy轨(body.轨);
  if (candidates.length === 0) {
    return {
      ok: false,
      err: `轨表中无 ${body.轨} 的 active sid 记录`,
      type: 'signal_invalid',
    };
  }

  // 生成话术：优先用请求中的话术，否则用模板 + 参数生成
  let phrase: string;
  if (body.话术) {
    phrase = body.话术;
  } else if (body.模板) {
    phrase = buildPhrase(body.模板, {
      轨: body.轨,
      轮次: body.轮次,
      版本: version,
      手册版本: body.手册版本,
    });
  } else {
    return { ok: false, err: '缺少 话术 或 模板 字段', type: 'signal_invalid' };
  }

  // 逐条尝试候选 sid：失效记录（会话已不存在）清理后继续下一条
  let lastStale: string | undefined;
  for (const record of candidates) {
    try {
      await actions.navigateTo(cdp, record.sid);
      await actions.assertIdentity(cdp, record.sid);
    } catch (e) {
      if (e instanceof ParallelAgentError && e.errorType === 'anchor_not_found') {
        deps.orbit.remove(record.sid);
        lastStale = record.sid;
        logger.warn(`dispatch 跳过失效 sid: ${record.sid}（轨 ${body.轨}）`);
        continue;
      }
      throw e;
    }

    await actions.clearInput(cdp);
    await actions.insertText(cdp, phrase);
    await actions.send(cdp);

    const sentAt = new Date().toISOString();
    logger.audit('dispatch', {
      轨: body.轨,
      轮次: body.轮次,
      版本: version,
      sid: record.sid,
      模板: body.模板,
    });

    return { ok: true, sid: record.sid, sent_at: sentAt };
  }

  return {
    ok: false,
    err:
      `轨 ${body.轨} 的 sid 记录均已失效` +
      `${lastStale ? `（最后失效 ${lastStale}）` : ''}` +
      '；已清理，请重新 /new 开轨',
    type: 'anchor_not_found',
  };
}

/** POST /new — newTask → 注入首条 → 发送 → 落身份表 */
async function handleNew(
  req: ParsedRequest,
  deps: RouteDeps,
): Promise<unknown> {
  const body = req.body as {
    轨?: string;
    模板?: PhraseTemplateId;
    话术?: string;
  };

  if (!body.轨) {
    return { ok: false, err: '缺少 轨 字段', type: 'signal_invalid' };
  }
  const cdp = deps.cdp;
  if (!cdp) {
    return { ok: false, err: 'CDP 未连接', type: 'cdp_unavailable' };
  }

  // 生成话术
  let phrase: string;
  if (body.话术) {
    phrase = body.话术;
  } else if (body.模板 === 'new_track' || !body.模板) {
    phrase = buildPhrase('new_track', { 轨: body.轨 });
  } else {
    phrase = buildPhrase(body.模板, { 轨: body.轨 });
  }

  // CDP 新建任务（挂 projectName 项目，含首条话术注入发送）→ 获取新 sid
  const sid = await actions.newTask(cdp, deps.projectName, phrase);

  // 落身份表
  deps.orbit.upsert(sid, body.轨);

  const namedAt = new Date().toISOString();
  logger.audit('new', { 轨: body.轨, sid });

  return { ok: true, sid, named_at: namedAt };
}

/** POST /delete — deleteTask → 出身份表 */
async function handleDelete(
  req: ParsedRequest,
  deps: RouteDeps,
): Promise<unknown> {
  const body = req.body as { sid?: string };

  if (!body.sid) {
    return { ok: false, err: '缺少 sid 字段', type: 'signal_invalid' };
  }
  const cdp = deps.cdp;
  if (!cdp) {
    return { ok: false, err: 'CDP 未连接', type: 'cdp_unavailable' };
  }

  try {
    await actions.deleteTask(cdp, body.sid);
  } catch (e) {
    // 只把 "导航时 sid 不存在" 视为会话已失效；菜单/弹窗锚点缺失仍按 500 抛出
    if (
      e instanceof AnchorNotFound &&
      /navigate 失败: sid=.*result=NOT_FOUND/.test(e.message)
    ) {
      deps.orbit.remove(body.sid);
      return { ok: false, err: `会话 ${body.sid} 不存在`, type: 'signal_invalid' };
    }
    throw e;
  }
  deps.orbit.remove(body.sid);

  return { ok: true };
}

/** POST /wait-ready — 阻塞等待轨道写出就绪回执（开轨握手第二步） */
async function handleWaitReady(
  req: ParsedRequest,
  deps: RouteDeps,
): Promise<unknown> {
  const body = req.body as {
    轨?: string[];
    since?: string | number;
    timeout_s?: number;
  };

  if (!Array.isArray(body.轨) || body.轨.length === 0) {
    return { ok: false, err: '缺少 轨 字段', type: 'signal_invalid' };
  }

  if (!deps.watcher) {
    return {
      ok: false,
      err: '文件信箱 watch 模块未初始化',
      type: 'watch_unavailable',
    };
  }

  // since 缺省为当前时刻：只认此刻之后写出的就绪回执，避免旧文件误判
  let sinceMs = Date.now();
  if (typeof body.since === 'number' && Number.isFinite(body.since)) {
    sinceMs = body.since;
  } else if (typeof body.since === 'string' && body.since) {
    const parsed = Date.parse(body.since);
    if (Number.isNaN(parsed)) {
      return { ok: false, err: 'since 无法解析为时间', type: 'signal_invalid' };
    }
    sinceMs = parsed;
  }

  const timeoutS = body.timeout_s ?? 300;
  const result = await deps.watcher.watchReady(body.轨, sinceMs, timeoutS);

  logger.audit('wait_ready', {
    轨: body.轨,
    since: new Date(sinceMs).toISOString(),
    就绪: result.ready,
    未就绪: result.notReady,
  });

  return {
    ok: true,
    since: new Date(sinceMs).toISOString(),
    就绪: result.ready,
    未就绪: result.notReady,
  };
}

/** POST /watch — 提交后台等待 job，立即返回 job_id（v1.2.0 不再阻塞） */
async function handleWatchSubmit(
  req: ParsedRequest,
  deps: RouteDeps,
): Promise<unknown> {
  const body = req.body as {
    轮次?: number;
    版本?: number;
    轨?: string[];
    timeout_s?: number;
    notify?: 'each' | 'all';
  };

  if (!isPositiveInt(body.轮次) || !Array.isArray(body.轨) || body.轨.length === 0) {
    return { ok: false, err: '缺少 轮次 或 轨 字段', type: 'signal_invalid' };
  }

  const version = body.版本 ?? 1;
  if (!isPositiveInt(version)) {
    return { ok: false, err: '版本 必须为正整数', type: 'signal_invalid' };
  }

  if (!deps.jobs) {
    return {
      ok: false,
      err: 'job 管理器未初始化',
      type: 'watch_unavailable',
    };
  }

  const timeoutS = body.timeout_s;
  if (
    timeoutS !== undefined &&
    (typeof timeoutS !== 'number' || !Number.isFinite(timeoutS) || timeoutS <= 0)
  ) {
    return { ok: false, err: 'timeout_s 必须为正数', type: 'signal_invalid' };
  }

  const notify = body.notify === 'all' ? 'all' : 'each';
  const result = deps.jobs.submit({
    轮次: body.轮次,
    版本: version,
    轨: body.轨,
    timeout_s: timeoutS,
    notify,
    仲裁者: deps.orbit.getArbiter()?.sid ?? null,
  });

  return {
    ok: true,
    job_id: result.state.job,
    轮次: result.state.轮次,
    版本: result.state.版本,
    notify: result.state.notify,
    状态文件: `信号/轮次状态/第${result.state.轮次}轮-v${result.state.版本}.json`,
    /** true = 同轮次版本已有 job，本次复用（未新建） */
    复用: result.复用,
    警告: result.警告,
  };
}

/** GET /watch/status?job=xxx — 只读查询待处理队列 */
async function handleWatchStatus(
  req: ParsedRequest,
  deps: RouteDeps,
): Promise<unknown> {
  const jobId = req.query.job;
  if (!jobId) {
    return { ok: false, err: '缺少 job 参数', type: 'signal_invalid' };
  }
  if (!deps.jobs) {
    return { ok: false, err: 'job 管理器未初始化', type: 'watch_unavailable' };
  }

  const state = deps.jobs.get(jobId);
  if (!state) {
    return { ok: false, err: `job 不存在: ${jobId}`, type: 'signal_invalid' };
  }
  return { ok: true, ...queueView(state) };
}

/** POST /watch/ack — 标记某轨已消费，并带回剩余队列 */
async function handleWatchAck(
  req: ParsedRequest,
  deps: RouteDeps,
): Promise<unknown> {
  const body = req.body as { job?: string; 轨?: string };
  if (!body.job || !body.轨) {
    return { ok: false, err: '缺少 job 或 轨 字段', type: 'signal_invalid' };
  }
  if (!deps.jobs) {
    return { ok: false, err: 'job 管理器未初始化', type: 'watch_unavailable' };
  }
  return deps.jobs.ack(body.job, body.轨);
}

/** POST /watch/cancel — 取消 job 并清理 */
async function handleWatchCancel(
  req: ParsedRequest,
  deps: RouteDeps,
): Promise<unknown> {
  const body = req.body as { job?: string };
  if (!body.job) {
    return { ok: false, err: '缺少 job 字段', type: 'signal_invalid' };
  }
  if (!deps.jobs) {
    return { ok: false, err: 'job 管理器未初始化', type: 'watch_unavailable' };
  }
  const r = deps.jobs.cancel(body.job);
  return r.ok ? { ok: true } : { ok: false, err: r.err, type: 'signal_invalid' };
}

/** GET /watch/jobs — 列出全部 job（自检与恢复） */
async function handleWatchJobs(
  _req: ParsedRequest,
  deps: RouteDeps,
): Promise<unknown> {
  if (!deps.jobs) {
    return { ok: false, err: 'job 管理器未初始化', type: 'watch_unavailable' };
  }
  return {
    ok: true,
    jobs: deps.jobs.list().map((s) => {
      const entries = Object.entries(s.轨道);
      const 待处理 = entries
        .filter(([, v]) => v.处理 === 'pending' || v.处理 === 'notified')
        .map(([k]) => k);
      return {
        job: s.job,
        轮次: s.轮次,
        版本: s.版本,
        job状态: s.job状态,
        notify: s.notify,
        创建于: s.创建于,
        待处理,
        轨道: Object.fromEntries(
          entries.map(([k, v]) => [
            k,
            { 状态: v.状态, 处理: v.处理, 回执: v.回执 },
          ]),
        ),
      };
    }),
  };
}

/** POST /bind-arbiter — 把当前选中会话绑定为通知目标 */
async function handleBindArbiter(
  _req: ParsedRequest,
  deps: RouteDeps,
): Promise<unknown> {
  const cdp = deps.cdp;
  if (!cdp) {
    return { ok: false, err: 'CDP 未连接', type: 'cdp_unavailable' };
  }

  const s = await actions.status(cdp);
  if (!s.sid) {
    return {
      ok: false,
      err: '当前没有选中会话，无法绑定仲裁者',
      type: 'signal_invalid',
    };
  }

  // D-04 修复：禁止绑定到 active 轨道会话；避免唤醒错投并覆盖轨身份
  const record = deps.orbit.getBySid(s.sid);
  if (record?.角色 === 'orbit' && record.状态 === 'active') {
    return {
      ok: false,
      err: `当前选中会话 ${s.sid} 是 active 轨道（${record.轨}），请先切回仲裁者会话再调用 /bind-arbiter`,
      type: 'signal_invalid',
    };
  }

  deps.orbit.bindArbiter(s.sid, s.title);
  deps.jobs?.setArbiter(s.sid);
  logger.audit('bind_arbiter', { sid: s.sid, 任务名: s.title });

  return { ok: true, sid: s.sid, 任务名: s.title };
}

/** 队列视图：只含信号级信息，不含任务内容 */
function queueView(state: {
  job: string;
  轮次: number;
  版本: number;
  job状态: string;
  notify: string;
  轨道: Record<
    string,
    { 状态: string; 处理: string | null; 回执: string | null; mtime: string | null }
  >;
}): {
  job: string;
  轮次: number;
  版本: number;
  job状态: string;
  notify: string;
  轨道: unknown;
  待处理: string[];
  未完成: string[];
} {
  const entries = Object.entries(state.轨道);
  return {
    job: state.job,
    轮次: state.轮次,
    版本: state.版本,
    job状态: state.job状态,
    notify: state.notify,
    轨道: state.轨道,
    待处理: entries
      .filter(([, e]) => e.处理 === 'pending' || e.处理 === 'notified')
      .map(([k]) => k),
    未完成: entries.filter(([, e]) => e.状态 === 'pending').map(([k]) => k),
  };
}

// ── 统一错误包装 ──────────────────────────────────────

export function errorResponse(err: unknown): { ok: false; err: string; type: string } {
  if (err instanceof ParallelAgentError) {
    return err.toResponse();
  }
  return {
    ok: false,
    err: (err as Error)?.message ?? String(err),
    type: 'internal',
  };
}
