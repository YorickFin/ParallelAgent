// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

import * as http from 'http';
import { CdpDisconnected } from '../errors';
import * as logger from '../logger';
import { CdpClient } from './cdpClient';

/** CDP target 描述 */
export interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

/**
 * 枚举 CDP targets
 * GET http://127.0.0.1:{port}/json
 */
export function listTargets(port: number, timeoutMs = 5000): Promise<CdpTarget[]> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: '127.0.0.1',
        port,
        path: '/json',
        timeout: timeoutMs,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on('end', () => {
          try {
            const targets = JSON.parse(body) as CdpTarget[];
            resolve(targets);
          } catch (e) {
            reject(
              new CdpDisconnected(
                `解析 /json 响应失败: ${(e as Error).message}`,
              ),
            );
          }
        });
      },
    );

    req.on('error', (err) => {
      reject(
        new CdpDisconnected(`枚举 targets 失败: ${err.message}`),
      );
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new CdpDisconnected('枚举 targets 超时'));
    });
  });
}

/**
 * 判定是否为 Agent 对话页。
 *
 * Trae 里同一个 Agent 页有两种 target 形态：
 * - title 形如 `Agent [管理员]`（url 可能不含 solo-lite）
 * - title 直接是 `vscode-file://.../solo/solo-lite.html`
 *
 * IDE 工作台页的 title 形如 `<项目名> - TRAE CN [管理员]`，不能当作 Agent 页。
 */
export function isAgentTarget(target: CdpTarget): boolean {
  if (target.type !== 'page') return false;
  const url = target.url ?? '';
  const title = target.title ?? '';
  if (url.includes('solo-lite')) return true;
  if (title.startsWith('Agent') && !title.includes('TRAE CN')) return true;
  return false;
}

/**
 * 过滤 Work 页面 target
 * 优先 Agent 页；兼容旧版 Trae 时才退回「管理员」页面（排除工作台页）。
 */
export function filterWorkTarget(targets: CdpTarget[]): CdpTarget | null {
  for (const t of targets) {
    if (isAgentTarget(t)) {
      logger.info(`匹配 Work target(Agent): id=${t.id} title=${t.title}`);
      return t;
    }
  }
  for (const t of targets) {
    if (t.type !== 'page') continue;
    if (t.title.includes('管理员') && !t.title.includes('TRAE CN')) {
      logger.info(`匹配 Work target(旧版兜底): id=${t.id} title=${t.title}`);
      return t;
    }
  }
  return null;
}

/**
 * 只匹配 Agent 对话页，不做旧版兜底。
 * 自动启动使用：Agent 页尚未打开时宁可等待，也不连到没有任务列表的 IDE 工作台页。
 */
export function filterWorkPageOnly(targets: CdpTarget[]): CdpTarget | null {
  for (const t of targets) {
    if (isAgentTarget(t)) {
      logger.info(`匹配 Work target(仅 Agent 页): id=${t.id} title=${t.title}`);
      return t;
    }
  }
  return null;
}

/**
 * 发现 Work target 并连接，返回 CdpClient 实例
 * fail-stop：找不到 target 抛 CdpDisconnected
 *
 * `requireWorkPage=true` 时只接受 solo-lite 的 Agent 页；
 * 默认保留「管理员」兜底，用于手动启动与旧版 Trae。
 */
export async function discoverAndConnect(
  port: number,
  opts: { requireWorkPage?: boolean } = {},
): Promise<{
  client: CdpClient;
  target: CdpTarget;
}> {
  const targets = await listTargets(port);
  logger.info(`CDP 枚举到 ${targets.length} 个 target`);

  const target = opts.requireWorkPage
    ? filterWorkPageOnly(targets)
    : filterWorkTarget(targets);
  if (!target) {
    throw new CdpDisconnected(
      opts.requireWorkPage
        ? '找不到 Agent 页 target（url 含 solo-lite）；请先打开 Agent 页面'
        : '找不到 Work 页面 target（无 type=page 且 title 含"管理员"或 url 含 solo-lite）',
    );
  }

  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();

  return { client, target };
}
