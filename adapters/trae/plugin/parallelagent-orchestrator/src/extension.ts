// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as path from 'path';
import * as child_process from 'child_process';
import * as fs from 'fs';

import * as logger from './logger';
import { readConfig, ParallelAgentConfig } from './state/config';
import { CdpClient } from './cdp/cdpClient';
import { discoverAndConnect, CdpTarget } from './cdp/cdpTarget';
import { createHttpServer } from './http/server';
import { buildPhrase, type RouteDeps } from './http/routes';
import { OrbitTable } from './state/orbitTable';
import { MailboxPaths } from './mailbox/paths';
import { ReceiptWatcher } from './mailbox/watcher';
import { WatchJobManager } from './mailbox/watchJob';
import { Notifier } from './cdp/notifier';
import {
  clearLock,
  isProcessAlive,
  readLock,
  sameWorkspace,
  writeLock,
} from './state/projectLock';
import { detectArgvJsonPath } from './state/traePaths';
import { ensureRemoteDebuggingPort } from './state/argvJson';

// ── 模块实例（后续步骤填充） ──────────────────────────
let httpServer: { close(): void; ready: Promise<void> } | null = null;
let cdpClient: CdpClient | null = null;
let cdpTarget: CdpTarget | null = null;
let fileWatcher: { dispose(): void } | null = null;
let watchJobs: WatchJobManager | null = null;
let orbitTable: OrbitTable | null = null;
let routeDeps: RouteDeps | null = null;
let currentConfig: ParallelAgentConfig | null = null;
let statusBar: vscode.StatusBarItem | null = null;
let autoStartTimer: ReturnType<typeof setTimeout> | null = null;
/** 最近一次 CDP 连接错误（用于识别 ECONNREFUSED） */
let lastCdpError: string | null = null;
/** 「立即重启」提示冷却，避免自动启动与手动重连连续弹窗 */
let lastRefusedPromptAt = 0;

/** 自动启动延迟：等 Work 页面与工作区就绪 */
const AUTO_START_DELAY_MS = 2500;
/** CDP 连接重试间隔 */
const CDP_RETRY_INTERVAL_MS = 2000;
/** 自动启动时等待 Agent 页出现的重试次数（15 次 × 2s ≈ 30s） */
const AUTO_START_CDP_RETRIES = 15;
/** 用户主动停止后不再自动启动（workspaceState） */
const AUTO_START_DISABLED_KEY = 'parallelagent.autoStartDisabled';

type StatusState =
  | 'hidden'
  | 'starting'
  | 'running'
  | 'cdp_down'
  | 'other_window'
  | 'port_conflict'
  | 'stopped';

/** 状态栏：自动启动路径的唯一可见反馈 */
function setStatus(state: StatusState, detail?: string): void {
  if (!statusBar) return;
  if (state === 'hidden') {
    statusBar.hide();
    return;
  }

  const presets: Record<
    Exclude<StatusState, 'hidden'>,
    { icon: string; text: string; tip: string }
  > = {
    starting: {
      icon: '$(sync~spin)',
      text: 'PA · 启动中',
      tip: 'ParallelAgent 编排器正在启动',
    },
    running: {
      icon: '$(check)',
      text: 'PA · 127.0.0.1:9318',
      tip: '编排器运行中；点击可重试 CDP 连接',
    },
    cdp_down: {
      icon: '$(warning)',
      text: 'PA · CDP 未连接',
      tip: 'HTTP 网关已启动但 CDP 不可用；请先打开 Agent 页，再点击重试；或运行「ParallelAgent: 带调试端口重启 Trae」',
    },
    other_window: {
      icon: '$(circle-slash)',
      text: 'PA · 已在其他窗口运行',
      tip: '同一项目已有编排器实例',
    },
    port_conflict: {
      icon: '$(error)',
      text: 'PA · 端口 9318 被占用',
      tip: '端口被其他项目实例或其他程序占用',
    },
    stopped: {
      icon: '$(circle-slash)',
      text: 'PA · 已停止',
      tip: '本窗口已停止自动启动；点击可手动启动',
    },
  };

  const preset = presets[state];
  statusBar.text = `${preset.icon} ${preset.text}`;
  statusBar.tooltip = detail ? `${preset.tip}\n${detail}` : preset.tip;
  statusBar.show();
}

