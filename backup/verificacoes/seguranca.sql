-- Conferência de segurança do banco Finanway (regras de SEGURANCA.md). Roda no CI (banco de teste), no backup diário
-- (banco de produção) e à mão (scripts/conferir_seguranca.py). Cada linha devolvida é um problema; nenhuma = tudo certo.
select 'tabela sem RLS' as problema, c.relname as objeto
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
union all
select 'view sem security_invoker', c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
  and not coalesce('security_invoker=true' = any(c.reloptions) or 'security_invoker=on' = any(c.reloptions), false)
union all
select 'visitante sem login (anon) acessa tabela/view', c.relname
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
  and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
    or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))
union all
-- liberada de propósito: registrar_login (falha de senha antes de existir sessão, com limite por minuto/hora)
select 'visitante sem login (anon) executa função', p.oid::regprocedure::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind = 'f' and p.proname not in ('registrar_login')
  and has_function_privilege('anon', p.oid, 'execute')
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
union all
-- funções internas (gatilhos e auxiliares) não podem ser chamadas pela API
select 'função interna executável por usuário logado', p.oid::regprocedure::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and (p.proname like 'fn\_%' or p.proname in ('confere_empresa', 'semear_plano_padrao', 'limpar_auditoria', 'eh_conta_admin_ti'))
  and has_function_privilege('authenticated', p.oid, 'execute')
union all
select 'função security definer sem search_path fixo', p.oid::regprocedure::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
union all
-- administrador TI só por login Google (e-mail/senha qualquer um cadastra com o e-mail que quiser)
select 'administrador TI sem login Google', u.email
from public.usuario u join auth.users a on a.id = u.id
where u.papel = 'ADMIN_TI' and u.ativo and not coalesce(a.raw_app_meta_data->'providers' ? 'google', false)
union all
select 'bucket de arquivos público', b.id
from storage.buckets b where b.public
union all
-- multiempresa: política de tabela com empresa_id sem filtro pela empresa em uso deixa uma empresa ver a outra
-- (a exceção é a política que só entrega as linhas do próprio usuário, por auth.uid())
select 'política sem filtro por empresa', p.tablename || '.' || p.policyname
from pg_policies p
where p.schemaname = 'public'
  and exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = p.tablename and c.column_name = 'empresa_id')
  and coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') not like '%empresa_atual()%'
  and coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') not like '%auth.uid()%'
union all
-- desempenho com muitas empresas: função chamada por linha na política (fora de "(select f())")
select distinct 'política com função chamada por linha', p.tablename || '.' || p.policyname || ': ' || m[1]
from pg_policies p,
  lateral regexp_matches(regexp_replace(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''),
                                        '\(\s*SELECT\s+[a-z_.]+\([^()]*\)\s+AS\s+[a-z_]+\)', '', 'gi'), '([a-z_]+)\(', 'gi') m
where p.schemaname = 'public'
  and lower(m[1]) not in ('exists', 'coalesce', 'any', 'all', 'array', 'lower', 'upper', 'btrim', 'length', 'now', 'select', 'and', 'or', 'not', 'in')
union all
select 'tabela com empresa_id sem índice começando por empresa_id', c.relname
from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'empresa_id'
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  and not exists (select 1 from pg_index i where i.indrelid = c.oid and i.indkey[0] = a.attnum)
order by 1, 2;
