import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0a0a0c',
        ink2: '#5b5b66',
        bg: '#fafaf7',
        accent: '#ff5a3c',
        accentDark: '#e8482b',
        accentSoft: '#ffeae4',
        sea: '#0e7c91',
        sand: '#f3ead7',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
export default config;
