# Finanway — Gestão Financeira Inteligente

*by One Way* · antes chamado FinFlow

Sistema web de **gestão financeira completa para empresas** (comércio, serviços, indústria, igrejas e terceiro setor):
contas a pagar e a receber, lançamentos, conciliação bancária por extrato (OFX/CSV), fluxo de caixa realizado e previsto,
DRE gerencial por competência ou caixa, orçamento previsto × realizado, fechamento mensal com parecer do contador,
centros de custo (que definem entrada ou saída), lançamento por modelo, clientes e fornecedores, documentos anexados (NF-e, boletos, comprovantes) e auditoria completa.

Independente de qualquer outro sistema. Mesmo padrão técnico e de segurança do **Luminexus** (de onde vieram a estrutura,
o modelo do banco, a publicação e as regras de segurança): **React 19 + TypeScript + Vite + Tailwind 3** (site estático no
Cloudflare Workers) e **Supabase** (PostgreSQL, Auth, Storage, RLS). Sem servidor próprio: o navegador fala direto com o
Supabase, e toda a segurança fica no banco (`SEGURANCA.md`). Funciona no computador e no celular (PWA instalável).

## Funcionalidades

| Área | O que faz |
| --- | --- |
| Painel | saldos por conta, entradas × saídas do mês e de 12 meses, a pagar/receber (vencido, hoje, 7 e 30 dias), agenda da semana, inadimplência por faixa, despesas por centro de custo (pai e filho), orçamento, pendências |
| Contas a pagar / a receber | títulos com parcelamento e repetição mensal, baixa parcial ou total com juros/multa e desconto (lançados à parte para a DRE), baixa em lote, estorno, cancelamento, anexos, impressão e CSV |
| Lançamentos | entradas, saídas e transferências entre contas; o centro de custo escolhido define se é entrada ou saída; competência separada da data. Duas visões: lista com filtros e **por modelo** (quadro de blocos de centros de custo com o total do mês e o "+" que lança já preenchido, como a planilha do mês) |
| Conciliação bancária | importa extrato OFX/CSV (sem duplicar na reimportação), sugere a classificação pelo histórico e concilia cada linha com o título em aberto (diferença vira juros) |
| Relatórios | fluxo de caixa (dia/semana/mês, realizado + previsto, alerta de saldo negativo), DRE gerencial (competência ou caixa, por centro de custo, mensal), relatório mensal (balancete), extrato por conta — tudo imprimível e exportável em CSV |
| Orçamento | previsão por centro de custo e mês, gerada do realizado de um ano-base com reajuste (IPCA do Banco Central), previsto × realizado |
| Fechamento do mês | o financeiro fecha, os lançamentos do mês travam, o contador dá o parecer (aprovado, com ressalvas, devolvido); só a diretoria reabre |
| Cadastros | centros de custo em árvore (4 níveis, código gerado, entrada/saída e linha da DRE no 1º nível), contas financeiras (caixa, banco, aplicação, cartão), clientes e fornecedores (consulta de CNPJ e CEP) |
| Administração | multiempresa, usuários por e-mail Google com papel por empresa, dados e logo da empresa, configuração da baixa, auditoria (quem, quando, antes/depois) |

## Papéis (por empresa)

| Papel | Acesso |
| --- | --- |
| ADMIN_TI | tudo, em qualquer empresa; cria empresas. Exclusivo de onewayinf@gmail.com com login Google, definido só pelo banco |
| DIRETOR (Diretoria) | tudo da empresa, inclusive reabrir mês fechado e dar o papel Diretoria |
| ADMIN | usuários, dados da empresa, auditoria e o financeiro completo |
| FINANCEIRO | financeiro completo: lançamentos, títulos, conciliação, cadastros, orçamento, fechamento do mês |
| FINANCEIRO_AUX | lança, baixa títulos, importa extrato e anexa documentos; não exclui, não fecha mês nem mexe em cadastros |
| CONTADOR | consulta tudo, relatórios e exportações; dá o parecer do fechamento |

A mesma conta Google pode ter acesso a várias empresas (um papel em cada); com mais de uma, escolhe no login.

## Estrutura

