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
          bg: 'var(--cad-bg)',
          panel: 'var(--cad-panel)',
          border: 'var(--cad-border)',
          primary: '#137fec',
          primaryHover: '#3b8df5',
          text: 'var(--cad-text)',
          muted: 'var(--cad-muted)',
          grid: 'var(--cad-grid)'
        }
      }
    }
  },
  plugins: [],
}
