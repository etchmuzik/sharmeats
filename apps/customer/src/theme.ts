/**
 * App v2 design language (Claude Design handoff, 2026-07): warm off-white
 * canvas, near-black ink, coral accent, hairline warm-grey lines, white cards
 * with a soft 2/10 shadow, pill CTAs, floating dark (#131313) tab nav.
 * Semantic status colors (green/red/amber/blue) are kept from v1 — they are
 * meaning, not styling, and the design does not respecify them.
 *
 * DARK MODE (2026-07): the palette is now a pair of tables behind one shape
 * (`Palette`). Components must not import `colors` directly — they read the
 * ACTIVE palette from `useThemeColors()` / `makeStyles()` in ./themeProvider,
 * because a React Native `StyleSheet.create` at module scope bakes its color
 * values in at import time and can never follow a theme change.
 *
 * Three tokens exist purely to keep dark mode honest, and replace the
 * overloaded `white` that used to serve all of these jobs at once:
 *
 *   - `surface`  — a card/panel background. Lifts AWAY from `bg` in both
 *                  themes (whiter than the canvas in light, lighter grey than
 *                  the canvas in dark).
 *   - `onAccent` — a label or icon sitting ON a filled accent control.
 *                  Stays near-white in BOTH themes.
 *   - `onInk`    — a label or icon on an `ink`-FILLED control. Must INVERT with
 *                  `ink` (near-white in light, near-black in dark), because the
 *                  "selected chip" pattern here fills with `ink` and `ink` is
 *                  itself near-white on the dark theme.
 *
 * `white` survives as a literal for the few places that genuinely want white
 * regardless of theme — the rings around map markers and avatars, which sit on
 * map tiles and photos rather than on a themed surface.
 */

/**
 * What the user picked in Settings. `system` follows the OS appearance.
 *
 * Declared here, in the leaf module, so both the session store (which persists
 * it) and the theme provider (which resolves it) can import it without an
 * import cycle.
 */
export type ThemeMode = 'system' | 'light' | 'dark';

/** The scheme actually rendered, once `system` has been resolved. */
export type ColorScheme = 'light' | 'dark';

/**
 * Resolve the mode the user picked against what the OS reports.
 *
 * Lives here rather than in themeProvider so it is testable without pulling in
 * react-native (whose Flow-typed source vitest cannot parse).
 *
 * `system` is deliberately strict about what counts as dark: RN's
 * `useColorScheme()` can return null (value not yet known) or 'unspecified',
 * and treating either as dark would flash a dark frame on a light device during
 * the first render. Only a literal 'dark' opts in.
 */
export function resolveScheme(mode: ThemeMode, system: string | null | undefined): ColorScheme {
  if (mode === 'light' || mode === 'dark') return mode;
  return system === 'dark' ? 'dark' : 'light';
}

/** The token contract both palettes satisfy. */
export interface Palette {
  bg: string;
  bgSoft: string;
  bgSoft2: string;
  sand: string;
  sand2: string;
  ink: string;
  ink2: string;
  ink3: string;
  /** Dark surface for the floating pill nav / dark CTAs / wallet card. */
  inkDeep: string;
  line: string;
  line2: string;
  accent: string;
  accentDark: string;
  accentSoft: string;
  sea: string;
  seaSoft: string;
  green: string;
  greenSoft: string;
  blue: string;
  blueSoft: string;
  red: string;
  redSoft: string;
  amber: string;
  amberSoft: string;
  star: string;
  /** Literal white — map-marker and avatar rings only. Not a card surface. */
  white: string;
  black: string;
  /** Card / panel background. Lifted away from `bg` in both themes. */
  surface: string;
  /** Label or icon on a filled accent control. Near-white in both themes. */
  onAccent: string;
  /**
   * A label or glyph ON a filled status control (green/sea/red). Unlike
   * `onAccent`, this inverts in dark mode: the status fills lighten there, so
   * near-white text drops to ~2:1 against them — near-black is the readable
   * pair. Use for text/icons on status-colored backgrounds.
   */
  onStatus: string;
  /**
   * Label or icon on an `ink`-FILLED control (the selected chip / segmented
   * control / primary pill). This has to INVERT with `ink`, not track
   * `onAccent`: `ink` is near-black in light and near-white in dark, so a
   * fixed near-white label vanishes on the dark theme's light chip.
   */
  onInk: string;
  /** Muted secondary text on an `ink`-filled control. Inverts with `ink`. */
  onInkMuted: string;
  /** Translucent chip/fill layered on an `ink`-filled control. */
  onInkOverlay: string;
}

