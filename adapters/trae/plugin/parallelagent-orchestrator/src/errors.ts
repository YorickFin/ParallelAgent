// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * 统一错误类型 —— 所有 fail-stop 场景抛出这些错误。
 * HTTP routes 层 catch 后返回 `{ ok: false, err, type }` 并写 alert.signal。
 */

export class ParallelAgentError extends Error {
  /** 用于 HTTP 返回的错误类型标识 */
  readonly errorType: string;

  constructor(message: string, errorType: string) {
    super(message);
    this.name = this.constructor.name;
    this.errorType = errorType;
  }

  /** 转为 HTTP 返回体 */
  toResponse(): { ok: false; err: string; type: string } {
    return { ok: false, err: this.message, type: this.errorType };
  }
}

/** 找不到 DOM 锚点 —— fail-stop，不盲点 */
export class AnchorNotFound extends ParallelAgentError {
  constructor(message: string) {
    super(message, 'anchor_not_found');
  }
}

/** 身份断言失败 —— sid 不匹配，禁止盲发 */
export class IdentityMismatch extends ParallelAgentError {
  constructor(expected: string, actual: string) {
    super(
      `身份断言失败: 期望 sid=${expected}, 实际 sid=${actual}`,
      'identity_mismatch',
    );
  }
}

/** CDP 连接断开 */
export class CdpDisconnected extends ParallelAgentError {
  constructor(message = 'CDP 连接断开') {
    super(message, 'cdp_disconnected');
  }
}

/** watch 超时 */
export class WatchTimeout extends ParallelAgentError {
  constructor(message = 'watch 超时') {
    super(message, 'watch_timeout');
  }
}

/** 控制信号格式无效 */
export class SignalInvalid extends ParallelAgentError {
  constructor(message: string) {
    super(message, 'signal_invalid');
  }
}
