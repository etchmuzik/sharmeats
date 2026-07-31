#!/usr/bin/env node
/**
 * Delete browser source maps from ./out AFTER they have been uploaded to
 * Sentry, so the static export published to Hostinger does not ship the
 * dashboard's own source.
 *
 * WHY: `productionBrowserSourceMaps: true` (next.config.mjs) writes .js.map
 * next to every chunk, and `output: 'export'` copies them into out/ — which is
 * uploaded wholesale to shared hosting. Nothing removed them, so an admin
 * dashboard that controls commission rates, credit issuance and KYC approval
 * served its unminified source to anyone who opened devtools: every role gate,
 * RPC name and table read, legible.
 *
 * ORDER MATTERS: this runs after `sentry:sourcemaps`, which injects Debug IDs
 * and uploads. Sentry keeps its own copy, so symbolication is unaffected —
 * the maps only stop being PUBLIC.
 *
 * The trailing `//# sourceMappingURL=` comment goes too. Leaving it behind
 * would point devtools at a file that is no longer there (a 404 per chunk) and
 * would tell a reader exactly what to go looking for in a stale deploy.
 *
 * Safe to run twice, and a no-op success when out/ does not exist — the plain
 * `next build` path has no out/ and must not fail here.
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OUT_DIR = resolve(process.cwd(), 'out');

if (!existsSync(OUT_DIR)) {
  console.log(`[sourcemaps] Nothing to strip — ${OUT_DIR} not found.`);
  process.exit(0);
}

/** Every file under dir, depth-first. */
function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

// JS uses a line comment, CSS a block comment. Both are emitted, both point at
// a file that no longer exists once this script has run.
const SOURCE_MAPPING_URL = /(^\s*\/\/# sourceMappingURL=.*$)|(\/\*# sourceMappingURL=.*?\*\/)/gm;

const files = walk(OUT_DIR);
let removed = 0;
let rewritten = 0;

for (const file of files) {
  if (file.endsWith('.map')) {
    rmSync(file);
    removed += 1;
    continue;
  }
  if (!file.endsWith('.js') && !file.endsWith('.css')) continue;
  const source = readFileSync(file, 'utf8');
  if (!SOURCE_MAPPING_URL.test(source)) continue;
  // A fresh string, not an in-place edit of `source` — and the regex is reset
  // because /g lastIndex survives a .test() call.
  SOURCE_MAPPING_URL.lastIndex = 0;
  writeFileSync(file, source.replace(SOURCE_MAPPING_URL, '').trimEnd() + '\n');
  rewritten += 1;
}

console.log(
  `[sourcemaps] Stripped ${removed} .map file(s) and ${rewritten} sourceMappingURL comment(s) from out/.`,
);
