import type { Config } from 'tailwindcss';

// Sharm Eats brand palette (mirrors packages/tokens). Kept inline here so the
// dashboard has no build-time dependency on the RN tokens package.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#F6F5F2',
        bgsoft: '#EFEDE9',
        sand: '#EBE9E4',
        ink: '#161616',
        ink2: '#8B8984',
        ink3: '#B0ADA6',
        line: '#EAE8E3',
        accent: '#F05A1F',
        accentdark: '#C4552D',
        accentsoft: '#FDEEE7',
        sea: '#0E7C91',
        green: '#2e8a5d',
        greensoft: '#e2f1ea',
        red: '#c8412a',
        redsoft: '#ffe2dc',
        amber: '#b8791a',
        star: '#e8a317',
      },
      borderRadius: {
        xl: '18px',
        '2xl': '20px',
      },
    },
  },
  plugins: [],
};

export default config;
