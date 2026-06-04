import type { CSSProperties } from "react";

/**
 * Sharm Eats — primary logo: the bold stacked wordmark.
 *
 * Faithful port of the Claude Design handoff "Sharm Eats Logo.html"
 * (the chosen Direction E). There is NO symbol — the name is the logo:
 * "SHARM" tracked over a big lowercase "eats" in coral, on a dark app tile.
 *
 * Everything is sized RELATIVE to `size`, so the mark scales crisply from a
 * 232px hero tile down to a 29px home-screen icon without re-tuning.
 *
 * These components are self-contained (brand hex inlined, Sora-first font
 * stack) so the logo is portable — usable on the light marketing site, in a
 * dark app header, or exported to a static file. Pass `fontFamily` to use a
 * loaded Sora (e.g. next/font's --font-sora) for pixel-exact rendering.
 */

// ---- Brand palette (from the Sharm Eats design system) ----
export const BRAND = {
  cream: "#fafaf7",
  coral: "#ff5a3c",
  coralLight: "#ff7559",
  coralDeep: "#ed3f20",
  ink: "#0a0a0c",
  tile: "#100e12", // dark app-tile surface
  sand: "#f3ead7",
  gold: "#e8a317",
  teal: "#0e7c91",
} as const;

/** Sora-first display stack. Override with a loaded font for exact metrics. */
const DISPLAY_STACK = '"Sora", "Plus Jakarta Sans", system-ui, sans-serif';

const SHADOW_LG = "0 16px 40px rgba(0,0,0,.55)";

export interface TileFinish {
  /** Tile background — solid color or any CSS gradient. */
  tile: string;
  /** Color of the tracked top word ("SHARM"). */
  topColor: string;
  /** Color of the big bottom word ("eats"). */
  bottomColor: string;
}

/** The three approved color finishes. */
export const FINISHES: Record<"darkCoral" | "coralInk" | "sandLight", TileFinish> = {
  darkCoral: { tile: BRAND.tile, topColor: BRAND.cream, bottomColor: BRAND.coral },
  coralInk: { tile: `linear-gradient(135deg,${BRAND.coralLight},${BRAND.coralDeep})`, topColor: "#fff", bottomColor: BRAND.tile },
  sandLight: { tile: BRAND.sand, topColor: BRAND.ink, bottomColor: BRAND.coral },
};

/**
 * StackedTile — the square app-tile logo. "SHARM" stacked over "eats".
 * Ported from logo-canvas.jsx <StackedTile>. All metrics are `size`-relative.
 */
export function StackedTile({
  size = 200,
  radius = 0.27,
  finish = FINISHES.darkCoral,
  top = "SHARM",
  bottom = "eats",
  shadow = true,
  fontFamily = DISPLAY_STACK,
  style,
}: {
  size?: number;
  radius?: number;
  finish?: TileFinish;
  top?: string;
  bottom?: string;
  shadow?: boolean;
  fontFamily?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * radius,
        background: finish.tile,
        boxShadow: shadow ? SHADOW_LG : "none",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily,
        lineHeight: 1,
        ...style,
      }}
    >
      <span
        style={{
          fontWeight: 800,
          fontSize: size * 0.15,
          letterSpacing: size * 0.018,
          color: finish.topColor,
          paddingLeft: size * 0.018,
        }}
      >
        {top}
      </span>
      <span
        style={{
          fontWeight: 800,
          fontSize: size * 0.345,
          letterSpacing: size * -0.012,
          color: finish.bottomColor,
          marginTop: size * 0.012,
        }}
      >
        {bottom}
      </span>
    </div>
  );
}

/**
 * StackedRow — the one-line header lockup: "SHARM eats".
 * Ported from logo-canvas.jsx <StackedRow>. Use in headers / footers.
 */
export function StackedRow({
  size = 44,
  sharm = BRAND.cream,
  eats = BRAND.coral,
  fontFamily = DISPLAY_STACK,
  style,
}: {
  size?: number;
  sharm?: string;
  eats?: string;
  fontFamily?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        fontFamily,
        fontWeight: 800,
        fontSize: size,
        lineHeight: 1,
        letterSpacing: size * -0.01,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      <span style={{ color: sharm, letterSpacing: size * 0.02 }}>SHARM</span>
      <span style={{ color: eats }}>&nbsp;eats</span>
    </span>
  );
}

/**
 * AppIcon — the home-screen icon. In the chosen direction the app tile IS
 * the StackedTile (dark · coral finish), so this is a thin alias that locks
 * the icon proportions (squircle radius, shadow) for clarity at call sites.
 */
export function AppIcon({
  size = 132,
  finish = FINISHES.darkCoral,
  shadow = true,
  style,
}: {
  size?: number;
  finish?: TileFinish;
  shadow?: boolean;
  style?: CSSProperties;
}) {
  return <StackedTile size={size} finish={finish} shadow={shadow} style={style} />;
}
