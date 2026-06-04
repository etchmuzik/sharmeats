/**
 * Generate the Sharm Eats customer-app icon set from the brand tile.
 *
 * The App Store requires a 1024×1024 OPAQUE (no alpha) icon; the default
 * Expo icon causes guaranteed review rejection. This rasterizes the brand
 * "SHARM eats" tile (outlined-path SVG, zero font dependency) into:
 *   - assets/icon.png            1024 opaque  (Expo `icon`, iOS App Store)
 *   - assets/adaptive-icon.png   1024 foreground (Android adaptive)
 *   - assets/splash-icon.png     512  (splash)
 *   - assets/favicon.png         48   (web)
 *
 * Source SVG is the committed landing brand asset. sharp is resolved from
 * the landing app (the customer app doesn't depend on it).
 *
 * Run from apps/customer:  node scripts/generate-app-icons.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CUSTOMER = join(__dirname, "..");
const REPO = join(CUSTOMER, "..", "..");
const LANDING = join(REPO, "landing");
const OUT = join(CUSTOMER, "assets");
mkdirSync(OUT, { recursive: true });

// Resolve sharp from the landing app (where it's installed).
const requireFromLanding = createRequire(pathToFileURL(join(LANDING, "package.json")));
const sharp = requireFromLanding("sharp");

const TILE = "#100e12"; // opaque dark-tile background (matches the design)
const svg = readFileSync(join(LANDING, "public", "brand", "sharm-eats-tile.svg"));

// 1024 opaque App Store / Expo icon. flatten() removes alpha → no rejection.
async function opaque(size) {
  return sharp(svg, { density: 512 })
    .resize(size, size)
    .flatten({ background: TILE })
    .png()
    .toBuffer();
}

writeFileSync(join(OUT, "icon.png"), await opaque(1024));
writeFileSync(join(OUT, "adaptive-icon.png"), await opaque(1024));
writeFileSync(join(OUT, "splash-icon.png"), await opaque(512));
writeFileSync(join(OUT, "favicon.png"), await opaque(48));

console.log("✓ App icons written to apps/customer/assets/: icon.png (1024 opaque), adaptive-icon.png, splash-icon.png, favicon.png");
