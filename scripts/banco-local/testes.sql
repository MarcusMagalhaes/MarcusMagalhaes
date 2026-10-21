-- Testes do banco do FinFlow (rodam depois dos stubs e das migrações; scripts/banco-local/testar.sh).
-- Simula cada usuário (auth.uid() pelo JWT simulado) com o papel "authenticated" e confere regras de negócio,
-- isolamento entre empresas e permissões por papel. Qualquer falha interrompe com erro.
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = warning;

create schema if not exists teste;
grant usage on schema teste to anon, authenticated;
create or replace function teste.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FALHOU: %', p_msg; end if;
end $$;
-- executa p_sql e exige um erro contendo p_trecho
create or replace function teste.erro(p_sql text, p_trecho text) returns void language plpgsql as $$
declare v_msg text;
begin
  begin execute p_sql; exception when others then v_msg := sqlerrm; end;
  if v_msg is null then raise exception 'FALHOU: esperava o erro "%" em: %', p_trecho, p_sql; end if;
  if position(lower(p_trecho) in lower(v_msg)) = 0 then raise exception 'FALHOU: em [%] esperava "%", veio: %', p_sql, p_trecho, v_msg; end if;
end $$;
create or replace function teste.como(p_email text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce((select id::text from auth.users where email = p_email), ''), false)
$$;
grant execute on all functions in schema teste to anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Contas: cadastro por e-mail/senha com o e-mail do TI não vira TI; Google sim
-- ---------------------------------------------------------------------
insert into auth.users (id, email, raw_app_meta_data) values ('00000000-0000-0000-0000-0000000000f1', 'onewayinf@gmail.com', '{"provider":"email","providers":["email"]}');
select teste.ok((select papel from usuario where id = '00000000-0000-0000-0000-0000000000f1') = 'USUARIO', 'cadastro por senha com o e-mail do TI nasce USUARIO');
delete from auth.users where id = '00000000-0000-0000-0000-0000000000f1';

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'onewayinf@gmail.com', '{"provider":"google","providers":["google"]}', '{"full_name":"Marcus TI"}'),
  ('00000000-0000-0000-0000-000000000011', 'a@alfa.com',  '{"provider":"google","providers":["google"]}', '{"full_name":"Ana Diretora"}'),
  ('00000000-0000-0000-0000-000000000012', 'b@alfa.com',  '{"provider":"google","providers":["google"]}', '{"full_name":"Bruno Auxiliar"}'),
  ('00000000-0000-0000-0000-000000000013', 'c@contabil.com', '{"provider":"google","providers":["google"]}', '{"full_name":"Carla Contadora"}'),
  ('00000000-0000-0000-0000-000000000014', 'e@alfa.com',  '{"provider":"google","providers":["google"]}', '{"full_name":"Edu Admin"}'),
  ('00000000-0000-0000-0000-000000000021', 'd@beta.com',  '{"provider":"google","providers":["google"]}', '{"full_name":"Davi Financeiro"}'),
  ('00000000-0000-0000-0000-000000000031', 'x@gmail.com', '{"provider":"google","providers":["google"]}', '{"full_name":"Xavier Sem Acesso"}');
select teste.ok((select papel from usuario where email = 'onewayinf@gmail.com') = 'ADMIN_TI', 'TI pelo Google vira ADMIN_TI');
select teste.ok((select count(*) from usuario where papel = 'ADMIN_TI') = 1, 'um só ADMIN_TI');
select teste.erro($$update usuario set papel = 'ADMIN_TI' where email = 'a@alfa.com'$$, 'exclusivo');

-- ---------------------------------------------------------------------
-- 2. TI cria as empresas e libera os acessos
-- ---------------------------------------------------------------------
select teste.como('onewayinf@gmail.com');
set role authenticated;
select criar_empresa('{"razao_social":"Alfa Comércio Ltda","nome_fantasia":"Alfa","cnpj":"11.222.333/0001-81","diretor_email":"A@alfa.com"}');
select teste.ok((select count(*) from plano_conta) = 64, 'plano padrão com 13 grupos e 51 contas');
select teste.ok((select plano_juros_pagos_id is not null and plano_descontos_concedidos_id is not null from empresa where razao_social = 'Alfa Comércio Ltda'), 'configuração de juros/descontos semeada');
insert into liberacao_previa (empresa_id, email, papel) values
  ((select id from empresa where razao_social = 'Alfa Comércio Ltda'), 'b@alfa.com', 'FINANCEIRO_AUX'),
  ((select id from empresa where razao_social = 'Alfa Comércio Ltda'), 'c@contabil.com', 'CONTADOR'),
  ((select id from empresa where razao_social = 'Alfa Comércio Ltda'), 'e@alfa.com', 'ADMIN');