// ── 激活入口 ──────────────────────────────────────────

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  logger.initLogger(context);

  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBar.command = 'parallelagent.start';
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand('parallelagent.start', async () => {
      await context.workspaceState.update(AUTO_START_DISABLED_KEY, false);
      await startOrchestrator(context, { silent: false, cdpRetries: 10 });
    }),
    vscode.commands.registerCommand('parallelagent.stop', async () => {
      await context.workspaceState.update(AUTO_START_DISABLED_KEY, true);
      await stopOrchestrator({ userInitiated: true });
    }),
    vscode.commands.registerCommand('parallelagent.health', () =>
      healthCheck(),
    ),
    vscode.commands.registerCommand('parallelagent.restartWithDebug', () =>
      restartWithDebug(context),
    ),
  );

  logger.info('扩展已激活');
  scheduleAutoStart(context);
}

/** 自动启动判定 + 延迟启动（失败静默，状态栏承载） */
function scheduleAutoStart(context: vscode.ExtensionContext): void {
  const config = readConfig();
  const decision = shouldAutoStart(context, config);
  if (!decision.ok) {
    logger.audit('auto_start_skip', {
      reason: decision.reason,
      workspace: config.workspaceRoot,
    });
    setStatus('hidden');
    return;
  }

  setStatus('starting');
  autoStartTimer = setTimeout(() => {
    autoStartTimer = null;
    void startOrchestrator(context, {
      silent: true,
      cdpRetries: AUTO_START_CDP_RETRIES,
      requireWorkPage: true,
    });
  }, AUTO_START_DELAY_MS);

  context.subscriptions.push({
    dispose: () => {
      if (autoStartTimer) {
        clearTimeout(autoStartTimer);
        autoStartTimer = null;
      }
    },
  });
}

function shouldAutoStart(
  context: vscode.ExtensionContext,
  config: ParallelAgentConfig,
): { ok: boolean; reason: string } {
  if (!config.workspaceRoot) return { ok: false, reason: 'no-workspace' };
  if (config.autoStart === 'off') return { ok: false, reason: 'config-off' };
  if (context.workspaceState.get<boolean>(AUTO_START_DISABLED_KEY, false)) {
    return { ok: false, reason: 'user-stopped' };
  }
  if (config.autoStart === 'auto' && !fs.existsSync(config.mailboxRoot)) {
    return { ok: false, reason: 'no-mailbox' };
  }
  return { ok: true, reason: 'auto' };
}

// ── 命令实现 ───────────────────────────────────────────

interface StartOptions {
  /** 自动启动路径为 true：不弹任何提示框，状态栏承载结果 */
  silent?: boolean;
  /** CDP 连接尝试次数 */
  cdpRetries?: number;
  /** 只接受 solo-lite 的 Agent 页；默认保留「管理员」兜底 */
  requireWorkPage?: boolean;
}

