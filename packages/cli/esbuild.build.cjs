// Copyright 2026 ParallelAgent Contributors
// SPDX-License-Identifier: Apache-2.0
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/index.js',
  platform: 'node',
  format: 'esm',
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: false,
  target: 'node18',
  logLevel: 'info',
};

/** 构建时把 adapters/trae/skills/ 拷到 assets/skills/ */
function copySkillAssets() {
  const srcRoot = path.join(__dirname, '..', '..', 'adapters', 'trae', 'skills');
  const destRoot = path.join(__dirname, 'assets', 'skills');
  fs.rmSync(destRoot, { recursive: true, force: true });
  fs.cpSync(srcRoot, destRoot, { recursive: true });
  console.log('[assets] skills copied → assets/skills/');
}

/** 构建时把 adapters/trae/shared/references/ 拷到 assets/shared/references/ */
function copyReferenceAssets() {
  const srcRoot = path.join(__dirname, '..', '..', 'adapters', 'trae', 'shared', 'references');
  const destRoot = path.join(__dirname, 'assets', 'shared', 'references');
  fs.rmSync(destRoot, { recursive: true, force: true });
  fs.cpSync(srcRoot, destRoot, { recursive: true });
  console.log('[assets] references copied → assets/shared/references/');
}

async function main() {
  await esbuild.build(options);
  copySkillAssets();
  copyReferenceAssets();
  console.log('[esbuild] build complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
