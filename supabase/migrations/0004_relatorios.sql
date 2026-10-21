-- FinFlow · 0004: views e relatórios — lançamentos e títulos com nomes, saldos, painel, fluxo de caixa (realizado +
-- previsto), DRE (caixa ou competência) e extrato por conta. Views com security_invoker (respeitam o RLS de quem
-- consulta); funções security definer filtram pela empresa em uso e conferem o papel.
-- Rode depois da 0003. Pode ser executado mais de uma vez.

-- "Hoje" no horário de Brasília (o servidor do Supabase fica em UTC: depois das 21h já seria amanhã)
create or replace function hoje() returns date
language sql stable set search_path = public as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- =====================================================================
-- 1. Views
-- =====================================================================
create or replace view v_saldo_conta with (security_invoker = true) as
select c.id, c.empresa_id, c.nome, c.tipo, c.ativa, c.saldo_inicial, c.data_saldo_inicial, c.limite,
       c.saldo_inicial
       + coalesce((select sum(case when l.tipo = 'ENTRADA' then l.valor else -l.valor end) from lancamento l where l.conta_id = c.id and l.situacao = 'CONFIRMADO'), 0)
       + coalesce((select sum(l.valor) from lancamento l where l.conta_destino_id = c.id and l.situacao = 'CONFIRMADO'), 0) as saldo
from conta_financeira c;

drop view if exists v_lancamento;
create view v_lancamento with (security_invoker = true) as
select l.id, l.empresa_id, l.data, l.competencia, l.tipo, l.plano_conta_id, l.centro_custo_id, l.conta_id, l.conta_destino_id, l.valor,
       l.parceiro_id, l.forma, l.descricao, l.documento, l.origem, l.situacao, l.titulo_id, l.titulo_papel, l.baixa_id,
       l.extrato_id, l.extrato_descricao, l.importacao_id, l.criado_em, l.atualizado_em,
       p.nome as plano, p.codigo as plano_codigo, p.grupo, r.nome as plano_raiz,
       cc.nome as centro_custo, co.nome as conta, cd.nome as conta_destino, coalesce(pa.nome_fantasia, pa.nome) as parceiro,
       t.tipo as titulo_tipo, t.parcela, t.parcelas,
       (select count(*) from anexo a where a.lancamento_id = l.id)::int as anexos
from lancamento l
left join plano_conta p on p.id = l.plano_conta_id
left join plano_conta r on r.empresa_id = p.empresa_id and r.codigo = (p.codigo / 1000000) * 1000000
left join centro_custo cc on cc.id = l.centro_custo_id
left join conta_financeira co on co.id = l.conta_id
left join conta_financeira cd on cd.id = l.conta_destino_id
left join parceiro pa on pa.id = l.parceiro_id
left join titulo t on t.id = l.titulo_id;

drop view if exists v_titulo;
create view v_titulo with (security_invoker = true) as
select t.id, t.empresa_id, t.tipo, t.parceiro_id, t.plano_conta_id, t.centro_custo_id, t.descricao, t.documento, t.emissao, t.vencimento,
       t.competencia, t.valor, t.parcela, t.parcelas, t.grupo_id, t.conta_prevista_id, t.forma_prevista, t.codigo_barras, t.observacao,
       t.cancelado, t.cancelado_motivo, t.valor_pago, t.pago_em, t.situacao, t.criado_em, t.atualizado_em,
       t.valor - t.valor_pago as saldo,
       (t.situacao in ('ABERTO','PARCIAL') and t.vencimento < hoje()) as vencido,
       case when t.situacao in ('ABERTO','PARCIAL') and t.vencimento < hoje() then hoje() - t.vencimento else 0 end as dias_atraso,
       p.nome as plano, p.codigo as plano_codigo, r.nome as plano_raiz, cc.nome as centro_custo,
       coalesce(pa.nome_fantasia, pa.nome) as parceiro, pa.documento as parceiro_documento, cp.nome as conta_prevista,
       (select count(*) from anexo a where a.titulo_id = t.id)::int as anexos
from titulo t
left join plano_conta p on p.id = t.plano_conta_id
left join plano_conta r on r.empresa_id = p.empresa_id and r.codigo = (p.codigo / 1000000) * 1000000
left join centro_custo cc on cc.id = t.centro_custo_id
left join parceiro pa on pa.id = t.parceiro_id
left join conta_financeira cp on cp.id = t.conta_prevista_id;

-- previsão × realizado (caixa) do orçamento
drop view if exists v_orcamento;
create view v_orcamento with (security_invoker = true) as
with r as (
  select l.plano_conta_id, extract(year from l.data)::int as ano, extract(month from l.data)::int as mes, sum(l.valor) as realizado
  from lancamento l where l.situacao = 'CONFIRMADO' and l.plano_conta_id is not null
  group by 1, 2, 3
)
select o.empresa_id, o.ano, o.plano_conta_id, p.nome as plano, p.tipo, p.grupo, p.codigo, p.nivel, rz.codigo as raiz_codigo, rz.nome as raiz,
       o.mes, o.valor, coalesce(r.realizado, 0) as realizado
