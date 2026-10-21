// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * 扩展安装：Open VSX 主通道 + GitHub Release 兜底
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXTENSION_ID = 'yorickfin.parallelagent-orchestrator';
const VSIX_FILENAME = 'parallelagent-orchestrator.vsix';
const RELEASE_LATEST_URL = `https://github.com/YorickFin/ParallelAgent/releases/latest/download/${VSIX_FILENAME}`;

/** CLI 与扩展同版本发布，用 CLI 自身版本作为期望扩展版本 */
function readOwnVersion(): string | null {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.join(here, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

export const EXPECTED_EXTENSION_VERSION = readOwnVersion();

/** 语义化版本比较：a > b → 1，a == b → 0，a < b → -1 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

function run(cmd: string, args: string[]): { ok: boolean; output: string } {
  try {
    const output = execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    return { ok: true, output };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      output: `${err.stdout ?? ''}${err.stderr ?? ''}${err.message ?? ''}`,
    };
  }
}

/** 主通道：trae --install-extension（Trae 默认从 Open VSX 拉取） */
export function installFromOpenVsx(cliCommand: string): {
  ok: boolean;
  output: string;
} {
  return run(cliCommand, ['--install-extension', EXTENSION_ID]);
}

/** 下载 .vsix 到临时目录并本地安装 */
async function downloadAndInstall(
  url: string,
  label: string,
  cliCommand: string,
): Promise<{ ok: boolean; output: string }> {
  try {
    const resp = await fetch(url, { redirect: 'follow' });
    if (!resp.ok) {
      return { ok: false, output: `${label} 下载失败: HTTP ${resp.status} (${url})` };
    }
    const vsixPath = path.join(os.tmpdir(), VSIX_FILENAME);
    fs.writeFileSync(vsixPath, Buffer.from(await resp.arrayBuffer()));
    return run(cliCommand, ['--install-extension', vsixPath]);
  } catch (e) {
    return { ok: false, output: `${label} 下载失败: ${(e as Error).message}` };
  }
}

/** 兜底：从 GitHub Release 下载 .vsix 到 %TEMP%，再本地安装 */
export async function installFromGithubRelease(
  cliCommand: string,
): Promise<{ ok: boolean; output: string }> {
  return downloadAndInstall(RELEASE_LATEST_URL, 'GitHub Release', cliCommand);
}

/** 查询已安装扩展版本（无则返回 null） */
export function getInstalledExtensionVersion(cliCommand: string): string | null {
  const { ok, output } = run(cliCommand, ['--list-extensions', '--show-versions']);
  if (!ok) return null;
  const prefix = `${EXTENSION_ID.toLowerCase()}@`;
  const line = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.toLowerCase().startsWith(prefix));
  return line ? line.slice(line.indexOf('@') + 1) : null;
}

/** 是否已安装扩展（trae --list-extensions 查 EXTENSION_ID） */
export function isExtensionInstalled(cliCommand: string): boolean {
  const { ok, output } = run(cliCommand, ['--list-extensions']);
  if (!ok) return false;
  return output
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase())
    .includes(EXTENSION_ID.toLowerCase());
}
