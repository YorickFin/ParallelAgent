// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * 扩展安装：Open VSX 主通道 + GitHub Release 兜底
 *
 * 调用 Trae 优先直连 exe（`Trae CN.exe <cli.js> ...`），
 * 不再经过 cmd.exe / trae-cn.cmd 批处理层：
 * 少两个进程、没有批处理引号与代码页问题。
 *
 * 版本判定以 `extensions.json` 磁盘状态为准，只在磁盘读不到时回退 CLI。
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXTENSION_ID = 'yorickfin.parallelagent-orchestrator';
const VSIX_FILENAME = 'parallelagent-orchestrator.vsix';
const RELEASE_LATEST_URL = `https://github.com/YorickFin/ParallelAgent/releases/latest/download/${VSIX_FILENAME}`;

/** 调用 Trae 的两个入口：exe 直连（优先）/ .cmd 兜底 */
export interface TraeTarget {
  exePath: string | null;
  cliCommand: string | null;
}

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

/** 直连 exe 时需要跑的脚本：`<exe 同级>/resources/app/out/cli.js` */
export function cliScriptPath(exePath: string | null): string | null {
  if (!exePath) return null;
  const script = path.join(path.dirname(exePath), 'resources', 'app', 'out', 'cli.js');
  try {
    return fs.statSync(script).isFile() ? script : null;
  } catch {
    return null;
  }
}

/** 是否有可用的调用入口（直连 exe 或 .cmd） */
export function hasTraeCli(target: TraeTarget): boolean {
  return cliScriptPath(target.exePath) !== null || target.cliCommand !== null;
}

