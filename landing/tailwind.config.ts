import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0a0a0c',
        ink2: '#5b5b66',
        ink3: '#9494a0',
        bg: '#fafaf7',
        bgSoft: '#f5f0e1',
        line: '#e8e3d4',
        accent: '#ff5a3c',
        accentDark: '#e8482b',
        accentSoft: '#ffeae4',
        sea: '#0e7c91',
        seaSoft: '#dff0f3',
        sand: '#f3ead7',
        sand2: '#ebe0c5',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
