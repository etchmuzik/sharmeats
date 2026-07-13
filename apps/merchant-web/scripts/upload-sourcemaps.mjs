#!/usr/bin/env node
/**
 * Upload static-export source maps to Sentry so browser stack traces are
 * symbolicated (readable) instead of pointing into minified chunks.
 *
 * This runs AFTER `STATIC_EXPORT=1 next build` has produced ./out (which now
 * contains .js + .js.map thanks to `productionBrowserSourceMaps: true` in
 * next.config.mjs). It is deliberately NOT wired into next.config via
 * withSentryConfig — that plugin is a server-build (.next) Webpack/Turbopack
 * hook and is unsupported under `output: 'export'`. A post-build sentry-cli
 * step keeps the static export completely untouched.
 *
 * FAIL-SAFE / OPT-IN: this is a no-op success (exit 0) when any of the three
 * build-time upload vars is missing. A token-less build (the current default,
 * e.g. Hostinger / local) still succeeds — nothing is uploaded and nothing
 * breaks. Set SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT (in CI or the
 * owner's shell) to actually upload. No secret is ever hardcoded here.
 *
 * Steps (order matters):
 *   1. sourcemaps inject ./out  — stamps Debug IDs into the JS + maps so events
 *      resolve to the exact uploaded artifacts regardless of release/version.
 *   2. sourcemaps upload ./out  — ships the artifacts to Sentry.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT_DIR = resolve(process.cwd(), 'out');

const { SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT } = process.env;

// Gate: skip cleanly unless every required upload var is present.
const missing = [
  ['SENTRY_AUTH_TOKEN', SENTRY_AUTH_TOKEN],
  ['SENTRY_ORG', SENTRY_ORG],
  ['SENTRY_PROJECT', SENTRY_PROJECT],
]
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missing.length > 0) {
  console.log(
    `[sentry] Skipping source-map upload — missing ${missing.join(', ')}. ` +
      'Build succeeds; stack traces stay unsymbolicated until these are set.',
  );
  process.exit(0);
}

if (!existsSync(OUT_DIR)) {
  console.log(
    `[sentry] Skipping source-map upload — ${OUT_DIR} not found. ` +
      'Run the static export first (STATIC_EXPORT=1 next build).',
  );
  process.exit(0);
}

/** Run a sentry-cli subcommand, inheriting stdio; throw on non-zero exit. */
function runSentryCli(args) {
  // `npx --no-install` uses the @sentry/cli devDependency already resolved in
  // node_modules; it never triggers a network install.
  const result = spawnSync(
    'npx',
    ['--no-install', 'sentry-cli', ...args],
    { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' },
  );
  if (result.error) throw result.error;
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`sentry-cli ${args.join(' ')} exited with code ${result.status}`);
  }
}

try {
  console.log('[sentry] Injecting Debug IDs into ./out …');
  runSentryCli(['sourcemaps', 'inject', OUT_DIR]);

  console.log('[sentry] Uploading source maps from ./out …');
  runSentryCli(['sourcemaps', 'upload', OUT_DIR]);

  console.log('[sentry] Source-map upload complete.');
} catch (err) {
  console.error('[sentry] Source-map upload failed:', err.message);
  process.exit(1);
}
