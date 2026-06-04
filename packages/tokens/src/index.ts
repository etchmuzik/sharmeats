/**
 * Sharm Eats design tokens — framework-neutral primitives.
 *
 * Lifted from apps/customer/src/theme.ts so the new surfaces share the exact
 * brand. Raw values only (hex / px numbers) — no RN- or CSS-specific shapes —
 * so both RN StyleSheet and Tailwind/CSS can consume them.
 *
 * Palette identity: warm sand/cream (Sharm desert) + coral accent + sea teal.
 */

export const colors = {
  bg: '#fafaf7',
  bgSoft: '#f5f0e1',
  bgSoft2: '#fbf6e8',
  sand: '#f3ead7',
  sand2: '#ebe0c5',
  ink: '#0a0a0c',
  ink2: '#5b5b66',
  ink3: '#9494a0',
  line: '#e8e3d4',
  line2: '#dad3bf',
  accent: '#ff5a3c',
  accentDark: '#e8482b',
  accentSoft: '#ffeae4',
  sea: '#0e7c91',
  seaSoft: '#dff0f3',
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

export const radius = {
  sm: 8,
  md: 12,
  lg: 14,
  xl: 16,
  xxl: 18,
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
