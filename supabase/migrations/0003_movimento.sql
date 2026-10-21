-- Finanway · 0003: movimento financeiro — títulos (contas a pagar e a receber), lançamentos (o que entrou e saiu das
-- contas), baixas, importação de extrato e conciliação, documentos anexados, orçamento e fechamento do mês.
-- Rode depois da 0002. Pode ser executado mais de uma vez.

-- =====================================================================
-- 1. Títulos: contas a pagar e a receber (o compromisso; o dinheiro só se move na baixa)
--    valor_pago, pago_em e situacao são calculados pelo banco a partir das baixas (lançamentos com titulo_id e
--    papel PRINCIPAL): nunca vêm da tela. Parcelas e repetições compartilham grupo_id.
-- =====================================================================
create table if not exists titulo (
  id                bigserial primary key,
  empresa_id        int not null default empresa_atual() references empresa(id) on delete cascade,
  tipo              text not null check (tipo in ('PAGAR','RECEBER')),
  parceiro_id       int references parceiro(id) on delete restrict,
  plano_conta_id    int not null references plano_conta(id),
  centro_custo_id   int references centro_custo(id),
  descricao         text not null check (btrim(descricao) <> ''),
  documento         text,                                     -- nº da nota fiscal, boleto, contrato
  emissao           date,
  vencimento        date not null,
  competencia       date not null,                            -- 1º dia do mês a que a receita/despesa pertence (DRE)
  valor             numeric(14,2) not null check (valor > 0),
  parcela           smallint check (parcela > 0),
  parcelas          smallint check (parcelas > 0),
  grupo_id          uuid,                                     -- parcelamento ou repetição
  conta_prevista_id int references conta_financeira(id),
  forma_prevista    text check (forma_prevista in ('DINHEIRO','PIX','TRANSFERENCIA','BOLETO','CARTAO','CHEQUE','DEBITO_AUTOMATICO')),
  codigo_barras     text,                                     -- linha digitável do boleto ou código PIX copia e cola
  observacao        text,
  cancelado         boolean not null default false,
  cancelado_motivo  text,
  valor_pago        numeric(14,2) not null default 0,         -- calculado: soma das baixas (principal)
  pago_em           date,                                     -- calculado: data da última baixa
  situacao          text not null default 'ABERTO' check (situacao in ('ABERTO','PARCIAL','PAGO','CANCELADO')),   -- calculado
  criado_em         timestamptz not null default now(),
  criado_por        uuid references usuario(id) on delete set null,
  atualizado_em     timestamptz not null default now(),
  atualizado_por    uuid references usuario(id) on delete set null,
  check (parcela is null or parcelas is null or parcela <= parcelas)
);
create index if not exists ix_titulo_empresa_venc on titulo (empresa_id, tipo, vencimento) where situacao in ('ABERTO','PARCIAL');
create index if not exists ix_titulo_empresa_competencia on titulo (empresa_id, competencia);
create index if not exists ix_titulo_parceiro on titulo (parceiro_id);
create index if not exists ix_titulo_grupo on titulo (grupo_id) where grupo_id is not null;

-- =====================================================================
-- 2. Lançamentos: ENTRADA e SAIDA (com conta do plano) e TRANSFERENCIA entre contas (sem conta do plano)
--    situacao PENDENTE = veio do extrato e aguarda classificação/conciliação: não entra em saldos nem relatórios.
--    Baixa de título: lançamento PRINCIPAL (abate o título) + JUROS e DESCONTO quando houver, todos com o mesmo baixa_id.
-- =====================================================================
create table if not exists importacao_extrato (
  id            serial primary key,
  empresa_id    int not null default empresa_atual() references empresa(id) on delete cascade,
  conta_id      int not null references conta_financeira(id),
  arquivo_nome  text not null,
  formato       text not null check (formato in ('OFX','CSV')),
  periodo_de    date, periodo_ate date,
  linhas        int not null default 0,
  importadas    int not null default 0,
  duplicadas    int not null default 0,
  criado_em     timestamptz not null default now(),
  criado_por    uuid default auth.uid() references usuario(id) on delete set null
);
create index if not exists ix_importacao_empresa on importacao_extrato (empresa_id, criado_em desc);

create table if not exists lancamento (
  id                 bigserial primary key,
  empresa_id         int not null default empresa_atual() references empresa(id) on delete cascade,
  data               date not null,
  competencia        date not null,                           -- 1º dia do mês (DRE por competência); padrão = mês da data
  tipo               text not null check (tipo in ('ENTRADA','SAIDA','TRANSFERENCIA')),
  plano_conta_id     int references plano_conta(id),
  centro_custo_id    int references centro_custo(id),
  conta_id           int not null references conta_financeira(id),
  conta_destino_id   int references conta_financeira(id),
  valor              numeric(14,2) not null check (valor > 0),
  parceiro_id        int references parceiro(id) on delete set null,
  forma              text check (forma in ('DINHEIRO','PIX','TRANSFERENCIA','BOLETO','CARTAO','CHEQUE','DEBITO_AUTOMATICO')),
  descricao          text,
  documento          text,
  origem             text not null default 'APP' check (origem in ('APP','BAIXA','IMPORTACAO','CARGA')),
  situacao           text not null default 'CONFIRMADO' check (situacao in ('CONFIRMADO','PENDENTE')),
  titulo_id          bigint references titulo(id) on delete restrict,
  titulo_papel       text check (titulo_papel in ('PRINCIPAL','JUROS','DESCONTO')),
  baixa_id           uuid,
  extrato_id         text,
  extrato_descricao  text,
  importacao_id      int references importacao_extrato(id) on delete set null,
  criado_em          timestamptz not null default now(),
  criado_por         uuid references usuario(id) on delete set null,
  atualizado_em      timestamptz not null default now(),
  atualizado_por     uuid references usuario(id) on delete set null,
  check (tipo <> 'TRANSFERENCIA' or (conta_destino_id is not null and plano_conta_id is null and titulo_id is null)),
  check (tipo = 'TRANSFERENCIA' or (plano_conta_id is not null and conta_destino_id is null)),
  check (conta_destino_id is null or conta_destino_id <> conta_id),
  check ((titulo_id is null) = (titulo_papel is null)),
  check (titulo_id is null or baixa_id is not null)
);
create index if not exists ix_lancamento_empresa_data on lancamento (empresa_id, data desc);
create index if not exists ix_lancamento_empresa_competencia on lancamento (empresa_id, competencia);
create index if not exists ix_lancamento_conta on lancamento (conta_id, data);
create index if not exists ix_lancamento_conta_destino on lancamento (conta_destino_id, data) where conta_destino_id is not null;
create index if not exists ix_lancamento_plano on lancamento (plano_conta_id, data);
create index if not exists ix_lancamento_titulo on lancamento (titulo_id) where titulo_id is not null;
create index if not exists ix_lancamento_baixa on lancamento (baixa_id) where baixa_id is not null;
create index if not exists ix_lancamento_pendente on lancamento (empresa_id) where situacao = 'PENDENTE';
create unique index if not exists ux_lancamento_extrato on lancamento (conta_id, extrato_id) where extrato_id is not null;

