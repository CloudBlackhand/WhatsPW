#!/usr/bin/env node
'use strict';

/**
 * Garante `src/dashboard/index.html` antes de `nest start`.
 * Primeira execução: npm ci + build em dashboard-ui/ (Vite).
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const indexHtml = path.join(root, 'src', 'dashboard', 'index.html');

if (fs.existsSync(indexHtml)) {
  process.exit(0);
}

console.warn(
  '[WhatsPW] Dashboard em falta; a compilar a partir de dashboard-ui/ …',
);

const run = (cmd) => {
  execSync(cmd, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
};

try {
  run('npm ci --prefix dashboard-ui');
  run('npm run build --prefix dashboard-ui');
} catch {
  console.error(
    '[WhatsPW] Falha ao compilar o dashboard. Executa: yarn dashboard:install && yarn dashboard:build',
  );
  process.exit(1);
}
