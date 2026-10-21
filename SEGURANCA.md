# Segurança do Finanway

Modelo de ameaça (o mesmo do Luminexus): a chave *anon* do Supabase vai dentro do JavaScript do site — qualquer pessoa na
internet a tem. Toda proteção dos dados fica no banco (RLS, permissões e checagens nas funções). O front só esconde botões.

## Regras (migrações 0001–0006)

- **Visitante sem login (anon)** não acessa nada do schema `public` (tabelas, views, sequências, funções), exceto
  `registrar_login` (falha de senha antes de existir sessão, com limite por minuto e por hora).
- **Multiempresa:** toda tabela de dados tem `empresa_id` (padrão = empresa em uso) e índice começando por ele; toda
  política exige `empresa_id = (select empresa_atual())` (empresa escolhida no login, gravada em `usuario.empresa_atual_id`
  por `escolher_empresa`, que confere o acesso). Funções `security definer` filtram pela empresa em uso. Uma empresa não lê
  nem altera a outra — testado em `scripts/banco-local/testes.sql` (§7).
- **Gatilhos antes do RLS:** os gatilhos de regras rodam antes de o RLS conferir a linha nova; por isso começam com
  `confere_empresa(new.empresa_id)` — sem isso, uma linha com `empresa_id` de outra empresa faria o gatilho ler e citar
  dados dela na mensagem de erro. Referências (conta, conta do plano, centro, cliente/fornecedor, título) precisam ser da
  mesma empresa ("inexistente" sem revelar nomes).
- **Papéis conferidos no banco:** `eh_leitor()` (todos), `eh_operador()` (todos menos CONTADOR), `eh_financeiro()`
  (exclusão, cadastros, orçamento, fechamento, estorno), `eh_admin()` (usuários, empresa, auditoria), `eh_diretor()`
  (reabrir mês, dar o papel Diretoria), `eh_contador()` (parecer). O ADMIN não altera o próprio papel nem dá DIRETOR.
- **ADMIN_TI** exclusivo de onewayinf@gmail.com, conferido em `auth.users` por e-mail **e** provedor Google
  (`eh_conta_admin_ti`, gatilho `fn_protege_admin_ti`): um cadastro e-mail/senha com esse e-mail nasce USUARIO.
- **Campos calculados não vêm da tela:** `titulo.valor_pago`, `pago_em` e `situacao` são recalculados pelo gatilho a
  partir das baixas a cada gravação. Lançamentos de baixa só nascem, mudam e saem por `baixar_titulo`,
  `conciliar_titulo` e `estornar_baixa` (marca `app.baixa` na transação; o PostgREST não expõe `set_config`).
- **Mês fechado** trava inclusão, alteração e exclusão de lançamentos daquele mês (gatilho), até o contador devolver ou a
  diretoria reabrir. Fechamento só por função (sem política de escrita).
- Views com `security_invoker = true`; toda função `security definer` fixa o `search_path` e termina sem execução para
  `anon`/`public`; funções internas (gatilhos, `confere_empresa`, `semear_plano_padrao`, `limpar_auditoria`) não são
  executáveis por usuário logado.
- **Storage:** buckets privados. `documentos` (PDF, imagens, XML da NF-e, até 20 MB) em `<empresa>/lancamentos/<id>/…` ou
  `<empresa>/titulos/<id>/…` — todos os papéis leem, operador envia e apaga; o registro `anexo` confere a pasta. `logos`
  (sem SVG, até 2 MB) — usuários das empresas leem, administrador grava.
- **Front:** login Google pelo botão oficial (nonce SHA-256) e PKCE no login de reserva; visualizador trata XML/HTML/SVG
  como texto; impressão sem script inline e todo texto do banco passa por `escHtml`; CSV neutraliza fórmulas (`=`, `+`,
  `-`, `@`); CSP em `public/_headers` (modo de observação até a 1ª semana sem avisos — então trocar por
  `Content-Security-Policy`), violações no log do Worker (`/api/csp`).
- **Auditoria:** toda inclusão/alteração/exclusão (quem, quando, antes/depois; na alteração só os campos alterados) e
  logins. Retenção: registros 13 meses, logins 6 meses (Marco Civil, art. 15), pelo pg_cron.

## Conferência automática

- `npm run banco:testar` e o CI (`verificar.yml`, a cada push): migrações aplicadas duas vezes num PostgreSQL limpo,
  testes de regras e permissões por papel e por empresa, e `backup/verificacoes/seguranca.sql`.
- Backup diário (`backup/`): a mesma conferência no banco de produção; qualquer problema = e-mail.
- À mão: `python scripts/conferir_seguranca.py`.

## Ao criar algo novo

- Tabela nova: `empresa_id int not null default empresa_atual() references empresa(id)`, índice começando por
  `empresa_id`, RLS com `(select empresa_atual())` e `(select eh_…())`, gatilho de auditoria, e `confere_empresa` no
  gatilho de regras se ele ler outras tabelas. View nova: `with (security_invoker = true)`.
- Função `security definer` nova: `set search_path = public`, filtro pela empresa em uso, papel conferido no início e
  `revoke execute … from anon, public` (já vem da 0005: reaplicar a 0005 depois de migração nova com função).
- Rodar `npm run banco:testar` (e acrescentar o teste em `scripts/banco-local/testes.sql`).

## Pendências para o painel do Supabase (fazer uma vez)

1. Desligar o provedor Email se só o Google for usado (nunca ligar autoconfirm).
2. Ligar o pg_cron e reaplicar a 0006.
3. 2FA nas contas Google dos administradores e no GitHub; Dependabot e push protection no GitHub.
4. Trocar a CSP para modo de bloqueio após uma semana sem avisos e restringir `*.supabase.co` ao projeto real.
5. Dados da empresa: planilhas, extratos e CSVs ficam fora do git (`.gitignore`); não copiar a base real para homologação.
