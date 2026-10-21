-- FinFlow · 0002: cadastros do financeiro — contas financeiras, plano de contas (árvore), centros de custo e
-- clientes/fornecedores. Toda tabela tem empresa_id (padrão = empresa em uso) e índice começando por ele.
-- Rode depois da 0001. Pode ser executado mais de uma vez.

-- =====================================================================
-- 1. Contas financeiras: caixa, conta corrente, poupança, aplicação, cartão de crédito
--    Cartão: as compras saem da conta "cartão" (saldo negativo = fatura em aberto); o pagamento da fatura é uma
--    transferência da conta corrente para o cartão.
-- =====================================================================
create table if not exists conta_financeira (
  id                   serial primary key,
  empresa_id           int not null default empresa_atual() references empresa(id) on delete cascade,
  nome                 text not null check (btrim(nome) <> ''),
  tipo                 text not null default 'CONTA_CORRENTE' check (tipo in ('CAIXA','CONTA_CORRENTE','POUPANCA','APLICACAO','CARTAO_CREDITO','OUTRA')),
  banco                text,
  agencia              text,
  numero               text,
  pix                  text,
  saldo_inicial        numeric(14,2) not null default 0,
  data_saldo_inicial   date,
  limite               numeric(14,2),                     -- cartão de crédito / cheque especial (informativo)
  observacao           text,
  ativa                boolean not null default true,
  criado_em            timestamptz not null default now()
);
create unique index if not exists ux_conta_empresa_nome on conta_financeira (empresa_id, lower(btrim(nome)));

-- =====================================================================
-- 2. Plano de contas (árvore de até 4 níveis, mesmo desenho dos centros de custo do Luminexus 0082/0083)
--    * Código de 8 dígitos, 2 por nível (01000000 → 01010000 → 01010100 → 01010101), gerado pelo banco; único por empresa.
--    * Tipo ENTRADA/SAIDA escolhido no 1º nível e herdado pelos filhos.
--    * grupo = classificação na DRE e no fluxo de caixa, escolhida no 1º nível e herdada pelos filhos.
--    * Lançamento, título e orçamento só do 2º nível para baixo (o 1º nível agrupa).
--    * Depois de salvo, código, pai, tipo e grupo não mudam (só nome, descrição e ativa). Desativar desativa os filhos.
-- =====================================================================
create table if not exists plano_conta (
  id          serial primary key,
  empresa_id  int not null default empresa_atual() references empresa(id) on delete cascade,
  tipo        text not null check (tipo in ('ENTRADA','SAIDA')),
  grupo       text not null check (grupo in (
                'RECEITA_OPERACIONAL','RECEITA_FINANCEIRA','OUTRA_RECEITA','APORTE_EMPRESTIMO',
                'DEDUCAO','CUSTO','DESPESA_OPERACIONAL','DESPESA_FINANCEIRA','IMPOSTO_LUCRO','INVESTIMENTO','DISTRIBUICAO_AMORTIZACAO')),
  nome        text not null,
  descricao   text,
  codigo      int not null check (codigo between 1000000 and 99999999),
  nivel       smallint not null check (nivel between 1 and 4),
  pai_id      int references plano_conta(id),
  ordem       int not null default 0,
  ativa       boolean not null default true,
  criado_em   timestamptz not null default now(),
  check ((nivel = 1) = (pai_id is null)),
  check ((tipo = 'ENTRADA' and grupo in ('RECEITA_OPERACIONAL','RECEITA_FINANCEIRA','OUTRA_RECEITA','APORTE_EMPRESTIMO'))
      or (tipo = 'SAIDA' and grupo in ('DEDUCAO','CUSTO','DESPESA_OPERACIONAL','DESPESA_FINANCEIRA','IMPOSTO_LUCRO','INVESTIMENTO','DISTRIBUICAO_AMORTIZACAO')))
);
create unique index if not exists ux_plano_empresa_codigo on plano_conta (empresa_id, codigo);
create unique index if not exists ux_plano_irmaos on plano_conta (empresa_id, tipo, coalesce(pai_id, 0), lower(btrim(nome)));
create index if not exists ix_plano_pai on plano_conta (pai_id);

