/** @type {import('tailwindcss').Config} */
// Identidade FinFlow (21/10/2026, tirada da logo): grafite = #34404C (primária: menu ativo, títulos, botões);
// laranja = #E65F03 (destaque: faixa do cabeçalho, setas da marca, alertas). Textos secundários em slate.
export default {
  content: ['./index.html', './src/**/*.tsx'],   // só .tsx: os .ts de lib têm regex/strings que o Tailwind confunde com classes
  theme: {
    extend: {
      colors: {
        grafite: {
          50: '#f6f7f9', 100: '#eceff2', 200: '#d6dce2', 300: '#b3bcc5', 400: '#8a96a1',
          500: '#6f7c89', 600: '#5b6977', 700: '#4a5866', 800: '#3e4b58', 900: '#34404c',
        },
        laranja: {
          50: '#fff4ec', 100: '#ffe6d3', 200: '#fec9a5', 300: '#fda56c', 400: '#fb8133',
          500: '#e65f03', 600: '#c94f02', 700: '#a53f05', 800: '#85350b', 900: '#6c2d0c',
        },
      },
      fontFamily: { sans: ['Montserrat', 'Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
}