/** Windows 下给 shell 命令行转义单个参数 */
function quoteWinArg(arg: string): string {
  if (!/[\s"&|<>^]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function run(
  target: TraeTarget,
  args: string[],
): { ok: boolean; output: string } {
  const script = cliScriptPath(target.exePath);
  try {
    // 直连 exe：等价于 trae-cn.cmd 里做的 ELECTRON_RUN_AS_NODE + exe + cli.js
    if (target.exePath && script) {
      const output = execFileSync(target.exePath, [script, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120_000,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' },
      });
      return { ok: true, output };
    }

    const cmd = target.cliCommand;
    if (!cmd) return { ok: false, output: '未找到 Trae exe 或 CLI 命令' };

    // 兜底：Windows 上 .cmd/.bat 不能被 execFile 直接启动，必须经 shell
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
    const err = e as {
      stdout?: string;
      stderr?: string;
      message?: string;
      status?: number | null;
    };
    const status = err.status ?? 'null';
    return {
      ok: false,
      output: `exit=${status}\n${err.stdout ?? ''}${err.stderr ?? ''}${err.message ?? ''}`,
    };
  }
}

/** `.obsolete` 里登记的是目录名（小写），被标记的即将删除，不算已安装 */
function readObsolete(extRoot: string): Set<string> {
  try {
    const raw = fs.readFileSync(path.join(extRoot, '.obsolete'), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return new Set(Object.keys(parsed).map((k) => k.toLowerCase()));
  } catch {
    return new Set();
  }
}

/** 直接读磁盘：extensions.json 是扩展注册的权威来源 */
export function readInstalledFromDisk(dataDir: string | null): string | null {
  if (!dataDir) return null;
  const extRoot = path.join(dataDir, 'extensions');
  try {
    const raw = fs.readFileSync(path.join(extRoot, 'extensions.json'), 'utf8');
    const list = JSON.parse(raw) as Array<{
      identifier?: { id?: string };
      version?: string;
    }>;
    const entry = list.find(
      (e) => e.identifier?.id?.toLowerCase() === EXTENSION_ID,
    );
    if (!entry?.version) return null;
    const dirName = `${EXTENSION_ID}-${entry.version}`.toLowerCase();
    if (readObsolete(extRoot).has(dirName)) return null;
    return entry.version;
  } catch {
    return null;
  }
}

/** 查询已安装扩展版本：磁盘优先，读不到再问 Trae CLI */
export function getInstalledExtensionVersion(
  target: TraeTarget,
  dataDir: string | null,
): string | null {
  const onDisk = readInstalledFromDisk(dataDir);
  if (onDisk) return onDisk;

  const { ok, output } = run(target, ['--list-extensions', '--show-versions']);
  if (!ok) return null;
  const prefix = `${EXTENSION_ID.toLowerCase()}@`;
  const line = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.toLowerCase().startsWith(prefix));
  return line ? line.slice(line.indexOf('@') + 1) : null;
}

/** 是否已安装扩展 */
export function isExtensionInstalled(
  target: TraeTarget,
  dataDir: string | null,
): boolean {
  if (readInstalledFromDisk(dataDir)) return true;

  const { ok, output } = run(target, ['--list-extensions']);
  if (!ok) return false;
  return output
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase())
    .includes(EXTENSION_ID.toLowerCase());
}

/**
 * 安装后轮询等待版本达标。
 * Trae 运行时 `--install-extension` 会把请求交给主进程后立即退出，
 * 实际写入 `extensions.json` 是异步的，所以以磁盘为准轮询（300ms 一次）。
 */
export async function waitForVersion(
  target: TraeTarget,
  dataDir: string | null,
  expected: string | null,
  timeoutMs = 30_000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  do {
    const now = readInstalledFromDisk(dataDir);
    if (now && (!expected || compareVersions(now, expected) >= 0)) return now;
    await new Promise((r) => setTimeout(r, 300));
  } while (Date.now() < deadline);
  return getInstalledExtensionVersion(target, dataDir);
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
  target: TraeTarget,
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
    // --force：已安装同/旧版本时也强制覆盖，避免静默 no-op
    const r = run(target, ['--install-extension', vsixPath, '--force']);
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

/** 主通道：从 Open VSX 下载 vsix 后本地安装（不依赖 Trae 的商店源） */
export async function installFromOpenVsx(
  target: TraeTarget,
  version?: string,
): Promise<{ ok: boolean; output: string }> {
  const apiBase = `https://open-vsx.org/api/${EXTENSION_ID.replace('.', '/')}`;
  const wanted = version ?? 'latest';
  try {
    const metaResp = await fetch(`${apiBase}/${wanted}`, { redirect: 'follow' });
    if (!metaResp.ok) {
      return {
        ok: false,
        output: `Open VSX 查询失败: HTTP ${metaResp.status}（${wanted}）`,
      };
    }
    const meta = (await metaResp.json()) as { files?: { download?: string } };
    const url = meta.files?.download;
    if (!url) {
      return { ok: false, output: `Open VSX 未返回 ${wanted} 的下载直链` };
    }
    return downloadAndInstall(url, 'Open VSX', target);
  } catch (e) {
    return { ok: false, output: `Open VSX 安装失败: ${(e as Error).message}` };
  }
}

/** 可选：让 Trae 从它自己的商店源安装（仅当扩展已上架、或用户已配置 Open VSX 源） */
export function installFromStore(target: TraeTarget): {
  ok: boolean;
  output: string;
} {
  return run(target, ['--install-extension', EXTENSION_ID, '--force']);
}

/** 离线安装：直接装本地 vsix，不经过任何网络请求 */
export function installFromVsixFile(
  vsixPath: string,
  target: TraeTarget,
): { ok: boolean; output: string } {
  if (!fs.existsSync(vsixPath)) {
    return { ok: false, output: `vsix 文件不存在: ${vsixPath}` };
  }
  return run(target, ['--install-extension', vsixPath, '--force']);
}

/** 兜底：从 GitHub Release 下载 .vsix 到稳定缓存目录，再本地安装 */
export async function installFromGithubRelease(
  target: TraeTarget,
): Promise<{ ok: boolean; output: string }> {
  return downloadAndInstall(RELEASE_LATEST_URL, 'GitHub Release', target);
}
