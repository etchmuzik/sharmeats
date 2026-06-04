/**
 * Generate Sharm Eats logo assets (SVG + PNG) from the design spec.
 *
 * The logo is pure type (Sora 800). To make the exported files render
 * IDENTICALLY everywhere — including standalone, as a favicon, and through
 * sharp's rasterizer (which doesn't reliably render <text>) — we OUTLINE the
 * glyphs to vector <path>s with opentype.js. The result has zero font
 * dependency.
 *
 * Metrics mirror src/components/brand/SharmLogo.tsx exactly:
 *   StackedTile: radius=size*0.27, tile bg, "SHARM" @ 0.15em / +0.018 track,
 *                "eats" @ 0.345em / -0.012 track, gap marginTop size*0.012.
 *   StackedRow:  "SHARM" (+0.02 track) + " eats", overall -0.01 track.
 *
 * Run: node scripts/generate-logo-assets.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import opentype from "opentype.js";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "public", "brand");
mkdirSync(OUT, { recursive: true });

// Sora 800 (ExtraBold), static single-weight TTF — the wordmark face.
// Self-bootstrapping: fetched on first run so the script is standalone (no
// committed font binary). Fontsource serves clean per-weight static TTFs.
const FONT_DIR = join(ROOT, ".tmp-fonts");
const FONT_PATH = join(FONT_DIR, "Sora-800.ttf");
const FONT_URL = "https://cdn.jsdelivr.net/fontsource/fonts/sora@latest/latin-800-normal.ttf";
if (!existsSync(FONT_PATH)) {
  mkdirSync(FONT_DIR, { recursive: true });
  console.log("Fetching Sora 800 TTF …");
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`Failed to fetch Sora font: ${res.status}`);
  writeFileSync(FONT_PATH, Buffer.from(await res.arrayBuffer()));
}

// opentype v2 deprecated loadSync; parse an ArrayBuffer directly. Slice to
// the exact byte range — a Node Buffer can be a view into a larger pool.
const _fb = readFileSync(FONT_PATH);
const FONT = opentype.parse(_fb.buffer.slice(_fb.byteOffset, _fb.byteOffset + _fb.byteLength));

const BRAND = {
  cream: "#fafaf7",
  coral: "#ff5a3c",
  coralLight: "#ff7559",
  coralDeep: "#ed3f20",
  ink: "#0a0a0c",
  tile: "#100e12",
  sand: "#f3ead7",
};

/**
 * Lay out a single word as an outlined SVG path at a given font size +
 * CSS-style letter-spacing (px added after each glyph). Returns the path
 * `d`, the total advance width (incl. trailing track, as CSS boxes it), and
 * vertical metrics. Baseline is at y=0; caller translates.
 */
function layoutWord(text, fontSize, letterSpacing) {
  const scale = fontSize / FONT.unitsPerEm;
  let x = 0;
  let d = "";
  const glyphs = FONT.stringToGlyphs(text);
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    const p = g.getPath(x, 0, fontSize); // baseline y=0
    d += p.toPathData(3) + " ";
    x += (g.advanceWidth || 0) * scale + letterSpacing;
  }
  // CSS adds trailing letter-spacing to the box width.
  const width = x;
  const ascent = FONT.ascender * scale;
  const descent = FONT.descender * scale; // negative
  return { d: d.trim(), width, ascent, descent };
}

const round = (n) => Math.round(n * 1000) / 1000;

/** Build the square app-tile SVG (outlined). */
function tileSVG({ size = 512, finish }) {
  const radius = size * 0.27;
  // Font metrics (match SharmLogo.tsx)
  const topSize = size * 0.15;
  const topTrack = size * 0.018;
  const botSize = size * 0.345;
  const botTrack = size * -0.012;
  const gap = size * 0.012;

  const top = layoutWord("SHARM", topSize, topTrack);
  const bot = layoutWord("eats", botSize, botTrack);

  // Cap heights for visual vertical centering (use cap/x heights, not full
  // line boxes, so the pair sits optically centered like flex-center does on
  // single-line spans). Approximate the rendered line box by ascent+|descent|
  // but center on the glyphs' visual band.
  const topLineH = topSize; // span line-height:1
  const botLineH = botSize;
  const blockH = topLineH + gap + botLineH;
  const startY = (size - blockH) / 2;

  // Baseline for each line = top of line box + ascent-portion. With
  // line-height:1 the glyphs are vertically centered in the em box; we place
  // the baseline at lineTop + fontSize*0.80 (Sora cap sits ~0.72-0.80 em).
  const topBaseline = startY + topSize * 0.8;
  const botBaseline = startY + topLineH + gap + botSize * 0.8;

  // Horizontal centering. CSS centers the full advance box (incl. trailing
  // track); the tile also nudges SHARM right by paddingLeft size*0.018.
  const topPadLeft = size * 0.018;
  const topX = (size - top.width) / 2 + topPadLeft / 2;
  const botX = (size - bot.width) / 2;

  const fill = finish.tile.startsWith("linear-gradient")
    ? 'url(#tileGrad)'
    : finish.tile;
  const grad = finish.tile.startsWith("linear-gradient")
    ? `<defs><linearGradient id="tileGrad" x1="0" y1="0" x2="1" y2="1">
         <stop stop-color="${BRAND.coralLight}"/><stop offset="1" stop-color="${BRAND.coralDeep}"/>
       </linearGradient></defs>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${grad}
  <rect width="${size}" height="${size}" rx="${round(radius)}" fill="${fill}"/>
  <g transform="translate(${round(topX)}, ${round(topBaseline)})" fill="${finish.topColor}">
    <path d="${top.d}"/>
  </g>
  <g transform="translate(${round(botX)}, ${round(botBaseline)})" fill="${finish.bottomColor}">
    <path d="${bot.d}"/>
  </g>
</svg>`;
}

