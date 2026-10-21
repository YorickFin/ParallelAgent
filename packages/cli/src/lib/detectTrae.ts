// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Trae 安装信息探测（Windows-only，v1.1.0）
 * 零硬编码绝对路径：数据目录 / CLI 命令名 / exe 路径全部运行时探测。
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface TraeInfo {
  /** 用户数据目录（argv.json 所在目录） */
  dataDir: string | null;
  /** PATH 上或可执行目录下的 CLI 命令（trae-cn / trae / .cmd 绝对路径） */
  cliCommand: string | null;
  /** Trae 主程序 exe 绝对路径 */
  exePath: string | null;
}

const DATA_DIR_CANDIDATES = ['.trae-cn', '.trae'];
const CLI_NAMES = ['trae-cn', 'trae'];

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** 探测用户数据目录：`~/.trae-cn/` → `~/.trae/` → null */
export function detectDataDir(): string | null {
  for (const name of DATA_DIR_CANDIDATES) {
    const dir = path.join(os.homedir(), name);
    if (isDir(dir)) return dir;
  }
  return null;
}

/** 在 PATH 上查找命令（Windows where.exe） */
function which(cmd: string): string | null {
  try {
    const out = execFileSync('where.exe', [cmd], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const first = out.split(/\r?\n/)[0]?.trim();
    return first && isFile(first) ? first : null;
  } catch {
    return null;
  }
}

/**
 * 从注册表 Uninstall 项读取 InstallLocation。
 * 匹配 DisplayName 含 "Trae" 的条目（Trae CN 优先）。
 */
function readInstallLocationFromRegistry(): string | null {
  const roots: Array<[string, string]> = [
    ['HKCU', String.raw`Software\Microsoft\Windows\CurrentVersion\Uninstall`],
    ['HKLM', String.raw`Software\Microsoft\Windows\CurrentVersion\Uninstall`],
  ];
  for (const [hive, sub] of roots) {
    let out: string;
    try {
      out = execFileSync('reg.exe', ['query', `${hive}\\${sub}`, '/s', '/v', 'InstallLocation'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      continue;
    }
    // 以键名为段切分，找 DisplayName 含 Trae 的段。先粗取所有 InstallLocation 值，
    // 再按同段是否提及 Trae 过滤。
    const blocks = out.split(/\r?\n\r?\n/);
    for (const block of blocks) {
      if (!/trae/i.test(block)) continue;
      const m = block.match(/InstallLocation\s+REG_SZ\s+(.+)/);
      if (m?.[1]) {
        const loc = m[1].trim();
        if (isDir(loc)) return loc;
      }
    }
  }
  return null;
}

/** 探测 Trae exe：注册表 InstallLocation → 常见安装路径 → null */
export function detectExePath(): string | null {
  const exeNames = ['Trae CN.exe', 'Trae.exe'];

  const installLoc = readInstallLocationFromRegistry();
  if (installLoc) {
    for (const name of exeNames) {
      const exe = path.join(installLoc, name);
      if (isFile(exe)) return exe;
    }
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    for (const name of exeNames) {
      const dirName = name.replace(/\.exe$/i, '');
      const exe = path.join(localAppData, 'Programs', dirName, name);
      if (isFile(exe)) return exe;
    }
  }
  return null;
}

/**
 * 探测 CLI 命令名：PATH 上查 trae-cn / trae；
 * 查不到则试 exe 同级 `bin/trae-cn.cmd`、`bin/trae.cmd`。
 */
export function detectCliCommand(exePath: string | null): string | null {
  for (const name of CLI_NAMES) {
    const found = which(name);
    if (found) return name;
  }
  if (exePath) {
    const binDir = path.join(path.dirname(exePath), 'bin');
    for (const name of CLI_NAMES) {
      const cmd = path.join(binDir, `${name}.cmd`);
      if (isFile(cmd)) return cmd;
    }
  }
  return null;
}

/** 一站式探测 */
export function detectTrae(): TraeInfo {
  const dataDir = detectDataDir();
  const exePath = detectExePath();
  const cliCommand = detectCliCommand(exePath);
  return { dataDir, cliCommand, exePath };
}
