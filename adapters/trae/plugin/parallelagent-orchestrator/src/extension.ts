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
import { pingCdp } from './cdp/precheck';
import { detectArgvJsonPath } from './state/traePaths';
import { ensureRemoteDebuggingPort } from './state/argvJson';

// ── 模块实例（后续步骤填充） ──────────────────────────
let httpServer: { close(): void } | null = null;
let cdpClient: CdpClient | null = null;
let cdpTarget: CdpTarget | null = null;
let fileWatcher: { dispose(): void } | null = null;
let watchJobs: WatchJobManager | null = null;
let orbitTable: OrbitTable | null = null;
let routeDeps: RouteDeps | null = null;
let currentConfig: ParallelAgentConfig | null = null;

// ── 激活入口 ──────────────────────────────────────────

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  logger.initLogger(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('parallelagent.start', () =>
      startOrchestrator(context),
    ),
    vscode.commands.registerCommand('parallelagent.stop', () =>
      stopOrchestrator(),
    ),
    vscode.commands.registerCommand('parallelagent.health', () =>
      healthCheck(),
    ),
    vscode.commands.registerCommand('parallelagent.restartWithDebug', () =>
      restartWithDebug(context),
    ),
  );

  logger.info('扩展已激活，等待启动命令');

  // A3：激活后 CDP 预检（不阻塞 activate 返回）
  void precheckCdp(context);
}

/** A3：CDP 预检；不通则引导一键修复 */
async function precheckCdp(context: vscode.ExtensionContext): Promise<void> {
  const port = readConfig().cdpPort;
  const ok = await pingCdp(port);
  if (ok) {
    logger.info(`CDP 预检通过（端口 ${port}）`);
    return;
  }
  logger.warn(`CDP 预检未通过（端口 ${port}）`);
  const choice = await vscode.window.showErrorMessage(
    `ParallelAgent：CDP 端口 ${port} 不通。可一键写入 argv.json 并重启 Trae 修复。`,
    '立即修复',
    '仅本次忽略',
  );
  if (choice === '立即修复') {
    await restartWithDebug(context);
  }
}

// ── 命令实现 ───────────────────────────────────────────

async function startOrchestrator(
  context: vscode.ExtensionContext,
): Promise<void> {
  const config = readConfig();
  currentConfig = config;

  // 已在运行：只重试 CDP（修好端口后无需先停再启）
  if (httpServer && routeDeps) {
    logger.info('编排器已在运行，重试 CDP 连接...');
    const connected = await connectCdp(config, routeDeps);
    vscode.window.showInformationMessage(
      connected
        ? 'ParallelAgent 编排器已在运行，CDP 已连接'
        : `ParallelAgent 编排器已在运行（HTTP 127.0.0.1:${config.httpPort}），CDP 仍不可达`,
    );
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

  routeDeps = { cdp: null, orbit: orbitTable, watcher, jobs, projectName };
  httpServer = createHttpServer(config.httpPort, routeDeps);
  jobs.start();

  // 步骤 2: 再连 CDP；失败只告警，HTTP 网关保持可用
  const connected = await connectCdp(config, routeDeps);

  if (connected) {
    logger.info('编排器已启动');
    vscode.window.showInformationMessage('ParallelAgent 编排器已启动');
  } else {
    vscode.window.showWarningMessage(
      `ParallelAgent HTTP 网关已启动（127.0.0.1:${config.httpPort}），但 CDP ${config.cdpPort} 连接失败。` +
        '运行"带调试端口重启 Trae"后，再次执行启动命令即可重试连接。',
    );
  }
}

/** 连接 CDP 并回填到共享 deps；成功后 HTTP 路由立即具备执行能力 */
async function connectCdp(
  config: ParallelAgentConfig,
  deps: RouteDeps,
): Promise<boolean> {
  try {
    const { client, target } = await discoverAndConnect(config.cdpPort);
    cdpClient = client;
    cdpTarget = target;
    deps.cdp = client;
    logger.audit('cdp_connect', { targetId: target.id, title: target.title });
    return true;
  } catch (e) {
    logger.error(`CDP 连接失败: ${(e as Error).message}`);
    return false;
  }
}

async function stopOrchestrator(): Promise<void> {
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

  orbitTable = null;
  routeDeps = null;
  currentConfig = null;

  logger.info('编排器已停止');
  vscode.window.showInformationMessage('ParallelAgent 编排器已停止');
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
async function restartWithDebug(
  context: vscode.ExtensionContext,
): Promise<void> {
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
    `"${psExe}" -NoProfile -ExecutionPolicy Bypass`,
    `-File "${scriptPath}"`,
    `-ExePath "${exePath}"`,
    `-Port ${cdpPort}`,
    `-LogPath "${logPath}"`,
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
        'ParallelAgent 已写入调试端口配置，将在 8 秒后关闭并重启 Trae',
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
