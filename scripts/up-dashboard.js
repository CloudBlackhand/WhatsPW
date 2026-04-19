#!/usr/bin/env node
'use strict';

/**
 * Legado: antes atualizava waha.config.json → dashboard.ref no GitHub.
 * O dashboard passou a viver em dashboard-ui/ neste repositório.
 */

// eslint-disable-next-line no-console
console.log(
  'Dashboard integrado em dashboard-ui/ (Vite). Para gerar src/dashboard:',
);
// eslint-disable-next-line no-console
console.log('  yarn dashboard:build');
process.exit(0);