select criar_empresa('{"razao_social":"Beta Serviços SA"}');
insert into liberacao_previa (empresa_id, email, papel) values ((select id from empresa where razao_social = 'Beta Serviços SA'), 'd@beta.com', 'FINANCEIRO');
select teste.ok((select count(*) from minhas_empresas()) = 2, 'TI vê as duas empresas');
reset role;
select teste.ok((select count(*) from usuario_empresa) = 5, 'pré-liberação de conta Google existente cria o vínculo na hora');
select teste.ok((select usada_em is not null from liberacao_previa where email = 'a@alfa.com'), 'liberação marcada como usada');

-- ---------------------------------------------------------------------
-- 3. ADMIN não dá o papel Diretor nem mexe no próprio papel
-- ---------------------------------------------------------------------
select teste.como('e@alfa.com');
set role authenticated;
select teste.ok(papel_atual() = 'ADMIN', 'papel do admin');
select teste.erro($$insert into liberacao_previa (empresa_id, email, papel) values (empresa_atual(), 'novo@alfa.com', 'DIRETOR')$$, 'Somente a diretoria');
update usuario_empresa set papel = 'FINANCEIRO' where usuario_id = auth.uid();
select teste.ok((select papel from usuario_empresa where usuario_id = auth.uid()) = 'ADMIN', 'admin não altera o próprio papel');
insert into liberacao_previa (empresa_id, email, papel) values (empresa_atual(), 'novo@alfa.com', 'FINANCEIRO');
reset role;

-- ---------------------------------------------------------------------
-- 4. Diretor da Alfa: cadastros, títulos, baixas, estorno, transferência, extrato e conciliação
-- ---------------------------------------------------------------------
select teste.como('a@alfa.com');
set role authenticated;
select teste.ok(papel_atual() = 'DIRETOR', 'papel do diretor');
select teste.ok((select count(*) from minhas_empresas()) = 1, 'diretor vê só a Alfa');
insert into parceiro (tipo, pessoa, nome, documento) values ('FORNECEDOR', 'PJ', 'Imobiliária Centro', '11.444.777/0001-61');
select teste.ok((select documento from parceiro where nome = 'Imobiliária Centro') = '11444777000161', 'documento guardado só com dígitos');
select teste.erro($$insert into parceiro (tipo, pessoa, nome, documento) values ('CLIENTE', 'PF', 'Fulano', '123')$$, 'CPF inválido');
insert into parceiro (tipo, pessoa, nome) values ('CLIENTE', 'PJ', 'Cliente Y');

insert into titulo (tipo, parceiro_id, plano_conta_id, descricao, vencimento, valor)
values ('PAGAR', (select id from parceiro where nome = 'Imobiliária Centro'), (select id from plano_conta where nome = 'Aluguel e condomínio'), 'Aluguel outubro', '2026-10-10', 1000);
select teste.ok((select situacao from titulo where descricao = 'Aluguel outubro') = 'ABERTO', 'título nasce em aberto');
select teste.ok((select competencia from titulo where descricao = 'Aluguel outubro') = '2026-10-01', 'competência = mês do vencimento');
select teste.erro($$insert into titulo (tipo, plano_conta_id, descricao, vencimento, valor) values ('PAGAR', (select id from plano_conta where nome = 'Venda de produtos'), 'x', '2026-10-10', 10)$$, 'é de entrada');
select teste.erro($$insert into titulo (tipo, plano_conta_id, descricao, vencimento, valor) values ('PAGAR', (select id from plano_conta where nome = 'Custos'), 'x', '2026-10-10', 10)$$, 'agrupa');
-- a tela não consegue forçar campos calculados
update titulo set valor_pago = 999, situacao = 'PAGO' where descricao = 'Aluguel outubro';
select teste.ok((select situacao = 'ABERTO' and valor_pago = 0 from titulo where descricao = 'Aluguel outubro'), 'valor_pago e situação são calculados');