-- Regras do título: conta do plano do tipo certo, cadastros da mesma empresa, competência no 1º dia do mês,
-- e os campos calculados (valor_pago, pago_em, situacao) recalculados a partir das baixas
create or replace function fn_titulo_regras() returns trigger
language plpgsql security definer set search_path = public as $$
declare p plano_conta; v_emp int;
begin
  perform confere_empresa(new.empresa_id);
  if tg_op = 'UPDATE' and new.empresa_id is distinct from old.empresa_id then raise exception 'O título não muda de empresa.'; end if;
  if tg_op = 'UPDATE' and new.tipo is distinct from old.tipo and old.valor_pago > 0 then raise exception 'Título com baixa não muda entre pagar e receber.'; end if;
  select * into p from plano_conta where id = new.plano_conta_id;
  if p.id is null or p.empresa_id <> new.empresa_id then raise exception 'Conta do plano inexistente.'; end if;
  if p.tipo <> (case new.tipo when 'PAGAR' then 'SAIDA' else 'ENTRADA' end) then
    raise exception 'A conta do plano "%" é de %, e o título é a %.', p.nome, case p.tipo when 'ENTRADA' then 'entrada' else 'saída' end, case new.tipo when 'PAGAR' then 'pagar' else 'receber' end;
  end if;
  if tg_op = 'INSERT' or new.plano_conta_id is distinct from old.plano_conta_id then
    if not p.ativa then raise exception 'A conta do plano "%" está inativa.', p.nome; end if;
    if p.nivel = 1 then raise exception '"%" agrupa outras contas do plano: escolha uma das contas abaixo dela.', p.nome; end if;
  end if;
  if new.parceiro_id is not null then
    select empresa_id into v_emp from parceiro where id = new.parceiro_id;
    if v_emp is distinct from new.empresa_id then raise exception 'Cliente/fornecedor inexistente.'; end if;
  end if;
  if new.centro_custo_id is not null then
    select empresa_id into v_emp from centro_custo where id = new.centro_custo_id;
    if v_emp is distinct from new.empresa_id then raise exception 'Centro de custo inexistente.'; end if;
    if (tg_op = 'INSERT' or new.centro_custo_id is distinct from old.centro_custo_id) and not (select ativo from centro_custo where id = new.centro_custo_id) then
      raise exception 'Centro de custo inativo.';
    end if;
  end if;
  if new.conta_prevista_id is not null then
    select empresa_id into v_emp from conta_financeira where id = new.conta_prevista_id;
    if v_emp is distinct from new.empresa_id then raise exception 'Conta financeira inexistente.'; end if;
  end if;
  new.descricao := btrim(new.descricao);
  new.documento := nullif(btrim(new.documento), '');
  new.competencia := date_trunc('month', coalesce(new.competencia, new.vencimento))::date;
  -- campos calculados: nunca vêm da tela
  if tg_op = 'INSERT' then
    new.valor_pago := 0; new.pago_em := null;
  else
    select coalesce(sum(valor), 0), max(data) into new.valor_pago, new.pago_em
      from lancamento where titulo_id = new.id and titulo_papel = 'PRINCIPAL' and situacao = 'CONFIRMADO';
  end if;
  if new.valor < new.valor_pago then raise exception 'O valor do título (%) não pode ficar menor que o já baixado (%).', new.valor, new.valor_pago; end if;
  if new.cancelado and new.valor_pago > 0 then raise exception 'Título com baixa não pode ser cancelado: estorne as baixas antes.'; end if;
  if not new.cancelado then new.cancelado_motivo := null; end if;
  new.situacao := case when new.cancelado then 'CANCELADO' when new.valor_pago >= new.valor then 'PAGO' when new.valor_pago > 0 then 'PARCIAL' else 'ABERTO' end;
  return new;
end $$;
drop trigger if exists trg_titulo_regras on titulo;
create trigger trg_titulo_regras before insert or update on titulo for each row execute function fn_titulo_regras();

