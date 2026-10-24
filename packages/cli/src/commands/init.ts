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
}

/** 打印将要执行的动作（dry-run 模式） */
function dry(label: string): void {
  console.log(`[dry-run] ${label}`);
}

export async function runInit(options: InitOptions): Promise<void> {
  const { dryRun, traeCli, fromStore = false } = options;

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
    dry(`从 Open VSX 下载对应版本 vsix 后本地安装`);
    dry(`└─ Open VSX 未达版本则回退 GitHub Release .vsix`);
    if (fromStore) dry(`└─ 仍失败则尝试 Trae 商店安装`);
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

      const versionOk = (): boolean => {
        if (!expected) return true;
        const now = getInstalledExtensionVersion(cliCommand);
        return !!now && compareVersions(now, expected) >= 0;
      };

      // 主通道：Open VSX 直链下载 vsix，本地安装（不依赖 Trae 的商店源）
      let extResult = await installFromOpenVsx(cliCommand, expected ?? undefined);
      if (!extResult.ok || !versionOk()) {
        console.log('  Open VSX 未取得目标版本，尝试 GitHub Release 兜底...');
        extResult = await installFromGithubRelease(cliCommand);
      }
      if ((!extResult.ok || !versionOk()) && fromStore) {
        console.log('  仍失败，尝试 Trae 商店安装（--from-store）...');
        extResult = installFromStore(cliCommand);
      }
      if (!extResult.ok && !versionOk()) {
        fail(`扩展安装失败:\n${extResult.output}`);
      }

      const finalVersion = getInstalledExtensionVersion(cliCommand);
      if (finalVersion && expected && compareVersions(finalVersion, expected) < 0) {
        fail(
          `扩展版本仍为 ${finalVersion}，目标 ${expected}` +
            '\n请确认 Open VSX 审核状态，或 GitHub Release 是否已上传对应 vsix。',
        );
      }
      console.log(`  ✓ 扩展已安装 ${finalVersion ?? ''}`.trim());
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