select baixar_titulo((select id from titulo where descricao = 'Aluguel outubro'), '2026-10-12', (select id from conta_financeira where tipo = 'CONTA_CORRENTE'), 1000, 15, 0, 'PIX');
select teste.ok((select situacao = 'PAGO' and valor_pago = 1000 and pago_em = '2026-10-12' from titulo where descricao = 'Aluguel outubro'), 'baixa total quita o título');
select teste.ok((select count(*) from lancamento where titulo_id = (select id from titulo where descricao = 'Aluguel outubro')) = 2, 'baixa com juros gera 2 lançamentos');
select teste.ok((select saldo from v_saldo_conta where tipo = 'CONTA_CORRENTE') = -1015, 'conta corrente: -1000 - 15 de juros');
select teste.erro($$delete from lancamento where titulo_papel = 'JUROS'$$, 'Estornar baixa');
select teste.erro($$update lancamento set valor = 1 where titulo_papel = 'PRINCIPAL'$$, 'estorne a baixa');
update lancamento set descricao = 'Aluguel out/2026' where titulo_papel = 'PRINCIPAL';
select teste.erro($$insert into lancamento (data, tipo, plano_conta_id, conta_id, valor, titulo_id, titulo_papel, baixa_id) values ('2026-10-12', 'SAIDA', (select id from plano_conta where nome = 'Aluguel e condomínio'), (select id from conta_financeira where tipo = 'CAIXA'), 5, (select id from titulo where descricao = 'Aluguel outubro'), 'PRINCIPAL', gen_random_uuid())$$, 'Baixa de título só');
select teste.erro($$update titulo set cancelado = true where descricao = 'Aluguel outubro'$$, 'estorne as baixas');
select teste.erro($$update titulo set valor = 500 where descricao = 'Aluguel outubro'$$, 'menor que o já baixado');

insert into titulo (tipo, parceiro_id, plano_conta_id, descricao, vencimento, valor)
values ('RECEBER', (select id from parceiro where nome = 'Cliente Y'), (select id from plano_conta where nome = 'Prestação de serviços'), 'Serviço X', '2026-10-15', 500);
select baixar_titulo((select id from titulo where descricao = 'Serviço X'), '2026-10-15', (select id from conta_financeira where tipo = 'CONTA_CORRENTE'), 200);
select teste.ok((select situacao = 'PARCIAL' and valor_pago = 200 from titulo where descricao = 'Serviço X'), 'baixa parcial');
select teste.erro($$select baixar_titulo((select id from titulo where descricao = 'Serviço X'), '2026-10-16', (select id from conta_financeira where tipo = 'CONTA_CORRENTE'), 301)$$, 'maior que o saldo');
select baixar_titulo((select id from titulo where descricao = 'Serviço X'), '2026-10-16', (select id from conta_financeira where tipo = 'CONTA_CORRENTE'), 300, 0, 20);
select teste.ok((select situacao = 'PAGO' from titulo where descricao = 'Serviço X'), 'segunda baixa quita');
select teste.ok((select saldo from v_saldo_conta where tipo = 'CONTA_CORRENTE') = -535, 'corrente: -1015 + 200 + 300 - 20 de desconto');
select estornar_baixa((select baixa_id from lancamento where titulo_papel = 'PRINCIPAL' and data = '2026-10-15'));
select teste.ok((select situacao = 'PARCIAL' and valor_pago = 300 from titulo where descricao = 'Serviço X'), 'estorno volta o título a parcial');
select teste.ok((select saldo from v_saldo_conta where tipo = 'CONTA_CORRENTE') = -735, 'estorno tira o dinheiro da conta');