```
supabase/migrations/   0001_base (empresas, usuários, papéis, auditoria) · 0002_cadastros · 0003_movimento (títulos,
                       lançamentos, baixas, extrato, anexos, orçamento, fechamento) · 0004_relatorios · 0005_rls · 0006_implantacao ·
                       0007_centro_custo_e_modelos (centro de custo único e lançamento por modelo)
src/lib/               supabase, auth (multiempresa), dados, format, documento (CPF/CNPJ), planoContas (árvore e DRE),
                       extrato (OFX/CSV), csv, imprimir, arquivos (Storage), tipos
src/components/        Layout (menu por papel), ui (modal, toast, overlay…), Painel (indicadores e gráficos), Anexos,
                       ComboParceiro, OpcoesPlano, NovoPlanoConta, Logo
src/pages/             Painel · financeiro/ · relatorios/ · cadastros/ · admin/ · Login · EscolherEmpresa
scripts/               banco-local/ (testes do banco), aplicar_migracoes.py, conferir_seguranca.py, identidade.py, versao.mjs
backup/                backup diário criptografado (vai para o repositório privado Finanway-backup)
worker/index.ts        Worker do Cloudflare (site + relatórios da CSP)
docs/identidade/       arte original da marca
```

## 1. Banco (Supabase)

1. Crie o projeto no Supabase (região São Paulo, `sa-east-1`, de preferência).
2. Aplique as migrações pelo GitHub Actions: crie o segredo `DB_URL` (URI do "Session pooler" do Supabase, em
   Connect) e rode **Actions › Aplicar migrações › Run workflow** com `--todas` (depois, só os arquivos novos). O workflow
   também confere a segurança. Alternativas: `DB_URL=… python scripts/aplicar_migracoes.py --todas` na sua máquina, ou
   colar cada arquivo no SQL Editor, de 0001 a 0007.
3. **Login com Google** (Authentication › Providers › Google): Client ID e Secret de um cliente OAuth do Google Cloud.
   Origens JavaScript autorizadas: `https://finanway.com.br` e `http://localhost:5175`. Redirecionamento: `https://<ref>.supabase.co/auth/v1/callback`.
4. Authentication › URL Configuration: Site URL = `https://finanway.com.br`; Redirect URLs `https://finanway.com.br/**` e `http://localhost:5175/**`.
5. Database › Extensions: ligue **pg_cron** e rode a `0006_implantacao.sql` de novo (agenda a limpeza da auditoria).
6. Entre no site com onewayinf@gmail.com pelo Google: nasce ADMIN_TI. Em **Administração › Empresas › + Nova empresa**
   cadastre a primeira empresa (já vem com os centros de custo padrão, Caixa e Conta corrente) e informe o
   e-mail Google de quem será a Diretoria.
7. Confira: `python scripts/conferir_seguranca.py` (nenhum problema).

## 2. Rodar localmente

```bash
cp .env.example .env     # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_GOOGLE_CLIENT_ID
npm install
npm run dev              # http://localhost:5175
npm run typecheck && npm test
npm run banco:testar     # migrações + testes de regras e permissões + segurança num PostgreSQL local (precisa do PostgreSQL)
```

Node 22 (`.nvmrc`).

## 3. Publicar (Cloudflare Workers)

Cada push na `main` publica pelo GitHub Actions (`.github/workflows/publicar.yml`: typecheck, testes, build,
`wrangler deploy --name finanway`, conferência do site). Configure em Settings › Secrets and variables › Actions:

- **Variáveis:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (públicas: vão no pacote do site), `SITE_URL`.
- **Segredos:** `CLOUDFLARE_API_TOKEN` ("Edit Cloudflare Workers"), `CLOUDFLARE_ACCOUNT_ID`, `VITE_GOOGLE_CLIENT_ID`.

Sem a configuração o job só avisa. Todo push e pull request roda `verificar.yml` (front + banco num PostgreSQL 17 limpo).
**Mesclar na `main` = publicar:** só com a migração correspondente já aplicada no banco. Antes do commit: `npm run versao`
(o número aparece ao lado de Sair). Reserva manual: `npm run build` · `npx wrangler deploy --name finanway`.

## 4. Backup

Diário, criptografado, 7 dias, com teste de restauração e conferência de segurança: ver `backup/README.md`.

## Roteiro (próximas fases)

1. **Integração com outros sistemas:** API REST no Worker (`/api/v1/…`) com chave por empresa (só o hash no banco,
   escopo de leitura/escrita, limite de requisições), para relatórios e lançamentos vindos de outros sistemas; webhooks
   de saída (título vencido, baixa, fechamento). Hoje a troca é por CSV (todas as listas e relatórios exportam).
2. Importação do **XML da NF-e** como título a pagar (fornecedor, valor, vencimentos das duplicatas).
3. Boletos e PIX de cobrança pela API do banco, com baixa automática pelo retorno.
4. Avisos (e-mail/push) de vencimentos do dia e da semana.
5. Conciliação de cartão de crédito (importação da fatura).
