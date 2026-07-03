import type { Config } from 'tailwindcss';

// Landing v2 palette (Claude Design handoff, 2026-07): warm off-white canvas,
// near-black ink, coral accent, teal secondary. Legal pages share these tokens.
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#161616',
        ink2: '#8B8984',
        ink3: '#B0ADA6',
        bg: '#F6F5F2',
        bgSoft: '#EFEDE9',
        line: '#EAE8E3',
        accent: '#F05A1F',
        accentDark: '#C4552D',
        accentSoft: '#FDEBE2',
        sea: '#0E7C91',
        seaSoft: '#DFF0F3',
        sand: '#EFEDE9',
        sand2: '#E4E2DD',
      },
      fontFamily: {
        sans: ['var(--font-urbanist)', 'var(--font-tajawal)', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['var(--font-urbanist)', 'var(--font-tajawal)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
