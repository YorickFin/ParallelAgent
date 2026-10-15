// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

import WebSocket from 'ws';
import { CdpDisconnected } from '../errors';
import * as logger from '../logger';

/** CDP 响应 */
export interface CdpResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** CDP 事件（无 id） */
export interface CdpEvent {
  method: string;
  params: unknown;
}

type CdpEventHandler = (params: unknown) => void;

interface PendingRequest {
  resolve: (resp: CdpResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 30000;
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 5;

export class CdpClient {
  private ws: WebSocket | null = null;
  private nextId = 0;
  private pending = new Map<number, PendingRequest>();
  private eventHandlers = new Map<string, Set<CdpEventHandler>>();
  private webSocketDebuggerUrl: string;
  private connected = false;
  private reconnectAttempts = 0;
  private shouldReconnect = true;

  constructor(webSocketDebuggerUrl: string) {
    this.webSocketDebuggerUrl = webSocketDebuggerUrl;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info(`CDP 连接中: ${this.webSocketDebuggerUrl}`);
      const ws = new WebSocket(this.webSocketDebuggerUrl);

      ws.on('open', () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        logger.info('CDP 连接已建立');
        resolve();
      });

      ws.on('message', (data: WebSocket.RawData) => {
        this.handleMessage(data.toString());
      });

      ws.on('close', (code: number, reason: Buffer) => {
        this.connected = false;
        const msg = `CDP WebSocket 关闭: code=${code} reason=${reason.toString()}`;
        logger.warn(msg);
        this.failAllPending(new CdpDisconnected(msg));
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      });

      ws.on('error', (err: Error) => {
        logger.error(`CDP WebSocket 错误: ${err.message}`);
        if (!this.connected) {
          reject(new CdpDisconnected(`连接失败: ${err.message}`));
        }
      });

      this.ws = ws;
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.error(
        `CDP 重连已达上限 ${MAX_RECONNECT_ATTEMPTS}，放弃`,
      );
      return;
    }
    this.reconnectAttempts++;
    logger.info(
      `CDP 尝试第 ${this.reconnectAttempts} 次重连（${RECONNECT_DELAY_MS}ms 后）`,
    );
    setTimeout(() => {
      this.connect().catch(() => {
        // connect 内部已记日志，重连失败后 scheduleReconnect 会继续
      });
    }, RECONNECT_DELAY_MS);
  }

  /** 发送 CDP 命令并等待响应 */
  send(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<CdpResponse> {
    if (!this.ws || !this.connected) {
      return Promise.reject(
        new CdpDisconnected('CDP 未连接，无法发送'),
      );
    }

    const id = ++this.nextId;
    const payload = JSON.stringify({ id, method, params: params ?? {} });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new CdpDisconnected(
            `CDP 命令超时: method=${method} id=${id} timeout=${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      this.ws!.send(payload, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(
            new CdpDisconnected(
              `CDP 发送失败: method=${method} ${err.message}`,
            ),
          );
        }
      });
    });
  }

  /** 注册事件处理器 */
  on(method: string, handler: CdpEventHandler): void {
    if (!this.eventHandlers.has(method)) {
      this.eventHandlers.set(method, new Set());
    }
    this.eventHandlers.get(method)!.add(handler);
  }

  /** 注销事件处理器 */
  off(method: string, handler: CdpEventHandler): void {
    this.eventHandlers.get(method)?.delete(handler);
  }

  /** 是否已连接 */
  isConnected(): boolean {
    return this.connected;
  }

  /** 断开连接，不再重连 */
  disconnect(): void {
    this.shouldReconnect = false;
    this.connected = false;
    this.failAllPending(new CdpDisconnected('主动断开'));
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private handleMessage(raw: string): void {
    let msg: { id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      logger.warn(`CDP 收到无法解析的消息: ${raw.slice(0, 200)}`);
      return;
    }

    if (msg.id !== undefined && msg.id !== null) {
      // 响应
      const pending = this.pending.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(msg.id);
        pending.resolve(msg as CdpResponse);
      } else {
        logger.warn(
          `CDP 收到未知 id=${msg.id} 的响应`,
        );
      }
    } else if (msg.method) {
      // 事件
      const handlers = this.eventHandlers.get(msg.method);
      if (handlers) {
        for (const h of handlers) {
          try {
            h(msg.params);
          } catch (e) {
            logger.error(
              `CDP 事件处理器异常: method=${msg.method} ${e}`,
            );
          }
        }
      }
    }
  }

  private failAllPending(err: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }
}
