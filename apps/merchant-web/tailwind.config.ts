import type { Config } from 'tailwindcss';

// Sharm Eats brand palette (mirrors packages/tokens). Kept inline here so the
// dashboard has no build-time dependency on the RN tokens package.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#fafaf7',
        bgsoft: '#f5f0e1',
        sand: '#f3ead7',
        ink: '#0a0a0c',
        ink2: '#5b5b66',
        ink3: '#9494a0',
        line: '#e8e3d4',
        accent: '#ff5a3c',
        accentdark: '#e8482b',
        accentsoft: '#ffeae4',
        sea: '#0e7c91',
        green: '#2e8a5d',
        greensoft: '#e2f1ea',
        red: '#c8412a',
        redsoft: '#ffe2dc',
        amber: '#b8791a',
        star: '#e8a317',
      },
      borderRadius: {
        xl: '16px',
        '2xl': '18px',
      },
    },
  },
  plugins: [],
};

export default config;
