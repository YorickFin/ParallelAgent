// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * argv.json 读-改-写（增量合并，绝不整文件覆盖，保留用户注释）
 *
 * argv.json 是 JSONC（VS Code 系允许 // 与 块注释），因此：
 * - 读：注释/尾逗号容忍解析
 * - 写：在原文上做外科手术式 upsert / 删除，保留其他键与注释
 *
 * 注意：与 packages/cli/src/lib/argvJson.ts 为同一逻辑的两份实现，
 * 修改时请保持同步。
 */

import * as fs from 'fs';

export type ArgvJson = Record<string, unknown>;

// ── JSONC 解析 ─────────────────────────────────────────

/** 去掉字符串之外的 // 与 块注释 */
function stripJsonComments(s: string): string {
  return s.replace(
    /\\"|"(?:\\"|[^"])*"|(\/\/[^\n\r]*|\/\*[\s\S]*?\*\/)/g,
    (m, g) => (g ? '' : m),
  );
}

/** 去掉字符串之外的尾逗号 */
function stripTrailingCommas(s: string): string {
  return s.replace(
    /\\"|"(?:\\"|[^"])*"|,(?=\s*[}\]])/g,
    (m) => (m.startsWith(',') ? '' : m),
  );
}

/** 注释/尾逗号容忍的 JSON 解析；失败返回 null */
function parseJsonc(raw: string): ArgvJson | null {
  try {
    const parsed = JSON.parse(stripTrailingCommas(stripJsonComments(raw)));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ArgvJson;
    }
    return null;
  } catch {
    return null;
  }
}

// ── 公共 API ───────────────────────────────────────────

/** 读取 argv.json；文件不存在或解析失败时返回空对象 */
export function readArgvJson(argvPath: string): ArgvJson {
  try {
    const raw = fs.readFileSync(argvPath, 'utf8');
    return parseJsonc(raw) ?? {};
  } catch {
    return {};
  }
}

/**
 * 增量合并写入 argv.json（保留原文注释与其他键）。
 * 写前备份为 `<argvPath>.parallelagent-bak`（每次写都刷新备份）。
 */
export function writeArgvJson(argvPath: string, patch: ArgvJson): void {
  const raw = fs.existsSync(argvPath)
    ? fs.readFileSync(argvPath, 'utf8')
    : '';

  if (fs.existsSync(argvPath)) {
    fs.copyFileSync(argvPath, `${argvPath}.parallelagent-bak`);
  }

  let updated = raw;
  for (const [key, value] of Object.entries(patch)) {
    updated = upsertKey(updated, key, value);
  }
  fs.writeFileSync(argvPath, updated, 'utf8');
}

/**
 * 幂等确保 remote-debugging-port 键存在。
 * 已实测字符串形式（"9317"）在 Trae CN 生效，统一写字符串。
 *
 * @returns true 表示发生了写入；false 表示已是目标值无需改动
 */
export function ensureRemoteDebuggingPort(
  argvPath: string,
  port: number,
): boolean {
  const current = readArgvJson(argvPath);
  const existing = current['remote-debugging-port'];
  if (existing === String(port) || existing === port) return false;
  writeArgvJson(argvPath, { 'remote-debugging-port': String(port) });
  return true;
}

/** 移除 remote-debugging-port 键（只删这一个键，其他键与注释保留） */
export function removeRemoteDebuggingPort(argvPath: string): boolean {
  if (!fs.existsSync(argvPath)) return false;
  const raw = fs.readFileSync(argvPath, 'utf8');
  const current = parseJsonc(raw);
  if (!current || !('remote-debugging-port' in current)) return false;

  fs.copyFileSync(argvPath, `${argvPath}.parallelagent-bak`);

  // 删除整行（含行尾逗号），再清理可能残留的尾逗号
  const removed = raw.replace(
    /^[ \t]*"remote-debugging-port"[ \t]*:[ \t]*("(?:[^"\\]|\\.)*"|[^,\n\r}]+)[ \t]*,?[ \t]*\r?\n?/m,
    '',
  );
  fs.writeFileSync(argvPath, cleanupTrailingComma(removed), 'utf8');
  return true;
}

// ── 内部工具 ───────────────────────────────────────────

/** 在原文中 upsert 一个键（保留注释）；值写为 JSON 字面量 */
function upsertKey(raw: string, key: string, value: unknown): string {
  const literal = JSON.stringify(value);
  const keyRe = new RegExp(
    `("${escapeRe(key)}"[ \t]*:[ \t]*)("(?:[^"\\\\]|\\\\.)*"|[^,\\n\\r}]+)`,
  );

  if (keyRe.test(raw)) {
    // 键已存在：原位替换值
    return raw.replace(keyRe, `$1${literal}`);
  }

  // 键不存在：插入到最后一个 } 之前
  const closeIdx = raw.lastIndexOf('}');
  if (closeIdx === -1) {
    return `{\n  "${key}": ${literal}\n}\n`;
  }

  const before = raw.slice(0, closeIdx);
  const after = raw.slice(closeIdx);
  // 判断对象是否为空（忽略注释与空白后，} 前最后一个字符是 {）
  const strippedBefore = stripJsonComments(before).trimEnd();
  const isEmpty = strippedBefore.endsWith('{');
  const needsComma = !isEmpty && !strippedBefore.endsWith(',');

  const indent = '  ';
  const entry = `${needsComma ? ',' : ''}\n${indent}"${key}": ${literal}`;
  return before.trimEnd() + entry + '\n' + after;
}

/** 清理字符串之外的尾逗号（删除键后可能残留） */
function cleanupTrailingComma(raw: string): string {
  return stripTrailingCommas(raw);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
