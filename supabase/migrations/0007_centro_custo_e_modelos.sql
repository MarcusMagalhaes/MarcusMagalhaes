-- Finanway · 0007: centro de custo como no Luminexus (0082/0083 e 0121), pedido do Marcus em 21/10/2026.
--   • A árvore de 4 níveis (tabela plano_conta, coluna plano_conta_id) passa a se chamar CENTRO DE CUSTO nas telas e nas
--     mensagens: é ela que classifica o lançamento, o título e o orçamento e define se é Entrada ou Saída (tipo herdado do
--     1º nível) e a linha da DRE (grupo). O nome interno continua plano_conta, como categoria_financeira no Luminexus.
--   • O cadastro simples de centros de custo que veio do AgroAves (tabela centro_custo, sem tipo) sai de uso: os dados
--     são apagados, as colunas lancamento.centro_custo_id e titulo.centro_custo_id ficam sempre vazias (restrição abaixo)
--     e a tela não grava mais nela. A tabela e as colunas continuam no banco só para as migrações 0002–0006 poderem rodar
--     de novo (as views da 0004 e a sugerir_classificacao as citam).
--   • Lançamento por modelo (Luminexus 0121): a tela Lançamentos ganha a visão "Por modelo", quadros de blocos (título,
--     cor e centros de custo) com o total do mês por centro e o "+" que abre o lançamento já preenchido.
--     `blocos` = [{ "titulo": text, "cor": text, "centros": [plano_conta.id, …] }, …]; o centro entra com todos os filhos.
--     Todos da empresa veem os modelos; quem cuida dos cadastros (financeiro) cria, altera e exclui.
-- Rode depois da 0006. Pode ser executado mais de uma vez.
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------
-- 1. O centro de custo antigo (lista simples) sai de uso
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from titulo where centro_custo_id is not null) then
    alter table titulo disable trigger user;
    update titulo set centro_custo_id = null where centro_custo_id is not null;
    alter table titulo enable trigger user;
  end if;
  if exists (select 1 from lancamento where centro_custo_id is not null) then
    alter table lancamento disable trigger user;
    update lancamento set centro_custo_id = null where centro_custo_id is not null;
    alter table lancamento enable trigger user;
  end if;
  delete from centro_custo;
  if not exists (select 1 from pg_constraint where conname = 'titulo_sem_centro_antigo') then
    alter table titulo add constraint titulo_sem_centro_antigo check (centro_custo_id is null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lancamento_sem_centro_antigo') then
    alter table lancamento add constraint lancamento_sem_centro_antigo check (centro_custo_id is null);
  end if;
end $$;
revoke insert, update, delete on centro_custo from authenticated;

-- ---------------------------------------------------------------------
-- 2. Regras e funções com as mensagens de "centro de custo" e sem o cadastro antigo
--    (cópias da 0002/0003/0004/0006 com esses ajustes; o painel lista as maiores despesas por centro de custo)
-- ---------------------------------------------------------------------
create or replace function fn_plano_inclusao() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pai plano_conta; v_passo int; v_max int; v_qtd int;
begin
  new.empresa_id := coalesce(new.empresa_id, empresa_atual());
  perform confere_empresa(new.empresa_id);
  new.nome := btrim(new.nome);
  if coalesce(new.nome, '') = '' then raise exception 'Informe o nome do centro de custo.'; end if;
  if new.pai_id is null then
    if new.tipo is null then raise exception 'Informe se o centro de custo é de entrada ou de saída.'; end if;
    new.grupo := coalesce(new.grupo, case when new.tipo = 'ENTRADA' then 'OUTRA_RECEITA' else 'DESPESA_OPERACIONAL' end);
    perform pg_advisory_xact_lock(hashtext('plano_conta_raiz'), new.empresa_id);
    select coalesce(max(codigo), 0) + 1000000 into v_max from plano_conta where empresa_id = new.empresa_id and nivel = 1;
    if v_max > 99000000 then raise exception 'Limite de 99 centros de custo no primeiro nível.'; end if;
    new.codigo := v_max; new.nivel := 1;
  else
    select * into v_pai from plano_conta where id = new.pai_id for update;
    if v_pai.id is null or v_pai.empresa_id <> new.empresa_id then raise exception 'Centro de custo pai inexistente.'; end if;
    if not v_pai.ativa then raise exception 'O centro de custo pai (%) está inativo.', v_pai.nome; end if;
    if v_pai.nivel >= 4 then raise exception 'O centro de custo tem no máximo 4 níveis.'; end if;
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
    raise exception 'O código, o pai, o tipo e o grupo do centro de custo não podem ser alterados.';
  end if;
  new.nome := btrim(new.nome);
  if coalesce(new.nome, '') = '' then raise exception 'Informe o nome do centro de custo.'; end if;
  if new.ativa and not old.ativa and new.pai_id is not null then
    select ativa into v_pai_ativa from plano_conta where id = new.pai_id;
    if not v_pai_ativa then raise exception 'Ative primeiro o centro de custo pai.'; end if;
  end if;
  new.ordem := new.codigo;
  return new;
end $$;

create or replace function fn_titulo_regras() returns trigger
language plpgsql security definer set search_path = public as $$
declare p plano_conta; v_emp int;
begin
  perform confere_empresa(new.empresa_id);
  if tg_op = 'UPDATE' and new.empresa_id is distinct from old.empresa_id then raise exception 'O título não muda de empresa.'; end if;
  if tg_op = 'UPDATE' and new.tipo is distinct from old.tipo and old.valor_pago > 0 then raise exception 'Título com baixa não muda entre pagar e receber.'; end if;
  select * into p from plano_conta where id = new.plano_conta_id;
  if p.id is null or p.empresa_id <> new.empresa_id then raise exception 'Centro de custo inexistente.'; end if;
  if p.tipo <> (case new.tipo when 'PAGAR' then 'SAIDA' else 'ENTRADA' end) then
    raise exception 'O centro de custo "%" é de %, e o título é a %.', p.nome, case p.tipo when 'ENTRADA' then 'entrada' else 'saída' end, case new.tipo when 'PAGAR' then 'pagar' else 'receber' end;
  end if;
  if tg_op = 'INSERT' or new.plano_conta_id is distinct from old.plano_conta_id then
    if not p.ativa then raise exception 'O centro de custo "%" está inativo.', p.nome; end if;
    if p.nivel = 1 then raise exception '"%" agrupa outros centros de custo: escolha um dos centros abaixo dele.', p.nome; end if;
  end if;
  if new.parceiro_id is not null then
    select empresa_id into v_emp from parceiro where id = new.parceiro_id;
    if v_emp is distinct from new.empresa_id then raise exception 'Cliente/fornecedor inexistente.'; end if;
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

create or replace function fn_lancamento_regras() returns trigger
language plpgsql security definer set search_path = public as $$
declare p plano_conta; c conta_financeira; t titulo; v_emp int;
begin
  perform confere_empresa(new.empresa_id);
  if tg_op = 'UPDATE' and new.empresa_id is distinct from old.empresa_id then raise exception 'O lançamento não muda de empresa.'; end if;
  if new.plano_conta_id is not null then
    select * into p from plano_conta where id = new.plano_conta_id;
    if p.id is null or p.empresa_id <> new.empresa_id then raise exception 'Centro de custo inexistente.'; end if;
    if p.tipo <> new.tipo then raise exception 'O centro de custo "%" é de %, mas o lançamento é de %.', p.nome,
      case p.tipo when 'ENTRADA' then 'entrada' else 'saída' end, case new.tipo when 'ENTRADA' then 'entrada' when 'SAIDA' then 'saída' else 'transferência' end; end if;
    if tg_op = 'INSERT' or new.plano_conta_id is distinct from old.plano_conta_id then
      if not p.ativa then raise exception 'O centro de custo "%" está inativo.', p.nome; end if;
      if p.nivel = 1 then raise exception '"%" agrupa outros centros de custo: escolha um dos centros abaixo dele.', p.nome; end if;
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
  if new.tipo <> 'ENTRADA' and new.tipo <> 'SAIDA' then new.parceiro_id := null; end if;
  return new;
end $$;

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
    if v_plano is null then raise exception 'Defina o centro de custo para juros e multas em Empresa › Configuração'; end if;
    insert into lancamento (empresa_id, data, competencia, tipo, plano_conta_id, centro_custo_id, conta_id, valor, parceiro_id, forma, descricao, documento, origem, titulo_id, titulo_papel, baixa_id)
    values (t.empresa_id, p_data, date_trunc('month', p_data)::date, v_mov, v_plano, t.centro_custo_id, p_conta_id, p_juros, t.parceiro_id, p_forma, 'Juros/multa: ' || v_desc, t.documento, 'BAIXA', t.id, 'JUROS', v_baixa);
  end if;
  if p_desconto > 0 then
    v_plano := case t.tipo when 'PAGAR' then e.plano_descontos_obtidos_id else e.plano_descontos_concedidos_id end;
    if v_plano is null then raise exception 'Defina o centro de custo para descontos em Empresa › Configuração'; end if;
    insert into lancamento (empresa_id, data, competencia, tipo, plano_conta_id, centro_custo_id, conta_id, valor, parceiro_id, forma, descricao, documento, origem, titulo_id, titulo_papel, baixa_id)
    values (t.empresa_id, p_data, date_trunc('month', p_data)::date, case v_mov when 'SAIDA' then 'ENTRADA' else 'SAIDA' end, v_plano, t.centro_custo_id, p_conta_id, p_desconto, t.parceiro_id, p_forma, 'Desconto: ' || v_desc, t.documento, 'BAIXA', t.id, 'DESCONTO', v_baixa);
  end if;
  return v_baixa;
end $$;

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
    v_cc := null;   -- 0007: a classificação é o centro de custo (plano_conta_id); a coluna antiga fica sempre vazia
    insert into lancamento (empresa_id, data, tipo, plano_conta_id, centro_custo_id, conta_id, valor, parceiro_id, descricao, origem, situacao, extrato_id, extrato_descricao, importacao_id)
      values (v_emp, (v_l->>'data')::date, v_tipo, v_plano, v_cc, p_conta_id, abs(v_valor), v_parc, left(v_l->>'descricao', 200), 'IMPORTACAO', 'PENDENTE',
              left(v_l->>'extrato_id', 200), left(v_l->>'descricao', 300), v_imp);
    v_n := v_n + 1;
  end loop;
  update importacao_extrato set importadas = v_n, duplicadas = v_dup where id = v_imp;
  return jsonb_build_object('importacao_id', v_imp, 'importadas', v_n, 'duplicadas', v_dup);
end $$;

create or replace function fn_orcamento_regras() returns trigger
language plpgsql security definer set search_path = public as $$
declare p plano_conta;
begin
  perform confere_empresa(new.empresa_id);
  select * into p from plano_conta where id = new.plano_conta_id;
  if p.id is null or p.empresa_id <> new.empresa_id then raise exception 'Centro de custo inexistente.'; end if;
  if p.nivel = 1 then raise exception '"%" agrupa outros centros de custo: o orçamento vai nos centros abaixo dele.', p.nome; end if;
  return new;
end $$;

create or replace function painel(p_ano int, p_mes int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_emp int := empresa_atual();
  ini date := make_date(p_ano, p_mes, 1);
  fim date := (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day')::date;
  v_hoje date := hoje();
  r jsonb;
begin
  if not eh_leitor() or v_emp is null then raise exception 'Sem permissão no financeiro'; end if;
  with mov as (
    select l.data, l.tipo, l.valor, l.plano_conta_id, l.centro_custo_id
      from lancamento l where l.empresa_id = v_emp and l.situacao = 'CONFIRMADO' and l.tipo in ('ENTRADA','SAIDA')
       and l.data between (ini - interval '11 months')::date and fim
  ), mes as (
    select * from mov where data between ini and fim
  ), ant as (
    select * from mov where data between (ini - interval '1 month')::date and (ini - 1)
  ), saldo as (
    select s.id, s.nome, s.tipo, s.saldo, s.limite, s.saldo_inicial, s.data_saldo_inicial,
           exists (select 1 from lancamento x where x.conta_id = s.id or x.conta_destino_id = s.id) as movimentada
      from v_saldo_conta s where s.empresa_id = v_emp and s.ativa
  ), aberto as (
    select t.tipo, t.vencimento, t.valor - t.valor_pago as saldo, t.id, t.descricao, t.parcela, t.parcelas, t.parceiro_id
      from titulo t where t.empresa_id = v_emp and t.situacao in ('ABERTO','PARCIAL')
  ), raiz as (
    select m.tipo, coalesce(r.nome, 'Sem classificação') as nome, sum(m.valor) as total
      from mes m left join plano_conta p on p.id = m.plano_conta_id
      left join plano_conta r on r.empresa_id = p.empresa_id and r.codigo = (p.codigo / 1000000) * 1000000
     group by 1, 2
  ), orc as (
    select p.tipo, sum(o.valor) as previsto,
           coalesce((select sum(m.valor) from mes m join plano_conta q on q.id = m.plano_conta_id where q.tipo = p.tipo
                      and exists (select 1 from orcamento o2 where o2.empresa_id = v_emp and o2.ano = p_ano and o2.mes = p_mes and o2.plano_conta_id = m.plano_conta_id)), 0) as realizado
      from orcamento o join plano_conta p on p.id = o.plano_conta_id
     where o.empresa_id = v_emp and o.ano = p_ano and o.mes = p_mes
     group by 1
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('inicio', ini, 'fim', fim, 'hoje', v_hoje),
    'contas', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'tipo', tipo, 'saldo', saldo, 'limite', limite) order by tipo, nome) from saldo), '[]'::jsonb),
    'saldo_total', coalesce((select sum(saldo) from saldo), 0),
    'mes', jsonb_build_object(
        'entradas', coalesce((select sum(valor) from mes where tipo = 'ENTRADA'), 0),
        'saidas', coalesce((select sum(valor) from mes where tipo = 'SAIDA'), 0),
        'entradas_anterior', coalesce((select sum(valor) from ant where tipo = 'ENTRADA'), 0),
        'saidas_anterior', coalesce((select sum(valor) from ant where tipo = 'SAIDA'), 0)),
    'serie', coalesce((select jsonb_agg(jsonb_build_object('mes', to_char(m, 'YYYY-MM'),
        'entradas', coalesce((select sum(valor) from mov where tipo = 'ENTRADA' and date_trunc('month', data) = m), 0),
        'saidas', coalesce((select sum(valor) from mov where tipo = 'SAIDA' and date_trunc('month', data) = m), 0)) order by m)
        from generate_series(date_trunc('month', ini) - interval '11 months', date_trunc('month', ini), interval '1 month') m), '[]'::jsonb),
    'receber', (select jsonb_build_object(
        'vencido', coalesce(sum(saldo) filter (where vencimento < v_hoje), 0), 'qtd_vencido', count(*) filter (where vencimento < v_hoje),
        'hoje', coalesce(sum(saldo) filter (where vencimento = v_hoje), 0),
        'proximos_7', coalesce(sum(saldo) filter (where vencimento > v_hoje and vencimento <= v_hoje + 7), 0),
        'proximos_30', coalesce(sum(saldo) filter (where vencimento > v_hoje and vencimento <= v_hoje + 30), 0),
        'total', coalesce(sum(saldo), 0), 'qtd', count(*)) from aberto where tipo = 'RECEBER'),
    'pagar', (select jsonb_build_object(
        'vencido', coalesce(sum(saldo) filter (where vencimento < v_hoje), 0), 'qtd_vencido', count(*) filter (where vencimento < v_hoje),
        'hoje', coalesce(sum(saldo) filter (where vencimento = v_hoje), 0),
        'proximos_7', coalesce(sum(saldo) filter (where vencimento > v_hoje and vencimento <= v_hoje + 7), 0),
        'proximos_30', coalesce(sum(saldo) filter (where vencimento > v_hoje and vencimento <= v_hoje + 30), 0),
        'total', coalesce(sum(saldo), 0), 'qtd', count(*)) from aberto where tipo = 'PAGAR'),
    -- inadimplência: a receber vencido por faixa de atraso
    'atraso_receber', (select jsonb_build_object(
        'ate_30', coalesce(sum(saldo) filter (where v_hoje - vencimento between 1 and 30), 0),
        'de_31_60', coalesce(sum(saldo) filter (where v_hoje - vencimento between 31 and 60), 0),
        'de_61_90', coalesce(sum(saldo) filter (where v_hoje - vencimento between 61 and 90), 0),
        'mais_90', coalesce(sum(saldo) filter (where v_hoje - vencimento > 90), 0)) from aberto where tipo = 'RECEBER'),
    'agenda', coalesce((select jsonb_agg(x order by x.vencimento, x.tipo) from (
        select a.id, a.tipo, a.vencimento, a.saldo, a.descricao || case when a.parcelas > 1 then format(' (%s/%s)', a.parcela, a.parcelas) else '' end as descricao,
               coalesce(pa.nome_fantasia, pa.nome) as parceiro
          from aberto a left join parceiro pa on pa.id = a.parceiro_id
         where a.vencimento <= v_hoje + 7 order by a.vencimento, a.tipo limit 15) x), '[]'::jsonb),
    'receitas_por_raiz', coalesce((select jsonb_agg(jsonb_build_object('nome', nome, 'total', total) order by total desc) from raiz where tipo = 'ENTRADA'), '[]'::jsonb),
    'despesas_por_raiz', coalesce((select jsonb_agg(jsonb_build_object('nome', nome, 'total', total) order by total desc) from raiz where tipo = 'SAIDA'), '[]'::jsonb),
    -- 0007: maiores despesas por centro de custo (o centro do lançamento, 2º nível para baixo)
    'despesas_por_centro', coalesce((select jsonb_agg(jsonb_build_object('nome', nome, 'total', total) order by total desc) from (
        select coalesce(p.nome, 'Sem centro de custo') as nome, sum(m.valor) as total from mes m left join plano_conta p on p.id = m.plano_conta_id
         where m.tipo = 'SAIDA' group by 1 order by 2 desc limit 10) x), '[]'::jsonb),
    'orcamento', case when exists (select 1 from orc) then jsonb_build_object(
        'previsto_entradas', coalesce((select previsto from orc where tipo = 'ENTRADA'), 0), 'realizado_entradas', coalesce((select realizado from orc where tipo = 'ENTRADA'), 0),
        'previsto_saidas', coalesce((select previsto from orc where tipo = 'SAIDA'), 0), 'realizado_saidas', coalesce((select realizado from orc where tipo = 'SAIDA'), 0)) end,
    'pendencias', jsonb_build_object(
        'lancamentos_pendentes', (select count(*) from lancamento where empresa_id = v_emp and situacao = 'PENDENTE'),
        'contas_sem_saldo_inicial', (select count(*) from saldo where movimentada and saldo_inicial = 0 and data_saldo_inicial is null),
        'meses_sem_fechamento', coalesce((select jsonb_agg(to_char(m, 'MM/YYYY') order by m)
            from generate_series(date_trunc('month', v_hoje) - interval '12 months', date_trunc('month', v_hoje) - interval '1 month', interval '1 month') m
           where exists (select 1 from lancamento l where l.empresa_id = v_emp and l.data >= m and l.data < m + interval '1 month')
             and not exists (select 1 from fechamento_mes f where f.empresa_id = v_emp and f.mes = m::date and f.status <> 'DEVOLVIDO')), '[]'::jsonb),
        'configuracao_baixa', (select plano_juros_pagos_id is not null and plano_juros_recebidos_id is not null and plano_descontos_obtidos_id is not null
                                      and plano_descontos_concedidos_id is not null from empresa where id = v_emp))
  ) into r;
  return r;