async function startOrchestrator(
  context: vscode.ExtensionContext,
  opts: StartOptions = {},
): Promise<void> {
  const silent = opts.silent ?? false;
  const cdpRetries = opts.cdpRetries ?? 1;
  const requireWorkPage = opts.requireWorkPage ?? false;
  const config = readConfig();
  currentConfig = config;
  setStatus('starting');

  // 已在运行：只重试 CDP（修好端口后无需先停再启）
  if (httpServer && routeDeps) {
    logger.info('编排器已在运行，重试 CDP 连接...');
    const connected = await connectCdpWithRetry(
      config,
      routeDeps,
      cdpRetries,
      requireWorkPage,
    );
    setStatus(connected ? 'running' : 'cdp_down');
    if (!connected) {
      const prompted = await promptRestartIfPortRefused(context);
      if (!prompted && !silent) {
        vscode.window.showInformationMessage(
          `ParallelAgent 编排器已在运行（HTTP 127.0.0.1:${config.httpPort}），CDP 仍不可达`,
        );
      }
    } else if (!silent) {
      vscode.window.showInformationMessage(
        'ParallelAgent 编排器已在运行，CDP 已连接',
      );
    }
    return;
  }

  // 项目锁：同一项目只允许一个编排器实例
  const lock = readLock(config.mailboxRoot);
  if (
    lock &&
    lock.pid !== process.pid &&
    isProcessAlive(lock.pid) &&
    sameWorkspace(lock.workspace, config.workspaceRoot)
  ) {
    logger.audit('lock_conflict', lock);
    setStatus('other_window', `PID ${lock.pid} · ${lock.workspace}`);
    if (!silent) {
      vscode.window.showWarningMessage(
        `ParallelAgent 编排器已在另一窗口运行（PID ${lock.pid}）`,
      );
    }
    return;
  }

  // 端口探测：区分本项目实例、其他项目实例与其他程序
  const health = await probeHealth(config.httpPort);
  if (health?.ok) {
    const healthWorkspace =
      typeof health.workspace === 'string' ? health.workspace : '';
    if (sameWorkspace(healthWorkspace, config.workspaceRoot)) {
      // 锁丢失但实例仍在：补写锁并复用
      if (typeof health.pid === 'number' && health.pid > 0) {
        writeLock(config.mailboxRoot, {
          pid: health.pid,
          port: config.httpPort,
          workspace: config.workspaceRoot,
          startedAt: new Date().toISOString(),
          version: context.extension.packageJSON.version as string,
        });
      }
      logger.audit('adopt_existing_instance', { port: config.httpPort });
      setStatus('running');
      if (!silent) {
        vscode.window.showInformationMessage(
          `ParallelAgent 编排器已在本项目的另一窗口运行（127.0.0.1:${config.httpPort}）`,
        );
      }
      return;
    }

    logger.audit('port_conflict', {
      port: config.httpPort,
      otherWorkspace: healthWorkspace,
    });
    setStatus('port_conflict', `被 ${healthWorkspace || '其他项目'} 占用`);
    if (!silent) {
      vscode.window.showErrorMessage(
        `ParallelAgent 端口 ${config.httpPort} 已被其他项目占用（${healthWorkspace || '未知项目'}）`,
      );
    }
    return;
  }

  logger.info(`编排器启动中... CDP=${config.cdpPort} HTTP=${config.httpPort}`);

  // 步骤 1: 数据面 + HTTP 网关先起——CDP 挂掉时 /health 仍须可诊断
  orbitTable = new OrbitTable(
    path.join(context.globalStorageUri.fsPath, 'orbit-table.json'),
  );

  const mailboxPaths = new MailboxPaths(config.mailboxRoot);
  ensureMailboxSkeleton(config.mailboxRoot);
  const watcher = new ReceiptWatcher(mailboxPaths, config.pollIntervalMs);
  fileWatcher = watcher;

  const projectName =
    vscode.workspace.workspaceFolders?.[0]?.name ?? 'ParallelAgent';

  // 通知器：空闲 + 输入框为空时注入固定话术唤醒仲裁者
  const notifier = new Notifier({
    getCdp: () => routeDeps?.cdp ?? null,
    getArbiterSid: () => orbitTable?.getArbiter()?.sid ?? null,
    buildPhrase: (req) =>
      buildPhrase(req.类型 === 'alert' ? 'watch_alert' : 'watch_notify', {
        轮次: req.轮次,
        版本: req.版本,
        job: req.jobId,
      }),
    alertSignalPath: mailboxPaths.alertSignal,
  });

  // 回执等待 job 管理器：等待状态留在插件进程，不占用 AI 回合
  const jobs = new WatchJobManager({
    paths: mailboxPaths,
    pollIntervalMs: config.pollIntervalMs,
    defaultTimeoutS: config.watchTimeoutS,
    notify: (req) => notifier.notify(req),
    degrade: (req) => void notifier.notify({ ...req, 降级: true }),
  });
  watchJobs = jobs;

  routeDeps = {
    cdp: null,
    orbit: orbitTable,
    watcher,
    jobs,
    projectName,
    workspace: config.workspaceRoot,
  };
  const server = createHttpServer(config.httpPort, routeDeps);
  httpServer = server;

  try {
    await server.ready;
  } catch (e) {
    const msg = (e as Error).message;
    logger.audit('port_conflict', { port: config.httpPort, err: msg });
    setStatus('port_conflict', msg);
    httpServer = null;
    fileWatcher?.dispose();
    fileWatcher = null;
    watchJobs = null;
    orbitTable = null;
    routeDeps = null;
    if (!silent) {
      vscode.window.showErrorMessage(
        `ParallelAgent 端口 ${config.httpPort} 启动失败：${msg}`,
      );
    }
    return;
  }

  writeLock(config.mailboxRoot, {
    pid: process.pid,
    port: config.httpPort,
    workspace: config.workspaceRoot,
    startedAt: new Date().toISOString(),
    version: context.extension.packageJSON.version as string,
  });

  jobs.start();

  // 步骤 2: 再连 CDP；失败只告警，HTTP 网关保持可用
  const connected = await connectCdpWithRetry(
    config,
    routeDeps,
    cdpRetries,
    requireWorkPage,
  );
  setStatus(connected ? 'running' : 'cdp_down');

  if (!connected) {
    // ECONNREFUSED 说明 Trae 本次启动没绑定端口，提示重启（下次启动可恢复）
    const prompted = await promptRestartIfPortRefused(context);
    if (!prompted && !silent) {
      vscode.window.showWarningMessage(
        `ParallelAgent HTTP 网关已启动（127.0.0.1:${config.httpPort}），但 CDP ${config.cdpPort} 连接失败。` +
          '运行"带调试端口重启 Trae"后，再次执行启动命令即可重试连接。',
      );
    }
  } else if (!silent) {
    logger.info('编排器已启动');
    vscode.window.showInformationMessage('ParallelAgent 编排器已启动');
  }

  if (silent) {
    logger.audit('auto_start', { port: config.httpPort, cdp: connected });
  }
}

