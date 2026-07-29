/**
 * Driver app design tokens. Mirrors the Sharm Eats brand (same palette as the
 * customer app + packages/tokens). The driver app leans on `sea` (teal) as its
 * primary accent to visually distinguish it from the customer app's coral.
 *
 * Two palettes, one contract: `lightColors` is the original v1 look, unchanged.
 * `darkColors` is its counterpart. Anything that RENDERS must read the active
 * palette through `useThemeColors()` / `makeStyles()` from ./themeProvider —
 * see the note on `colors` at the bottom for why importing that directly pins a
 * component to light mode forever.
 */

/**
 * What the driver picked in the header control. `system` follows the OS.
 *
 * Declared in this leaf module so both the persisted store and the theme
 * provider can import it without an import cycle.
 */
export type ThemeMode = 'system' | 'light' | 'dark';

/** The scheme actually rendered, once `system` has been resolved. */
export type ColorScheme = 'light' | 'dark';

/**
 * Resolve the driver's choice against what the OS reports.
 *
 * Lives here rather than in themeProvider so it is testable without importing
 * react-native (whose Flow-typed source vitest cannot parse).
 *
 * `system` is deliberately strict about what counts as dark: RN's
 * `useColorScheme()` can return null (value not yet known) or 'unspecified',
 * and treating either as dark would flash a dark frame on a light device during
 * the first render.
 */
export function resolveScheme(mode: ThemeMode, system: string | null | undefined): ColorScheme {
  if (mode === 'light' || mode === 'dark') return mode;
  return system === 'dark' ? 'dark' : 'light';
}

/** The token contract both palettes satisfy. */
export interface Palette {
  bg: string;
  bgSoft: string;
  sand: string;
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  /**
   * Teal FILL. Deliberately identical in both themes: it is the background of
   * primary buttons that carry a white label, and those labels are 14–16px
   * bold — small text by WCAG, so they need 4.5:1, not the 3:1 large-text
   * allowance. White holds 4.80:1 on this teal. Lightening it for the dark
   * canvas (the obvious move) would drop those labels to ~3.2:1 and below.
   * For teal as TEXT on a dark canvas, use `accentText`.
   */
  accent: string;
  /**
   * The DEEPER teal for text and icons, mostly on `accentSoft` chips — the
   * countdown figure, the hotel-handoff badge, the avatar monogram. Despite the
   * name it is never a fill anywhere in this app.
   *
   * It therefore has to INVERT: "deeper than accent" means darker on a pale
   * chip and BRIGHTER on a dark one. Left at its light value it would sit at
   * 2.07:1 on the dark `accentSoft` — invisible. The dark value is chosen to
   * land on the same contrast it has today (6.21:1 light → 6.13:1 dark), so the
   * emphasis step over `accentText` survives the inversion.
   */
  accentDark: string;
  accentSoft: string;
  /**
   * Teal as ordinary TEXT or an ICON on the canvas / a card ("Sign out", the
   * sign-in links). Same split, and same reason, as the greenText / redText /
   * amberText trio below: a value tuned as a FILL fails AA as small text, so
   * the two roles cannot share one token.
   *
   * Light: identical to `accent`, which already passes at 4.66:1 on the canvas,
   * so the existing light design is unchanged. Dark: 5.90:1 on the canvas,
   * 5.46:1 on a card.
   */
  accentText: string;
  coral: string;
  green: string;
  greenSoft: string;
  red: string;
  redSoft: string;
  amber: string;
  amberSoft: string;
  // Text-weight variants of the semantic trio. The fill values are tuned for
  // BORDERS and FILLS, where WCAG requires only 3:1 — as small text they fail
  // AA (amber on amberSoft is 3.26:1, red on redSoft 4.04:1, against a 4.5:1
  // requirement). Matters most on the offer countdown chip and the COD-owed
  // figure, read one-handed in direct sun. Use these for text and icons; keep
  // the originals for borders and fills so the visual language is unchanged.
  greenText: string;
  redText: string;
  amberText: string;
  star: string;
  /** Literal white — avatar/marker rings that sit on photos, not on a surface. */
  white: string;
  /** Card / panel background, lifted away from `bg` in both themes. */
  surface: string;
  /** Label or icon on a filled `accent` control. Near-white in both themes. */
  onAccent: string;
  /**
   * Label on any fill whose lightness INVERTS between themes — `ink` (the
   * active-delivery card, the primary job button), and equally `green` (the
   * Accept button) and `ink3` (its expired state).
   *
   * It cannot track `onAccent`: those fills are dark in light theme and LIGHT
   * in dark theme, so the fixed white label they used would disappear. Measured
   * on the dark theme: 17.0:1 on `ink`, 8.32:1 on `green`, 5.19:1 on `ink3`
   * — where a white label scored 2.27:1 on green and 3.64:1 on ink3.
   */
  onInk: string;
  /** Secondary label on an ink slab (the status line). Inverts with `ink`. */
  onInkMuted: string;
  /** Faintest label on an ink slab ("· tap to continue"). Inverts with `ink`. */
  onInkFaint: string;
}

