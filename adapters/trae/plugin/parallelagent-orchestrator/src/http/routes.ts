// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

import type { CdpClient } from '../cdp/cdpClient';
import type { OrbitTable } from '../state/orbitTable';
import * as actions from '../cdp/actions';
import { ParallelAgentError } from '../errors';
import * as logger from '../logger';

// ── 话术模板表（定稿 §9.6 五种） ──────────────────────

/** 话术模板标识 */
export type PhraseTemplateId =
  | 'new_track'
  | 'dispatch_round'
  | 'cancel_standby'
  | 'arbiter_ii'
  | 'track_ii';

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
  /** 目标项目名（新建轨道会话时自动挂该项目） */
  projectName: string;
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
    { method: 'POST', path: '/watch', handler: handleWatch },
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

  // 查轨表
  const record = deps.orbit.getBy轨(body.轨);
  if (!record) {
    return {
      ok: false,
      err: `轨表中无 ${body.轨} 的 sid 记录`,
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

  // 切轨 → 断言身份 → 清空 → 注入 → 发送
  await actions.navigateTo(cdp, record.sid);
  await actions.assertIdentity(cdp, record.sid);
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

  await actions.deleteTask(cdp, body.sid);
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

/** POST /watch — 阻塞监听回执 + 超时 */
async function handleWatch(
  req: ParsedRequest,
  deps: RouteDeps,
): Promise<unknown> {
  const body = req.body as {
    轮次?: number;
    版本?: number;
    轨?: string[];
    timeout_s?: number;
  };

  if (!isPositiveInt(body.轮次) || !Array.isArray(body.轨) || body.轨.length === 0) {
    return { ok: false, err: '缺少 轮次 或 轨 字段', type: 'signal_invalid' };
  }

  const version = body.版本 ?? 1;
  if (!isPositiveInt(version)) {
    return { ok: false, err: '版本 必须为正整数', type: 'signal_invalid' };
  }

  if (!deps.watcher) {
    return {
      ok: false,
      err: '文件信箱 watch 模块未初始化',
      type: 'watch_unavailable',
    };
  }

  const timeoutS = body.timeout_s ?? 1800;
  const result = await deps.watcher.watchReceipts(
    body.轮次,
    body.轨,
    timeoutS,
    version,
  );

  return {
    ok: true,
    轮次: body.轮次,
    版本: version,
    完成: result.completed,
    未完成: result.incomplete,
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
