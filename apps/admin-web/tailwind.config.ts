import type { Config } from 'tailwindcss';
import colors from 'tailwindcss/colors';

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
        // Brand hues keep their flat names via DEFAULT (bg-green, text-red/10, ...)
        // while spreading Tailwind's scale back in so numbered variants
        // (bg-green-600, text-red-600, ...) still resolve.
        green: { ...colors.green, DEFAULT: '#2e8a5d' },
        greensoft: '#e2f1ea',
        red: { ...colors.red, DEFAULT: '#c8412a' },
        redsoft: '#ffe2dc',
        amber: { ...colors.amber, DEFAULT: '#b8791a' },
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
