// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as path from 'path';

/** 编排器自动启动策略 */
export type AutoStartMode = 'auto' | 'on' | 'off';

export interface ParallelAgentConfig {
  cdpPort: number;
  httpPort: number;
  mailboxRoot: string;
  pollIntervalMs: number;
  watchTimeoutS: number;
  autoStart: AutoStartMode;
  /** 第一个工作区根的绝对路径；空窗口为空字符串 */
  workspaceRoot: string;
}

function parseAutoStart(value: string): AutoStartMode {
  return value === 'on' || value === 'off' ? value : 'auto';
}

export function readConfig(): ParallelAgentConfig {
  const cfg = vscode.workspace.getConfiguration('parallelagent');
  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

  const mailboxRoot = cfg.get<string>('mailboxRoot', '.parallel-agent');
  const absoluteMailboxRoot = path.isAbsolute(mailboxRoot)
    ? mailboxRoot
    : path.join(workspaceRoot, mailboxRoot);

  return {
    cdpPort: cfg.get<number>('cdpPort', 9317),
    httpPort: cfg.get<number>('httpPort', 9318),
    mailboxRoot: absoluteMailboxRoot,
    pollIntervalMs: cfg.get<number>('pollIntervalMs', 1000),
    watchTimeoutS: cfg.get<number>('watchTimeoutS', 1800),
    autoStart: parseAutoStart(cfg.get<string>('autoStart', 'auto')),
    workspaceRoot,
  };
}
