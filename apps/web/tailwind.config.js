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
        sans: ['Noto Sans Hebrew', 'Open Sans', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#f0fdf9',
          100: '#ccfbef',
          500: '#0f7a67',
          600: '#0a5a4c',
          700: '#064f42',
        },
        danger: '#b34a3e',
        ok: '#0c6a56',
      },
    },
  },
  plugins: [],
};
