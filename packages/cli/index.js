#!/usr/bin/env node
'use strict';

/**
 * ParallelAgent v3 安装器
 *
 * 边界：只把共享数据（references / templates / hosts）复制到 <root>/.parallel-agent，
 * 并写 install-state.json。
 *
 * 不安装 Skill、不创建链接、不删除任何文件。
 * Skill 的安装/更新/卸载交给上游 `npx skills`（vercel-labs/skills）或 `gh skill`。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PKG = require('./package.json');

const DATA_DIR = '.parallel-agent';
const SKILLS_REPO = 'YorickFin/ParallelAgent';

function usage() {
  console.log(`ParallelAgent v3.1 共享数据安装器 ${PKG.version}

用法：
  parallelagent init [选项]

选项：
  --root <目录>   安装根目录（默认用户主目录，用于测试/隔离）
  --dry-run       只打印将要执行的动作，不写任何文件
  --force         覆盖用户已修改的文件（默认写 .new，不覆盖）
  --help          显示帮助

说明：
  - 只复制 references / templates / hosts 到 <root>/${DATA_DIR} 并写 install-state.json
  - 不安装 Skill、不创建链接、不删除任何文件
  - Skill 由上游安装器管理：
      npx skills add ${SKILLS_REPO} -g -a trae-cn
      gh skill install ${SKILLS_REPO} --scope user --agent trae-cn
  - 能力档案（${DATA_DIR}/能力档案/）永不覆盖
`);
}

function parseArgs(argv) {
  const out = { cmd: 'help', root: os.homedir(), dryRun: false, force: false };
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--help' || a === '-h') help = true;
    else if (a === '--root') {
      const v = argv[++i];
      if (!v) throw new Error('--root 缺少值');
      out.root = v;
    } else if (a.startsWith('-')) {
      throw new Error(`未知参数：${a}`);
    } else {
      out.cmd = a;
    }
  }
  if (help) out.cmd = 'help';
  return out;
}

/** 资产根：发布包用 assets/，仓库内直接用仓库根 */
function resolveAssetRoot() {
  const bundled = path.join(__dirname, 'assets');
  if (fs.existsSync(bundled)) return bundled;
  return path.resolve(__dirname, '..', '..');
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function walk(dir, base, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.join(base, entry.name);
    if (entry.isDirectory()) walk(abs, rel, acc);
    else if (entry.isFile()) acc.push({ abs, rel });
  }
  return acc;
}

function readState(file) {
  if (!fs.existsSync(file)) return { files: {} };
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { files: {} };
  }
}

function copyWithGuard(src, dest, state, opts, report) {
  const prevHash = state.files[dest];
  const exists = fs.existsSync(dest);
  const srcHash = sha256(src);

  // 内容已一致：跳过（幂等）
  if (exists && sha256(dest) === srcHash) {
    state.files[dest] = srcHash;
    report.push({ action: 'same', dest });
    return;
  }

  const userModified = exists && prevHash && sha256(dest) !== prevHash;

  if (opts.dryRun) {
    report.push({ action: 'copy', src, dest, userModified });
    return;
  }

  const dir = path.dirname(dest);
  fs.mkdirSync(dir, { recursive: true });
  if (userModified && !opts.force) {
    fs.copyFileSync(src, dest + '.new');
    report.push({ action: 'conflict', dest, wrote: dest + '.new' });
  } else {
    fs.copyFileSync(src, dest);
    report.push({ action: 'copy', dest });
  }
  state.files[dest] = srcHash;
}

function init(opts) {
  const root = path.resolve(opts.root);
  const dataDir = path.join(root, DATA_DIR);
  const stateFile = path.join(dataDir, 'install-state.json');
  const assetRoot = resolveAssetRoot();

  console.log(`数据目录：${dataDir}`);
  console.log(`资产来源：${assetRoot}`);
  if (opts.dryRun) console.log('（dry-run：不写入任何文件）');

  const state = readState(stateFile);
  const report = [];

  for (const category of ['references', 'templates', 'hosts']) {
    const src = path.join(assetRoot, category);
    if (!fs.existsSync(src)) continue;
    for (const f of walk(src, category)) {
      copyWithGuard(f.abs, path.join(dataDir, f.rel), state, opts, report);
    }
  }

  // 能力档案目录：只建目录，绝不覆盖
  if (!opts.dryRun) {
    fs.mkdirSync(path.join(dataDir, '能力档案'), { recursive: true });
    const next = {
      version: PKG.version,
      dataDir,
      installedAt: new Date().toISOString(),
      files: state.files,
    };
    fs.writeFileSync(stateFile, JSON.stringify(next, null, 2) + '\n', 'utf8');
  }

  const copied = report.filter((r) => r.action === 'copy').length;
  const same = report.filter((r) => r.action === 'same').length;
  const conflicts = report.filter((r) => r.action === 'conflict');
  if (opts.dryRun) {
    console.log(`\n将复制/覆盖 ${copied} 个文件，跳过未变更 ${same} 个（未写入任何文件）`);
  } else {
    console.log(`\n完成：复制/覆盖 ${copied} 个文件，跳过未变更 ${same} 个`);
  }
  if (conflicts.length) {
    console.log(`注意：${conflicts.length} 个文件被本地修改过，已写入 .new 备份，未覆盖：`);
    for (const c of conflicts) console.log(`  - ${c.wrote}`);
  }

  console.log(`
共享数据安装完成。Skill 不在这里安装，请用上游安装器：

  npx skills add ${SKILLS_REPO} -g -a trae-cn
  gh skill install ${SKILLS_REPO} --scope user --agent trae-cn

卸载同样交给上游：npx skills remove --global -a trae-cn parallelagent-*

首次使用前需要一份能力档案（~/${DATA_DIR}/能力档案/<host>.md）。
可参考 ~/${DATA_DIR}/hosts/ 下预置档案或 能力档案-模板.md；confidence 非「实测」时需确认。

请选择（可直接回复序号，或自由输入）：
  1. 立即初始化测试：由 Agent 按 P1-P6 探测（会 spawn 若干子代理）
  2. 触发 L4 时再测试：第一次多轨任务前再问
  3. 其它：请直接说明（如指定已有档案路径、改写已有档案、先不测）

Agent 会在下次对话中读取本提示；安装器不代替你做选择。`);
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    usage();
    process.exit(1);
  }
  if (opts.cmd === 'help') return usage();
  if (opts.cmd !== 'init') {
    usage();
    process.exit(1);
  }
  try {
    init(opts);
  } catch (e) {
    console.error(`安装失败：${e.message}`);
    process.exit(1);
  }
}

main();
