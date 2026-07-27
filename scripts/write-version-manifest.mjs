#!/usr/bin/env node
/**
 * Write a build-time version manifest to <surface>/public/version.json.
 *
 * WHY THIS EXISTS (package 01 §3)
 * None of the three web surfaces can currently tell you what code they are
 * running. "Deployed" has meant "someone pushed and Vercel probably picked it
 * up", which is not something you can verify during an incident. This makes the
 * deployed commit a fact carried by the artifact itself rather than a claim in
 * a chat message.
 *
 * The file is GENERATED, never hand-edited. That is the whole point: a
 * hand-maintained constant drifts, and a drifted version file is worse than no
 * version file because it is believed.
 *
 * USAGE
 *   node ../../scripts/write-version-manifest.mjs --surface admin-web
 *   node scripts/write-version-manifest.mjs --surface landing --out landing/public
 *
 * Wired into each surface's `prebuild` so a plain `npm run build` cannot
 * produce an artifact without it.
 *
 * PRODUCTION STRICTNESS
 * When NODE_ENV=production, CI=true, or --strict is passed, the script FAILS
 * rather than emitting a manifest it cannot stand behind:
 *   · no git SHA available  -> fail (an unidentifiable build is the problem
 *                             this file exists to prevent)
 *   · working tree dirty    -> fail (the SHA would name a commit that is not
 *                             what is being built)
 * Local dev builds emit the manifest with `dirty: true` and a warning, because
 * blocking a developer's build over uncommitted work would be obstructive.
 *
 * WHAT MUST NEVER GO IN HERE
 * No secrets, tokens, connection strings, environment names or customer data.
 * This file is served publicly and unauthenticated at /version.json. The commit
 * SHA is not sensitive; the repository is private and a SHA discloses nothing on
 * its own. Anything you would not print on a billboard does not belong here.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Surfaces this script knows how to write for, and where their static root is. */
const SURFACES = {
  landing: 'landing/public',
  'admin-web': 'apps/admin-web/public',
  'merchant-web': 'apps/merchant-web/public',
};

function parseArgs(argv) {
  const args = { strict: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--surface') args.surface = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--strict') args.strict = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function git(...cmd) {
  try {
    return execFileSync('git', ['-C', REPO_ROOT, ...cmd], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function usage() {
  console.error(`usage: write-version-manifest.mjs --surface <name> [--out <dir>] [--strict]

  --surface   one of: ${Object.keys(SURFACES).join(', ')}
  --out       override the output directory (default: the surface's public/)
  --strict    fail on a dirty tree or missing SHA (implied by NODE_ENV=production or CI)`);
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.surface) usage();

if (!args.out && !SURFACES[args.surface]) {
  console.error(
    `ERROR: unknown surface "${args.surface}". Known: ${Object.keys(SURFACES).join(', ')}.\n` +
      'Pass --out explicitly if you are adding a new surface.',
  );
  process.exit(2);
}

const strict =
  args.strict || process.env.NODE_ENV === 'production' || process.env.CI === 'true';

// ---------------------------------------------------------------------------
// Commit SHA. Prefer git; fall back to the CI-provided SHA so a shallow or
// detached CI checkout still produces a truthful manifest.
// ---------------------------------------------------------------------------
const commit =
  git('rev-parse', 'HEAD') ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  null;

if (!commit) {
  const msg =
    'no git SHA available (not a git checkout, and neither VERCEL_GIT_COMMIT_SHA nor GITHUB_SHA is set)';
  if (strict) {
    console.error(`ERROR: ${msg}.\nA production build must be identifiable. Refusing to write a manifest.`);
    process.exit(1);
  }
  console.warn(`WARNING: ${msg} — writing commit: null for this local build.`);
}

// ---------------------------------------------------------------------------
// Dirty check. `git status --porcelain` is empty exactly when the tree is
// clean. Untracked files count: they can change the build (a stray page, an
// overriding .env.local), so treating them as clean would let the SHA lie.
// ---------------------------------------------------------------------------
const status = git('status', '--porcelain');
// null means git failed; in that case we already handled the SHA above and
// cannot assert cleanliness, so report dirty rather than claim clean.
const dirty = status === null ? commit !== null : status.length > 0;

if (dirty && strict) {
  console.error(
    'ERROR: the working tree is dirty, so the commit SHA would not describe what is being built.\n' +
      'Commit or stash first. Uncommitted changes:\n' +
      (status || '  <unable to read git status>')
        .split('\n')
        .slice(0, 20)
        .map((l) => `  ${l}`)
        .join('\n'),
  );
  process.exit(1);
}
if (dirty) {
  console.warn('WARNING: working tree is dirty — manifest will record dirty: true.');
}

const manifest = {
  commit,
  builtAt: new Date().toISOString(),
  surface: args.surface,
  dirty,
};

const outDir = resolve(REPO_ROOT, args.out ?? SURFACES[args.surface]);
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'version.json');
writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`version.json → ${outFile}`);
console.log(`  commit ${commit ?? 'null'}${dirty ? ' (DIRTY)' : ''}`);
