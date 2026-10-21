# Identidade visual — FinFlow

Arte original: `docs/identidade/finflow-original.jpg` (ícone + nome + slogan).

- **Símbolo:** "F" estilizado combinado com setas de fluxo de entrada/saída e barras de crescimento financeiro.
- **Nome:** FINFLOW — "FIN" em grafite e "FLOW" em laranja.
- **Slogan:** "GESTÃO FINANCEIRA INTELIGENTE". Na arte original o slogan saiu cortado ("GESTÃO FINANCEIRA INTEGRA"); por
  isso o sistema usa a arte só até o nome e escreve o slogan em texto (`components/Logo.tsx`, `SLOGAN`). Ao refazer a arte,
  corrigir o slogan.
- **Paleta** (tirada da arte; `tailwind.config.js`):
  - Grafite/chumbo `#34404C` (`grafite-900`) — primária: menu ativo, títulos, botões principais, cabeçalhos de impressão.
  - Laranja `#E65F03` (`laranja-500`) — destaque: faixa sob o cabeçalho, botões de destaque, links, saídas nos gráficos.
  - Entradas nos gráficos e valores positivos: verde esmeralda `#059669`; negativos: vermelho.
- **Fonte:** Montserrat (Google Fonts), próxima da letra da arte.
- **Imagens geradas** por `python scripts/identidade.py`: `public/marca.png` (símbolo), `public/logo.png` (símbolo + nome),
  `icon-192/512.png` (PWA, com área segura), `apple-touch-icon.png`, `favicon.png`.