/** 判断最近一次 CDP 失败是否为端口未监听 */
function isPortRefused(err: string | null): boolean {
  return !!err && err.includes('ECONNREFUSED');
}

/**
 * ECONNREFUSED：Trae 本次启动未绑定调试端口，下次完整重启可恢复。
 * 返回是否已弹出提示（用于避免同时再弹普通失败提示）。
 */
async function promptRestartIfPortRefused(
  context: vscode.ExtensionContext,
): Promise<boolean> {
  if (!isPortRefused(lastCdpError)) return false;
  const now = Date.now();
  if (now - lastRefusedPromptAt < 30_000) return false;
  lastRefusedPromptAt = now;

  const choice = await vscode.window.showWarningMessage(
    'ParallelAgent：频繁重启导致 CDP 端口绑定失败，下次重启后恢复。',
    '立即重启',
    '忽略',
  );
  if (choice === '立即重启') {
    await restartWithDebug(context, { delaySeconds: 0 });
  }
  return true;
}

/** 探测 9318 上的实例；不可达返回 null */
async function probeHealth(
  port: number,
): Promise<{ ok?: boolean; workspace?: string; pid?: number } | null> {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as {
      ok?: boolean;
      workspace?: string;
      pid?: number;
    };
  } catch {
    return null;
  }
}

/** 连接 CDP 并回填到共享 deps；成功后 HTTP 路由立即具备执行能力 */
async function connectCdp(
  config: ParallelAgentConfig,
  deps: RouteDeps,
  requireWorkPage = false,
): Promise<boolean> {
  try {
    const { client, target } = await discoverAndConnect(config.cdpPort, {
      requireWorkPage,
    });
    cdpClient = client;
    cdpTarget = target;
    deps.cdp = client;
    lastCdpError = null;
    logger.audit('cdp_connect', {
      targetId: target.id,
      title: target.title,
      url: target.url,
    });
    return true;
  } catch (e) {
    const msg = (e as Error).message;
    lastCdpError = msg;
    logger.error(`CDP 连接失败: ${msg}`);
    logger.audit('cdp_connect_fail', { err: msg, requireWorkPage });
    return false;
  }
}

/** 等待固定毫秒 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 带重试的 CDP 连接：启动期 Work 页面可能尚未就绪 */
async function connectCdpWithRetry(
  config: ParallelAgentConfig,
  deps: RouteDeps,
  attempts: number,
  requireWorkPage = false,
): Promise<boolean> {
  const total = Math.max(1, attempts);
  for (let i = 0; i < total; i++) {
    if (await connectCdp(config, deps, requireWorkPage)) return true;
    if (i < total - 1) await sleep(CDP_RETRY_INTERVAL_MS);
  }
  return false;
}