-- rótulos dos grupos (os mesmos de GRUPOS_PLANO em src/lib/types.ts)
create or replace function rotulo_grupo_plano(p_grupo text) returns text
language sql immutable set search_path = public as $$
  select case p_grupo
    when 'RECEITA_OPERACIONAL' then 'Receitas operacionais' when 'RECEITA_FINANCEIRA' then 'Receitas financeiras'
    when 'OUTRA_RECEITA' then 'Outras receitas' when 'APORTE_EMPRESTIMO' then 'Aportes e empréstimos'
    when 'DEDUCAO' then 'Deduções da receita' when 'CUSTO' then 'Custos' when 'DESPESA_OPERACIONAL' then 'Despesas operacionais'
    when 'DESPESA_FINANCEIRA' then 'Despesas financeiras' when 'IMPOSTO_LUCRO' then 'Impostos sobre o lucro'
    when 'INVESTIMENTO' then 'Investimentos' when 'DISTRIBUICAO_AMORTIZACAO' then 'Distribuição de lucros e amortizações'
    else p_grupo end
$$;

create or replace function fn_plano_inclusao() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pai plano_conta; v_passo int; v_max int; v_qtd int;
begin
  new.empresa_id := coalesce(new.empresa_id, empresa_atual());
  perform confere_empresa(new.empresa_id);
  new.nome := btrim(new.nome);
  if coalesce(new.nome, '') = '' then raise exception 'Informe o nome da conta do plano.'; end if;
  if new.pai_id is null then
    if new.tipo is null then raise exception 'Informe se a conta do plano é de entrada ou de saída.'; end if;
    new.grupo := coalesce(new.grupo, case when new.tipo = 'ENTRADA' then 'OUTRA_RECEITA' else 'DESPESA_OPERACIONAL' end);
    perform pg_advisory_xact_lock(hashtext('plano_conta_raiz'), new.empresa_id);
    select coalesce(max(codigo), 0) + 1000000 into v_max from plano_conta where empresa_id = new.empresa_id and nivel = 1;
    if v_max > 99000000 then raise exception 'Limite de 99 contas no primeiro nível do plano.'; end if;
    new.codigo := v_max; new.nivel := 1;
  else
    select * into v_pai from plano_conta where id = new.pai_id for update;
    if v_pai.id is null or v_pai.empresa_id <> new.empresa_id then raise exception 'Conta pai inexistente no plano de contas.'; end if;
    if not v_pai.ativa then raise exception 'A conta pai (%) está inativa.', v_pai.nome; end if;
    if v_pai.nivel >= 4 then raise exception 'O plano de contas tem no máximo 4 níveis.'; end if;
    v_passo := case v_pai.nivel when 1 then 10000 when 2 then 100 else 1 end;
    select coalesce(max(codigo), v_pai.codigo) + v_passo, count(*) into v_max, v_qtd from plano_conta where pai_id = v_pai.id;
    if v_qtd >= 99 or v_max >= v_pai.codigo + v_passo * 100 then raise exception 'Limite de 99 filhos em %.', v_pai.nome; end if;
    new.codigo := v_max; new.nivel := v_pai.nivel + 1; new.tipo := v_pai.tipo; new.grupo := v_pai.grupo;
  end if;
  new.ordem := new.codigo;
  return new;
end $$;

create or replace function fn_plano_alteracao() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pai_ativa boolean;
begin
  if new.codigo is distinct from old.codigo or new.pai_id is distinct from old.pai_id or new.nivel is distinct from old.nivel
     or new.tipo is distinct from old.tipo or new.grupo is distinct from old.grupo or new.empresa_id is distinct from old.empresa_id then
    raise exception 'O código, a conta pai, o tipo e o grupo da conta do plano não podem ser alterados.';
  end if;
  new.nome := btrim(new.nome);
  if coalesce(new.nome, '') = '' then raise exception 'Informe o nome da conta do plano.'; end if;
  if new.ativa and not old.ativa and new.pai_id is not null then
    select ativa into v_pai_ativa from plano_conta where id = new.pai_id;
    if not v_pai_ativa then raise exception 'Ative primeiro a conta pai.'; end if;
  end if;
  new.ordem := new.codigo;
  return new;
