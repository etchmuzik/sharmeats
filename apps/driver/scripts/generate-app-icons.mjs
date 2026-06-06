/**
 * Generate the Sharm Eats DRIVER app icon set.
 *
 * Same brand tile as the customer app, but on the driver TEAL (#0e7c91)
 * background so the two apps are instantly distinguishable on a phone home
 * screen (customer = dark tile, driver = teal tile). The App Store requires a
 * 1024×1024 OPAQUE (no-alpha) icon — flatten() guarantees that, avoiding the
 * transparent-icon rejection the customer app hit.
 *
 * Writes:
 *   - assets/icon.png            1024 opaque  (Expo `icon`, iOS App Store)
 *   - assets/adaptive-icon.png   1024 foreground (Android adaptive)
 *   - assets/splash-icon.png     512  (splash)
 *   - assets/favicon.png         48   (web)
 *
 * sharp is resolved from the landing app (driver doesn't depend on it).
 * Run from apps/driver:  node scripts/generate-app-icons.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRIVER = join(__dirname, "..");
const REPO = join(DRIVER, "..", "..");
const LANDING = join(REPO, "landing");
const OUT = join(DRIVER, "assets");
mkdirSync(OUT, { recursive: true });

const requireFromLanding = createRequire(pathToFileURL(join(LANDING, "package.json")));
const sharp = requireFromLanding("sharp");

const TEAL = "#0e7c91"; // driver brand background (matches the splash)

// Reuse the committed brand tile but recolor its background rect to teal.
// The source tile's background is the single `#100e12` fill on the <rect>.
const tileSrc = readFileSync(join(LANDING, "public", "brand", "sharm-eats-tile.svg"), "utf8");
const svg = Buffer.from(tileSrc.replace('fill="#100e12"', `fill="${TEAL}"`));

async function opaque(size) {
  return sharp(svg, { density: 512 })
    .resize(size, size)
    .flatten({ background: TEAL })
    .png()
    .toBuffer();
}

writeFileSync(join(OUT, "icon.png"), await opaque(1024));
writeFileSync(join(OUT, "adaptive-icon.png"), await opaque(1024));
writeFileSync(join(OUT, "splash-icon.png"), await opaque(512));
writeFileSync(join(OUT, "favicon.png"), await opaque(48));

console.log("✓ Driver app icons written to apps/driver/assets/ (teal #0e7c91): icon.png (1024 opaque), adaptive-icon.png, splash-icon.png, favicon.png");
