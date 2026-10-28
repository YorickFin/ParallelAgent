#!/usr/bin/env node
'use strict';

/**
 * ParallelAgent v3 安装器
 *
 * 边界：只复制文件、写安装状态、打印首次运行提示。
 * 不探测、不写能力档案、不碰项目 .parallel-agent/。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PKG = require('./package.json');

const HOSTS = {
  'trae-cn': { skillsDir: ['.trae-cn', 'skills'], label: 'Trae CN' },
  workbuddy: { skillsDir: ['.workbuddy', 'skills'], label: 'WorkBuddy' },
  'claude-code': { skillsDir: ['.claude', 'skills'], label: 'Claude Code' },
};

const DATA_DIR = '.parallel-agent';

function usage() {
  console.log(`ParallelAgent v3 安装器 ${PKG.version}

用法：
  parallelagent init [选项]

选项：
  --host <trae-cn|workbuddy|claude-code>  目标宿主（默认 trae-cn）
  --root <目录>                            安装根目录（默认用户主目录，用于测试/隔离）
  --skills-dir <目录>                     覆盖 Skill 安装目录
  --dry-run                               只打印将要执行的动作
  --force                                 覆盖用户已修改的文件
  --help                                  显示帮助

说明：
  - 只复制文件与写 install-state.json
  - 能力档案（${DATA_DIR}/能力档案/）永不覆盖
  - 项目目录 ${DATA_DIR}/ 永不触碰
`);
}

function parseArgs(argv) {
  const out = { cmd: 'help', host: 'trae-cn', root: os.homedir(), dryRun: false, force: false };
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--help' || a === '-h') help = true;
    else if (a === '--host') {
      const v = argv[++i];
      if (!v) throw new Error('--host 缺少值');
      out.host = v;
    } else if (a === '--root') {
      const v = argv[++i];
      if (!v) throw new Error('--root 缺少值');
      out.root = v;
    } else if (a === '--skills-dir') {
      const v = argv[++i];
      if (!v) throw new Error('--skills-dir 缺少值');
      out.skillsDir = v;
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
  const dir = path.dirname(dest);
  fs.mkdirSync(dir, { recursive: true });

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
  const host = HOSTS[opts.host];
  if (!host) throw new Error(`不支持的宿主：${opts.host}（可选：${Object.keys(HOSTS).join(' / ')}）`);

  const root = path.resolve(opts.root);
  const skillsDir = opts.skillsDir
    ? path.resolve(opts.skillsDir)
    : path.join(root, ...host.skillsDir);
  const dataDir = path.join(root, DATA_DIR);
  const stateFile = path.join(dataDir, 'install-state.json');
  const assetRoot = resolveAssetRoot();

  console.log(`宿主：${host.label}`);
  console.log(`Skill 目录：${skillsDir}`);
  console.log(`数据目录：${dataDir}`);
  console.log(`资产来源：${assetRoot}`);
  if (opts.dryRun) console.log('（dry-run：不写入任何文件）');

  const state = readState(stateFile);
  const report = [];

  // 1. Skills：每个 Skill 目录整体复制
  const skillsRoot = path.join(assetRoot, 'skills');
  for (const s of walk(skillsRoot, 'skills')) {
    const relFromSkill = s.rel.split(path.sep).slice(1).join(path.sep); // 去掉 skills/<name>/ 的第一段
    const dest = path.join(skillsDir, relFromSkill);
    copyWithGuard(s.abs, dest, state, opts, report);
  }

  // 2. references / templates / hosts -> 数据目录
  for (const category of ['references', 'templates', 'hosts']) {
    const src = path.join(assetRoot, category);
    if (!fs.existsSync(src)) continue;
    for (const f of walk(src, category)) {
      const dest = path.join(dataDir, f.rel);
      copyWithGuard(f.abs, dest, state, opts, report);
    }
  }

  // 3. 能力档案目录：只建目录，绝不覆盖
  if (!opts.dryRun) {
    fs.mkdirSync(path.join(dataDir, '能力档案'), { recursive: true });
    // 4. 写安装状态（CLI 独有）
    const next = {
      version: PKG.version,
      host: opts.host,
      skillsDir,
      dataDir,
      installedAt: new Date().toISOString(),
      files: state.files,
    };
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(next, null, 2) + '\n', 'utf8');
  }

  const copied = report.filter((r) => r.action === 'copy').length;
  const same = report.filter((r) => r.action === 'same').length;
  const conflicts = report.filter((r) => r.action === 'conflict');
  console.log(`\n完成：复制/覆盖 ${copied} 个文件，跳过未变更 ${same} 个`);
  if (conflicts.length) {
    console.log(`注意：${conflicts.length} 个文件被本地修改过，已写入 .new 备份，未覆盖：`);
    for (const c of conflicts) console.log(`  - ${c.wrote}`);
  }

  console.log(`
安装完成。首次使用前需要一份能力档案（~/${DATA_DIR}/能力档案/${opts.host}.md）。

已随包安装该宿主的预置实测值：~/${DATA_DIR}/hosts/${opts.host}.md（可采用，需用户确认）。

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