from orcamento o
join plano_conta p on p.id = o.plano_conta_id
left join plano_conta rz on rz.empresa_id = p.empresa_id and rz.codigo = (p.codigo / 1000000) * 1000000
left join r on r.plano_conta_id = o.plano_conta_id and r.ano = o.ano and r.mes = o.mes;

-- =====================================================================
-- 2. Painel: os números do dia a dia numa chamada só
-- =====================================================================
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
    'despesas_por_centro', coalesce((select jsonb_agg(jsonb_build_object('nome', nome, 'total', total) order by total desc) from (
        select coalesce(cc.nome, 'Sem centro de custo') as nome, sum(m.valor) as total from mes m left join centro_custo cc on cc.id = m.centro_custo_id
         where m.tipo = 'SAIDA' group by 1) x), '[]'::jsonb),
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

-- =====================================================================
-- 3. Fluxo de caixa: realizado (lançamentos confirmados) + previsto (saldo dos títulos em aberto pelo vencimento;
--    vencidos entram como previstos para hoje). Agrupado por DIA, SEMANA ou MES. Com p_conta_id: só a conta (as
--    transferências contam como entrada/saída dela) e só os títulos com essa conta prevista.
-- =====================================================================
create or replace function fluxo_caixa(p_de date, p_ate date, p_agrupar text default 'DIA', p_conta_id int default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_emp int := empresa_atual(); v_hoje date := hoje(); v_unid text; r jsonb;
begin
  if not eh_leitor() or v_emp is null then raise exception 'Sem permissão no financeiro'; end if;
  if p_ate < p_de then raise exception 'Período inválido'; end if;
  v_unid := case upper(coalesce(p_agrupar, 'DIA')) when 'SEMANA' then 'week' when 'MES' then 'month' else 'day' end;
  if v_unid = 'day' and p_ate - p_de > 400 then raise exception 'Por dia, o período vai até 400 dias: agrupe por semana ou mês'; end if;
  if p_conta_id is not null and not exists (select 1 from conta_financeira where id = p_conta_id and empresa_id = v_emp) then raise exception 'Conta inválida'; end if;
  with contas as (
    select id, saldo_inicial from conta_financeira where empresa_id = v_emp and (p_conta_id is null or id = p_conta_id)
  ), mov as (   -- movimentos com sinal do ponto de vista das contas filtradas
    select l.data, case when l.tipo = 'ENTRADA' then l.valor when l.tipo = 'SAIDA' then -l.valor else -l.valor end as v
      from lancamento l where l.empresa_id = v_emp and l.situacao = 'CONFIRMADO' and l.conta_id in (select id from contas)
       and not (p_conta_id is null and l.tipo = 'TRANSFERENCIA')
    union all
    select l.data, l.valor from lancamento l where l.empresa_id = v_emp and l.situacao = 'CONFIRMADO' and l.tipo = 'TRANSFERENCIA'
       and p_conta_id is not null and l.conta_destino_id = p_conta_id
  ), prev as (
    select greatest(t.vencimento, v_hoje) as data, case t.tipo when 'RECEBER' then t.valor - t.valor_pago else -(t.valor - t.valor_pago) end as v
      from titulo t where t.empresa_id = v_emp and t.situacao in ('ABERTO','PARCIAL') and (p_conta_id is null or t.conta_prevista_id = p_conta_id)
  ), periodos as (
    select generate_series(date_trunc(v_unid, p_de::timestamp), date_trunc(v_unid, p_ate::timestamp), ('1 ' || v_unid)::interval)::date as ini
  )
  select jsonb_build_object(
    'de', p_de, 'ate', p_ate, 'agrupar', upper(coalesce(p_agrupar, 'DIA')), 'hoje', v_hoje,
    'saldo_inicial', coalesce((select sum(saldo_inicial) from contas), 0) + coalesce((select sum(v) from mov where data < p_de), 0),
    -- previsto anterior ao período (títulos vencidos, quando o período começa depois de hoje)
    'previsto_antes', coalesce((select sum(v) from prev where data < p_de), 0),
    'periodos', coalesce((select jsonb_agg(jsonb_build_object('inicio', p.ini,
        'entradas', coalesce((select sum(v) from mov m where m.v > 0 and m.data between greatest(p.ini, p_de) and least((p.ini + ('1 ' || v_unid)::interval - interval '1 day')::date, p_ate)), 0),
        'saidas', coalesce((select -sum(v) from mov m where m.v < 0 and m.data between greatest(p.ini, p_de) and least((p.ini + ('1 ' || v_unid)::interval - interval '1 day')::date, p_ate)), 0),
        'entradas_previstas', coalesce((select sum(v) from prev x where x.v > 0 and x.data between greatest(p.ini, p_de) and least((p.ini + ('1 ' || v_unid)::interval - interval '1 day')::date, p_ate)), 0),
        'saidas_previstas', coalesce((select -sum(v) from prev x where x.v < 0 and x.data between greatest(p.ini, p_de) and least((p.ini + ('1 ' || v_unid)::interval - interval '1 day')::date, p_ate)), 0)
      ) order by p.ini) from periodos p), '[]'::jsonb)
  ) into r;
  return r;
end $$;

-- =====================================================================
-- 4. DRE gerencial: totais por conta do plano e mês. A tela monta a DRE pelos grupos do plano de contas.
--    CAIXA       = lançamentos confirmados pela data.
--    COMPETENCIA = títulos não cancelados pela competência + lançamentos sem título (e juros/descontos de baixas)
--                  pela competência; a parte principal das baixas não conta de novo (já está no título).
--    p_centro_custo_id filtra um centro de custo (0 = só os lançamentos/títulos sem centro).
-- =====================================================================
create or replace function dre(p_de date, p_ate date, p_regime text default 'COMPETENCIA', p_centro_custo_id int default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_emp int := empresa_atual(); ini date := date_trunc('month', p_de)::date; r jsonb;
begin
  if not eh_leitor() or v_emp is null then raise exception 'Sem permissão no financeiro'; end if;
  if p_ate < p_de or p_ate - p_de > 3700 then raise exception 'Período inválido (até 10 anos)'; end if;
  if upper(p_regime) = 'CAIXA' then
    select coalesce(jsonb_agg(jsonb_build_object('p', plano_conta_id, 'm', mes, 't', total) order by mes, plano_conta_id), '[]'::jsonb) into r
      from (select l.plano_conta_id, to_char(l.data, 'YYYY-MM') as mes, sum(l.valor) as total
              from lancamento l where l.empresa_id = v_emp and l.situacao = 'CONFIRMADO' and l.tipo in ('ENTRADA','SAIDA') and l.data between p_de and p_ate
               and (p_centro_custo_id is null or coalesce(l.centro_custo_id, 0) = p_centro_custo_id)
             group by 1, 2) x;
  else
    select coalesce(jsonb_agg(jsonb_build_object('p', plano_conta_id, 'm', mes, 't', total) order by mes, plano_conta_id), '[]'::jsonb) into r
      from (select plano_conta_id, mes, sum(total) as total from (
              select t.plano_conta_id, to_char(t.competencia, 'YYYY-MM') as mes, t.valor as total
                from titulo t where t.empresa_id = v_emp and not t.cancelado and t.competencia between ini and p_ate
                 and (p_centro_custo_id is null or coalesce(t.centro_custo_id, 0) = p_centro_custo_id)
              union all
              select l.plano_conta_id, to_char(l.competencia, 'YYYY-MM'), l.valor
                from lancamento l where l.empresa_id = v_emp and l.situacao = 'CONFIRMADO' and l.tipo in ('ENTRADA','SAIDA')
                 and l.competencia between ini and p_ate and coalesce(l.titulo_papel, '') <> 'PRINCIPAL'
                 and (p_centro_custo_id is null or coalesce(l.centro_custo_id, 0) = p_centro_custo_id)) u
             group by 1, 2) x;
  end if;
  return r;
end $$;

-- =====================================================================
-- 5. Extrato de uma conta: saldo anterior e movimentos confirmados com o saldo dia a dia (a tela acumula)
-- =====================================================================
create or replace function extrato_conta(p_conta_id int, p_de date, p_ate date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_emp int := empresa_atual(); c conta_financeira; r jsonb;
begin
  if not eh_leitor() or v_emp is null then raise exception 'Sem permissão no financeiro'; end if;
  select * into c from conta_financeira where id = p_conta_id and empresa_id = v_emp;
  if c.id is null then raise exception 'Conta inválida'; end if;
  with mov as (
    select l.id, l.data, l.tipo, l.valor, l.descricao, l.documento, l.plano_conta_id, l.parceiro_id, l.conta_destino_id, l.conta_id,
           case when l.conta_id = c.id then (case when l.tipo = 'ENTRADA' then l.valor else -l.valor end) else l.valor end as v
      from lancamento l where l.empresa_id = v_emp and l.situacao = 'CONFIRMADO' and (l.conta_id = c.id or l.conta_destino_id = c.id)
  )
  select jsonb_build_object(
    'conta', jsonb_build_object('id', c.id, 'nome', c.nome, 'tipo', c.tipo),
    'saldo_anterior', c.saldo_inicial + coalesce((select sum(v) from mov where data < p_de), 0),
    'linhas', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'data', m.data, 'tipo', m.tipo, 'valor', m.v, 'documento', m.documento,
        'descricao', coalesce(m.descricao, case when m.tipo = 'TRANSFERENCIA' then case when m.conta_id = c.id then 'Transferência para ' || cd.nome else 'Transferência de ' || co.nome end end),
        'plano', p.nome, 'parceiro', coalesce(pa.nome_fantasia, pa.nome)) order by m.data, m.id)
        from mov m left join plano_conta p on p.id = m.plano_conta_id left join parceiro pa on pa.id = m.parceiro_id
        left join conta_financeira cd on cd.id = m.conta_destino_id left join conta_financeira co on co.id = m.conta_id
       where m.data between p_de and p_ate), '[]'::jsonb)
  ) into r;
  return r;
end $$;

notify pgrst, 'reload schema';
