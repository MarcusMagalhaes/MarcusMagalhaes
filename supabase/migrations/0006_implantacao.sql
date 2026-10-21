-- Finanway · 0006: implantação — plano de contas padrão (DRE gerencial), criação de empresa pelo administrador TI e
-- rotina diária de limpeza da auditoria (pg_cron, quando a extensão estiver ligada no Supabase).
-- Rode depois da 0005. Pode ser executado mais de uma vez.

-- Plano de contas padrão de uma empresa (comércio, serviços, indústria, terceiro setor): 13 grupos no 1º nível e as
-- contas mais usadas no 2º. Só semeia empresa sem plano. Também aponta as contas de juros e descontos usadas na baixa.
create or replace function semear_plano_padrao(p_empresa_id int) returns int
language plpgsql security definer set search_path = public as $$
declare g record; f text; v_raiz int; v_n int := 0;
begin
  if exists (select 1 from plano_conta where empresa_id = p_empresa_id) then return 0; end if;
  for g in select * from (values
      (1,  'ENTRADA', 'RECEITA_OPERACIONAL', 'Receitas operacionais',        array['Venda de produtos','Prestação de serviços','Outras receitas operacionais']),
      (2,  'SAIDA',   'DEDUCAO',             'Deduções da receita',          array['Impostos sobre vendas (Simples, ICMS, ISS, PIS, COFINS)','Devoluções e cancelamentos']),
      (3,  'SAIDA',   'CUSTO',               'Custos',                       array['Compra de mercadorias','Matéria-prima e insumos','Serviços de terceiros (custo)','Fretes sobre compras']),
      (4,  'SAIDA',   'DESPESA_OPERACIONAL', 'Despesas com pessoal',         array['Salários','Pró-labore','Encargos (INSS, FGTS)','Benefícios (VT, VR, plano de saúde)','Férias e 13º salário','Rescisões']),
      (5,  'SAIDA',   'DESPESA_OPERACIONAL', 'Despesas administrativas',     array['Aluguel e condomínio','Energia elétrica','Água e esgoto','Internet e telefone','Material de escritório e limpeza','Contabilidade','Softwares e sistemas','Manutenção e conservação','Seguros','Taxas, licenças e alvarás']),
      (6,  'SAIDA',   'DESPESA_OPERACIONAL', 'Despesas comerciais',          array['Marketing e publicidade','Comissões sobre vendas','Taxas de cartão e meios de pagamento','Fretes sobre vendas','Viagens e deslocamentos']),
      (7,  'ENTRADA', 'RECEITA_FINANCEIRA',  'Receitas financeiras',         array['Rendimentos de aplicações','Juros e multas recebidos','Descontos obtidos']),
      (8,  'SAIDA',   'DESPESA_FINANCEIRA',  'Despesas financeiras',         array['Tarifas bancárias','Juros e multas pagos','IOF','Juros de empréstimos','Descontos concedidos']),
      (9,  'ENTRADA', 'OUTRA_RECEITA',       'Outras receitas',              array['Venda de bens do ativo','Receitas diversas']),
      (10, 'SAIDA',   'IMPOSTO_LUCRO',       'Impostos sobre o lucro',       array['IRPJ','CSLL']),
      (11, 'SAIDA',   'INVESTIMENTO',        'Investimentos',                array['Máquinas e equipamentos','Móveis e utensílios','Computadores e periféricos','Veículos','Obras e reformas']),
      (12, 'ENTRADA', 'APORTE_EMPRESTIMO',   'Aportes e empréstimos',        array['Aporte de capital dos sócios','Empréstimos e financiamentos recebidos']),
      (13, 'SAIDA',   'DISTRIBUICAO_AMORTIZACAO', 'Distribuição e amortizações', array['Distribuição de lucros','Amortização de empréstimos'])
    ) x(ordem, tipo, grupo, nome, filhos) order by ordem loop
    insert into plano_conta (empresa_id, tipo, grupo, nome, nivel) values (p_empresa_id, g.tipo, g.grupo, g.nome, 1) returning id into v_raiz;
    v_n := v_n + 1;
    foreach f in array g.filhos loop
      insert into plano_conta (empresa_id, pai_id, nome) values (p_empresa_id, v_raiz, f);
      v_n := v_n + 1;
    end loop;
  end loop;
  update empresa set
    plano_juros_pagos_id = (select id from plano_conta where empresa_id = p_empresa_id and nivel = 2 and nome = 'Juros e multas pagos'),
    plano_juros_recebidos_id = (select id from plano_conta where empresa_id = p_empresa_id and nivel = 2 and nome = 'Juros e multas recebidos'),
    plano_descontos_obtidos_id = (select id from plano_conta where empresa_id = p_empresa_id and nivel = 2 and nome = 'Descontos obtidos'),
    plano_descontos_concedidos_id = (select id from plano_conta where empresa_id = p_empresa_id and nivel = 2 and nome = 'Descontos concedidos')
  where id = p_empresa_id;
  return v_n;
end $$;
revoke execute on function semear_plano_padrao(int) from authenticated, anon, public;

-- Nova empresa (TI): cria com o plano de contas padrão, Caixa e Conta corrente, um centro de custo "Geral", entra nela
-- e, se vier p_dados.diretor_email, pré-libera esse e-mail Google como Diretor. Devolve o id.
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
  insert into centro_custo (empresa_id, codigo, nome) values (v_id, '01', 'Geral');
  if v_email like '%@%' then
    insert into liberacao_previa (empresa_id, email, papel, nome) values (v_id, v_email, 'DIRETOR', nullif(btrim(p_dados->>'diretor_nome'), ''))
      on conflict (empresa_id, email) do update set papel = 'DIRETOR', usada_em = null;
  end if;
  return v_id;
end $$;
revoke execute on function criar_empresa(jsonb) from anon, public;
grant execute on function criar_empresa(jsonb) to authenticated;

-- Rotina diária (03:15 de Brasília): auditoria > 13 meses e logins > 6 meses saem do banco.
-- No Supabase: Database › Extensions › pg_cron (ligar) e rodar esta migração de novo.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('finanway-limpar-auditoria', 'finflow-limpar-auditoria');   -- finflow: nome antigo do projeto
    perform cron.schedule('finanway-limpar-auditoria', '15 6 * * *', 'select public.limpar_auditoria()');   -- 06:15 UTC = 03:15 Brasília
  else
    raise notice 'pg_cron não está ligado: a limpeza da auditoria não foi agendada (ligue a extensão e rode a 0006 de novo).';
  end if;
end $$;

notify pgrst, 'reload schema';