end $$;

create or replace function criar_empresa(p_dados jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_id int; v_email text := lower(btrim(coalesce(p_dados->>'diretor_email', '')));
begin
  if not eh_admin_ti() then raise exception 'Somente o administrador TI cria empresas'; end if;
  if btrim(coalesce(p_dados->>'razao_social', '')) = '' then raise exception 'Informe a razão social'; end if;
  insert into empresa (razao_social, nome_fantasia, cnpj, regime_tributario, cep, endereco, numero, complemento, bairro, cidade, uf, telefone, email, site)
  values (btrim(p_dados->>'razao_social'), nullif(btrim(p_dados->>'nome_fantasia'), ''), nullif(regexp_replace(coalesce(p_dados->>'cnpj', ''), '\D', '', 'g'), ''),
          nullif(p_dados->>'regime_tributario', ''), p_dados->>'cep', p_dados->>'endereco', p_dados->>'numero', p_dados->>'complemento', p_dados->>'bairro',
          p_dados->>'cidade', p_dados->>'uf', p_dados->>'telefone', p_dados->>'email', p_dados->>'site')
  returning id into v_id;
  update usuario set empresa_atual_id = v_id where id = auth.uid();   -- antes de semear: os gatilhos conferem a empresa em uso
  perform semear_plano_padrao(v_id);
  insert into conta_financeira (empresa_id, nome, tipo) values (v_id, 'Caixa (dinheiro)', 'CAIXA'), (v_id, 'Banco – conta corrente', 'CONTA_CORRENTE');
  if v_email like '%@%' then
    insert into liberacao_previa (empresa_id, email, papel, nome) values (v_id, v_email, 'DIRETOR', nullif(btrim(p_dados->>'diretor_nome'), ''))
      on conflict (empresa_id, email) do update set papel = 'DIRETOR', usada_em = null;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 3. Modelos de lançamento (quadro por blocos)
-- ---------------------------------------------------------------------
create table if not exists modelo_lancamento (
  id             int generated always as identity primary key,
  empresa_id     int not null default empresa_atual() references empresa(id) on delete cascade,
  nome           text not null check (btrim(nome) <> ''),
  blocos         jsonb not null default '[]' check (jsonb_typeof(blocos) = 'array'),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid default auth.uid() references usuario(id) on delete set null
);
create unique index if not exists ux_modelo_lancamento_nome on modelo_lancamento (empresa_id, lower(btrim(nome)));

create or replace function fn_modelo_lancamento_alteracao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform confere_empresa(new.empresa_id);
  if tg_op = 'UPDATE' and new.empresa_id is distinct from old.empresa_id then raise exception 'O modelo não muda de empresa.'; end if;
  new.nome := btrim(new.nome);
  if jsonb_typeof(new.blocos) = 'array' and jsonb_array_length(new.blocos) > 40 then raise exception 'O modelo tem no máximo 40 blocos.'; end if;
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end $$;
revoke execute on function fn_modelo_lancamento_alteracao() from authenticated, anon, public;
drop trigger if exists trg_modelo_lancamento_alteracao on modelo_lancamento;
create trigger trg_modelo_lancamento_alteracao before insert or update on modelo_lancamento for each row execute function fn_modelo_lancamento_alteracao();
drop trigger if exists trg_aud_modelo_lancamento on modelo_lancamento;
create trigger trg_aud_modelo_lancamento after insert or update or delete on modelo_lancamento for each row execute function fn_auditoria();

alter table modelo_lancamento enable row level security;
drop policy if exists modelo_lancamento_ler on modelo_lancamento;
drop policy if exists modelo_lancamento_incluir on modelo_lancamento;
drop policy if exists modelo_lancamento_alterar on modelo_lancamento;
drop policy if exists modelo_lancamento_excluir on modelo_lancamento;
create policy modelo_lancamento_ler on modelo_lancamento for select to authenticated
  using (empresa_id = (select empresa_atual()) and (select eh_leitor()));
create policy modelo_lancamento_incluir on modelo_lancamento for insert to authenticated
  with check (empresa_id = (select empresa_atual()) and (select eh_financeiro()));
create policy modelo_lancamento_alterar on modelo_lancamento for update to authenticated
  using (empresa_id = (select empresa_atual()) and (select eh_financeiro()))
  with check (empresa_id = (select empresa_atual()) and (select eh_financeiro()));
create policy modelo_lancamento_excluir on modelo_lancamento for delete to authenticated
  using (empresa_id = (select empresa_atual()) and (select eh_financeiro()));
revoke all on modelo_lancamento from anon;
grant select, insert, update, delete on modelo_lancamento to authenticated;
