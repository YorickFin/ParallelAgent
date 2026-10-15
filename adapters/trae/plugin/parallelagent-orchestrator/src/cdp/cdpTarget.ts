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
 * 过滤 Work 页面 target
 * 定稿 §8.4：url 含 solo-lite 的 Work 对话页优先；
 * 兜底才用 title 含"管理员"（编辑器页标题也含"管理员"，不能作首选）。
 */
export function filterWorkTarget(targets: CdpTarget[]): CdpTarget | null {
  for (const t of targets) {
    if (t.type !== 'page') continue;
    if (t.url.includes('solo-lite')) {
      logger.info(`匹配 Work target(solo-lite): id=${t.id} title=${t.title}`);
      return t;
    }
  }
  for (const t of targets) {
    if (t.type !== 'page') continue;
    if (t.title.includes('管理员')) {
      logger.info(`匹配 Work target(兜底title): id=${t.id} title=${t.title}`);
      return t;
    }
  }
  return null;
}

/**
 * 发现 Work target 并连接，返回 CdpClient 实例
 * fail-stop：找不到 target 抛 CdpDisconnected
 */
export async function discoverAndConnect(port: number): Promise<{
  client: CdpClient;
  target: CdpTarget;
}> {
  const targets = await listTargets(port);
  logger.info(`CDP 枚举到 ${targets.length} 个 target`);

  const target = filterWorkTarget(targets);
  if (!target) {
    throw new CdpDisconnected(
      '找不到 Work 页面 target（无 type=page 且 title 含"管理员"或 url 含 solo-lite）',
    );
  }

  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();

  return { client, target };
}
