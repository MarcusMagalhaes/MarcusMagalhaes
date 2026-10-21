# Finanway — memória do projeto

Registro das decisões e do estado da implantação, para quem continuar o trabalho (pessoa ou agente). Regras do código em
`CLAUDE.md`; visão geral e passo a passo em `README.md`; segurança em `SEGURANCA.md`.

## 1. Origem e decisões (21/10/2026)

- **Pedido:** sistema financeiro completo e independente para empresas, em repositório próprio, tomando o módulo financeiro
  do Luminexus como referência e copiando todo o modelo dele: estrutura, banco, publicação e práticas de segurança. Depois o
  sistema vai gerar relatórios e conversar com outros sistemas (ver §5).
- **Nome:** começou como **FinFlow** (laranja/grafite) e virou **Finanway — by One Way**, com a arte de fundo carvão em
  `docs/identidade/finanway-original.jpg`. Cores e fonte em `CLAUDE.md`; imagens geradas por `scripts/identidade.py`.
- **Multiempresa:** tudo tem `empresa_id` com padrão `empresa_atual()`; RLS em todas as tabelas; papéis por empresa
  (Diretor, Administrador, Financeiro, Financeiro auxiliar, Contador) e o administrador TI global
  (onewayinf@gmail.com, só pelo Google).
- **Primeiro acesso do TI (1.0.002):** sem nenhuma empresa no banco, o TI entra e cria a primeira na tela
  `EscolherEmpresa` (antes caía em "sua conta ainda não tem acesso a nenhuma empresa").
- **Centro de custo como no Luminexus (0007, 1.0.003):** a primeira versão tinha "plano de contas" (árvore) + "centro de
  custo" (lista simples, herdada do AgroAves). Decisão do Marcus: igual ao Luminexus. A árvore passou a se chamar
  **centro de custo** e define se o lançamento é entrada ou saída (o 1º nível define o tipo e a linha da DRE); a lista
  simples saiu de uso. Nome interno da árvore continua `plano_conta` (como `categoria_financeira` no Luminexus).
- **Lançamento por modelo (0007, 1.0.003):** trazido do Luminexus 0121. Lançamentos › ▦ Por modelo: quadro de blocos de
  centros de custo com o total do mês e o "+" que abre o lançamento já preenchido.

## 2. Onde está cada coisa

| O quê | Onde |
| --- | --- |
| Código | github.com/MarcusMagalhaes/Finanway (`main` publica) |
| Site | https://finanway.markvpm.workers.dev (Worker `finanway` no Cloudflare). Domínio próprio pendente (§4) |
| Banco | Supabase, projeto `uqsayduufherfzfncktl` (servidor do pooler: aws-0-us-east-1) |
| Migrações aplicadas na produção | 0001 a 0007 (Actions › "Aplicar migrações"; a 0007 em 21/10/2026, run 39658031806) |
| Login | Google (cliente OAuth do Google Cloud; o mesmo Client ID no provedor Google do Supabase) |

Segredos ficam **só** nos lugares certos, nunca no repositório nem em conversa:
- GitHub › Settings › Secrets and variables › Actions: segredos `DB_URL`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
  `VITE_GOOGLE_CLIENT_ID`; variáveis `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SITE_URL`.
- Supabase › Authentication › Providers › Google: Client ID e Client Secret.

## 3. Histórico das versões

| Versão | O que mudou |
| --- | --- |
| 1.0.001 | Sistema completo: títulos, lançamentos, conciliação OFX/CSV, fluxo de caixa, DRE, orçamento, fechamento com parecer do contador, cadastros, administração, auditoria, PWA; publicação e backup no modelo do Luminexus |
| 1.0.002 | Primeiro acesso do TI cria a primeira empresa; preparação do domínio finanway.com.br (rotas comentadas em `wrangler.jsonc` até a zona estar no Cloudflare) |
| 1.0.003 | 0007: centro de custo único (define entrada/saída) e lançamento por modelo |

## 4. Pendências da implantação

- [ ] **Domínio finanway.com.br:** zona adicionada no Cloudflare; falta trocar os servidores DNS no Registro.br para
  `matias.ns.cloudflare.com` e `rafe.ns.cloudflare.com` (com a DNSSEC vazia), esperar o domínio ficar **Active**, dar ao
  token do Cloudflare as permissões Zone Read + DNS Edit + Workers Routes Edit em finanway.com.br e então descomentar
  `routes` em `wrangler.jsonc` (o deploy cria o DNS e o certificado; www redireciona no `worker/index.ts`). Depois:
  variável `SITE_URL` = https://finanway.com.br e Supabase › URL Configuration › Site URL = https://finanway.com.br.
- [ ] **Login com Google:** conferir no Google Cloud as origens JavaScript (`https://finanway.markvpm.workers.dev`,
  `https://finanway.com.br`, `http://localhost:5175`) e o redirecionamento `https://uqsayduufherfzfncktl.supabase.co/auth/v1/callback`;
  no Supabase, provedor Google com "Authorized Client IDs" e as Redirect URLs dos dois endereços.
- [ ] **Trocar credenciais expostas na conversa de implantação:** senha do banco (atualizar o `DB_URL`) e Client Secret do
  Google (atualizar no Supabase).
- [ ] **pg_cron:** ligar em Database › Extensions e rodar a 0006 de novo (agenda a limpeza da auditoria).
- [ ] **Backup:** criar o repositório privado Finanway-backup com o conteúdo de `backup/`, um par de chaves age e os
  segredos descritos em `backup/README.md`.
- [ ] **CSP:** depois de uma semana sem avisos no log do Worker, trocar `Content-Security-Policy-Report-Only` por
  `Content-Security-Policy` em `public/_headers`.
- [ ] Apagar o ramo `centro-custo-modelos` no GitHub (igual à `main`; ficou porque o ambiente não conseguiu apagar).

## 5. Próximos passos (roteiro)

- Integração com outros sistemas: rotas `/api/…` no Worker (API com chave por empresa e webhooks).
- Importação do XML da NF-e para gerar contas a pagar/receber.
- Relatórios adicionais e envio automático (e-mail) do relatório mensal.
