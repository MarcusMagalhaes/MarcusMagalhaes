-- Linhas por tabela do schema public (sem auditoria), no formato tabela|linhas: compara o Supabase com o backup restaurado.
select c.relname,
  (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text::bigint
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname not in ('auditoria', 'auditoria_login')
order by 1;
