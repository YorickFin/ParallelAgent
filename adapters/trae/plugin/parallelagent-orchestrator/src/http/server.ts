// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

import * as http from 'http';
import {
  buildRoutes,
  errorResponse,
  RouteDeps,
  ParsedRequest,
} from './routes';
import * as logger from '../logger';

const MAX_BODY_BYTES = 1024 * 1024; // 1MB

/**
 * 创建 HTTP 网关
 * 监听 127.0.0.1:port，body 解析（1MB 限制），统一错误包装
 */
export function createHttpServer(
  port: number,
  deps: RouteDeps,
): { close(): void } {
  const routes = buildRoutes();

  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const pathname = parsedUrl.pathname;
    const query: Record<string, string> = {};
    for (const [k, v] of parsedUrl.searchParams.entries()) {
      query[k] = v;
    }

    // body 解析
    let body: unknown = undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks: Buffer[] = [];
      let totalSize = 0;
      try {
        for await (const chunk of req) {
          totalSize += (chunk as Buffer).length;
          if (totalSize > MAX_BODY_BYTES) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                ok: false,
                err: 'body 超过 1MB 限制',
                type: 'body_too_large',
              }),
            );
            return;
          }
          chunks.push(chunk as Buffer);
        }
        const raw = Buffer.concat(chunks).toString('utf8');
        if (raw) {
          body = JSON.parse(raw);
        }
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: false,
            err: 'body JSON 解析失败',
            type: 'parse_error',
          }),
        );
        return;
      }
    }

    // 路由匹配
    const route = routes.find(
      (r) => r.method === req.method && r.path === pathname,
    );
    if (!route) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: false,
          err: `路由不存在: ${req.method} ${pathname}`,
          type: 'not_found',
        }),
      );
      return;
    }

    // 执行 handler
    const parsedReq: ParsedRequest = {
      method: req.method ?? 'GET',
      url: pathname,
      query,
      body,
    };

    try {
      const result = await route.handler(parsedReq, deps);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (err) {
      const errResp = errorResponse(err);
      logger.error(
        `路由异常: ${req.method} ${pathname}: ${errResp.err}`,
      );
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(errResp));
    }
  });

  server.listen(port, '127.0.0.1', () => {
    logger.info(`HTTP 网关监听 127.0.0.1:${port}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    logger.error(`HTTP 服务器错误: ${err.message}`);
  });

  return {
    close: () => {
      server.close();
      logger.info('HTTP 网关已关闭');
    },
  };
}