export const lightColors: Palette = {
  bg: '#FAF9F6',
  bgSoft: '#F2EFEA',
  bgSoft2: '#F6F2EC',
  sand: '#EEE8DE',
  sand2: '#E4DCCF',
  ink: '#141210',
  ink2: '#554F49',
  ink3: '#706A64',
  inkDeep: '#131313',
  line: '#EAE8E3',
  line2: '#DDDAD4',
  accent: '#C8452F',
  accentDark: '#963222',
  accentSoft: '#FBEAE4',
  sea: '#0E7C91',
  seaSoft: '#DFF0F3',
  green: '#2e8a5d',
  greenSoft: '#e2f1ea',
  blue: '#0070f3',
  blueSoft: '#e6f0ff',
  red: '#c8412a',
  redSoft: '#ffe2dc',
  amber: '#8F5D10',
  amberSoft: '#fbf2dd',
  star: '#B07818',
  white: '#FFFDFA',
  black: '#141210',
  surface: '#FFFDFA',
  onAccent: '#FFFDFA',
  onStatus: '#FFFDFA',
  onInk: '#FFFDFA',
  onInkMuted: 'rgba(255,255,255,0.75)',
  onInkOverlay: 'rgba(255,255,255,0.16)',
};

/**
 * Dark palette. Warm-neutral rather than blue-grey, so the brand's sand/coral
 * identity survives the inversion instead of turning into a generic slate app.
 *
 * Contrast, measured against `bg` (#100F0E):
 *   ink   #F4F1EC ~17:1    ink2 #B5AFA7 ~9.5:1    ink3 #8B847C ~5.6:1
 *   accent #DE5335 ~4.9:1  — passes AA as text/icon on the canvas.
 *
 * `accent` is deliberately NOT just a lightened coral: brightening it far
 * enough to pop on the canvas would drop `onAccent` white button labels below
 * 3:1. #DE5335 holds ~4.9:1 as ink on the canvas while keeping ~3.8:1 for the
 * bold white label sitting on top of it.
 *
 * `inkDeep` INVERTS its relationship to the canvas here. In light it is a dark
 * slab that stands out against an off-white page; the same #131313 on a near
 * black canvas would disappear, so in dark it becomes a LIFTED surface. The
 * floating tab bar keeps reading as a floating object either way.
 */
export const darkColors: Palette = {
  bg: '#100F0E',
  bgSoft: '#171615',
  bgSoft2: '#1B1918',
  sand: '#232120',
  sand2: '#2B2827',
  ink: '#F4F1EC',
  ink2: '#B5AFA7',
  ink3: '#8B847C',
  inkDeep: '#262322',
  line: '#2A2726',
  line2: '#3A3634',
  accent: '#DE5335',
  accentDark: '#B23F26',
  accentSoft: '#2E1712',
  sea: '#4FC3D9',
  seaSoft: '#102A30',
  green: '#4FBF85',
  greenSoft: '#12291E',
  blue: '#5FA8FF',
  blueSoft: '#121F33',
  red: '#FF7A63',
  redSoft: '#331713',
  amber: '#E0A340',
  amberSoft: '#2E2312',
  star: '#E8A317',
  white: '#FFFDFA',
  black: '#000000',
  surface: '#1A1817',
  onAccent: '#FFFDFA',
  onStatus: '#17191A',
  onInk: '#100F0E',
  onInkMuted: 'rgba(16,15,14,0.72)',
  onInkOverlay: 'rgba(16,15,14,0.14)',
};

/**
 * The light palette, kept as a named export for the handful of NON-component
 * modules that need a color outside React (and for tests). Anything that
 * renders must use `useThemeColors()` instead, or it will be stuck in light
 * mode forever.
 */
export const colors = lightColors;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

// v2 rounds everything up a notch: cards live at 18–24, controls at pill.
export const radius = {
  sm: 10,
  md: 14,
  lg: 16,
  xl: 18,
  xxl: 20,
  xxxl: 24,
  pill: 999,
} as const;

export const font = {
  weights: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
    extrabold: '800' as const,
    black: '900' as const,
  },
  sizes: {
    xs: 12,
    sm: 13,
    md: 14,
    base: 15,
    lg: 16,
    xl: 17,
    '2xl': 18,
    '3xl': 20,
    '4xl': 22,
    '5xl': 24,
    '6xl': 26,
    '7xl': 28,
    '8xl': 30,
    '9xl': 34,
    '10xl': 40,
    '11xl': 48,
  },
} as const;

/**
 * Elevation. Intentionally theme-independent: a near-black shadow is
 * essentially invisible on the dark canvas, which is the correct outcome —
 * dark mode conveys elevation with `surface` lifting away from `bg` and with
 * the `line` hairline, not with drop shadows.
 */
export const shadow = {
  // Design card shadow: 0 2px 10px rgba(23,20,16,.04)
  soft: {
    shadowColor: '#171410',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  card: {
    shadowColor: '#171410',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  // Floating pill nav: 0 18px 40px rgba(0,0,0,.22)
  nav: {
    shadowColor: '#141210',
    shadowOpacity: 0.22,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 18 },
    elevation: 12,
  },
  accentGlow: {
    shadowColor: '#F05A1F',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
} as const;
