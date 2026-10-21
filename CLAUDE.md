# Finanway — memória do app

**Finanway — Gestão Financeira Inteligente**: sistema financeiro completo e independente para empresas (multiempresa).
Nasceu do módulo financeiro do Luminexus e segue o mesmo padrão: React 19 + Vite + Tailwind 3 (site estático no Cloudflare
Workers) e Supabase (Postgres, Auth, Storage, RLS). Visão geral, papéis, implantação e publicação em `README.md`; regras de
segurança em `SEGURANCA.md` (ler antes de mexer no banco).

Identidade (21/10/2026; nome antigo FinFlow, trocado para **Finanway — by One Way**; arte em
`docs/identidade/finanway-original.jpg`, fundo carvão): carvão `grafite-900 #24282C` (primária: menu ativo, títulos,
botões; fundo da arte `grafite-950 #181B1F`), laranja `laranja-500 #E97D25` (destaque: faixa do cabeçalho, alertas), cinza
metálico `grafite-500 #6A7077`; fonte Montserrat. A logo completa (`components/Logo.tsx`) só vai sobre fundo escuro.
Imagens: `python scripts/identidade.py`.

- Idioma: código, comentários, commits e respostas em **português**.
- Front: `npm run typecheck` / `npm test` / `npm run build` (Node 22). Banco: `npm run banco:testar` (PostgreSQL local com
  stubs do Supabase; o CI faz o mesmo). Migrações em `supabase/migrations/` (numeradas; nova = próximo número, nunca editar
  as aplicadas na produção; toda migração pode rodar duas vezes). Migração que troca política começa com
  `set local lock_timeout = '5s'`.
- Segurança: chave anon é pública → tabela nova exige RLS com `empresa_id = (select empresa_atual())` e
  `(select eh_…())`; view nova `security_invoker = true`; função `security definer` com `search_path` fixo; gatilho de
  regras chama `confere_empresa(new.empresa_id)` antes de ler outras tabelas; `anon` só executa `registrar_login`.
  Teste novo em `scripts/banco-local/testes.sql`.
- Papéis (lib/types): `ehLeitor` (todos), `ehOperador` (lança/baixa/importa), `ehFinanceiro` (exclui, cadastros,
  orçamento, fechamento, estorno), `ehAdmin` (usuários, empresa, auditoria), `ehDiretor` (reabrir mês), `ehContador`
  (parecer). A tela esconde; o banco confere.
- Títulos: `valor_pago`, `pago_em`, `situacao` são calculados pelo banco; gravar só `soColunas(obj, COLUNAS_TITULO)`.
  Baixa só por `baixar_titulo`/`conciliar_titulo`, estorno por `estornar_baixa`; juros e descontos viram lançamentos à
  parte nos centros de custo configurados em Empresa › Configuração. DRE por competência usa o título; por caixa, os
  lançamentos.
- Centro de custo (0007, como no Luminexus): árvore de 4 níveis na tabela interna `plano_conta` (coluna `plano_conta_id`;
  nas telas e mensagens sempre "centro de custo"), código de 8 dígitos gerado pelo banco; o 1º nível define entrada/saída
  e a linha da DRE (`grupo`): na ficha o centro escolhido define o tipo do lançamento. Lançamento/título/orçamento só do
  2º nível para baixo. Utilitários em `lib/planoContas.ts`. A tabela `centro_custo` (lista simples antiga) e as colunas
  `centro_custo_id` estão fora de uso (sempre vazias; ficam só para as migrações antigas rodarem de novo).
- Lançamento por modelo (0007, Luminexus 0121): `modelo_lancamento.blocos` = [{titulo, cor, centros: [plano_conta.id]}];
  centro entra com os filhos. Tela em `pages/financeiro/LancamentoModelo.tsx` (☰ Lista / ▦ Por modelo em Lançamentos).
- Telas: `<Carregando />` + overlay `Ocupado` (leituras do Supabase já acionam via `lib/ocupado.ts`); listas grandes com
  `todas()` de `lib/dados.ts` (a API corta em 1.000). Consultas encadeadas do supabase-js são `PromiseLike`: para
  `.then().catch()` embrulhe em `Promise.resolve(...)`.
- Padrões visuais: barra de filtros `.barra`, tabela `.tabela` (fonte 11, zebra, `num` nos valores), formulários
  `.ficha` (campos amarelos), modais em tela cheia para fichas e `largura="max-w-…"` para as pequenas, exclusão sempre com
  `<Confirmar />`, bloco com título = `<Bloco>` (no celular vira seção recolhível). Relatórios: imprimir (`imprimirHtml` +
  `cabecalhoImpressao` + `escHtml`) e exportar CSV (`baixarCsv`).
- Páginas carregam sob demanda: página nova entra em `App.tsx` como `lazy(() => import(...))`; o que outra tela usa de uma
  página vai para `src/lib/`.
- Arquivos: `lib/arquivos.ts` (`enviarArquivo`, `removerArquivo`, `abrirArquivo`, `urlImagem`) e `components/Anexos.tsx`
  (anexos de lançamento ou título). Buckets privados `documentos` e `logos`, sempre em `<empresa>/…`.
- Versão: `npm run versao` antes de cada publicação; o número aparece ao lado de Sair.
- Publicação: **push na `main` publica** (`publicar.yml`); só mesclar com a migração correspondente já aplicada.
  `verificar.yml` roda front e banco em todo push.