end $$;

create or replace function fn_plano_desativa_filhos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.ativa and not new.ativa then
    update plano_conta set ativa = false where pai_id = new.id and ativa;   -- dispara de novo a cada nível
  end if;
  return null;
end $$;

drop trigger if exists trg_plano_inclusao on plano_conta;
create trigger trg_plano_inclusao before insert on plano_conta for each row execute function fn_plano_inclusao();
drop trigger if exists trg_plano_alteracao on plano_conta;
create trigger trg_plano_alteracao before update on plano_conta for each row execute function fn_plano_alteracao();
drop trigger if exists trg_plano_desativa_filhos on plano_conta;
create trigger trg_plano_desativa_filhos after update of ativa on plano_conta for each row execute function fn_plano_desativa_filhos();

-- Conta "A classificar" (entrada ou saída) da empresa em uso: recebe o que vem do extrato sem classificação
create or replace function plano_a_classificar(p_tipo text) returns int
language plpgsql security definer set search_path = public as $$
declare v_id int; v_raiz int; v_emp int := empresa_atual();
begin
  if not eh_operador() or v_emp is null then raise exception 'Sem permissão no financeiro'; end if;
  if p_tipo not in ('ENTRADA','SAIDA') then raise exception 'Tipo inválido'; end if;
  select id into v_id from plano_conta where empresa_id = v_emp and tipo = p_tipo and nivel = 2 and nome = 'A classificar';
  if v_id is not null then
    update plano_conta set ativa = true where id = v_id and not ativa and exists (select 1 from plano_conta r where r.id = plano_conta.pai_id and r.ativa);
    return v_id;
  end if;
  select id into v_raiz from plano_conta where empresa_id = v_emp and tipo = p_tipo and nivel = 1 and nome = 'A classificar';
  if v_raiz is null then
    insert into plano_conta (empresa_id, tipo, grupo, nome, nivel) values (v_emp, p_tipo, case when p_tipo = 'ENTRADA' then 'OUTRA_RECEITA' else 'DESPESA_OPERACIONAL' end, 'A classificar', 1)
      returning id into v_raiz;
  end if;
  update plano_conta set ativa = true where id = v_raiz and not ativa;
  insert into plano_conta (empresa_id, pai_id, nome) values (v_emp, v_raiz, 'A classificar') returning id into v_id;
  return v_id;
end $$;

-- Contas do plano usadas na baixa de títulos (juros/multa e descontos); definidas em Empresa › Configuração
alter table empresa add column if not exists plano_juros_pagos_id int references plano_conta(id) on delete set null;
alter table empresa add column if not exists plano_juros_recebidos_id int references plano_conta(id) on delete set null;
alter table empresa add column if not exists plano_descontos_obtidos_id int references plano_conta(id) on delete set null;
alter table empresa add column if not exists plano_descontos_concedidos_id int references plano_conta(id) on delete set null;

-- a configuração só aponta para contas da própria empresa, do tipo certo e do 2º nível para baixo
create or replace function fn_empresa_config() returns trigger
language plpgsql security definer set search_path = public as $$
declare c record; v plano_conta;
begin
  perform confere_empresa(new.id);
  for c in select * from (values ('plano_juros_pagos_id', 'SAIDA', new.plano_juros_pagos_id), ('plano_juros_recebidos_id', 'ENTRADA', new.plano_juros_recebidos_id),
                                 ('plano_descontos_obtidos_id', 'ENTRADA', new.plano_descontos_obtidos_id), ('plano_descontos_concedidos_id', 'SAIDA', new.plano_descontos_concedidos_id)) x(campo, tipo, id) loop
    continue when c.id is null;
    select * into v from plano_conta where id = c.id;
    if v.id is null or v.empresa_id <> new.id or v.tipo <> c.tipo or v.nivel = 1 then
      raise exception 'Configuração inválida (%): escolha uma conta de % do 2º nível para baixo.', c.campo, case when c.tipo = 'ENTRADA' then 'entrada' else 'saída' end;
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists trg_empresa_config on empresa;
create trigger trg_empresa_config before update of plano_juros_pagos_id, plano_juros_recebidos_id, plano_descontos_obtidos_id, plano_descontos_concedidos_id
  on empresa for each row execute function fn_empresa_config();