interface StopOptions {
  /** true = 用户主动停止：显示提示并更新状态栏 */
  userInitiated?: boolean;
}

async function stopOrchestrator(opts: StopOptions = {}): Promise<void> {
  logger.info('编排器停止中...');

  httpServer?.close();
  httpServer = null;

  cdpClient?.disconnect();
  cdpClient = null;
  cdpTarget = null;

  fileWatcher?.dispose();
  fileWatcher = null;

  watchJobs?.dispose();
  watchJobs = null;

  // 释放项目锁，允许其他窗口接管
  const mailboxRoot = currentConfig?.mailboxRoot ?? readConfig().mailboxRoot;
  clearLock(mailboxRoot);

  orbitTable = null;
  routeDeps = null;
  currentConfig = null;

  if (opts.userInitiated) {
    setStatus('stopped');
  }

  logger.info('编排器已停止');
  if (opts.userInitiated) {
    vscode.window.showInformationMessage(
      'ParallelAgent 编排器已停止（本窗口不再自动启动）',
    );
  }
}

async function healthCheck(): Promise<void> {
  logger.info('健康检查...');

  if (!currentConfig) {
    logger.warn('编排器未启动');
    vscode.window.showWarningMessage('ParallelAgent 编排器未启动');
    return;
  }

  // 调 HTTP /health 端点
  try {
    const resp = await fetch(
      `http://127.0.0.1:${currentConfig.httpPort}/health`,
    );
    const result = await resp.json();
    logger.info(`健康检查结果: ${JSON.stringify(result)}`);
    logger.audit('health', result);
    vscode.window.showInformationMessage(
      `ParallelAgent 健康: cdp_alive=${(result as { cdp_alive?: boolean })?.cdp_alive ?? false}`,
    );
  } catch (e) {
    logger.error(`健康检查失败: ${(e as Error).message}`);
    vscode.window.showErrorMessage(
      `ParallelAgent 健康检查失败: ${(e as Error).message}`,
    );
  }
}

/**
 * A2：写 argv.json（持久化调试端口）+ 重启 Trae。
 * argv.json 一旦写入，之后任何入口启动 Trae 调试端口都自动就绪。
 */
interface RestartOptions {
  /** 杀进程前等待秒数，默认 8；错误提示里的「立即重启」传 0 */
  delaySeconds?: number;
}

