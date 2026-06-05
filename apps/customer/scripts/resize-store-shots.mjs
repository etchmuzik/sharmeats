#!/usr/bin/env node
/**
 * Resize raw native simulator screenshots into exact App Store Connect slot
 * sizes, WITHOUT distortion.
 *
 * App Store Connect iPhone/iPad slots are fixed pixel sizes. A raw grab from
 * an iPhone 16 Pro Max is 1320×2868 (6.9"); the iPad Pro 13" is 2064×2752.
 * Apple accepts a small set of exact dimensions per device class. We use
 * `sharp` with `fit: 'cover'` + center position so the aspect-correct image
 * fills the slot edge-to-edge (a few px of the very top/bottom may be trimmed —
 * fine, since the status bar / home indicator are not content).
 *
 * Usage:  node scripts/resize-store-shots.mjs <RAW_DIR> <OUT_DIR> <slot>
 *   slot = "iphone69" (1320×2868) | "iphone65" (1242×2688) | "ipad13" (2048×2732)
 *
 * Writes <OUT_DIR>/<slot>/<name>.png (and a .jpg for upload size headroom).
 */
import { readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import sharp from 'sharp';

const SLOTS = {
  iphone69: { w: 1320, h: 2868 },
  iphone65: { w: 1242, h: 2688 },
  ipad13: { w: 2048, h: 2732 },
};

const [, , rawDir, outDir, slotKey] = process.argv;
if (!rawDir || !outDir || !slotKey || !SLOTS[slotKey]) {
  console.error('usage: resize-store-shots.mjs <RAW_DIR> <OUT_DIR> <iphone69|iphone65|ipad13>');
  process.exit(1);
}
const { w, h } = SLOTS[slotKey];
const dest = join(outDir, slotKey);
mkdirSync(dest, { recursive: true });

const pngs = readdirSync(rawDir).filter((f) => extname(f).toLowerCase() === '.png').sort();
if (pngs.length === 0) {
  console.error(`No PNGs found in ${rawDir}`);
  process.exit(1);
}

for (const file of pngs) {
  const name = basename(file, '.png');
  const src = join(rawDir, file);
  const base = sharp(src).resize(w, h, { fit: 'cover', position: 'centre' });
  await base.clone().png().toFile(join(dest, `${name}.png`));
  await base.clone().jpeg({ quality: 92 }).toFile(join(dest, `${name}.jpg`));
  console.log(`  ${slotKey}: ${name}.png (${w}×${h})`);
}
console.log(`Done → ${dest}`);
