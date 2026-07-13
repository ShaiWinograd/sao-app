/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontSize: {
        xs: ['0.875rem', { lineHeight: '1.35rem' }],
        sm: ['1rem', { lineHeight: '1.5rem' }],
      },
      fontFamily: {
        sans: ['Assistant', 'Heebo', 'Noto Sans Hebrew', 'Arial', 'sans-serif'],
      },
      colors: {
        // Muted-green brand from UI_VISUAL_DESIGN_SPEC.md §2.1
        primary: {
          50: '#f4f7f5',
          100: '#eaf0ec',
          200: '#d5e1da',
          300: '#b3c7bc',
          400: '#8caa99',
          500: '#719180',
          600: '#5f7d6e',
          700: '#4e695c',
          800: '#3d5449',
          900: '#2f4038',
        },
        // Supporting terracotta accent (use sparingly) §2.3
        accent: {
          100: '#f7ece7',
          600: '#b66f52',
        },
        // Warm neutral surfaces §2.2
        canvas: '#f7f6f2',
        surface: { DEFAULT: '#ffffff', muted: '#fbfaf7' },
        // Semantic states §2.4 (each pairs a foreground with a soft bg)
        success: { DEFAULT: '#4f7a5a', bg: '#eaf3ec' },
        warning: { DEFAULT: '#b47a26', bg: '#fff4e2' },
        danger: { DEFAULT: '#b85656', bg: '#fbecec' },
        info: { DEFAULT: '#5f7b9a', bg: '#ebf1f6' },
        ok: '#0c6a56',
        // Legacy alias kept so existing bg-brand-* usages resolve to green
        brand: {
          50: '#f4f7f5',
          100: '#eaf0ec',
          500: '#719180',
          600: '#5f7d6e',
          700: '#4e695c',
        },
      },
    },
  },
  plugins: [],
};