async function restartWithDebug(
  context: vscode.ExtensionContext,
  opts: RestartOptions = {},
): Promise<void> {
  const delaySeconds = opts.delaySeconds ?? 8;
  const scriptPath = findRestartScript(context);
  if (!scriptPath) {
    vscode.window.showErrorMessage('找不到 restart-with-debug.ps1');
    return;
  }

  const cdpPort = readConfig().cdpPort;

  // 1. 探测 argv.json 路径
  const argvPath = detectArgvJsonPath();
  if (!argvPath) {
    vscode.window.showErrorMessage(
      'ParallelAgent：未探测到 Trae 用户数据目录（~/.trae-cn 或 ~/.trae）',
    );
    return;
  }

  // 2. 增量写入 remote-debugging-port（幂等）
  try {
    const written = ensureRemoteDebuggingPort(argvPath, cdpPort);
    logger.info(
      written
        ? `已写入 ${argvPath}: remote-debugging-port=${cdpPort}`
        : `argv.json 已含 remote-debugging-port=${cdpPort}，无需改动`,
    );
  } catch (e) {
    logger.error(`写 argv.json 失败: ${(e as Error).message}`);
    vscode.window.showErrorMessage(
      `ParallelAgent 写 argv.json 失败: ${(e as Error).message}`,
    );
    return;
  }

  // 3. 通过 WMI 拉起 restart 脚本（脱离 Trae 进程树）
  // 必须用 WMI 拉起：child_process.exec 的子进程在 Trae 的 Job Object 里，
  // 脚本杀掉 Trae 时会被连带终止，Start-Process 永远执行不到。
  // WMI 创建的进程父进程是 WmiPrvSE，脱离 Trae 进程树。
  //
  // 注意：WMI 服务的环境里没有 PowerShell 的 PATH，CommandLine 直接写
  // `powershell` 会返回 ReturnValue=9（Path Not Found），脚本根本不会被拉起。
  // 因此必须用 powershell.exe 的绝对路径。
  const psExe = detectPowerShellPath();
  if (!psExe) {
    vscode.window.showErrorMessage(
      'ParallelAgent：找不到 powershell.exe，无法执行重启',
    );
    return;
  }

  logger.info(`写入完成，带调试端口 ${cdpPort} 重启 Trae...`);
  const exePath = process.execPath;
  const logPath = path.join(
    context.globalStorageUri.fsPath,
    'restart.log',
  );

  const targetCmd = [
    `"${psExe}" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass`,
    `-File "${scriptPath}"`,
    `-ExePath "${exePath}"`,
    `-Port ${cdpPort}`,
    `-LogPath "${logPath}"`,
    `-DelaySeconds ${delaySeconds}`,
  ].join(' ');

  const wmiScript = [
    `$ProgressPreference = 'SilentlyContinue'`,
    `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${targetCmd.replace(/'/g, "''")}' }`,
    `if ($r.ReturnValue -ne 0) { Write-Output ('WMI_FAIL:' + $r.ReturnValue); exit 2 }`,
    `Write-Output ('WMI_OK:' + $r.ProcessId)`,
  ].join('\n');

  // EncodedCommand 用 UTF-16LE base64，避开多层引号与中文路径的编码问题
  const encoded = Buffer.from(wmiScript, 'utf16le').toString('base64');

  child_process.execFile(
    psExe,
    ['-NoProfile', '-EncodedCommand', encoded],
    (err, stdout, stderr) => {
      const out = (stdout ?? '').trim();
      if (err) {
        logger.error(`重启失败: ${err.message}${stderr ? ` / ${stderr}` : ''}`);
        vscode.window.showErrorMessage(
          `ParallelAgent 重启失败: ${err.message}`,
        );
        return;
      }
      if (!/WMI_OK:/.test(out)) {
        logger.error(`WMI 未能创建重启进程: ${out}`);
        vscode.window.showErrorMessage(
          `ParallelAgent 重启失败：WMI 返回 ${out || '未知错误'}` +
            '（ReturnValue 9 通常表示找不到可执行文件）',
        );
        return;
      }
      logger.info(`重启脚本已拉起: ${out}，日志 ${logPath}`);
      vscode.window.showInformationMessage(
        delaySeconds > 0
          ? `ParallelAgent 已写入调试端口配置，将在 ${delaySeconds} 秒后关闭并重启 Trae`
          : 'ParallelAgent 已写入调试端口配置，正在重启 Trae',
      );
    },
  );
}

/** 探测 powershell.exe 绝对路径（WMI 环境下依赖它，不能只写命令名） */
function detectPowerShellPath(): string | null {
  const root = process.env.SystemRoot ?? 'C:\\Windows';
  const candidates = [
    path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    path.join(root, 'Sysnative', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // 继续尝试下一个
    }
  }
  return null;
}

/** A1：从扩展安装目录定位 restart 脚本（随扩展分发，零硬编码） */
function findRestartScript(context: vscode.ExtensionContext): string | null {
  const p = path.join(
    context.extensionPath,
    'resources',
    'scripts',
    'restart-with-debug.ps1',
  );
  try {
    if (fs.existsSync(p)) return p;
  } catch {
    // fall through
  }
  return null;
}

/** A4：幂等创建项目层信箱骨架 + .gitignore（排除临时信号目录） */
function ensureMailboxSkeleton(mailboxRoot: string): void {
  try {
    for (const sub of [
      '转达',
      '回执',
      '就绪',
      '交接手册',
      '信号',
      path.join('信号', '轮次状态'),
    ]) {
      fs.mkdirSync(path.join(mailboxRoot, sub), { recursive: true });
    }
    const gitignorePath = path.join(mailboxRoot, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, '信号/\n', 'utf8');
    }
  } catch (e) {
    logger.error(`创建信箱目录骨架失败: ${(e as Error).message}`);
  }
}

// ── 卸载 ───────────────────────────────────────────────

export function deactivate(): void {
  stopOrchestrator();
}
