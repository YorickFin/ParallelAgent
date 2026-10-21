// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * 扩展安装：Open VSX 主通道 + GitHub Release 直链 .vsix 兜底
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const EXTENSION_ID = 'yorickfin.parallelagent-orchestrator';
const VSIX_FILENAME = 'parallelagent-orchestrator.vsix';
const RELEASE_LATEST_URL = `https://github.com/YorickFin/ParallelAgent/releases/latest/download/${VSIX_FILENAME}`;

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

/** 兜底：从 GitHub Release 下载 .vsix 到 %TEMP%，再本地安装 */
export async function installFromGithubRelease(
  cliCommand: string,
): Promise<{ ok: boolean; output: string }> {
  const vsixPath = path.join(os.tmpdir(), VSIX_FILENAME);
  const resp = await fetch(RELEASE_LATEST_URL, { redirect: 'follow' });
  if (!resp.ok) {
    return {
      ok: false,
      output: `下载 vsix 失败: HTTP ${resp.status} (${RELEASE_LATEST_URL})`,
    };
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(vsixPath, buf);
  return run(cliCommand, ['--install-extension', vsixPath]);
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
