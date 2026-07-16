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
        // Brand scale is driven by CSS variables so a section can retint it.
        // Default channels (green) live in globals.css :root; the worker area
        // overrides them to purple via the `.worker-theme` scope.
        primary: {
          50: 'rgb(var(--tw-primary-50) / <alpha-value>)',
          100: 'rgb(var(--tw-primary-100) / <alpha-value>)',
          200: 'rgb(var(--tw-primary-200) / <alpha-value>)',
          300: 'rgb(var(--tw-primary-300) / <alpha-value>)',
          400: 'rgb(var(--tw-primary-400) / <alpha-value>)',
          500: 'rgb(var(--tw-primary-500) / <alpha-value>)',
          600: 'rgb(var(--tw-primary-600) / <alpha-value>)',
          700: 'rgb(var(--tw-primary-700) / <alpha-value>)',
          800: 'rgb(var(--tw-primary-800) / <alpha-value>)',
          900: 'rgb(var(--tw-primary-900) / <alpha-value>)',
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
