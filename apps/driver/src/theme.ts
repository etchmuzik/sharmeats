/**
 * Driver app design tokens. Mirrors the Sharm Eats brand (same palette as the
 * customer app + packages/tokens). The driver app leans on `sea` (teal) as its
 * primary accent to visually distinguish it from the customer app's coral.
 */
export const colors = {
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
  coral: '#ff5a3c',
  green: '#2e8a5d',
  greenSoft: '#e2f1ea',
  red: '#c8412a',
  redSoft: '#ffe2dc',
  amber: '#b8791a',
  amberSoft: '#fbf2dd',
  // Text-weight variants of the semantic trio. The values above are tuned for
  // BORDERS and FILLS, where WCAG requires only 3:1 — as small text they fail
  // AA (amber on amberSoft is 3.26:1, red on redSoft 4.04:1, against a 4.5:1
  // requirement). Matters most on the offer countdown chip and the COD-owed
  // figure, read one-handed in direct sun. Use these for text and icons; keep
  // the originals for borders and fills so the visual language is unchanged.
  greenText: '#1f6b45', // 5.54:1 on greenSoft, 6.37:1 on white
  redText: '#a8301c', //   5.53:1 on redSoft,   6.66:1 on white
  amberText: '#8a5a10', // 5.31:1 on amberSoft, 5.83:1 on white
  star: '#e8a317',
  white: '#fffdfa',
} as const;

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
