// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

/** `parallelagent init`：一次性完成全部配置 */

import * as fs from 'node:fs';
import { detectTrae } from '../lib/detectTrae.js';
import { ensureRemoteDebuggingPort } from '../lib/argvJson.js';
import {
  installFromOpenVsx,
  installFromStore,
  installFromGithubRelease,
  installFromVsixFile,
  waitForVersion,
  isExtensionInstalled,
  getInstalledExtensionVersion,
  compareVersions,
  EXPECTED_EXTENSION_VERSION,
} from '../lib/installExtension.js';
import { installSkills } from '../lib/installSkills.js';
import { pingCdp, missingSkills } from '../lib/verify.js';

const CDP_PORT = 9317;

interface InitOptions {
  dryRun: boolean;
  traeCli?: string;
  /** 额外尝试让 Trae 从自己的商店源安装（默认关闭） */
  fromStore?: boolean;
  /** 离线安装：直接指定本地 vsix，跳过所有网络请求 */
  vsixPath?: string;
}

/** 打印将要执行的动作（dry-run 模式） */
function dry(label: string): void {
  console.log(`[dry-run] ${label}`);
}

export async function runInit(options: InitOptions): Promise<void> {
  const { dryRun, traeCli, fromStore = false, vsixPath } = options;

  // ── 1. 探测 ──
  if (dryRun) dry('探测 Trae 安装位置、数据目录、CLI 命令');

  const trae = detectTrae();
  if (!trae.dataDir) {
    fail(
      '未探测到 Trae 用户数据目录（~/.trae-cn 或 ~/.trae）' +
        '\n请确认 Trae 已安装，或通过 --trae-cli 指定命令路径。',
    );
  }
  console.log(`  ✓ 数据目录: ${trae.dataDir}`);

  const cliCommand = traeCli ?? trae.cliCommand;
  if (!cliCommand) {
    fail(
      '未找到 Trae CLI 命令（trae-cn / trae）' +
        '\n可尝试用 --trae-cli 显式指定命令路径。',
    );
  }
  console.log(`  ✓ CLI 命令: ${cliCommand}`);
  if (trae.exePath) console.log(`  ✓ exe 路径: ${trae.exePath}`);

  // ── 2. 装扩展 ──
  console.log('');
  console.log('步骤 2/5: 安装扩展');

  if (dryRun) {
    dry(`目标扩展版本: ${EXPECTED_EXTENSION_VERSION ?? '未知（跳过版本校验）'}`);
    if (vsixPath) {
      dry(`离线安装本地 vsix: ${vsixPath}`);
    } else {
      dry(`从 Open VSX 下载对应版本 vsix 后本地安装`);
      dry(`└─ 失败则回退 GitHub Release .vsix`);
      if (fromStore) dry(`└─ 仍失败则尝试 Trae 商店安装`);
    }
    dry(`安装后轮询等待版本达标（最多 30 秒，Trae 运行时安装是异步的）`);
  } else {
    const expected = EXPECTED_EXTENSION_VERSION;
    const installed = isExtensionInstalled(cliCommand)
      ? getInstalledExtensionVersion(cliCommand)
      : null;

    const satisfied =
      !!installed && (!expected || compareVersions(installed, expected) >= 0);

    if (satisfied) {
      console.log(`  ✓ 扩展已安装 ${installed}（跳过）`);
    } else {
      if (installed) {
        console.log(`  已安装 ${installed}，目标 ${expected ?? 'latest'}，尝试升级...`);
      }

      type Attempt = {
        label: string;
        run: () =>
          | { ok: boolean; output: string }
          | Promise<{ ok: boolean; output: string }>;
      };

      const attempts: Attempt[] = [];
      if (vsixPath) {
        attempts.push({
          label: `本地 vsix（${vsixPath}）`,
          run: () => installFromVsixFile(vsixPath, cliCommand),
        });
      } else {
        attempts.push({
          label: 'Open VSX',
          run: () => installFromOpenVsx(cliCommand, expected ?? undefined),
        });
        attempts.push({
          label: 'GitHub Release',
          run: () => installFromGithubRelease(cliCommand),
        });
        if (fromStore) {
          attempts.push({
            label: 'Trae 商店',
            run: () => installFromStore(cliCommand),
          });
        }
      }

      let finalVersion: string | null = null;
      let lastError = '';
      for (const attempt of attempts) {
        console.log(`  尝试 ${attempt.label}...`);
        const r = await attempt.run();
        if (!r.ok) {
          lastError = r.output;
          const brief = r.output
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(0, 4)
            .map((l) => `    ${l}`)
            .join('\n');
          console.log(`  ✗ ${attempt.label} 失败:\n${brief}`);
          continue;
        }
        // 安装命令返回后 Trae 可能仍在异步写入，必须轮询等待版本变化
        const v = await waitForVersion(cliCommand, expected, 30_000);
        if (v && (!expected || compareVersions(v, expected) >= 0)) {
          finalVersion = v;
          break;
        }
        lastError = `安装后版本仍为 ${v ?? '未知'}（等待 30 秒超时）`;
        console.log(`  ⚠ ${attempt.label}: ${lastError}`);
      }

      if (!finalVersion) {
        fail(
          '扩展安装失败。\n' +
            `最后错误: ${lastError}\n` +
            '可手动下载 vsix 后用 --vsix <路径> 离线安装；网络抖动时也可直接重试。',
        );
      }
      console.log(`  ✓ 扩展已安装 ${finalVersion}`);
    }
  }

  // ── 3. 铺 skills ──
  console.log('');
  console.log('步骤 3/5: 铺 Skills');

  if (dryRun) {
    dry(`拷 skills → ${trae.dataDir}/skills/`);
  } else {
    const installed = installSkills(trae.dataDir);
    for (const p of installed) console.log(`  ✓ ${p}`);
  }

  // ── 4. 写 argv.json ──
  console.log('');
  console.log('步骤 4/5: 配置调试端口');

  const argvPath = `${trae.dataDir}/argv.json`;
  if (dryRun) {
    dry(`argv.json 增量合并: remote-debugging-port = ${CDP_PORT}`);
    console.log(`  目标文件: ${argvPath}`);
  } else {
    const written = ensureRemoteDebuggingPort(argvPath, CDP_PORT);
    console.log(
      written
        ? `  ✓ 已写入 argv.json: remote-debugging-port = ${CDP_PORT}`
        : `  ✓ argv.json 已含正确端口，无需改动`,
    );
  }

  // ── 5. 验证 ──
  console.log('');
  console.log('步骤 5/5: 验证');

  if (dryRun) {
    dry('检查 skills 文件存在');
    dry('ping CDP（如 Trae 运行中）');
  } else {
    const missing = missingSkills(trae.dataDir);
    if (missing.length) {
      fail(`Skills 缺失:\n${missing.join('\n')}`);
    }
    console.log('  ✓ Skills 文件就位');

    const cdpOk = await pingCdp(CDP_PORT);
    if (cdpOk) {
      console.log(`  ✓ CDP 端口 ${CDP_PORT} 连通`);
    } else {
      console.log(
        `  ⚠ CDP 端口 ${CDP_PORT} 暂不通（Trae 未运行，重启后生效）`,
      );
    }
  }

  // ── 成功面板 ──
  console.log('');
  console.log('========================================');
  console.log('ParallelAgent 初始化完成');
  console.log('========================================');
  console.log('');
  console.log('后续操作：');
  console.log('  1. 重启 Trae（双击图标 / 开始菜单 / 任务栏）');
  console.log('  2. Ctrl+Shift+P → ParallelAgent: 启动编排器');
  console.log('');
  console.log('诊断：');
  console.log('  parallelagent doctor      # 环境自检');
  console.log('');
}

function fail(msg: string): never {
  console.error('错误:', msg);
  process.exit(1);
}
