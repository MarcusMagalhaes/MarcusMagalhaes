/** @type {import('tailwindcss').Config} */
// Identidade Finanway (21/10/2026, tirada da arte by One Way): grafite = carvão #24282C (primária: menu ativo, títulos,
// botões; fundo da arte #181B1F) e laranja = #E97D25 (destaque: faixa do cabeçalho, setas da marca, alertas).
// Cinza metálico do "FINAN" = grafite-500 #6A7077. Textos secundários em slate.
export default {
  content: ['./index.html', './src/**/*.tsx'],   // só .tsx: os .ts de lib têm regex/strings que o Tailwind confunde com classes
  theme: {
    extend: {
      colors: {
        grafite: {
          50: '#f6f7f8', 100: '#eceef0', 200: '#d7dade', 300: '#b7bcc2', 400: '#8d939a',
          500: '#6a7077', 600: '#535960', 700: '#42474d', 800: '#33373c', 900: '#24282c', 950: '#181b1f',
        },
        laranja: {
          50: '#fff6ee', 100: '#ffe9d5', 200: '#fdcfa8', 300: '#f9ad6d', 400: '#f2913f',
          500: '#e97d25', 600: '#cc6514', 700: '#a74f10', 800: '#864113', 900: '#6d3713',
        },
      },
      fontFamily: { sans: ['Montserrat', 'Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
}