insert into lancamento (data, tipo, plano_conta_id, conta_id, valor, descricao)
values ('2026-10-05', 'ENTRADA', (select id from plano_conta where nome = 'Venda de produtos'), (select id from conta_financeira where tipo = 'CAIXA'), 2000, 'Venda balcão');
select teste.erro($$insert into lancamento (data, tipo, plano_conta_id, conta_id, valor) values ('2026-10-05', 'ENTRADA', (select id from plano_conta where nome = 'Receitas operacionais'), (select id from conta_financeira where tipo = 'CAIXA'), 1)$$, 'agrupa');
select teste.erro($$insert into lancamento (data, tipo, plano_conta_id, conta_id, valor) values ('2026-10-05', 'SAIDA', (select id from plano_conta where nome = 'Venda de produtos'), (select id from conta_financeira where tipo = 'CAIXA'), 1)$$, 'é de entrada');
insert into lancamento (data, tipo, conta_id, conta_destino_id, valor)
values ('2026-10-06', 'TRANSFERENCIA', (select id from conta_financeira where tipo = 'CAIXA'), (select id from conta_financeira where tipo = 'CONTA_CORRENTE'), 500);
select teste.ok((select saldo from v_saldo_conta where tipo = 'CAIXA') = 1500 and (select saldo from v_saldo_conta where tipo = 'CONTA_CORRENTE') = -235, 'transferência entre contas');

select teste.ok((importar_extrato((select id from conta_financeira where tipo = 'CONTA_CORRENTE'), 'extrato.ofx', 'OFX',
  '[{"extrato_id":"ofx:1","data":"2026-10-18","valor":480,"descricao":"PIX RECEBIDO CLIENTE Y"},{"extrato_id":"ofx:2","data":"2026-10-19","valor":-99.9,"descricao":"TARIFA PACOTE"}]'))->>'importadas' = '2', 'extrato importado');
select teste.ok((importar_extrato((select id from conta_financeira where tipo = 'CONTA_CORRENTE'), 'extrato.ofx', 'OFX',
  '[{"extrato_id":"ofx:1","data":"2026-10-18","valor":480,"descricao":"PIX RECEBIDO CLIENTE Y"},{"extrato_id":"ofx:2","data":"2026-10-19","valor":-99.9,"descricao":"TARIFA PACOTE"}]'))->>'duplicadas' = '2', 'reimportar não duplica');
select teste.ok((select count(*) from lancamento where situacao = 'PENDENTE') = 2, 'linhas do extrato ficam pendentes');
select teste.ok((select saldo from v_saldo_conta where tipo = 'CONTA_CORRENTE') = -235, 'pendente não entra no saldo');
insert into titulo (tipo, parceiro_id, plano_conta_id, descricao, vencimento, valor)
values ('RECEBER', (select id from parceiro where nome = 'Cliente Y'), (select id from plano_conta where nome = 'Prestação de serviços'), 'Consultoria', '2026-10-17', 450);
select teste.ok((select titulo_id from titulos_para_conciliar((select id from lancamento where extrato_id = 'ofx:1')) limit 1) = (select id from titulo where descricao = 'Consultoria'), 'sugere o título de valor mais próximo');
select conciliar_titulo((select id from lancamento where extrato_id = 'ofx:1'), (select id from titulo where descricao = 'Consultoria'));
select teste.ok((select situacao from titulo where descricao = 'Consultoria') = 'PAGO', 'conciliação quita o título');
select teste.ok((select count(*) from lancamento where titulo_papel = 'JUROS' and data = '2026-10-18' and valor = 30) = 1, 'diferença do extrato vira juros');
select teste.ok((select saldo from v_saldo_conta where tipo = 'CONTA_CORRENTE') = 245, 'conciliado entra no saldo (480)');
select estornar_baixa((select baixa_id from lancamento where extrato_id = 'ofx:1'));
select teste.ok((select situacao = 'PENDENTE' and valor = 480 and titulo_id is null from lancamento where extrato_id = 'ofx:1'), 'estorno da conciliação devolve a linha do extrato inteira e pendente');
select teste.ok((select situacao from titulo where descricao = 'Consultoria') = 'ABERTO', 'título volta a aberto');
select conciliar_titulo((select id from lancamento where extrato_id = 'ofx:1'), (select id from titulo where descricao = 'Consultoria'));
update lancamento set situacao = 'CONFIRMADO', plano_conta_id = (select id from plano_conta where nome = 'Tarifas bancárias') where extrato_id = 'ofx:2';
select teste.ok((select count(*) from sugerir_classificacao(array['TARIFA PACOTE'])) = 1, 'histórico sugere a classificação');

