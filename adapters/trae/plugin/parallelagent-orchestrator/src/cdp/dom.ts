// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

import { CdpClient } from './cdpClient';
import { AnchorNotFound } from '../errors';
import * as logger from '../logger';

/**
 * Runtime.evaluate 薄封装
 * 定稿 §8.3：returnByValue=true，可选 awaitPromise
 */

export interface EvalResult {
  value: unknown;
  type: string;
  unserializableValue?: string;
  description?: string;
  objectId?: string;
}

/**
 * 执行 JS 表达式，返回 by-value 结果
 * @throws 如果 evaluate 返回异常或响应包含 error
 */
export async function evalExpression(
  client: CdpClient,
  expression: string,
  options: { awaitPromise?: boolean; timeoutMs?: number } = {},
): Promise<unknown> {
  const { awaitPromise = false, timeoutMs } = options;

  const resp = await client.send(
    'Runtime.evaluate',
    {
      expression,
      returnByValue: true,
      awaitPromise,
    },
    timeoutMs,
  );

  if (resp.error) {
    throw new Error(
      `Runtime.evaluate error: ${JSON.stringify(resp.error)}`,
    );
  }

  const result = resp.result as {
    result?: { value?: unknown; type?: string; description?: string; objectId?: string; unserializableValue?: string };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  };

  if (result?.exceptionDetails) {
    const detail = result.exceptionDetails;
    const msg =
      detail.text ??
      detail.exception?.description ??
      JSON.stringify(detail);
    logger.error(`Runtime.evaluate 异常: ${msg}`);
    throw new Error(`JS 执行异常: ${msg}`);
  }

  return result?.result?.value;
}

/**
 * 查询元素是否存在
 * 返回 'CSS selector 查到的元素个数'（0 = 不存在）
 */
export async function countElements(
  client: CdpClient,
  selector: string,
): Promise<number> {
  const expr = `(()=>{return document.querySelectorAll(${JSON.stringify(selector)}).length;})()`;
  const count = await evalExpression(client, expr);
  return typeof count === 'number' ? count : 0;
}

/**
 * 确保元素存在，否则抛 AnchorNotFound（fail-stop）
 */
export async function assertAnchor(
  client: CdpClient,
  selector: string,
  label: string,
): Promise<void> {
  const count = await countElements(client, selector);
  if (count === 0) {
    throw new AnchorNotFound(
      `找不到 DOM 锚点 [${label}]: selector=${selector}`,
    );
  }
  logger.debug(`锚点 [${label}] 存在: count=${count} selector=${selector}`);
}
