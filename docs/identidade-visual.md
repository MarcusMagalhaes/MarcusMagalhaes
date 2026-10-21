# Identidade visual — Finanway (by One Way)

Arte original: `docs/identidade/finanway-original.jpg` (símbolo + nome + slogan + assinatura, sobre fundo carvão).
O projeto se chamava FinFlow até 21/10/2026.

- **Símbolo:** "F" e "W" entrelaçados — o F laranja se desfaz em pixels e trilhas de circuito (tecnologia), o W metálico
  com barras de crescimento e setas para cima (fluxo financeiro e resultado).
- **Nome:** FINAN WAY — "FINAN" em cinza metálico e "WAY" em laranja (escrito Finanway no sistema).
- **Slogan:** "GESTÃO FINANCEIRA INTELIGENTE". **Assinatura:** "by ONE WAY" (ligação com a One Way).
- **Paleta** (tirada da arte; `tailwind.config.js`):
  - Carvão `#24282C` (`grafite-900`) — primária: menu ativo, títulos, botões principais, cabeçalhos de impressão.
    Fundo da arte `#181B1F` (`grafite-950`): telas de entrada e ícones.
  - Laranja `#E97D25` (`laranja-500`) — destaque: faixa sob o cabeçalho, botões de destaque, links, saídas nos gráficos.
  - Cinza metálico `#6A7077` (`grafite-500`) — o "FINAN" da marca.
  - Entradas nos gráficos e valores positivos: verde esmeralda `#059669`; negativos: vermelho.
- **Uso da logo:** a arte tem fundo escuro, então a logo completa aparece só sobre `grafite-950` (login, escolha de
  empresa), com as bordas esfumadas (`components/Logo.tsx`). Dentro do sistema (fundo claro) vai só o símbolo (`marca.png`),
  num quadrado escuro.
- **Fonte:** Montserrat (Google Fonts), próxima da letra da arte.
- **Imagens geradas** por `python scripts/identidade.py`: `public/marca.png` (símbolo), `public/logo.png` (arte completa),
  `icon-192/512.png` (PWA, símbolo na área segura), `apple-touch-icon.png`, `favicon.png`.