-- relatórios
select teste.ok((painel(2026, 10)->>'saldo_total')::numeric = (select sum(saldo) from v_saldo_conta), 'painel: saldo total');
select teste.ok((painel(2026, 10)->'mes'->>'entradas')::numeric = 2000 + 300 + 450 + 30, 'painel: entradas do mês');
select teste.ok(jsonb_array_length(fluxo_caixa('2026-10-01', '2026-11-30', 'SEMANA')->'periodos') >= 9, 'fluxo de caixa por semana');
select teste.ok((fluxo_caixa('2026-10-01', '2026-10-31', 'MES')->'periodos'->0->>'entradas')::numeric = 2000 + 300 + 450 + 30, 'fluxo: entradas realizadas');
select teste.ok((select sum((x->>'t')::numeric) from jsonb_array_elements(dre('2026-10-01', '2026-10-31', 'COMPETENCIA')) x
                 where (x->>'p')::int = (select id from plano_conta where nome = 'Prestação de serviços')) = 950, 'DRE competência: serviço pelo valor dos títulos');
select teste.ok((select sum((x->>'t')::numeric) from jsonb_array_elements(dre('2026-10-01', '2026-10-31', 'CAIXA')) x
                 where (x->>'p')::int = (select id from plano_conta where nome = 'Prestação de serviços')) = 750, 'DRE caixa: serviço pelo recebido');
select teste.ok((extrato_conta((select id from conta_financeira where tipo = 'CONTA_CORRENTE'), '2026-10-01', '2026-10-31')->>'saldo_anterior')::numeric = 0, 'extrato: saldo anterior');
select teste.ok(jsonb_array_length(extrato_conta((select id from conta_financeira where tipo = 'CONTA_CORRENTE'), '2026-10-01', '2026-10-31')->'linhas') = 8, 'extrato: linhas da conta');
select teste.ok(gerar_orcamento(2027, 2026, 5) > 0, 'orçamento gerado do realizado');
select teste.ok((select valor from orcamento where ano = 2027 and mes = 10 and plano_conta_id = (select id from plano_conta where nome = 'Venda de produtos')) = 2100, 'orçamento com reajuste');

-- fechamento do mês
insert into lancamento (data, tipo, plano_conta_id, conta_id, valor, descricao)
values ('2026-09-15', 'SAIDA', (select id from plano_conta where nome = 'Energia elétrica'), (select id from conta_financeira where tipo = 'CAIXA'), 120, 'Energia setembro');
select fechar_mes('2026-09-01', 'Setembro conferido');
select teste.erro($$insert into lancamento (data, tipo, plano_conta_id, conta_id, valor) values ('2026-09-20', 'SAIDA', (select id from plano_conta where nome = 'Energia elétrica'), (select id from conta_financeira where tipo = 'CAIXA'), 1)$$, 'está fechado');
select teste.erro($$select fechar_mes('2026-10-01')$$, 'já terminaram');
select teste.erro($$select avaliar_fechamento('2026-09-01', 'APROVADO', null)$$, 'Somente o contador');
reset role;

-- ---------------------------------------------------------------------
-- 5. Auxiliar financeiro: lança, mas não exclui, não mexe em cadastros nem fecha mês
-- ---------------------------------------------------------------------
select teste.como('b@alfa.com');
set role authenticated;
insert into lancamento (data, tipo, plano_conta_id, conta_id, valor, descricao)
values ('2026-10-20', 'SAIDA', (select id from plano_conta where nome = 'Material de escritório e limpeza'), (select id from conta_financeira where tipo = 'CAIXA'), 35, 'Papel A4');
delete from lancamento where descricao = 'Papel A4';
select teste.ok((select count(*) from lancamento where descricao = 'Papel A4') = 1, 'auxiliar não exclui lançamento');
select teste.erro($$insert into conta_financeira (nome) values ('Conta nova')$$, 'row-level security');
select teste.erro($$insert into plano_conta (pai_id, nome) values ((select id from plano_conta where nome = 'Custos'), 'Nova')$$, 'row-level security');
select teste.erro($$select fechar_mes('2026-08-01')$$, 'Somente o financeiro');
select teste.erro($$select estornar_baixa((select baixa_id from lancamento where titulo_papel = 'PRINCIPAL' limit 1))$$, 'Somente o financeiro');
select teste.ok((select count(*) from auditoria) = 0, 'auxiliar não lê a auditoria');
reset role;

