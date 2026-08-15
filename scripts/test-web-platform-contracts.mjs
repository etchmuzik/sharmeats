#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const repo = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(join(repo, path), 'utf8');

assert.equal(read('.nvmrc').trim(), '22', 'local and CI Node versions must share .nvmrc');

for (const path of [
  'apps/admin-web/package.json',
  'apps/merchant-web/package.json',
  'landing/package.json',
]) {
  const manifest = JSON.parse(read(path));
  assert.equal(manifest.engines?.node, '22.x', `${path} must pin the deployed Node major`);
}

const workflow = read('.github/workflows/ci.yml');
assert.match(workflow, /node-version-file:\s*\.nvmrc/);
assert.doesNotMatch(workflow, /npm ci\s*\|\|/);
assert.doesNotMatch(workflow, /--if-present/);

for (const path of [
  'landing/public/.htaccess',
  'apps/admin-web/public/.htaccess',
  'apps/merchant-web/public/.htaccess',
]) {
  const apache = read(path);
  assert.match(apache, /Content-Security-Policy/, `${path} must set a CSP`);
  assert.match(apache, /Strict-Transport-Security/, `${path} must set HSTS`);
  assert.match(apache, /X-Content-Type-Options/, `${path} must disable MIME sniffing`);
  assert.match(apache, /Referrer-Policy/, `${path} must set a referrer policy`);
  assert.match(apache, /FilesMatch "\\\.map\$"/, `${path} must deny source-map requests`);
}

for (const path of [
  'apps/admin-web/next.config.mjs',
  'apps/merchant-web/next.config.mjs',
  'landing/next.config.mjs',
]) {
  const href = `${pathToFileURL(join(repo, path)).href}?contract=${Date.now()}-${path}`;
  const { default: config } = await import(href);
  assert.equal(typeof config.headers, 'function', `${path} must set headers for server hosting`);
  const rules = await config.headers();
  const flattened = rules.flatMap((rule) => rule.headers ?? []);
  assert.ok(flattened.some((header) => header.key === 'Content-Security-Policy'));
  assert.ok(flattened.some((header) => header.key === 'Strict-Transport-Security'));
}

for (const path of [
  'apps/admin-web/scripts/build-hostinger.sh',
  'apps/merchant-web/scripts/build-hostinger.sh',
]) {
  assert.match(read(path), /npm run sentry:sourcemaps/, `${path} must finalize source maps`);
}

const fixture = mkdtempSync(join(tmpdir(), 'sharmeats-web-maps-'));
try {
  const nested = join(fixture, '_next', 'static');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, 'app.js.map'), '{"version":3}\n');
  writeFileSync(join(nested, 'app.js'), 'console.log("ok")\n//# sourceMappingURL=app.js.map\n');

  const run = spawnSync(
    process.execPath,
    [join(repo, 'scripts/finalize-web-sourcemaps.mjs'), '--dir', fixture],
    {
      cwd: repo,
      env: {
        ...process.env,
        SENTRY_AUTH_TOKEN: '',
        SENTRY_ORG: '',
        SENTRY_PROJECT: '',
      },
      encoding: 'utf8',
    },
  );
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.throws(() => readFileSync(join(nested, 'app.js.map')));
  assert.doesNotMatch(readFileSync(join(nested, 'app.js'), 'utf8'), /sourceMappingURL/);
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log('web platform contracts: PASS');
