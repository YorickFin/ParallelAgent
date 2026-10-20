// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as path from 'path';

export interface ParallelAgentConfig {
  cdpPort: number;
  httpPort: number;
  mailboxRoot: string;
  pollIntervalMs: number;
  watchTimeoutS: number;
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
  };
}