export const lightColors: Palette = {
  bg: '#fafaf7',
  bgSoft: '#f5f0e1',
  sand: '#f3ead7',
  ink: '#0a0a0c',
  ink2: '#5b5b66',
  ink3: '#6b6770',
  line: '#e8e3d4',
  accent: '#0e7c91', // sea teal — driver primary
  accentDark: '#0a5f70',
  accentSoft: '#dff0f3',
  accentText: '#0e7c91', // 4.66:1 on bg — the fill value already passes in light
  coral: '#ff5a3c',
  green: '#2e8a5d',
  greenSoft: '#e2f1ea',
  red: '#c8412a',
  redSoft: '#ffe2dc',
  amber: '#b8791a',
  amberSoft: '#fbf2dd',
  greenText: '#1f6b45', // 5.54:1 on greenSoft, 6.37:1 on white
  redText: '#a8301c', //   5.53:1 on redSoft,   6.66:1 on white
  amberText: '#8a5a10', // 5.31:1 on amberSoft, 5.83:1 on white
  star: '#e8a317',
  white: '#fffdfa',
  surface: '#fffdfa',
  onAccent: '#fffdfa',
  onInk: '#fffdfa', //     19.48:1 on the light ink slab
  onInkMuted: '#cfd6da', // 13.45:1 — was hardcoded in ActiveJobCard
  onInkFaint: '#8d979c', //  6.63:1 — was hardcoded in ActiveJobCard
};

/**
 * Dark palette. Warm-neutral rather than blue-grey, so the brand's sand/teal
 * identity survives the inversion instead of turning into a generic slate app.
 * Canvas and neutrals are shared with the customer app's dark palette so the
 * two surfaces still look like one product.
 *
 * Contrast, measured against `bg` (#100F0E):
 *   ink #F4F1EC 17.0:1   ink2 #B5AFA7 8.8:1   ink3 #8B847C 5.19:1
 *   accentText #1D9CB5 5.90:1   accentDark #35B4CC 7.80:1
 *   coral #FF7A5C 7.47:1   star #E8A317 8.83:1
 *
 * The semantic trio INVERTS its light-mode relationship. In light, the *Text
 * variants are DARKENED to carry contrast on a pale soft background; here the
 * soft backgrounds are dark, so they are LIGHTENED instead:
 *   greenText #63CE96 on greenSoft 7.93:1
 *   redText   #FF9179 on redSoft   7.53:1
 *   amberText #E8B45C on amberSoft 8.14:1
 *
 * `surface` sits only 1.08:1 off the canvas — a deliberately subtle lift. Cards
 * in this app all carry a 1px `line` border, and that border, not the fill, is
 * what defines the panel edge. A stronger lift reads as grey plastic.
 */
export const darkColors: Palette = {
  bg: '#100F0E',
  bgSoft: '#171615',
  sand: '#232120',
  ink: '#F4F1EC',
  ink2: '#B5AFA7',
  ink3: '#8B847C',
  line: '#2A2726',
  accent: '#0e7c91', // unchanged: see the note on Palette.accent
  accentDark: '#35B4CC', // inverted: 6.13:1 on accentSoft, matching light's 6.21:1
  accentSoft: '#0E2A31',
  accentText: '#1D9CB5', // 5.90:1 on bg, 5.46:1 on surface, 4.64:1 on accentSoft
  coral: '#FF7A5C',
  green: '#4FBF85',
  greenSoft: '#12291E',
  red: '#FF7A63',
  redSoft: '#331713',
  amber: '#E0A340',
  amberSoft: '#2E2312',
  greenText: '#63CE96',
  redText: '#FF9179',
  amberText: '#E8B45C',
  star: '#E8A317',
  white: '#fffdfa',
  surface: '#1A1817',
  onAccent: '#fffdfa',
  // Inverted against the now near-white `ink` slab. Ratios mirror the light
  // hierarchy: faint lands at 6.06:1 against light's 6.63:1.
  onInk: '#100F0E', //     17.00:1 on the dark ink slab
  onInkMuted: '#3E3A35', // 10.01:1
  onInkFaint: '#5F5A54', //  6.06:1
};

/**
 * The light palette, kept as a named export for the handful of NON-component
 * modules that need a color outside React (and for tests). Anything that
 * renders must use `useThemeColors()` / `makeStyles()` instead, or it will be
 * stuck in light mode forever.
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
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 14,
  xl: 16,
  xxl: 20,
  pill: 999,
} as const;

export const font = {
  weights: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
    extrabold: '800' as const,
  },
  sizes: {
    xs: 11,
    sm: 12,
    base: 14,
    lg: 16,
    xl: 18,
    xxl: 22,
    xxxl: 28,
    huge: 36,
  },
} as const;
