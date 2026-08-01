#!/usr/bin/env node
//
// Fail the build when two migrations claim the same NNN prefix.
//
// WHY THIS EXISTS. On 2026-08-01 two sessions worked the repo in parallel, both
// read "the highest migration is 201", and both wrote a 202:
//
//   202_audit_20260731_p0_p1_fixes.sql
//   202_platform_settings_secret_keys_lockdown.sql
//
// CLAUDE.md had warned about exactly this collision hours earlier, and the
// warning did not help — because the failure is a RACE BETWEEN CONCURRENT
// READERS, not someone trusting a stale number. Both authors did the correct
// thing (read the highest number off disk) and still collided. Documentation
// cannot fix a race; a check that runs on both branches can.
//
// Production survived because Supabase records migrations under timestamp
// versions, not the filename prefix. The damage is to anyone rebuilding from
// migrations, and to every future reader who cannot tell which 202 ran first.
//
// The check also refuses a prefix that is not exactly three digits, since
// `2020_foo.sql` sorts before `203_foo.sql` and would apply in the wrong order.
//
// Usage:  node scripts/check-migration-numbers.mjs     (exit 0 clean, 1 dirty)

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');

// Collisions that predate this check and are already applied to production.
// Renumbering an applied migration is worse than the duplication: the ledger
// records what actually ran, and rewriting history to satisfy a linter would
// make the repo disagree with the database. New entries must NEVER be added
// here to silence a fresh collision — renumber the newer file instead.
const GRANDFATHERED = new Set(['026']);

const NUMBERED = /^(\d+)_.*\.sql$/;
// The three legacy YYYYMMDDHHMMSS_name.sql files sort after the numbered ones
// and are applied by timestamp; they are not part of the NNN sequence.
const TIMESTAMPED = /^\d{14}_.*\.sql$/;

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));

const byNumber = new Map();
const malformed = [];

for (const file of files) {
  if (TIMESTAMPED.test(file)) continue;
  const m = NUMBERED.exec(file);
  if (!m) {
    malformed.push(file);
    continue;
  }
  const prefix = m[1];
  if (prefix.length !== 3) {
    malformed.push(`${file} (prefix "${prefix}" is ${prefix.length} digits, expected 3)`);
    continue;
  }
  if (!byNumber.has(prefix)) byNumber.set(prefix, []);
  byNumber.get(prefix).push(file);
}

const collisions = [...byNumber.entries()]
  .filter(([n, fs]) => fs.length > 1 && !GRANDFATHERED.has(n))
  .sort(([a], [b]) => a.localeCompare(b));

let failed = false;

if (collisions.length > 0) {
  failed = true;
  console.error('✗ Duplicate migration numbers:\n');
  for (const [n, fs] of collisions) {
    console.error(`  ${n} is claimed by ${fs.length} files:`);
    for (const f of fs.sort()) console.error(`      ${f}`);
  }
  console.error(
    '\n  Renumber the NEWER file to the next free number. Do not add it to\n' +
      '  GRANDFATHERED — that list is only for collisions already applied to\n' +
      '  production before this check existed.\n' +
      '\n  Next free number:',
    nextFree(byNumber),
  );
}

if (malformed.length > 0) {
  failed = true;
  console.error('\n✗ Migrations whose prefix is not exactly NNN_:\n');
  for (const f of malformed) console.error(`      ${f}`);
  console.error(
    '\n  Numeric prefixes are compared as strings by every tool that orders\n' +
      '  these files, so "2020_" sorts before "203_" and would apply out of order.',
  );
}

if (failed) process.exit(1);

const highest = [...byNumber.keys()].sort((a, b) => Number(a) - Number(b)).at(-1);
console.log(
  `✓ ${byNumber.size} distinct migration numbers, no collisions ` +
    `(highest ${highest}; next free ${nextFree(byNumber)})`,
);

// Always one past the highest, never a gap. Gaps in this sequence are
// deliberate history (a migration that was written and dropped), and reusing
// one would make two different changes share a number across git history.
function nextFree(map) {
  const max = Math.max(...[...map.keys()].map(Number));
  return String(max + 1).padStart(3, '0');
}
