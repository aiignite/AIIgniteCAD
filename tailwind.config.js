/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Noto Sans', 'sans-serif'],
        mono: ['monospace'],
        display: ['Space Grotesk', 'sans-serif'],
      },
      colors: {
        cad: {
          bg: 'rgb(var(--cad-bg) / <alpha-value>)',
          panel: 'rgb(var(--cad-panel) / <alpha-value>)',
          border: 'rgb(var(--cad-border) / <alpha-value>)',
          primary: '#137fec',
          primaryHover: '#3b8df5',
          text: {
            DEFAULT: 'rgb(var(--cad-text) / <alpha-value>)',
            secondary: 'rgb(var(--cad-text-secondary) / <alpha-value>)',
          },
          muted: 'rgb(var(--cad-muted) / <alpha-value>)',
          grid: 'rgb(var(--cad-grid) / <alpha-value>)',
          secondary: 'rgb(var(--cad-secondary) / <alpha-value>)',
          hover: 'rgb(var(--cad-hover) / <alpha-value>)',
        },
      },
    }
  },
  plugins: [require('tailwindcss-animate')],
}
