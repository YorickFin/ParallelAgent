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
  /** 交接手册版本号（第二任用） */
  版本?: string;
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
      return `读手册 docs/协调/轨道启动手册.md，你是 ${params.轨}，待命`;
    case 'dispatch_round':
      return `读转达第${params.轮次}轮你的→${params.轨}节，执行，写回执`;
    case 'cancel_standby':
      return `本轮无 ${params.轨} 任务，待命`;
    case 'arbiter_ii':
      return `读交接手册第${params.版本}版 docs/协调/交接手册/第${params.版本}版-*.md，你是仲裁者 II 世，承接 ${params.轨道们?.join('/') ?? ''} 收尾`;
    case 'track_ii':
      return `读交接手册第${params.版本}版 docs/协调/交接手册/第${params.版本}版-*.md，你是 ${params.轨} II 世，承接 ${params.轨} 身份`;
  }
}

// ── 文件信箱 watch 接口（步骤 5 实现） ────────────────

export interface MailboxWatcher {
  watchReceipts(
    round: number,
    orbits: string[],
    timeoutS: number,
  ): Promise<{ completed: string[]; incomplete: string[] }>;
}

// ── 路由依赖 ──────────────────────────────────────────

export interface RouteDeps {
  cdp: CdpClient;
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
    { method: 'POST', path: '/watch', handler: handleWatch },
  ];
}

// ── 各路由 handler ────────────────────────────────────

/** GET /health — cdp_alive + 轨表 */
async function handleHealth(
  _req: ParsedRequest,
  deps: RouteDeps,
): Promise<unknown> {
  const cdpAlive = deps.cdp.isConnected();
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

  // 切到该 sid
  await actions.navigateTo(deps.cdp, sid);
  // 读状态
  const s = await actions.status(deps.cdp);

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
    模板?: PhraseTemplateId;
    话术?: string;
  };

  if (!body.轨) {
    return { ok: false, err: '缺少 轨 字段', type: 'signal_invalid' };
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
    phrase = buildPhrase(body.模板, { 轨: body.轨, 轮次: body.轮次 });
  } else {
    return { ok: false, err: '缺少 话术 或 模板 字段', type: 'signal_invalid' };
  }

  // 切轨 → 断言身份 → 清空 → 注入 → 发送
  await actions.navigateTo(deps.cdp, record.sid);
  await actions.assertIdentity(deps.cdp, record.sid);
  await actions.clearInput(deps.cdp);
  await actions.insertText(deps.cdp, phrase);
  await actions.send(deps.cdp);

  const sentAt = new Date().toISOString();
  logger.audit('dispatch', { 轨: body.轨, sid: record.sid, 模板: body.模板 });

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
  const sid = await actions.newTask(deps.cdp, deps.projectName, phrase);

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

  await actions.deleteTask(deps.cdp, body.sid);
  deps.orbit.remove(body.sid);

  return { ok: true };
}

/** POST /watch — 阻塞监听回执 + 超时 */
async function handleWatch(
  req: ParsedRequest,
  deps: RouteDeps,
): Promise<unknown> {
  const body = req.body as {
    轮次?: number;
    轨?: string[];
    timeout_s?: number;
  };

  if (!body.轮次 || !body.轨) {
    return { ok: false, err: '缺少 轮次 或 轨 字段', type: 'signal_invalid' };
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
  );

  return {
    ok: true,
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
