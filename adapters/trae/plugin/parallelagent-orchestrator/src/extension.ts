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
import { OrbitTable } from './state/orbitTable';
import { MailboxPaths } from './mailbox/paths';
import { ReceiptWatcher } from './mailbox/watcher';

// ── 模块实例（后续步骤填充） ──────────────────────────
let httpServer: { close(): void } | null = null;
let cdpClient: CdpClient | null = null;
let cdpTarget: CdpTarget | null = null;
let fileWatcher: { dispose(): void } | null = null;
let orbitTable: OrbitTable | null = null;
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
      restartWithDebug(),
    ),
  );

  logger.info('扩展已激活，等待启动命令');
}

// ── 命令实现 ───────────────────────────────────────────

async function startOrchestrator(
  context: vscode.ExtensionContext,
): Promise<void> {
  const config = readConfig();
  currentConfig = config;

  logger.info(`编排器启动中... CDP=${config.cdpPort} HTTP=${config.httpPort}`);

  // 步骤 2: 发现 Work target 并连接 CDP
  try {
    const { client, target } = await discoverAndConnect(config.cdpPort);
    cdpClient = client;
    cdpTarget = target;
    logger.audit('cdp_connect', { targetId: target.id, title: target.title });
  } catch (e) {
    logger.error(`CDP 连接失败: ${(e as Error).message}`);
    vscode.window.showErrorMessage(
      `ParallelAgent CDP 连接失败: ${(e as Error).message}\n` +
        '请先运行"带调试端口重启 Trae"命令',
    );
    return;
  }

  // 步骤 4: 创建身份表
  orbitTable = new OrbitTable(
    path.join(context.globalStorageUri.fsPath, 'orbit-table.json'),
  );

  // 步骤 5: 创建文件信箱 watcher
  const mailboxPaths = new MailboxPaths(config.mailboxRoot);
  const watcher = new ReceiptWatcher(mailboxPaths, config.pollIntervalMs);
  fileWatcher = watcher;

  // 步骤 4: 创建 HTTP 网关（注入 watcher + 项目名）
  const projectName =
    vscode.workspace.workspaceFolders?.[0]?.name ?? 'ParallelAgent';
  httpServer = createHttpServer(config.httpPort, {
    cdp: cdpClient,
    orbit: orbitTable,
    watcher,
    projectName,
  });

  logger.info('编排器已启动');
  vscode.window.showInformationMessage('ParallelAgent 编排器已启动');
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

  orbitTable = null;
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

async function restartWithDebug(): Promise<void> {
  const scriptPath = findRestartScript();
  if (!scriptPath) {
    vscode.window.showErrorMessage('找不到 restart-with-debug.ps1');
    return;
  }

  const cdpPort = readConfig().cdpPort;

  logger.info(`带调试端口 ${cdpPort} 重启 Trae...`);

  // 必须用 WMI 拉起：child_process.exec 的子进程在 Trae 的 Job Object 里，
  // 脚本杀掉 Trae 时会被连带终止，Start-Process 永远执行不到。
  // WMI 创建的进程父进程是 WmiPrvSE，脱离 Trae 进程树。
  const wmiCmd = [
    'powershell', '-NoProfile', '-Command',
    `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = 'powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -Port ${cdpPort}' }`,
  ].join(' ');

  child_process.exec(wmiCmd, (err, stdout, _stderr) => {
    if (err) {
      logger.error(`重启失败: ${err.message}`);
      vscode.window.showErrorMessage(`重启失败: ${err.message}`);
      return;
    }
    logger.info(`重启脚本已通过 WMI 拉起: ${stdout.trim()}`);
    vscode.window.showInformationMessage(
      'ParallelAgent 将在 8 秒后关闭并重启 Trae（带调试端口）',
    );
  });
}

function findRestartScript(): string | null {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return null;

  const candidates = [
    path.join(
      workspaceRoot,
      'adapters',
      'trae',
      'probes',
      'restart-with-debug.ps1',
    ),
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // continue
    }
  }
  return null;
}

// ── 卸载 ───────────────────────────────────────────────

export function deactivate(): void {
  stopOrchestrator();
}
