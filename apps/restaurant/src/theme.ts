/**
 * Restaurant app design tokens. Same Sharm Eats palette as the customer/driver
 * apps, but leans on `accent` = violet to visually distinguish the restaurant
 * surface (customer = coral, driver = teal, restaurant = violet).
 *
 * Two palettes, one contract: `lightColors` is the original look, unchanged.
 * `darkColors` is its counterpart. Anything that RENDERS must read the active
 * palette through `useThemeColors()` / `makeStyles()` from ./themeProvider —
 * see the note on `colors` at the bottom for why importing that directly pins a
 * component to light mode forever.
 */

/**
 * What staff picked in the kitchen header. `system` follows the OS.
 *
 * Declared in this leaf module so both the persisted store and the theme
 * provider can import it without an import cycle.
 */
export type ThemeMode = 'system' | 'light' | 'dark';

/** The scheme actually rendered, once `system` has been resolved. */
export type ColorScheme = 'light' | 'dark';

/**
 * Resolve the staff choice against what the OS reports.
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
   * Violet FILL. Deliberately identical in both themes: it backs buttons and
   * chat bubbles carrying a white label at 14–16px bold — small text by WCAG,
   * so 4.5:1 is required rather than the 3:1 large-text allowance. White holds
   * 5.28:1 on this violet either way. For violet as TEXT, use `accentText`.
   */
  accent: string;
  /**
   * The DEEPER violet for text and icons, mostly on an `accentSoft` chip — the
   * unread-messages count, the brand-filter chip, the logo monogram. Despite
   * the name it is never a fill anywhere in this app.
   *
   * It therefore has to INVERT: "deeper than accent" means darker on a pale
   * chip and BRIGHTER on a dark one. The dark value is chosen to land on the
   * contrast it has today (6.55:1 light → 6.65:1 dark).
   */
  accentDark: string;
  accentSoft: string;
  /**
   * Violet as ordinary TEXT or an ICON on the canvas / a card. Same split, and
   * same reason, as the greenText / redText / amberText trio below.
   *
   * Light: identical to `accent`, which already passes at 5.13:1 on the canvas,
   * so the existing light design is unchanged. Dark: 5.09:1 on the canvas.
   */
  accentText: string;
  sea: string;
  coral: string;
  green: string;
  greenSoft: string;
  red: string;
  redSoft: string;
  amber: string;
  amberSoft: string;
  // Text-weight variants of the semantic trio. The values above are tuned for
  // BORDERS and FILLS, where WCAG requires only 3:1 — as small text they fail
  // AA badly (amber on amberSoft is 3.26:1, green on greenSoft 3.67:1, red on
  // redSoft 4.04:1, all against a 4.5:1 requirement). That matters most for the
  // things the kitchen must actually read: the wait timer, per-item notes like
  // "no onions", and the open/closed state — through steam, grease and glare.
  // Use these for any text or icon; keep the originals for borders and fills so
  // the visual language is unchanged.
  greenText: string;
  redText: string;
  amberText: string;
  star: string;
  /** Literal white — the Switch thumb, which rides a coloured track. */
  white: string;
  /** Card / panel background, lifted away from `bg` in both themes. */
  surface: string;
  /** Label or icon on a filled `accent` control. Near-white in both themes. */
  onAccent: string;
  /**
   * Label on any fill whose lightness INVERTS between themes — `green` (Accept)
   * and `red` (Confirm reject), the two decisive controls on a ticket.
   *
   * It cannot track `onAccent`: those fills are dark in light theme and LIGHT in
   * dark theme, so the fixed white label they used would disappear. Measured on
   * the dark theme: 8.32:1 on `green` and 7.49:1 on `red`, where a white label
   * scored 2.27:1 and 2.52:1.
   */
  onInk: string;
}

export const lightColors: Palette = {
  bg: '#fafaf7',
  bgSoft: '#f5f0e1',
  sand: '#f3ead7',
  ink: '#0a0a0c',
  ink2: '#5b5b66',
  ink3: '#6b6770',
  line: '#e8e3d4',
  accent: '#7a3cff', // violet — restaurant primary
  accentDark: '#5b26cc',
  accentSoft: '#ece3ff',
  accentText: '#7a3cff', // 5.13:1 on bg — the fill value already passes in light
  sea: '#0e7c91',
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
  onInk: '#fffdfa',
};

/**
 * Dark palette. Warm-neutral rather than blue-grey, so the brand's sand/violet
 * identity survives the inversion instead of turning into a generic slate app.
 * Canvas and neutrals are shared with the customer and driver dark palettes so
 * the three surfaces still look like one product.
 *
 * A NOTE ON WHY A KITCHEN TABLET GETS A DARK THEME AT ALL: this app also runs
 * on a phone in a back office, and a wall-mounted tablet in a dim prep area at
 * 2am is the case staff complain about. It follows the OS by default and the
 * header control overrides it per device, so a bright galley can pin Light and
 * never see this palette.
 *
 * Contrast, measured against `bg` (#100F0E):
 *   ink #F4F1EC 17.0:1   ink2 #B5AFA7 8.8:1   ink3 #8B847C 5.19:1
 *   accentText #9366FF 5.09:1   accentDark #B08CFF 7.33:1
 *   sea #4FC3D9 9.25:1   coral #FF7A5C 7.47:1   star #E8A317 8.83:1
 *
 * The semantic trio INVERTS its light-mode relationship. In light, the *Text
 * variants are DARKENED to carry contrast on a pale soft background; here the
 * soft backgrounds are dark, so they are LIGHTENED instead:
 *   greenText #63CE96 on greenSoft 7.93:1
 *   redText   #FF9179 on redSoft   7.53:1
 *   amberText #E8B45C on amberSoft 8.14:1
 *
 * `surface` sits only 1.08:1 off the canvas — a deliberately subtle lift. Cards
 * here all carry a 1px `line` border, and that border, not the fill, defines
 * the panel edge. A stronger lift reads as grey plastic.
 */
export const darkColors: Palette = {
  bg: '#100F0E',
  bgSoft: '#171615',
  sand: '#232120',
  ink: '#F4F1EC',
  ink2: '#B5AFA7',
  ink3: '#8B847C',
  line: '#2A2726',
  accent: '#7a3cff', // unchanged: see the note on Palette.accent
  accentDark: '#B08CFF', // inverted: 6.65:1 on accentSoft, matching light's 6.55:1
  accentSoft: '#1E1436',
  accentText: '#9366FF', // 5.09:1 on bg, 4.71:1 on surface, 4.62:1 on accentSoft
  sea: '#4FC3D9',
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
  onInk: '#100F0E',
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