-- ---------------------------------------------------------------------
-- 6. Contador: lê tudo, não grava; dá o parecer do fechamento
-- ---------------------------------------------------------------------
select teste.como('c@contabil.com');
set role authenticated;
select teste.ok((select count(*) from lancamento) > 0, 'contador lê os lançamentos');
select teste.erro($$insert into lancamento (data, tipo, plano_conta_id, conta_id, valor) values ('2026-10-20', 'SAIDA', (select id from plano_conta where nome = 'Energia elétrica'), (select id from conta_financeira where tipo = 'CAIXA'), 1)$$, 'row-level security');
select teste.erro($$select baixar_titulo((select id from titulo where descricao = 'Serviço X'), '2026-10-20', (select id from conta_financeira where tipo = 'CAIXA'), 10)$$, 'Sem permissão');
select teste.erro($$select avaliar_fechamento('2026-09-01', 'DEVOLVIDO', 'x')$$, 'motivo');
select avaliar_fechamento('2026-09-01', 'DEVOLVIDO', 'Falta a nota da energia');
reset role;
select teste.como('a@alfa.com');
set role authenticated;
insert into lancamento (data, tipo, plano_conta_id, conta_id, valor, descricao)
values ('2026-09-20', 'SAIDA', (select id from plano_conta where nome = 'Água e esgoto'), (select id from conta_financeira where tipo = 'CAIXA'), 80, 'Água setembro');
select fechar_mes('2026-09-01');
select teste.ok((select saidas from fechamento_mes where mes = '2026-09-01') = 200, 'balancete gravado no fechamento');
reset role;
select teste.como('c@contabil.com');
set role authenticated;
select avaliar_fechamento('2026-09-01', 'APROVADO', null);
reset role;
select teste.como('e@alfa.com');
set role authenticated;
select teste.erro($$select reabrir_mes('2026-09-01')$$, 'Somente a diretoria');
reset role;
select teste.como('a@alfa.com');
set role authenticated;
select reabrir_mes('2026-09-01');
select teste.ok((select count(*) from auditoria where tabela = 'fechamento_mes') >= 3, 'fechamento auditado');
reset role;

-- ---------------------------------------------------------------------
-- 7. Outra empresa não enxerga nem mexe na Alfa
-- ---------------------------------------------------------------------
select teste.como('d@beta.com');
set role authenticated;
select teste.ok(papel_atual() = 'FINANCEIRO', 'papel na Beta');
select teste.ok((select count(*) from lancamento) = 0 and (select count(*) from titulo) = 0 and (select count(*) from parceiro) = 0, 'Beta não lê dados da Alfa');
select teste.ok((select count(*) from plano_conta) = 64, 'Beta tem o próprio plano');
select teste.ok((select count(*) from empresa) = 1, 'Beta vê só a própria empresa');
select teste.ok((select count(*) from usuario) = 1, 'usuário comum lê só a própria conta');
select teste.erro($$insert into lancamento (data, tipo, plano_conta_id, conta_id, valor) values ('2026-10-20', 'SAIDA', (select id from plano_conta where nome = 'Energia elétrica' limit 1), (select min(id) from conta_financeira where empresa_id <> empresa_atual()), 1)$$, 'inexistente');
reset role;
-- ids da Alfa conhecidos por quem ataca (o RLS esconde, mas o id pode vazar): o banco recusa mesmo assim
select set_config('teste.conta_alfa', (select id::text from conta_financeira where tipo = 'CAIXA' and empresa_id = (select id from empresa where razao_social = 'Alfa Comércio Ltda')), false);
select set_config('teste.titulo_alfa', (select id::text from titulo where descricao = 'Serviço X'), false);
select set_config('teste.empresa_alfa', (select id::text from empresa where razao_social = 'Alfa Comércio Ltda'), false);
select teste.como('d@beta.com');
set role authenticated;
select teste.erro(format($$insert into lancamento (data, tipo, plano_conta_id, conta_id, valor) values ('2026-10-20', 'SAIDA', (select id from plano_conta where nome = 'Energia elétrica'), %s, 1)$$, current_setting('teste.conta_alfa')), 'Conta financeira inexistente');
select teste.erro(format($$insert into lancamento (empresa_id, data, tipo, plano_conta_id, conta_id, valor) values (%s, '2026-10-20', 'SAIDA', 1, %s, 1)$$, current_setting('teste.empresa_alfa'), current_setting('teste.conta_alfa')), 'row-level security');
select teste.erro(format($$select baixar_titulo(%s, '2026-10-20', %s, 1)$$, current_setting('teste.titulo_alfa'), current_setting('teste.conta_alfa')), 'Título não encontrado');
select teste.erro(format($$select escolher_empresa(%s)$$, current_setting('teste.empresa_alfa')), 'não tem acesso');
update titulo set valor = 1 where id = current_setting('teste.titulo_alfa')::bigint;
delete from lancamento where empresa_id = current_setting('teste.empresa_alfa')::int;
reset role;
select teste.ok((select valor from titulo where id = current_setting('teste.titulo_alfa')::bigint) = 500, 'Beta não altera título da Alfa');
select teste.ok((select count(*) from lancamento where empresa_id = current_setting('teste.empresa_alfa')::int) > 0, 'Beta não apaga lançamentos da Alfa');

