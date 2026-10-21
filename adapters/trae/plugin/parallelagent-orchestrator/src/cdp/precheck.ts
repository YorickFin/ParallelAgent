// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

/** CDP 连通性预检 */

/**
 * ping CDP 端口：fetch `http://127.0.0.1:${port}/json/version`
 * @returns true 表示端口可达且返回合法 JSON
 */
export async function pingCdp(
  port: number,
  timeoutMs = 2000,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: controller.signal,
    });
    if (!resp.ok) return false;
    const body = (await resp.json()) as { Browser?: string };
    return typeof body.Browser === 'string';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
