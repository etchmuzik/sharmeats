#!/usr/bin/env node
//
// check-landing-zones.mjs — the marketing site may not advertise coverage the
// product does not have.
//
// This check exists because the two lists silently disagreed. landing's zone
// grid promised Sunny Lakes, Ras Um Sid and El Montazah — none of which is a
// `zone_type` value, so no address there resolves to a zone and no
// delivery_fee_rules row prices it — while omitting Mubarak 7, Hay El-Nour and
// El-Hadaba Residential, which are real AND the three cheapest zones to deliver
// to. It went unnoticed for the worst possible reason: the COUNT matched. The
// headline said "Eleven zones" and eleven chips rendered, so nothing looked off.
//
// Three assertions, the first two against the migrations rather than a copy:
//   1. Every zone in landing/src/data/zones.ts exists in `public.zones`
//      (migration 002) with the SAME name_en and name_ar.
//   2. Every zone that `delivery_fee_rules` prices (migration 010) appears on
//      the landing page. A served zone we do not advertise is lost orders, and
//      the cheapest three were exactly the ones missing.
//   3. The hero ZONE TICKER in landing/src/app/page.tsx is derived from that
//      same list rather than hand-written. Added 2026-07-30, after the fix
//      above turned out to be half a fix: the grid was corrected and the
//      ticker, a second hardcoded copy forty lines up, kept scrolling all
//      three phantom zones for another two months. It is `aria-hidden`
//      decoration, so nothing read it back — not a test, not a screen reader,
//      not a reviewer skimming the diff.
//
// Run: node scripts/check-landing-zones.mjs   (wired as landing's `npm test`,
// which CI already invokes via `npm test --if-present`).
//
// Exit codes: 0 agree, 1 drift found, 2 could not read a source file.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  try {
    return readFileSync(join(root, rel), 'utf8');
  } catch (err) {
    console.error(`Could not read ${rel}: ${err.message}`);
    process.exit(2);
  }
}

// --- Source of truth: the migrations -----------------------------------------

const schema = read('supabase/migrations/002_app_schema.sql');
const zonesInsert = schema.match(
  /insert into public\.zones \(id, name_en, name_ar\) values([\s\S]*?);/,
);
if (!zonesInsert) {
  console.error(
    'Could not find the `insert into public.zones` block in migration 002. ' +
      'If the seed moved, update this script — do not delete it.',
  );
  process.exit(2);
}

const dbZones = new Map();
for (const [, id, en, ar] of zonesInsert[1].matchAll(
  /\(\s*'([^']+)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/g,
)) {
  dbZones.set(id, { en, ar });
}

const fees = read('supabase/migrations/010_zones_config.sql');
const feeInsert = fees.match(/insert into public\.delivery_fee_rules[\s\S]*?;/);
const pricedZones = new Set(
  feeInsert ? [...feeInsert[0].matchAll(/\(\s*'([^']+)'\s*,/g)].map((m) => m[1]) : [],
);

// --- What the marketing site claims ------------------------------------------

const landing = read('landing/src/data/zones.ts');
const siteZones = new Map();
for (const [, id, en, ar] of landing.matchAll(
  /\{\s*id:\s*'([^']+)'\s*,\s*en:\s*'([^']*)'\s*,\s*ar:\s*'([^']*)'\s*\}/g,
)) {
  siteZones.set(id, { en, ar });
}

// --- Compare ------------------------------------------------------------------

const problems = [];

if (dbZones.size === 0 || siteZones.size === 0 || pricedZones.size === 0) {
  console.error(
    `Parsed nothing: db=${dbZones.size} priced=${pricedZones.size} site=${siteZones.size}. ` +
      'A passing run must actually compare something.',
  );
  process.exit(2);
}

for (const [id, site] of siteZones) {
  const db = dbZones.get(id);
  if (!db) {
    problems.push(`landing advertises "${site.en}" (${id}), which is not a zone in migration 002`);
    continue;
  }
  if (!pricedZones.has(id)) {
    problems.push(`landing advertises "${site.en}" (${id}), which has no delivery_fee_rules row`);
  }
  if (db.en !== site.en) {
    problems.push(`${id}: landing says name_en "${site.en}", migration 002 says "${db.en}"`);
  }
  if (db.ar !== site.ar) {
    problems.push(`${id}: landing says name_ar "${site.ar}", migration 002 says "${db.ar}"`);
  }
}

for (const id of pricedZones) {
  if (!siteZones.has(id)) {
    const name = dbZones.get(id)?.en ?? id;
    problems.push(`"${name}" (${id}) is a priced, deliverable zone that landing does not advertise`);
  }
}

// --- The ticker must be derived, not a second copy -----------------------------
//
// Preferred state: `const TICKER = ZONES.map(...)`, which cannot drift at all.
// A literal array is still allowed — sometimes a literal is the honest thing —
// but then it has to agree with ZONES name-for-name, compared case- and
// punctuation-insensitively because the ticker is styled uppercase and the old
// copy wrote "SHARK'S BAY" for "Sharks Bay".

const page = read('landing/src/app/page.tsx');
const tickerDecl = page.match(/const TICKER\s*(?::[^=]+)?=\s*([\s\S]*?);\s*\n/);

if (!tickerDecl) {
  console.error(
    'Could not find `const TICKER = ...` in landing/src/app/page.tsx. If the ticker ' +
      'moved or was renamed, update this script — do not delete the check.',
  );
  process.exit(2);
} else if (!/\bZONES\b/.test(tickerDecl[1])) {
  const literal = [...tickerDecl[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]);
  if (literal.length === 0) {
    problems.push(
      'TICKER in landing/src/app/page.tsx neither derives from ZONES nor lists names this ' +
        'script can read; it cannot be checked, which is how the last drift survived',
    );
  } else {
    const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const canonical = new Map([...siteZones.values()].map(({ en }) => [norm(en), en]));
    for (const name of literal) {
      if (!canonical.has(norm(name))) {
        problems.push(`the hero ticker scrolls "${name}", which is not a zone we deliver to`);
      }
    }
    for (const [key, en] of canonical) {
      if (!literal.some((name) => norm(name) === key)) {
        problems.push(`the hero ticker omits "${en}", a zone we do deliver to`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error('Landing coverage disagrees with the database:\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\nFix landing/src/data/zones.ts to match supabase/migrations/002_app_schema.sql ' +
      'and 010_zones_config.sql, and keep the TICKER in landing/src/app/page.tsx ' +
      'derived from ZONES. The migrations win: they decide where an order can go.',
  );
  process.exit(1);
}

console.log(
  `Landing coverage matches the database: ${siteZones.size} zones, all present in ` +
    'public.zones and priced in delivery_fee_rules; the hero ticker agrees.',
);
