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

/** Windows 下给 shell 命令行转义单个参数 */
function quoteWinArg(arg: string): string {
  if (!/[\s"&|<>^]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function run(cmd: string, args: string[]): { ok: boolean; output: string } {
  try {
    // Windows 上 .cmd/.bat 不能被 execFile 直接启动，必须经 shell
    const viaShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd);
    const output = viaShell
      ? execFileSync([cmd, ...args.map(quoteWinArg)].join(' '), {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 120_000,
          shell: true,
        })
      : execFileSync(cmd, args, {
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

/** 主通道：从 Open VSX 下载 vsix 后本地安装（不依赖 Trae 的商店源） */
export async function installFromOpenVsx(
  cliCommand: string,
  version?: string,
): Promise<{ ok: boolean; output: string }> {
  const apiBase = `https://open-vsx.org/api/${EXTENSION_ID.replace('.', '/')}`;
  const target = version ?? 'latest';
  try {
    const metaResp = await fetch(`${apiBase}/${target}`, { redirect: 'follow' });
    if (!metaResp.ok) {
      return {
        ok: false,
        output: `Open VSX 查询失败: HTTP ${metaResp.status}（${target}）`,
      };
    }
    const meta = (await metaResp.json()) as { files?: { download?: string } };
    const url = meta.files?.download;
    if (!url) {
      return { ok: false, output: `Open VSX 未返回 ${target} 的下载直链` };
    }
    return downloadAndInstall(url, 'Open VSX', cliCommand);
  } catch (e) {
    return { ok: false, output: `Open VSX 安装失败: ${(e as Error).message}` };
  }
}

/** 可选：让 Trae 从它自己的商店源安装（仅当扩展已上架、或用户已配置 Open VSX 源） */
export function installFromStore(cliCommand: string): {
  ok: boolean;
  output: string;
} {
  return run(cliCommand, ['--install-extension', EXTENSION_ID]);
}

/** 离线安装：直接装本地 vsix，不经过任何网络请求 */
export function installFromVsixFile(
  vsixPath: string,
  cliCommand: string,
): { ok: boolean; output: string } {
  if (!fs.existsSync(vsixPath)) {
    return { ok: false, output: `vsix 文件不存在: ${vsixPath}` };
  }
  return run(cliCommand, ['--install-extension', vsixPath]);
}

/**
 * 安装后轮询等待版本达标。
 * Trae 运行时 `--install-extension` 会把请求交给主进程后立即退出，
 * 实际安装是异步的，所以不能安装完立刻判断版本。
 */
export async function waitForVersion(
  cliCommand: string,
  expected: string | null,
  timeoutMs = 30_000,
  intervalMs = 2_000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  do {
    const now = getInstalledExtensionVersion(cliCommand);
    if (now && (!expected || compareVersions(now, expected) >= 0)) return now;
    await new Promise((r) => setTimeout(r, intervalMs));
  } while (Date.now() < deadline);
  return getInstalledExtensionVersion(cliCommand);
}

/** 稳定的 vsix 缓存目录：不用 %TEMP%（可能被系统清理/杀软拦截） */
function cacheDir(): string {
  const base = process.env.LOCALAPPDATA ?? os.tmpdir();
  const dir = path.join(base, 'parallelagent', 'cache');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 下载 .vsix 到稳定缓存目录并本地安装 */
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
    const nameFromUrl = path.basename(new URL(url).pathname);
    const vsixPath = path.join(
      cacheDir(),
      nameFromUrl || `parallelagent-orchestrator-${Date.now()}.vsix`,
    );
    const bytes = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(vsixPath, bytes);
    if (!fs.existsSync(vsixPath) || fs.statSync(vsixPath).size === 0) {
      return { ok: false, output: `${label} 下载后文件写入失败: ${vsixPath}` };
    }
    const r = run(cliCommand, ['--install-extension', vsixPath]);
    if (!r.ok) {
      return {
        ok: false,
        output: `${r.output}\n已保留 vsix: ${vsixPath}（可用 --vsix 该路径离线安装）`,
      };
    }
    return r;
  } catch (e) {
    return { ok: false, output: `${label} 下载失败: ${(e as Error).message}` };
  }
}

/** 兜底：从 GitHub Release 下载 .vsix 到稳定缓存目录，再本地安装 */
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
