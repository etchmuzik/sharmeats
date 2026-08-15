#!/usr/bin/env node

/**
 * Upload static-export browser source maps to Sentry when configured, then
 * remove every map and sourceMappingURL reference from the public artifact.
 *
 * Source maps are build inputs for private telemetry, not deployable assets.
 * Cleanup therefore runs whether upload succeeds, is skipped, or fails.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { parse, resolve } from 'node:path';

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const artifactDir = resolve(process.cwd(), argument('--dir', 'out'));
const filesystemRoot = parse(artifactDir).root;

if (artifactDir === filesystemRoot || artifactDir === resolve(process.cwd())) {
  console.error(`[sentry] Refusing unsafe artifact directory: ${artifactDir}`);
  process.exit(1);
}

if (!existsSync(artifactDir)) {
  console.log(`[sentry] No artifact at ${artifactDir}; nothing to upload or clean.`);
  process.exit(0);
}

/** Walk regular files only; never traverse symlinks in a generated artifact. */
function filesBelow(directory, result = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      filesBelow(path, result);
    } else if (entry.isFile() && lstatSync(path).isFile()) {
      result.push(path);
    }
  }
  return result;
}

function runSentryCli(args) {
  const result = spawnSync('npx', ['--no-install', 'sentry-cli', ...args], {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`sentry-cli ${args.join(' ')} exited with code ${result.status}`);
  }
}

const uploadVariables = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'];
const missingVariables = uploadVariables.filter((name) => !process.env[name]);
let uploadError = null;

try {
  if (missingVariables.length > 0) {
    console.log(
      `[sentry] Skipping source-map upload; missing ${missingVariables.join(', ')}.`,
    );
  } else {
    console.log(`[sentry] Injecting Debug IDs into ${artifactDir} …`);
    runSentryCli(['sourcemaps', 'inject', artifactDir]);
    console.log(`[sentry] Uploading source maps from ${artifactDir} …`);
    runSentryCli(['sourcemaps', 'upload', artifactDir]);
    console.log('[sentry] Source-map upload complete.');
  }
} catch (error) {
  uploadError = error;
} finally {
  const files = filesBelow(artifactDir);
  let removedMaps = 0;
  let strippedReferences = 0;

  for (const path of files) {
    if (path.endsWith('.map')) {
      unlinkSync(path);
      removedMaps += 1;
      continue;
    }
    if (!path.endsWith('.js')) continue;

    const before = readFileSync(path, 'utf8');
    const after = before
      .replace(/^\s*\/\/[#@]\s*sourceMappingURL=.*$/gm, '')
      .replace(/\/\*[#@]\s*sourceMappingURL=.*?\*\//gs, '');
    if (after !== before) {
      writeFileSync(path, after);
      strippedReferences += 1;
    }
  }

  console.log(
    `[sentry] Public artifact cleaned: ${removedMaps} map(s) removed, ` +
      `${strippedReferences} JavaScript reference(s) stripped.`,
  );
}

if (uploadError) {
  // Loud, but NOT fatal. The security-relevant half — deleting every map and
  // sourceMappingURL from the public artifact — has already run above. Exiting
  // non-zero here aborts build-hostinger.sh under `set -e` BEFORE it copies
  // public/.htaccess into out/, producing an artifact that looks complete but
  // ships with no HTTPS redirect, no SPA fallback and none of the security
  // headers. A Sentry outage or an expired token must never degrade the
  // deployed site — the same fail-safe as SENTRY_DISABLE_AUTO_UPLOAD.
  console.error('[sentry] Source-map upload failed:', uploadError.message);
  console.error(
    '[sentry] ::warning::Maps were still removed from the public artifact; ' +
      'stack traces for this release will not be symbolicated.',
  );
}