-- Regras do lançamento: conta do plano do tipo certo e ativa (conferida só quando o vínculo muda, para um lançamento
-- antigo continuar editável), contas/cadastros da mesma empresa, título compatível
create or replace function fn_lancamento_regras() returns trigger
language plpgsql security definer set search_path = public as $$
declare p plano_conta; c conta_financeira; t titulo; v_emp int;
begin
  perform confere_empresa(new.empresa_id);
  if tg_op = 'UPDATE' and new.empresa_id is distinct from old.empresa_id then raise exception 'O lançamento não muda de empresa.'; end if;
  if new.plano_conta_id is not null then
    select * into p from plano_conta where id = new.plano_conta_id;
    if p.id is null or p.empresa_id <> new.empresa_id then raise exception 'Conta do plano inexistente.'; end if;
    if p.tipo <> new.tipo then raise exception 'A conta do plano "%" é de %, mas o lançamento é de %.', p.nome, lower(p.tipo), lower(new.tipo); end if;
    if tg_op = 'INSERT' or new.plano_conta_id is distinct from old.plano_conta_id then
      if not p.ativa then raise exception 'A conta do plano "%" está inativa.', p.nome; end if;
      if p.nivel = 1 then raise exception '"%" agrupa outras contas do plano: escolha uma das contas abaixo dela.', p.nome; end if;
    end if;
  end if;
  select * into c from conta_financeira where id = new.conta_id;
  if c.id is null or c.empresa_id <> new.empresa_id then raise exception 'Conta financeira inexistente.'; end if;
  if not c.ativa and (tg_op = 'INSERT' or new.conta_id is distinct from old.conta_id) then raise exception 'A conta "%" está inativa.', c.nome; end if;
  if new.conta_destino_id is not null then
    select * into c from conta_financeira where id = new.conta_destino_id;
    if c.id is null or c.empresa_id <> new.empresa_id then raise exception 'Conta de destino inexistente.'; end if;
    if not c.ativa and (tg_op = 'INSERT' or new.conta_destino_id is distinct from old.conta_destino_id) then raise exception 'A conta de destino "%" está inativa.', c.nome; end if;
  end if;
  if new.parceiro_id is not null then
    select empresa_id into v_emp from parceiro where id = new.parceiro_id;
    if v_emp is distinct from new.empresa_id then raise exception 'Cliente/fornecedor inexistente.'; end if;
  end if;
  if new.centro_custo_id is not null then
    select empresa_id into v_emp from centro_custo where id = new.centro_custo_id;
    if v_emp is distinct from new.empresa_id then raise exception 'Centro de custo inexistente.'; end if;
  end if;
  if new.titulo_id is not null then
    select * into t from titulo where id = new.titulo_id;
    if t.id is null or t.empresa_id <> new.empresa_id then raise exception 'Título inexistente.'; end if;
    if new.titulo_papel = 'PRINCIPAL' and new.tipo <> (case t.tipo when 'PAGAR' then 'SAIDA' else 'ENTRADA' end) then
      raise exception 'A baixa de um título a % é uma %.', lower(t.tipo), case t.tipo when 'PAGAR' then 'saída' else 'entrada' end;
    end if;
    if t.cancelado and (tg_op = 'INSERT' or new.titulo_id is distinct from old.titulo_id) then raise exception 'O título está cancelado.'; end if;
  end if;
  new.descricao := nullif(btrim(new.descricao), '');
  new.documento := nullif(btrim(new.documento), '');
  new.competencia := date_trunc('month', coalesce(new.competencia, new.data))::date;
  if new.tipo <> 'ENTRADA' and new.tipo <> 'SAIDA' then new.parceiro_id := null; new.centro_custo_id := null; end if;
  return new;
end $$;
drop trigger if exists trg_lancamento_regras on lancamento;
create trigger trg_lancamento_regras before insert or update on lancamento for each row execute function fn_lancamento_regras();

-- Depois de mexer numa baixa, o título recalcula valor pago, data e situação (fn_titulo_regras faz a conta)
create or replace function fn_lancamento_recalcula_titulo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'INSERT' and old.titulo_id is not null then update titulo set valor_pago = valor_pago where id = old.titulo_id; end if;
  if tg_op <> 'DELETE' and new.titulo_id is not null and (tg_op = 'INSERT' or new.titulo_id is distinct from old.titulo_id
       or new.valor is distinct from old.valor or new.situacao is distinct from old.situacao or new.data is distinct from old.data or new.titulo_papel is distinct from old.titulo_papel) then
    update titulo set valor_pago = valor_pago where id = new.titulo_id;
  end if;
  return null;
end $$;
drop trigger if exists trg_lancamento_recalcula_titulo on lancamento;
create trigger trg_lancamento_recalcula_titulo after insert or update or delete on lancamento for each row execute function fn_lancamento_recalcula_titulo();

-- Lançamentos de baixa (com baixa_id) só nascem, mudam de valor/vínculo e saem pelas funções baixar_titulo,
-- conciliar_titulo e estornar_baixa (marcam app.baixa = on na transação; o PostgREST não expõe set_config).
-- Pela tela dá para corrigir só descrição, documento, forma e centro de custo; para o resto: estornar e baixar de novo.
create or replace function fn_lancamento_baixa_protegida() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('app.baixa', true), '') = 'on' then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'INSERT' then
    if new.titulo_id is not null or new.baixa_id is not null then raise exception 'Baixa de título só pela tela de contas a pagar/receber (Baixar).'; end if;
    return new;
  end if;
  if old.baixa_id is null then
    if new.titulo_id is not null or new.baixa_id is not null then raise exception 'Baixa de título só pela tela de contas a pagar/receber (Baixar).'; end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then raise exception 'Este lançamento é a baixa de um título: use "Estornar baixa" no título.'; end if;
  if (new.data, new.valor, new.tipo, new.conta_id, new.plano_conta_id, new.situacao, new.titulo_id, new.titulo_papel, new.baixa_id, new.competencia)
     is distinct from (old.data, old.valor, old.tipo, old.conta_id, old.plano_conta_id, old.situacao, old.titulo_id, old.titulo_papel, old.baixa_id, old.competencia) then
    raise exception 'Este lançamento é a baixa de um título: para mudar data, valor, conta ou classificação, estorne a baixa e baixe de novo.';
  end if;
  return new;
end $$;
drop trigger if exists trg_lancamento_baixa_protegida on lancamento;
create trigger trg_lancamento_baixa_protegida before insert or update or delete on lancamento for each row execute function fn_lancamento_baixa_protegida();

-- carimbo e auditoria
do $$
declare t text;
begin
  foreach t in array array['titulo','lancamento'] loop
    execute format('drop trigger if exists trg_carimbo_%s on %I', t, t);
    execute format('create trigger trg_carimbo_%s before insert or update on %I for each row execute function fn_carimbo()', t, t);
  end loop;
  foreach t in array array['titulo','lancamento','importacao_extrato'] loop
    execute format('drop trigger if exists trg_aud_%s on %I', t, t);
    execute format('create trigger trg_aud_%s after insert or update or delete on %I for each row execute function fn_auditoria()', t, t);
  end loop;