/** Build the one-line wordmark SVG (outlined), transparent bg. */
function wordmarkSVG({ height = 120, sharm = BRAND.cream, eats = BRAND.coral, pad = 0.25 }) {
  const fontSize = height;
  const sharmTrack = fontSize * 0.02;
  const overall = fontSize * -0.01;
  // "SHARM" then " eats" (leading nbsp space). Build as two words with a
  // space-width gap between, applying overall track between glyphs.
  const w1 = layoutWord("SHARM", fontSize, sharmTrack + overall);
  const spaceAdvance = (FONT.charToGlyph(" ").advanceWidth / FONT.unitsPerEm) * fontSize + overall;
  const w2 = layoutWord("eats", fontSize, overall);

  const padX = fontSize * pad;
  const padY = fontSize * 0.28;
  const baseline = padY + fontSize * 0.8;
  const x1 = padX;
  const x2 = padX + w1.width + spaceAdvance;
  const totalW = padX * 2 + w1.width + spaceAdvance + w2.width;
  const totalH = padY * 2 + fontSize;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${round(totalW)}" height="${round(totalH)}" viewBox="0 0 ${round(totalW)} ${round(totalH)}">
  <g transform="translate(${round(x1)}, ${round(baseline)})" fill="${sharm}"><path d="${w1.d}"/></g>
  <g transform="translate(${round(x2)}, ${round(baseline)})" fill="${eats}"><path d="${w2.d}"/></g>
</svg>`;
}

// ---------------------------------------------------------------------------
// Write SVGs
// ---------------------------------------------------------------------------
const FINISHES = {
  darkCoral: { tile: BRAND.tile, topColor: BRAND.cream, bottomColor: BRAND.coral },
  coralInk: { tile: "linear-gradient", topColor: "#ffffff", bottomColor: BRAND.tile },
  sandLight: { tile: BRAND.sand, topColor: BRAND.ink, bottomColor: BRAND.coral },
};

const svgTile = tileSVG({ size: 512, finish: FINISHES.darkCoral });
const svgTileSand = tileSVG({ size: 512, finish: FINISHES.sandLight });
const svgTileCoral = tileSVG({ size: 512, finish: FINISHES.coralInk });
const svgWordmark = wordmarkSVG({ height: 120 });

writeFileSync(join(OUT, "sharm-eats-tile.svg"), svgTile);
writeFileSync(join(OUT, "sharm-eats-tile-sand.svg"), svgTileSand);
writeFileSync(join(OUT, "sharm-eats-tile-coral.svg"), svgTileCoral);
writeFileSync(join(OUT, "sharm-eats-wordmark.svg"), svgWordmark);
console.log("✓ SVGs written:", ["sharm-eats-tile", "sharm-eats-tile-sand", "sharm-eats-tile-coral", "sharm-eats-wordmark"].join(", "));

// ---------------------------------------------------------------------------
// Rasterize PNG app icons (from the dark·coral tile — pure paths, so sharp
// renders them exactly) + a maskable/any set of standard sizes.
// ---------------------------------------------------------------------------
const tileBuf = Buffer.from(svgTile);
const PNG_SIZES = [512, 192, 180, 120, 64, 32];
for (const s of PNG_SIZES) {
  const buf = await sharp(tileBuf, { density: 384 }).resize(s, s).png().toBuffer();
  writeFileSync(join(OUT, `icon-${s}.png`), buf);
}
console.log("✓ PNG icons written:", PNG_SIZES.map((s) => `icon-${s}`).join(", "));

// Apple touch icon alias (180) + favicon PNG (32) at conventional names
writeFileSync(join(OUT, "apple-touch-icon.png"), readFileSync(join(OUT, "icon-180.png")));

// favicon.ico (multi-size 16/32/48) → app/ for Next App Router auto-detection
const icoSizes = [16, 32, 48];
const icoPngs = await Promise.all(
  icoSizes.map((s) => sharp(tileBuf, { density: 384 }).resize(s, s).png().toBuffer())
);
// Minimal ICO writer (PNG-encoded entries, supported by all modern browsers).
function buildIco(pngs, sizes) {
  const count = pngs.length;
  const header = Buffer.alloc(6 + count * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  let offset = 6 + count * 16;
  const body = [];
  sizes.forEach((s, i) => {
    const png = pngs[i];
    const dirOff = 6 + i * 16;
    header.writeUInt8(s >= 256 ? 0 : s, dirOff + 0);
    header.writeUInt8(s >= 256 ? 0 : s, dirOff + 1);
    header.writeUInt8(0, dirOff + 2);
    header.writeUInt8(0, dirOff + 3);
    header.writeUInt16LE(1, dirOff + 4);
    header.writeUInt16LE(32, dirOff + 6);
    header.writeUInt32LE(png.length, dirOff + 8);
    header.writeUInt32LE(offset, dirOff + 12);
    offset += png.length;
    body.push(png);
  });
  return Buffer.concat([header, ...body]);
}
const ico = buildIco(icoPngs, icoSizes);
writeFileSync(join(OUT, "favicon.ico"), ico);
console.log("✓ favicon.ico + apple-touch-icon.png written");

console.log("\nAll logo assets generated into public/brand/");
