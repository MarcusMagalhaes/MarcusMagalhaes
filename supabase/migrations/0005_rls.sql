-- FinFlow · 0005: Row Level Security, permissões e Storage (regras de SEGURANCA.md)
-- Regra geral: visitante sem login (anon) não acessa nada do schema public, exceto registrar_login. Conta sem vínculo
-- ativo com a empresa em uso não lê nada. Uma empresa nunca lê a outra: toda política filtra empresa_id pela empresa em
-- uso, com as funções em "(select f())" (avaliadas uma vez por consulta — Luminexus 0068/0102).
--   leitura do financeiro: todos os papéis · operação (lançar, baixar, importar, anexar): todos menos CONTADOR
--   exclusão e cadastros (contas, plano, centros, orçamento): DIRETOR, ADMIN, FINANCEIRO · usuários/empresa/auditoria: DIRETOR, ADMIN
-- Rode depois da 0004. Pode ser executado mais de uma vez.
-- ATENÇÃO ao restaurar backup com pg_restore --no-privileges: rode esta migração de novo.

-- ---------------------------------------------------------------------
-- 1. anon não acessa o schema public; logado executa funções (as internas são tiradas abaixo)
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon, public;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon, public;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated, service_role;
alter default privileges in schema public grant execute on functions to authenticated, service_role;
grant execute on function registrar_login(text, text, text, text, text) to anon;

