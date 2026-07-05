/**
 * Sharm Eats design tokens — framework-neutral primitives.
 *
 * Lifted from apps/customer/src/theme.ts so the new surfaces share the exact
 * brand. Raw values only (hex / px numbers) — no RN- or CSS-specific shapes —
 * so both RN StyleSheet and Tailwind/CSS can consume them.
 *
 * Palette identity (v2, Claude Design handoff 2026-07): warm off-white canvas,
 * near-black ink, coral accent, hairline warm-grey lines + sea teal.
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

export const fontSizes = {
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
} as const;

export const fontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
  black: '900',
} as const;

export type ColorToken = keyof typeof colors;
