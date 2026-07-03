/**
 * App v2 design language (Claude Design handoff, 2026-07): warm off-white
 * canvas, near-black ink, coral accent, hairline warm-grey lines, white cards
 * with a soft 2/10 shadow, pill CTAs, floating dark (#131313) tab nav.
 * Semantic status colors (green/red/amber/blue) are kept from v1 — they are
 * meaning, not styling, and the design does not respecify them.
 */
export const colors = {
  bg: '#F6F5F2',
  bgSoft: '#EFEDE9',
  bgSoft2: '#F1EFEB',
  sand: '#EBE9E4',
  sand2: '#E4E2DD',
  ink: '#161616',
  ink2: '#8B8984',
  ink3: '#B0ADA6',
  /** Dark surface for the floating pill nav / dark CTAs / wallet card. */
  inkDeep: '#131313',
  line: '#EAE8E3',
  line2: '#DDDAD4',
  accent: '#F05A1F',
  accentDark: '#C4552D',
  accentSoft: '#FDEEE7',
  sea: '#0E7C91',
  seaSoft: '#DFF0F3',
  green: '#2e8a5d',
  greenSoft: '#e2f1ea',
  blue: '#0070f3',
  blueSoft: '#e6f0ff',
  red: '#c8412a',
  redSoft: '#ffe2dc',
  amber: '#b8791a',
  amberSoft: '#fbf2dd',
  star: '#e8a317',
  white: '#ffffff',
  black: '#000000',
} as const;

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
    xs: 10,
    sm: 11,
    md: 12,
    base: 13,
    lg: 14,
    xl: 15,
    '2xl': 16,
    '3xl': 18,
    '4xl': 20,
    '5xl': 22,
    '6xl': 24,
    '7xl': 26,
    '8xl': 28,
    '9xl': 32,
    '10xl': 38,
    '11xl': 48,
  },
} as const;

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
    shadowColor: '#000',
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
