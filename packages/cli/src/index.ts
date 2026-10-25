// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0

/** ParallelAgent CLI 入口 */

import { parseArgs } from 'node:util';
import { runInit } from './commands/init.js';
import { runDoctor } from './commands/doctor.js';
import { runUninit } from './commands/uninit.js';

const USAGE = `
ParallelAgent —— 一键安装 / 自检 / 卸载

用法：
  parallelagent <命令> [选项]

命令：
  init      装扩展 + 铺 Skills/共享 reference + 写 argv.json 调试端口（幂等）
  doctor    环境自检报告（全绿退出码 0，有问题 1）
  uninit    卸载扩展 + 清 Skills/共享 reference + 还原 argv.json（幂等）

init 选项：
  --dry-run         只打印将执行的动作，不落地
  --trae-cli <path> 显式指定 Trae CLI 命令路径（探测失败时兜底）
  --from-store      Open VSX / GitHub 都失败后，再尝试 Trae 商店源安装
  --vsix <path>     离线安装：直接装本地 vsix，跳过所有网络请求

示例：
  npx parallelagent@latest init
  parallelagent doctor
`;

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      'dry-run': { type: 'boolean', default: false },
      'trae-cli': { type: 'string' },
      'from-store': { type: 'boolean', default: false },
      vsix: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const cmd = positionals[0];

  if (values.help || !cmd) {
    console.log(USAGE);
    return;
  }

  switch (cmd) {
    case 'init':
      await runInit({
        dryRun: values['dry-run'] ?? false,
        traeCli: values['trae-cli'],
        fromStore: values['from-store'] ?? false,
        vsixPath: values.vsix,
      });
      break;
    case 'doctor':
      await runDoctor();
      break;
    case 'uninit':
      runUninit();
      break;
    default:
      console.error(`未知命令: ${cmd}\n${USAGE}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('致命错误:', (err as Error).message);
  process.exit(1);
});