end $$;
drop trigger if exists trg_fixa_empresa on importacao_extrato;
create trigger trg_fixa_empresa before update on importacao_extrato for each row execute function fn_fixa_empresa();

-- =====================================================================
-- 3. Baixa e estorno de títulos
-- =====================================================================
-- p_valor = quanto do título fica quitado (principal). Juros/multa e desconto viram lançamentos separados nas contas do
-- plano definidas em Empresa › Configuração, para a DRE mostrar cada coisa no lugar certo. Valor que sai/entra na conta
-- = principal + juros − desconto. Devolve o baixa_id (agrupa os lançamentos da baixa).
create or replace function baixar_titulo(p_titulo_id bigint, p_data date, p_conta_id int, p_valor numeric,
  p_juros numeric default 0, p_desconto numeric default 0, p_forma text default null, p_descricao text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare t titulo; e empresa; v_baixa uuid := gen_random_uuid(); v_mov text; v_desc text; v_plano int;
begin
  if not eh_operador() then raise exception 'Sem permissão para baixar títulos'; end if;
  select * into t from titulo where id = p_titulo_id and empresa_id = empresa_atual() for update;
  if t.id is null then raise exception 'Título não encontrado'; end if;
  if t.cancelado then raise exception 'O título está cancelado'; end if;
  p_juros := coalesce(p_juros, 0); p_desconto := coalesce(p_desconto, 0);
  if p_valor is null or p_valor <= 0 then raise exception 'Informe o valor da baixa'; end if;
  if p_juros < 0 or p_desconto < 0 then raise exception 'Juros e desconto não podem ser negativos'; end if;
  if p_valor > t.valor - t.valor_pago then raise exception 'O valor da baixa (%) é maior que o saldo do título (%)', p_valor, t.valor - t.valor_pago; end if;
  if p_desconto >= p_valor + p_juros then raise exception 'O desconto não pode ser maior que o valor pago'; end if;
  select * into e from empresa where id = t.empresa_id;
  perform set_config('app.baixa', 'on', true);
  v_mov := case t.tipo when 'PAGAR' then 'SAIDA' else 'ENTRADA' end;
  v_desc := coalesce(nullif(btrim(p_descricao), ''), t.descricao || case when t.parcelas > 1 then format(' (%s/%s)', t.parcela, t.parcelas) else '' end);
  insert into lancamento (empresa_id, data, competencia, tipo, plano_conta_id, centro_custo_id, conta_id, valor, parceiro_id, forma, descricao, documento,
                          origem, titulo_id, titulo_papel, baixa_id)
  values (t.empresa_id, p_data, t.competencia, v_mov, t.plano_conta_id, t.centro_custo_id, p_conta_id, p_valor, t.parceiro_id, p_forma, v_desc, t.documento,
          'BAIXA', t.id, 'PRINCIPAL', v_baixa);
  if p_juros > 0 then
    v_plano := case t.tipo when 'PAGAR' then e.plano_juros_pagos_id else e.plano_juros_recebidos_id end;
    if v_plano is null then raise exception 'Defina a conta do plano para juros e multas em Empresa › Configuração'; end if;
    insert into lancamento (empresa_id, data, competencia, tipo, plano_conta_id, centro_custo_id, conta_id, valor, parceiro_id, forma, descricao, documento, origem, titulo_id, titulo_papel, baixa_id)
    values (t.empresa_id, p_data, date_trunc('month', p_data)::date, v_mov, v_plano, t.centro_custo_id, p_conta_id, p_juros, t.parceiro_id, p_forma, 'Juros/multa: ' || v_desc, t.documento, 'BAIXA', t.id, 'JUROS', v_baixa);
  end if;
  if p_desconto > 0 then
    v_plano := case t.tipo when 'PAGAR' then e.plano_descontos_obtidos_id else e.plano_descontos_concedidos_id end;
    if v_plano is null then raise exception 'Defina a conta do plano para descontos em Empresa › Configuração'; end if;
    insert into lancamento (empresa_id, data, competencia, tipo, plano_conta_id, centro_custo_id, conta_id, valor, parceiro_id, forma, descricao, documento, origem, titulo_id, titulo_papel, baixa_id)
    values (t.empresa_id, p_data, date_trunc('month', p_data)::date, case v_mov when 'SAIDA' then 'ENTRADA' else 'SAIDA' end, v_plano, t.centro_custo_id, p_conta_id, p_desconto, t.parceiro_id, p_forma, 'Desconto: ' || v_desc, t.documento, 'BAIXA', t.id, 'DESCONTO', v_baixa);
  end if;
  return v_baixa;
end $$;

-- Estorno: apaga os lançamentos da baixa (o título volta a ficar em aberto). Lançamento conciliado com o extrato volta a
-- ser pendente (a linha do banco continua existindo); os juros criados na conciliação saem.
create or replace function estornar_baixa(p_baixa_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not eh_financeiro() then raise exception 'Somente o financeiro estorna baixas'; end if;
  if not exists (select 1 from lancamento where baixa_id = p_baixa_id and empresa_id = empresa_atual()) then raise exception 'Baixa não encontrada'; end if;
  perform set_config('app.baixa', 'on', true);
  update lancamento l set titulo_id = null, titulo_papel = null, baixa_id = null, situacao = 'PENDENTE', valor = coalesce(
           (select sum(x.valor * case when x.tipo = l.tipo then 1 else -1 end) from lancamento x where x.baixa_id = p_baixa_id and x.empresa_id = l.empresa_id), l.valor)
   where l.baixa_id = p_baixa_id and l.empresa_id = empresa_atual() and l.extrato_id is not null and l.titulo_papel = 'PRINCIPAL';
  delete from lancamento where baixa_id = p_baixa_id and empresa_id = empresa_atual();
  perform set_config('app.baixa', '', true);
end $$;

-- =====================================================================
-- 4. Importação de extrato (OFX/CSV) e conciliação
-- =====================================================================
-- p_linhas = [{extrato_id, data, valor (negativo = saída), descricao, plano_conta_id?, parceiro_id?, centro_custo_id?}]
-- Linha cujo extrato_id já existe na conta conta como duplicada e é ignorada. Tudo entra PENDENTE.
create or replace function importar_extrato(p_conta_id int, p_arquivo text, p_formato text, p_linhas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp int := empresa_atual(); v_imp int; v_l jsonb; v_valor numeric; v_tipo text; v_plano int; v_parc int; v_cc int;
        v_n int := 0; v_dup int := 0; v_de date; v_ate date;
begin
  if not eh_operador() or v_emp is null then raise exception 'Sem permissão no financeiro'; end if;
  if p_formato not in ('OFX','CSV') then raise exception 'Formato inválido'; end if;
  if jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) > 5000 then raise exception 'Arquivo grande demais (máximo de 5.000 linhas por vez)'; end if;
  if not exists (select 1 from conta_financeira where id = p_conta_id and empresa_id = v_emp and ativa) then raise exception 'Conta inválida'; end if;
  select min((x->>'data')::date), max((x->>'data')::date) into v_de, v_ate from jsonb_array_elements(p_linhas) x;
  insert into importacao_extrato (empresa_id, conta_id, arquivo_nome, formato, periodo_de, periodo_ate, linhas)
    values (v_emp, p_conta_id, left(p_arquivo, 200), p_formato, v_de, v_ate, jsonb_array_length(p_linhas)) returning id into v_imp;
  for v_l in select * from jsonb_array_elements(p_linhas) loop
    v_valor := round((v_l->>'valor')::numeric, 2);
    if v_valor = 0 or coalesce(v_l->>'extrato_id', '') = '' then continue; end if;
    if exists (select 1 from lancamento where conta_id = p_conta_id and extrato_id = v_l->>'extrato_id') then v_dup := v_dup + 1; continue; end if;
    v_tipo := case when v_valor > 0 then 'ENTRADA' else 'SAIDA' end;
    v_plano := nullif(v_l->>'plano_conta_id', '')::int;
    if v_plano is null or not exists (select 1 from plano_conta where id = v_plano and empresa_id = v_emp and tipo = v_tipo and ativa and nivel > 1) then v_plano := plano_a_classificar(v_tipo); end if;
    v_parc := nullif(v_l->>'parceiro_id', '')::int;
    if v_parc is not null and not exists (select 1 from parceiro where id = v_parc and empresa_id = v_emp) then v_parc := null; end if;
    v_cc := nullif(v_l->>'centro_custo_id', '')::int;
    if v_cc is not null and not exists (select 1 from centro_custo where id = v_cc and empresa_id = v_emp and ativo) then v_cc := null; end if;
    insert into lancamento (empresa_id, data, tipo, plano_conta_id, centro_custo_id, conta_id, valor, parceiro_id, descricao, origem, situacao, extrato_id, extrato_descricao, importacao_id)
      values (v_emp, (v_l->>'data')::date, v_tipo, v_plano, v_cc, p_conta_id, abs(v_valor), v_parc, left(v_l->>'descricao', 200), 'IMPORTACAO', 'PENDENTE',
              left(v_l->>'extrato_id', 200), left(v_l->>'descricao', 300), v_imp);
    v_n := v_n + 1;
  end loop;
  update importacao_extrato set importadas = v_n, duplicadas = v_dup where id = v_imp;
  return jsonb_build_object('importacao_id', v_imp, 'importadas', v_n, 'duplicadas', v_dup);
end $$;

-- Sugestão de classificação pelo histórico: último lançamento confirmado da empresa com a mesma descrição de extrato
create or replace function sugerir_classificacao(p_descricoes text[])
returns table (descricao text, plano_conta_id int, parceiro_id int, centro_custo_id int)
language sql stable security definer set search_path = public as $$
  select distinct on (d) d, l.plano_conta_id, l.parceiro_id, l.centro_custo_id
  from unnest(p_descricoes[1:2000]) d
  join lancamento l on l.empresa_id = empresa_atual() and l.situacao = 'CONFIRMADO' and l.extrato_descricao is not null
   and l.titulo_id is null and normalizar(l.extrato_descricao) = normalizar(d)
  join plano_conta p on p.id = l.plano_conta_id and p.ativa
  where eh_operador()
  order by d, l.data desc, l.id desc
$$;

-- Títulos em aberto candidatos a quitar com uma linha pendente do extrato (mesma direção; valor e data mais próximos)
create or replace function titulos_para_conciliar(p_lancamento_id bigint)
returns table (titulo_id bigint, descricao text, parceiro text, vencimento date, saldo numeric, diferenca numeric, dias int)
language sql stable security definer set search_path = public as $$
  select t.id, t.descricao || case when t.parcelas > 1 then format(' (%s/%s)', t.parcela, t.parcelas) else '' end, coalesce(pa.nome_fantasia, pa.nome),
         t.vencimento, t.valor - t.valor_pago, abs(t.valor - t.valor_pago - l.valor), abs(t.vencimento - l.data)
  from lancamento l
  join titulo t on t.empresa_id = l.empresa_id and t.situacao in ('ABERTO','PARCIAL')
   and t.tipo = case l.tipo when 'SAIDA' then 'PAGAR' else 'RECEBER' end
  left join parceiro pa on pa.id = t.parceiro_id
  where l.id = p_lancamento_id and l.empresa_id = empresa_atual() and l.situacao = 'PENDENTE' and l.tipo in ('ENTRADA','SAIDA') and eh_operador()
  order by abs(t.valor - t.valor_pago - l.valor), abs(t.vencimento - l.data), t.vencimento
  limit 15
$$;

-- Concilia a linha pendente do extrato com um título: a linha vira a baixa (principal). Se o banco mostra mais que o
-- saldo do título, a diferença vira juros/multa (lançamento à parte, mesma conta e data).
create or replace function conciliar_titulo(p_lancamento_id bigint, p_titulo_id bigint) returns uuid
language plpgsql security definer set search_path = public as $$
declare l lancamento; t titulo; e empresa; v_saldo numeric; v_baixa uuid := gen_random_uuid(); v_plano int;
begin
  if not eh_operador() then raise exception 'Sem permissão no financeiro'; end if;
  select * into l from lancamento where id = p_lancamento_id and empresa_id = empresa_atual() for update;
  if l.id is null or l.situacao <> 'PENDENTE' or l.tipo not in ('ENTRADA','SAIDA') then raise exception 'Lançamento pendente não encontrado'; end if;
  select * into t from titulo where id = p_titulo_id and empresa_id = l.empresa_id for update;
  if t.id is null or t.situacao not in ('ABERTO','PARCIAL') then raise exception 'Título em aberto não encontrado'; end if;
  if l.tipo <> (case t.tipo when 'PAGAR' then 'SAIDA' else 'ENTRADA' end) then raise exception 'A linha do extrato e o título têm direções diferentes'; end if;
  v_saldo := t.valor - t.valor_pago;
  perform set_config('app.baixa', 'on', true);
  if l.valor > v_saldo then
    select * into e from empresa where id = t.empresa_id;
    v_plano := case t.tipo when 'PAGAR' then e.plano_juros_pagos_id else e.plano_juros_recebidos_id end;
    if v_plano is null then raise exception 'O extrato tem % a mais que o saldo do título. Defina a conta de juros em Empresa › Configuração ou baixe o título à mão.', l.valor - v_saldo; end if;
    insert into lancamento (empresa_id, data, competencia, tipo, plano_conta_id, centro_custo_id, conta_id, valor, parceiro_id, descricao, documento, origem, titulo_id, titulo_papel, baixa_id)
    values (l.empresa_id, l.data, date_trunc('month', l.data)::date, l.tipo, v_plano, t.centro_custo_id, l.conta_id, l.valor - v_saldo, t.parceiro_id, 'Juros/multa: ' || t.descricao, t.documento, 'BAIXA', t.id, 'JUROS', v_baixa);
    l.valor := v_saldo;
  end if;
  update lancamento set valor = l.valor, plano_conta_id = t.plano_conta_id, centro_custo_id = t.centro_custo_id, parceiro_id = coalesce(t.parceiro_id, l.parceiro_id),
         competencia = t.competencia, descricao = t.descricao || case when t.parcelas > 1 then format(' (%s/%s)', t.parcela, t.parcelas) else '' end,
         documento = coalesce(t.documento, l.documento), titulo_id = t.id, titulo_papel = 'PRINCIPAL', baixa_id = v_baixa, situacao = 'CONFIRMADO'
   where id = l.id;
  return v_baixa;
end $$;

-- =====================================================================
-- 5. Documentos anexados (nota fiscal, XML da NF-e, boleto, recibo, comprovante)
--    Bucket privado 'documentos', pasta <empresa>/lancamentos/<id>/… ou <empresa>/titulos/<id>/…
-- =====================================================================
create table if not exists anexo (
  id             int generated always as identity primary key,
  empresa_id     int not null default empresa_atual() references empresa(id) on delete cascade,
  lancamento_id  bigint references lancamento(id) on delete cascade,
  titulo_id      bigint references titulo(id) on delete cascade,
  caminho        text not null,
  nome           text not null,
  mime           text,
  tamanho        int,
  criado_em      timestamptz not null default now(),
  criado_por     uuid default auth.uid() references usuario(id) on delete set null,
  check (num_nonnulls(lancamento_id, titulo_id) = 1)
);
create index if not exists ix_anexo_empresa on anexo (empresa_id, lancamento_id);
create index if not exists ix_anexo_lancamento on anexo (lancamento_id) where lancamento_id is not null;
create index if not exists ix_anexo_titulo on anexo (titulo_id) where titulo_id is not null;

create or replace function fn_anexo_regras() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_emp int; v_pasta text;
begin
  perform confere_empresa(new.empresa_id);
  if new.lancamento_id is not null then
    select empresa_id into v_emp from lancamento where id = new.lancamento_id; v_pasta := new.empresa_id || '/lancamentos/' || new.lancamento_id || '/';
  else
    select empresa_id into v_emp from titulo where id = new.titulo_id; v_pasta := new.empresa_id || '/titulos/' || new.titulo_id || '/';
  end if;
  if v_emp is null or v_emp <> new.empresa_id then raise exception 'Registro do anexo inexistente.'; end if;
  if left(new.caminho, length(v_pasta)) <> v_pasta or new.caminho like '%..%' then raise exception 'Caminho do anexo fora da pasta do registro.'; end if;
  if auth.uid() is not null then new.criado_por := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists trg_anexo_regras on anexo;
create trigger trg_anexo_regras before insert or update on anexo for each row execute function fn_anexo_regras();
drop trigger if exists trg_aud_anexo on anexo;
create trigger trg_aud_anexo after insert or update or delete on anexo for each row execute function fn_auditoria();

-- =====================================================================
-- 6. Orçamento (previsão por conta do plano e mês) — realizado pelo regime de caixa
-- =====================================================================
create table if not exists orcamento (
  empresa_id      int not null default empresa_atual() references empresa(id) on delete cascade,
  ano             int not null check (ano between 2000 and 2100),
  plano_conta_id  int not null references plano_conta(id) on delete cascade,
  mes             int not null check (mes between 1 and 12),
  valor           numeric(14,2) not null default 0 check (valor >= 0),
  primary key (empresa_id, ano, plano_conta_id, mes)
);
create table if not exists orcamento_parametro (
  empresa_id      int not null default empresa_atual() references empresa(id) on delete cascade,
  ano             int not null,
  ano_base        int,
  reajuste_pct    numeric(7,2) not null default 0,
  fonte_reajuste  text,
  observacao      text,
  gerado_em       timestamptz not null default now(),
  gerado_por      uuid default auth.uid() references usuario(id) on delete set null,
  primary key (empresa_id, ano)
);

create or replace function fn_orcamento_regras() returns trigger
language plpgsql security definer set search_path = public as $$
declare p plano_conta;
begin
  perform confere_empresa(new.empresa_id);
  select * into p from plano_conta where id = new.plano_conta_id;
  if p.id is null or p.empresa_id <> new.empresa_id then raise exception 'Conta do plano inexistente.'; end if;
  if p.nivel = 1 then raise exception '"%" agrupa outras contas: o orçamento vai nas contas abaixo dela.', p.nome; end if;
  return new;
end $$;
drop trigger if exists trg_orcamento_regras on orcamento;
create trigger trg_orcamento_regras before insert or update on orcamento for each row execute function fn_orcamento_regras();
do $$
declare t text;
begin
  foreach t in array array['orcamento','orcamento_parametro'] loop
    execute format('drop trigger if exists trg_aud_%s on %I', t, t);
    execute format('create trigger trg_aud_%s after insert or update or delete on %I for each row execute function fn_auditoria()', t, t);
  end loop;
end $$;

-- Gera o orçamento do ano a partir do realizado de um ano-base (meses futuros do ano-base: média dos meses com valor),
-- com reajuste percentual. Substitui o orçamento do ano.
create or replace function gerar_orcamento(p_ano int, p_ano_base int, p_reajuste_pct numeric, p_fonte text default null) returns int
language plpgsql security definer set search_path = public as $$
declare v_p record; v_mes int; v_real numeric; v_media numeric; v_meses_com int; v_n int := 0; v_fator numeric := 1 + coalesce(p_reajuste_pct, 0) / 100; v_emp int := empresa_atual();
begin
  if not eh_financeiro() or v_emp is null then raise exception 'Somente o financeiro gera o orçamento'; end if;
  delete from orcamento where ano = p_ano and empresa_id = v_emp;
  for v_p in select id from plano_conta where ativa and nivel > 1 and empresa_id = v_emp loop
    select coalesce(avg(t), 0), count(*) into v_media, v_meses_com
      from (select sum(valor) t from lancamento where plano_conta_id = v_p.id and empresa_id = v_emp and situacao = 'CONFIRMADO'
              and data between make_date(p_ano_base, 1, 1) and make_date(p_ano_base, 12, 31) group by date_trunc('month', data)) s;
    continue when v_meses_com = 0;
    for v_mes in 1..12 loop
      select coalesce(sum(valor), 0) into v_real from lancamento where plano_conta_id = v_p.id and empresa_id = v_emp and situacao = 'CONFIRMADO'
         and data between make_date(p_ano_base, v_mes, 1) and (make_date(p_ano_base, v_mes, 1) + interval '1 month - 1 day')::date;
      if v_real = 0 and make_date(p_ano_base, v_mes, 1) > current_date then v_real := v_media; end if;
      insert into orcamento (empresa_id, ano, plano_conta_id, mes, valor) values (v_emp, p_ano, v_p.id, v_mes, round(v_real * v_fator, 2));
      v_n := v_n + 1;
    end loop;
  end loop;
  insert into orcamento_parametro (empresa_id, ano, ano_base, reajuste_pct, fonte_reajuste, gerado_por)
    values (v_emp, p_ano, p_ano_base, coalesce(p_reajuste_pct, 0), p_fonte, auth.uid())
    on conflict (empresa_id, ano) do update set ano_base = excluded.ano_base, reajuste_pct = excluded.reajuste_pct, fonte_reajuste = excluded.fonte_reajuste,
      gerado_em = now(), gerado_por = auth.uid();
  return v_n;
end $$;

-- =====================================================================
-- 7. Fechamento do mês (Luminexus 0064): o financeiro fecha, o banco grava o balancete e trava os lançamentos do mês;
--    o contador dá o parecer (APROVADO, RESSALVA ou DEVOLVIDO — devolvido destrava). Reabrir: só diretor/TI.
-- =====================================================================
create table if not exists fechamento_mes (
  id            int generated always as identity primary key,
  empresa_id    int not null default empresa_atual() references empresa(id) on delete cascade,
  mes           date not null check (extract(day from mes) = 1),
  status        text not null default 'FECHADO' check (status in ('FECHADO','APROVADO','RESSALVA','DEVOLVIDO')),
  saldo_inicial numeric(14,2) not null,
  entradas      numeric(14,2) not null,
  saidas        numeric(14,2) not null,
  saldo_final   numeric(14,2) not null,
  resumo        jsonb not null,             -- balancete no momento do fechamento: { contas: [...], planos: [...] }
  observacao    text,
  fechado_em    timestamptz not null default now(),
  fechado_por   uuid default auth.uid() references usuario(id) on delete set null,
  parecer       text,
  avaliado_em   timestamptz,
  avaliado_por  uuid references usuario(id) on delete set null,
  unique (empresa_id, mes)
);
drop trigger if exists trg_aud_fechamento_mes on fechamento_mes;
create trigger trg_aud_fechamento_mes after insert or update or delete on fechamento_mes for each row execute function fn_auditoria();

-- trava: lançamento em mês fechado (que não foi devolvido) não entra, não muda e não sai
create or replace function fn_lancamento_mes_fechado() returns trigger
language plpgsql security definer set search_path = public as $$
declare d date; v_emp int;
begin
  v_emp := case when tg_op = 'DELETE' then old.empresa_id else new.empresa_id end;
  foreach d in array array[case when tg_op <> 'INSERT' then old.data end, case when tg_op <> 'DELETE' then new.data end] loop
    continue when d is null;
    if exists (select 1 from fechamento_mes f where f.empresa_id = v_emp and f.mes = date_trunc('month', d)::date and f.status <> 'DEVOLVIDO') then
      raise exception 'O mês %/% está fechado. Para corrigir, o contador devolve ou a diretoria reabre o mês.', to_char(d, 'MM'), to_char(d, 'YYYY');
    end if;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists trg_lancamento_mes_fechado on lancamento;
create trigger trg_lancamento_mes_fechado before insert or update or delete on lancamento for each row execute function fn_lancamento_mes_fechado();

-- balancete de um mês (cálculo; usado ao fechar e para a prévia)
create or replace function balancete_mes(p_mes date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare ini date := date_trunc('month', p_mes)::date; fim date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date;
        v_emp int := empresa_atual(); r jsonb;
begin
  if not eh_leitor() or v_emp is null then raise exception 'Sem permissão no financeiro'; end if;
  with mov as (
    select l.* from lancamento l where l.empresa_id = v_emp and l.situacao = 'CONFIRMADO' and l.data <= fim
  ), contas as (
    select c.id, c.nome, c.tipo,
      c.saldo_inicial + coalesce((select sum(case when m.tipo = 'ENTRADA' then m.valor else -m.valor end) from mov m where m.conta_id = c.id and m.data < ini), 0)
                      + coalesce((select sum(m.valor) from mov m where m.conta_destino_id = c.id and m.data < ini), 0) as inicial,
      c.saldo_inicial + coalesce((select sum(case when m.tipo = 'ENTRADA' then m.valor else -m.valor end) from mov m where m.conta_id = c.id), 0)
                      + coalesce((select sum(m.valor) from mov m where m.conta_destino_id = c.id), 0) as final
    from conta_financeira c where c.empresa_id = v_emp
  ), planos as (
    select m.tipo, p.grupo, r.codigo as raiz_codigo, r.nome as raiz, p.id as plano_conta_id, p.codigo, p.nome, sum(m.valor) as total, count(*) as qtd
    from mov m join plano_conta p on p.id = m.plano_conta_id
    left join plano_conta r on r.empresa_id = p.empresa_id and r.codigo = (p.codigo / 1000000) * 1000000
    where m.data >= ini and m.tipo in ('ENTRADA','SAIDA')
    group by 1, 2, 3, 4, 5, 6, 7
  )
  select jsonb_build_object(
    'mes', ini,
    'saldo_inicial', coalesce((select sum(inicial) from contas), 0),
    'entradas', coalesce((select sum(total) from planos where tipo = 'ENTRADA'), 0),
    'saidas', coalesce((select sum(total) from planos where tipo = 'SAIDA'), 0),
    'saldo_final', coalesce((select sum(final) from contas), 0),
    'planos', coalesce((select jsonb_agg(to_jsonb(planos) order by tipo, codigo) from planos), '[]'::jsonb),
    'contas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'tipo', tipo, 'inicial', inicial, 'final', final) order by nome) from contas where inicial <> 0 or final <> 0), '[]'::jsonb),
    'pendentes', (select count(*) from lancamento l where l.empresa_id = v_emp and l.data between ini and fim and l.situacao <> 'CONFIRMADO')
  ) into r;
  return r;
end $$;

create or replace function fechar_mes(p_mes date, p_observacao text default null) returns void
language plpgsql security definer set search_path = public as $$
declare b jsonb; ini date := date_trunc('month', p_mes)::date; f fechamento_mes;
begin
  if not eh_financeiro() then raise exception 'Somente o financeiro fecha o mês'; end if;
  if ini >= date_trunc('month', current_date)::date then raise exception 'Só dá para fechar meses que já terminaram'; end if;
  select * into f from fechamento_mes where empresa_id = empresa_atual() and mes = ini;
  if found and f.status <> 'DEVOLVIDO' then raise exception 'Este mês já está fechado'; end if;
  b := balancete_mes(ini);
  if (b->>'pendentes')::int > 0 then raise exception 'Há % lançamento(s) pendente(s) neste mês. Classifique ou exclua antes de fechar.', b->>'pendentes'; end if;
  insert into fechamento_mes (empresa_id, mes, status, saldo_inicial, entradas, saidas, saldo_final, resumo, observacao)
  values (empresa_atual(), ini, 'FECHADO', (b->>'saldo_inicial')::numeric, (b->>'entradas')::numeric, (b->>'saidas')::numeric, (b->>'saldo_final')::numeric, b,
          nullif(btrim(coalesce(p_observacao, '')), ''))
  on conflict (empresa_id, mes) do update set status = 'FECHADO', saldo_inicial = excluded.saldo_inicial, entradas = excluded.entradas, saidas = excluded.saidas,
    saldo_final = excluded.saldo_final, resumo = excluded.resumo, observacao = excluded.observacao, fechado_em = now(), fechado_por = auth.uid(),
    parecer = null, avaliado_em = null, avaliado_por = null;
end $$;

create or replace function avaliar_fechamento(p_mes date, p_status text, p_parecer text) returns void
language plpgsql security definer set search_path = public as $$
declare f fechamento_mes;
begin
  if not eh_contador() then raise exception 'Somente o contador dá o parecer'; end if;
  if p_status not in ('APROVADO','RESSALVA','DEVOLVIDO') then raise exception 'Parecer inválido'; end if;
  if p_status <> 'APROVADO' and length(btrim(coalesce(p_parecer, ''))) < 5 then raise exception 'Escreva o motivo (ressalva ou devolução)'; end if;
  select * into f from fechamento_mes where empresa_id = empresa_atual() and mes = date_trunc('month', p_mes)::date for update;
  if not found or f.status <> 'FECHADO' then raise exception 'Este mês não está aguardando parecer'; end if;
  update fechamento_mes set status = p_status, parecer = nullif(btrim(coalesce(p_parecer, '')), ''), avaliado_em = now(), avaliado_por = auth.uid() where id = f.id;
end $$;

create or replace function reabrir_mes(p_mes date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not eh_diretor() then raise exception 'Somente a diretoria reabre um mês fechado'; end if;
  delete from fechamento_mes where empresa_id = empresa_atual() and mes = date_trunc('month', p_mes)::date;
  if not found then raise exception 'Este mês não está fechado'; end if;
end $$;

notify pgrst, 'reload schema';
