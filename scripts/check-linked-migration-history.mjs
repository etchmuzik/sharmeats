#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'supabase',
  [
    'migration',
    'list',
    '--linked',
    '--output-format',
    'json',
  ],
  {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  },
);

if (result.error) {
  console.error(`Could not run Supabase CLI: ${result.error.message}`);
  process.exit(2);
}
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 2);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error('Supabase CLI did not return valid JSON.');
  process.stderr.write(result.stdout);
  process.exit(2);
}

const migrations = Array.isArray(report.migrations) ? report.migrations : [];
const localOnly = migrations.filter(({ local, remote }) => local && !remote);
const remoteOnly = migrations.filter(({ local, remote }) => !local && remote);
const mismatched = migrations.filter(
  ({ local, remote }) => local && remote && local !== remote,
);

if (localOnly.length || remoteOnly.length || mismatched.length) {
  console.error('BLOCKED: linked migration history does not match the repository.');
  console.error(
    `local-only=${localOnly.length} remote-only=${remoteOnly.length} mismatched=${mismatched.length}`,
  );
  for (const row of [...localOnly, ...remoteOnly, ...mismatched].slice(0, 12)) {
    console.error(`  local=${row.local || '-'} remote=${row.remote || '-'}`);
  }
  console.error(
    'Do not run supabase db push. Follow docs/DATABASE-RELEASE-RUNBOOK.md.',
  );
  process.exit(1);
}

console.log(`Linked migration history is aligned (${migrations.length} migrations).`);
