#!/usr/bin/env node
'use strict';

/**
 * 将仓库根的共享数据（references / templates / hosts）复制到 packages/cli/assets，供 npm pack 打包。
 * Skill 由上游 npx skills / gh skill 从 GitHub 仓库安装，不进入 npm 包。
 * 运行时（仓库内直接执行 index.js）不需要 assets，CLI 会回退到仓库根。
 */

const fs = require('fs');
const path = require('path');

const pkgRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(pkgRoot, '..', '..');
const assets = path.join(pkgRoot, 'assets');
const categories = ['references', 'templates', 'hosts'];

fs.rmSync(assets, { recursive: true, force: true });
fs.mkdirSync(assets, { recursive: true });

for (const category of categories) {
  const src = path.join(repoRoot, category);
  if (!fs.existsSync(src)) {
    throw new Error(`缺少资产目录：${src}`);
  }
  fs.cpSync(src, path.join(assets, category), { recursive: true });
  console.log(`[prepack] ${category} -> assets/${category}`);
}
