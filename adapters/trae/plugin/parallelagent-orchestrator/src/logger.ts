// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

let outputChannel: vscode.OutputChannel | null = null;
let auditLogPath: string | null = null;

export function initLogger(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel('ParallelAgent');
  context.subscriptions.push(outputChannel);

  const dir = context.globalStorageUri.fsPath;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  auditLogPath = path.join(dir, 'audit.log');
}

function ts(): string {
  return new Date().toISOString();
}

function appendAudit(line: string): void {
  if (!auditLogPath) return;
  try {
    fs.appendFileSync(auditLogPath, line + '\n', 'utf8');
  } catch {
    // 审计日志写失败不阻塞主流程
  }
}

export function info(msg: string): void {
  const line = `[${ts()}] [INFO] ${msg}`;
  outputChannel?.appendLine(line);
}

export function warn(msg: string): void {
  const line = `[${ts()}] [WARN] ${msg}`;
  outputChannel?.appendLine(line);
}

export function error(msg: string): void {
  const line = `[${ts()}] [ERROR] ${msg}`;
  outputChannel?.appendLine(line);
}

export function debug(msg: string): void {
  const line = `[${ts()}] [DEBUG] ${msg}`;
  outputChannel?.appendLine(line);
}

/** 审计日志：记录 CDP 动作 / HTTP 请求 / 信号收发 */
export function audit(action: string, detail: unknown): void {
  const entry = {
    ts: ts(),
    action,
    detail,
  };
  appendAudit(JSON.stringify(entry));
}

export function show(): void {
  outputChannel?.show(true);
}