-- ---------------------------------------------------------------------
-- 8. Conta sem vínculo e visitante sem login
-- ---------------------------------------------------------------------
select teste.como('x@gmail.com');
set role authenticated;
select teste.ok((select count(*) from minhas_empresas()) = 0, 'sem vínculo: nenhuma empresa');
select teste.ok((select count(*) from lancamento) = 0 and (select count(*) from plano_conta) = 0, 'sem vínculo: não lê nada');
select teste.erro($$select painel(2026, 10)$$, 'Sem permissão');
reset role;
select teste.como('');
set role anon;
select teste.erro($$select count(*) from empresa$$, 'permission denied');
select teste.erro($$select count(*) from v_lancamento$$, 'permission denied');
select teste.erro($$select empresa_atual()$$, 'permission denied');
select registrar_login('alguem@x.com', 'LOGIN_FALHA', 'senha errada', 'senha', 'teste');
reset role;
select teste.ok((select count(*) from auditoria_login where email = 'alguem@x.com') = 1, 'falha de login registrada por anon');

-- ---------------------------------------------------------------------
-- 9. Storage: pasta da empresa e do tipo de registro
-- ---------------------------------------------------------------------
select teste.como('a@alfa.com');
set role authenticated;
insert into storage.objects (bucket_id, name) values ('documentos', current_setting('teste.empresa_alfa') || '/lancamentos/1/nota.pdf');
select teste.erro(format($$insert into storage.objects (bucket_id, name) values ('documentos', '%s/outra/x.pdf')$$, current_setting('teste.empresa_alfa')), 'row-level security');
insert into storage.objects (bucket_id, name) values ('logos', current_setting('teste.empresa_alfa') || '/logo.png');
reset role;
select teste.como('d@beta.com');
set role authenticated;
select teste.ok((select count(*) from storage.objects where bucket_id = 'documentos') = 0, 'Beta não lê documentos da Alfa');
select teste.ok((select count(*) from storage.objects where bucket_id = 'logos') = 0, 'Beta não lê a logo da Alfa');
select teste.erro(format($$insert into storage.objects (bucket_id, name) values ('documentos', '%s/lancamentos/1/x.pdf')$$, current_setting('teste.empresa_alfa')), 'row-level security');
reset role;

-- ---------------------------------------------------------------------
-- 10. Auditoria: alteração grava só o que mudou
-- ---------------------------------------------------------------------
select teste.ok((select campos_alterados = array['descricao'] from auditoria where tabela = 'lancamento' and operacao = 'UPDATE' and depois->>'descricao' = 'Aluguel out/2026'), 'auditoria enxuta na alteração');
select teste.ok((select usuario_email from auditoria where tabela = 'titulo' and operacao = 'INSERT' order by id limit 1) = 'a@alfa.com', 'auditoria guarda quem fez');

drop schema teste cascade;
\echo 'TESTES DO BANCO: todos passaram'
