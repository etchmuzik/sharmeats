/**
 * Restaurant app design tokens. Same Sharm Eats palette as the customer/driver
 * apps, but leans on `accent` = violet to visually distinguish the restaurant
 * surface (customer = coral, driver = teal, restaurant = violet).
 */
export const colors = {
  bg: '#fafaf7',
  bgSoft: '#f5f0e1',
  sand: '#f3ead7',
  ink: '#0a0a0c',
  ink2: '#5b5b66',
  ink3: '#9494a0',
  line: '#e8e3d4',
  accent: '#7a3cff', // violet — restaurant primary
  accentDark: '#5b26cc',
  accentSoft: '#ece3ff',
  sea: '#0e7c91',
  coral: '#ff5a3c',
  green: '#2e8a5d',
  greenSoft: '#e2f1ea',
  red: '#c8412a',
  redSoft: '#ffe2dc',
  amber: '#b8791a',
  amberSoft: '#fbf2dd',
  star: '#e8a317',
  white: '#ffffff',
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