-- funções internas: só por outras funções, gatilhos ou pela conexão direta (postgres)
do $$
declare f text;
begin
  foreach f in array array[
    'eh_conta_admin_ti(uuid)', 'fn_protege_admin_ti()', 'fn_novo_usuario_auth()', 'fn_liberacao_previa_aplica()', 'fn_carimbo()',
    'fn_auditoria()', 'limpar_auditoria()', 'fn_plano_inclusao()', 'fn_plano_alteracao()', 'fn_plano_desativa_filhos()',
    'fn_empresa_config()', 'fn_parceiro_regras()', 'fn_fixa_empresa()', 'fn_titulo_regras()', 'fn_lancamento_regras()',
    'fn_lancamento_recalcula_titulo()', 'fn_lancamento_baixa_protegida()', 'fn_anexo_regras()', 'fn_orcamento_regras()',
    'fn_lancamento_mes_fechado()', 'fn_empresa_protegida()', 'confere_empresa(int)', 'semear_plano_padrao(int)'] loop
    if to_regprocedure(f) is not null then execute format('revoke execute on function %s from authenticated, anon, public', f); end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. RLS em todas as tabelas
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['empresa','usuario','usuario_empresa','liberacao_previa','auditoria','auditoria_login',
                           'conta_financeira','plano_conta','centro_custo','parceiro','titulo','lancamento','importacao_extrato',
                           'anexo','orcamento','orcamento_parametro','fechamento_mes'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- apaga as políticas antigas destas tabelas (a migração pode rodar de novo)
do $$
declare p record;
begin
  for p in select tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on %I', p.policyname, p.tablename);
  end loop;
end $$;

-- empresa: cada um vê as suas; administrador da empresa edita a sua; TI cria, edita e exclui todas
create policy empresa_ler on empresa for select to authenticated using (
  (select eh_admin_ti()) or exists (select 1 from usuario_empresa ue where ue.usuario_id = (select auth.uid()) and ue.empresa_id = empresa.id and ue.ativo));
create policy empresa_alterar on empresa for update to authenticated
  using ((select eh_admin_ti()) or (id = (select empresa_atual()) and (select eh_admin())))
  with check ((select eh_admin_ti()) or (id = (select empresa_atual()) and (select eh_admin())));
create policy empresa_ti_incluir on empresa for insert to authenticated with check ((select eh_admin_ti()));
create policy empresa_ti_excluir on empresa for delete to authenticated using ((select eh_admin_ti()));

-- o administrador da empresa não muda o que é do TI (ativar/desativar empresa)
create or replace function fn_empresa_protegida() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.ativa is distinct from old.ativa and auth.uid() is not null and not eh_admin_ti() then
    raise exception 'Somente o administrador TI ativa ou desativa uma empresa';
  end if;
  return new;
end $$;
revoke execute on function fn_empresa_protegida() from authenticated, anon, public;
drop trigger if exists trg_empresa_protegida on empresa;
create trigger trg_empresa_protegida before update on empresa for each row execute function fn_empresa_protegida();

-- usuario: cada um lê o próprio; administrador lê os da sua empresa; só o TI altera contas (bloquear)
create policy usuario_ler on usuario for select to authenticated using (
  id = (select auth.uid()) or (select eh_admin_ti())
  or ((select eh_admin()) and exists (select 1 from usuario_empresa ue where ue.usuario_id = usuario.id and ue.empresa_id = (select empresa_atual()))));
create policy usuario_ti on usuario for all to authenticated using ((select eh_admin_ti())) with check ((select eh_admin_ti()));

-- usuario_empresa: o próprio vê os seus vínculos; administrador gerencia os da empresa em uso (menos o próprio papel)
create policy ue_ler on usuario_empresa for select to authenticated using (
  usuario_id = (select auth.uid()) or (empresa_id = (select empresa_atual()) and (select eh_admin())));
create policy ue_admin_incluir on usuario_empresa for insert to authenticated
  with check (empresa_id = (select empresa_atual()) and (select eh_admin()));
create policy ue_admin_alterar on usuario_empresa for update to authenticated
  using (empresa_id = (select empresa_atual()) and (select eh_admin()) and (usuario_id <> (select auth.uid()) or (select eh_admin_ti())))
  with check (empresa_id = (select empresa_atual()) and (select eh_admin()));
create policy ue_admin_excluir on usuario_empresa for delete to authenticated
  using (empresa_id = (select empresa_atual()) and (select eh_admin()) and usuario_id <> (select auth.uid()));

-- só o diretor (ou TI) dá o papel DIRETOR: o ADMIN não se promove nem promove outros
create or replace function fn_papel_diretor() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.papel = 'DIRETOR' and (tg_op = 'INSERT' or old.papel is distinct from 'DIRETOR') and not eh_diretor() then
    raise exception 'Somente a diretoria dá o papel Diretor';
  end if;
  return new;
end $$;
revoke execute on function fn_papel_diretor() from authenticated, anon, public;
drop trigger if exists trg_papel_diretor on usuario_empresa;
create trigger trg_papel_diretor before insert or update on usuario_empresa for each row execute function fn_papel_diretor();
drop trigger if exists trg_papel_diretor on liberacao_previa;
create trigger trg_papel_diretor before insert or update on liberacao_previa for each row execute function fn_papel_diretor();

create policy liberacao_admin on liberacao_previa for all to authenticated
  using (empresa_id = (select empresa_atual()) and (select eh_admin()))
  with check (empresa_id = (select empresa_atual()) and (select eh_admin()));

-- cadastros que só o financeiro completo altera; todos os papéis leem
do $$
declare t text;
begin
  foreach t in array array['conta_financeira','plano_conta','centro_custo','orcamento','orcamento_parametro'] loop
    execute format('create policy %I on %I for select to authenticated using (empresa_id = (select empresa_atual()) and (select eh_leitor()))', t || '_ler', t);
    execute format('create policy %I on %I for insert to authenticated with check (empresa_id = (select empresa_atual()) and (select eh_financeiro()))', t || '_incluir', t);
    execute format('create policy %I on %I for update to authenticated using (empresa_id = (select empresa_atual()) and (select eh_financeiro())) with check (empresa_id = (select empresa_atual()) and (select eh_financeiro()))', t || '_alterar', t);
    execute format('create policy %I on %I for delete to authenticated using (empresa_id = (select empresa_atual()) and (select eh_financeiro()))', t || '_excluir', t);
  end loop;
  -- operação do dia a dia: operador inclui e altera; só o financeiro completo exclui (anexo: operador também tira)
  foreach t in array array['parceiro','titulo','lancamento','importacao_extrato','anexo'] loop
    execute format('create policy %I on %I for select to authenticated using (empresa_id = (select empresa_atual()) and (select eh_leitor()))', t || '_ler', t);
    execute format('create policy %I on %I for insert to authenticated with check (empresa_id = (select empresa_atual()) and (select eh_operador()))', t || '_incluir', t);
    execute format('create policy %I on %I for update to authenticated using (empresa_id = (select empresa_atual()) and (select eh_operador())) with check (empresa_id = (select empresa_atual()) and (select eh_operador()))', t || '_alterar', t);
    execute format('create policy %I on %I for delete to authenticated using (empresa_id = (select empresa_atual()) and (select %s()))', t || '_excluir', t,
                   case when t = 'anexo' then 'eh_operador' else 'eh_financeiro' end);
  end loop;
end $$;

-- fechamento: todos leem; escrita só pelas funções fechar_mes / avaliar_fechamento / reabrir_mes
create policy fechamento_ler on fechamento_mes for select to authenticated using (empresa_id = (select empresa_atual()) and (select eh_leitor()));
revoke insert, update, delete on fechamento_mes from authenticated;

-- auditoria: só administradores da empresa (e TI); ninguém grava pela API (só os gatilhos)
create policy aud_admin on auditoria for select to authenticated using (empresa_id = (select empresa_atual()) and (select eh_admin()));
create policy aud_login_admin on auditoria_login for select to authenticated using (
  (select eh_admin_ti()) or usuario_id = (select auth.uid())
  or ((select eh_admin()) and usuario_id in (select ue.usuario_id from usuario_empresa ue where ue.empresa_id = (select empresa_atual()))));
revoke insert, update, delete on auditoria, auditoria_login from authenticated;

-- ---------------------------------------------------------------------
-- 3. Views respeitam o RLS de quem consulta (declarado também na criação)
-- ---------------------------------------------------------------------
alter view v_saldo_conta set (security_invoker = true);
alter view v_lancamento set (security_invoker = true);
alter view v_titulo set (security_invoker = true);
alter view v_orcamento set (security_invoker = true);
revoke all on v_saldo_conta, v_lancamento, v_titulo, v_orcamento from anon;
grant select on v_saldo_conta, v_lancamento, v_titulo, v_orcamento to authenticated;

-- ---------------------------------------------------------------------
-- 4. Storage: buckets privados, arquivos em <empresa>/… (a política confere a primeira pasta)
--   documentos — anexos de lançamentos e títulos (<empresa>/lancamentos/<id>/…, <empresa>/titulos/<id>/…), até 20 MB:
--                PDF, imagens e XML da NF-e. Todos os papéis leem; operador envia e apaga.
--   logos      — logo da empresa (<empresa>/…), até 2 MB, sem SVG (pode carregar script). Usuários da empresa leem;
--                administrador grava.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 20971520,
        array['application/pdf','image/jpeg','image/png','image/webp','application/xml','text/xml'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

do $$
declare p text;
begin
  foreach p in array array['documentos_ler','documentos_enviar','documentos_atualizar','documentos_excluir','logos_ler','logos_enviar','logos_atualizar','logos_excluir'] loop
    execute format('drop policy if exists %I on storage.objects', p);
  end loop;
end $$;
create policy documentos_ler on storage.objects for select to authenticated using (
  bucket_id = 'documentos' and (storage.foldername(name))[1] = (select public.empresa_atual())::text
  and (storage.foldername(name))[2] in ('lancamentos','titulos') and (select public.eh_leitor()));
create policy documentos_enviar on storage.objects for insert to authenticated with check (
  bucket_id = 'documentos' and (storage.foldername(name))[1] = (select public.empresa_atual())::text
  and (storage.foldername(name))[2] in ('lancamentos','titulos') and (select public.eh_operador()));
create policy documentos_atualizar on storage.objects for update to authenticated using (
  bucket_id = 'documentos' and (storage.foldername(name))[1] = (select public.empresa_atual())::text and (select public.eh_operador()));
create policy documentos_excluir on storage.objects for delete to authenticated using (
  bucket_id = 'documentos' and (storage.foldername(name))[1] = (select public.empresa_atual())::text and (select public.eh_operador()));
create policy logos_ler on storage.objects for select to authenticated using (
  bucket_id = 'logos' and ((storage.foldername(name))[1] in (select me.empresa_id::text from public.minhas_empresas() me)));
create policy logos_enviar on storage.objects for insert to authenticated with check (
  bucket_id = 'logos' and (storage.foldername(name))[1] = (select public.empresa_atual())::text and (select public.eh_admin()));
create policy logos_atualizar on storage.objects for update to authenticated using (
  bucket_id = 'logos' and (storage.foldername(name))[1] = (select public.empresa_atual())::text and (select public.eh_admin()));
create policy logos_excluir on storage.objects for delete to authenticated using (
  bucket_id = 'logos' and (storage.foldername(name))[1] = (select public.empresa_atual())::text and (select public.eh_admin()));

notify pgrst, 'reload schema';