-- =====================================================================
-- 3. Centros de custo (departamentos, filiais, projetos): segunda dimensão, independente do plano de contas
-- =====================================================================
create table if not exists centro_custo (
  id          serial primary key,
  empresa_id  int not null default empresa_atual() references empresa(id) on delete cascade,
  codigo      text,
  nome        text not null check (btrim(nome) <> ''),
  descricao   text,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);
create unique index if not exists ux_centro_empresa_nome on centro_custo (empresa_id, lower(btrim(nome)));
create unique index if not exists ux_centro_empresa_codigo on centro_custo (empresa_id, lower(btrim(codigo))) where codigo is not null and btrim(codigo) <> '';

-- =====================================================================
-- 4. Clientes e fornecedores
-- =====================================================================
create table if not exists parceiro (
  id              serial primary key,
  empresa_id      int not null default empresa_atual() references empresa(id) on delete cascade,
  tipo            text not null default 'FORNECEDOR' check (tipo in ('CLIENTE','FORNECEDOR','AMBOS')),
  pessoa          text not null default 'PJ' check (pessoa in ('PF','PJ')),
  nome            text not null check (btrim(nome) <> ''),       -- razão social ou nome completo
  nome_fantasia   text,
  documento       text check (documento is null or documento ~ '^[0-9]{11}$|^[0-9]{14}$'),   -- CPF ou CNPJ, só dígitos
  inscricao_estadual text,
  email           text,
  telefone        text,
  contato         text,
  cep text, endereco text, numero text, complemento text, bairro text, cidade text, uf text,
  banco text, agencia text, conta text, pix text,
  observacao      text,
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  criado_por      uuid references usuario(id) on delete set null,
  atualizado_em   timestamptz not null default now(),
  atualizado_por  uuid references usuario(id) on delete set null
);
create index if not exists ix_parceiro_empresa_nome on parceiro (empresa_id, normalizar(nome));
create unique index if not exists ux_parceiro_documento on parceiro (empresa_id, documento) where documento is not null;

create or replace function fn_parceiro_regras() returns trigger
language plpgsql set search_path = public as $$
begin
  new.nome := btrim(new.nome);
  new.nome_fantasia := nullif(btrim(new.nome_fantasia), '');
  new.documento := nullif(regexp_replace(coalesce(new.documento, ''), '\D', '', 'g'), '');
  if new.documento is not null and length(new.documento) <> (case new.pessoa when 'PF' then 11 else 14 end) then
    raise exception '% inválido: informe os % dígitos.', case new.pessoa when 'PF' then 'CPF' else 'CNPJ' end, case new.pessoa when 'PF' then 11 else 14 end;
  end if;
  new.email := nullif(lower(btrim(new.email)), '');
  if tg_op = 'UPDATE' and new.empresa_id is distinct from old.empresa_id then raise exception 'O cadastro não muda de empresa.'; end if;
  return new;
end $$;
drop trigger if exists trg_parceiro_regras on parceiro;
create trigger trg_parceiro_regras before insert or update on parceiro for each row execute function fn_parceiro_regras();

-- carimbo e auditoria dos cadastros
drop trigger if exists trg_carimbo_parceiro on parceiro;
create trigger trg_carimbo_parceiro before insert or update on parceiro for each row execute function fn_carimbo();
do $$
declare t text;
begin
  foreach t in array array['conta_financeira','plano_conta','centro_custo','parceiro'] loop
    execute format('drop trigger if exists trg_aud_%s on %I', t, t);
    execute format('create trigger trg_aud_%s after insert or update or delete on %I for each row execute function fn_auditoria()', t, t);
  end loop;
end $$;

-- nenhuma tabela troca de empresa depois de criada (a política de escrita confere a empresa em uso na linha nova)
create or replace function fn_fixa_empresa() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.empresa_id is distinct from old.empresa_id then raise exception 'O registro não muda de empresa.'; end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['conta_financeira','centro_custo'] loop
    execute format('drop trigger if exists trg_fixa_empresa on %I', t);
    execute format('create trigger trg_fixa_empresa before update on %I for each row execute function fn_fixa_empresa()', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
