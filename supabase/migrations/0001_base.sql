-- Finanway — Gestão Financeira Inteligente · 0001: base do banco (Supabase / PostgreSQL)
-- Multi-empresa, contas de login, papéis por empresa, pré-liberação de e-mail, carimbo e auditoria completa.
-- Mesmo padrão do Luminexus: toda proteção fica no banco (a chave anon vai no JavaScript do site e é pública).
-- Políticas RLS, permissões e buckets em 0005_rls.sql. Ordem: 0001 → 0006 (scripts/aplicar_migracoes.py).
-- Pode ser executado mais de uma vez.

-- No Supabase as extensões moram no schema "extensions" (fora do search_path das funções com search_path = public)
create extension if not exists unaccent with schema extensions;

-- Busca sem acento (índices e filtros)
create or replace function normalizar(p text) returns text
language sql immutable set search_path = public as $$ select lower(extensions.unaccent(coalesce(p, ''))) $$;

-- =====================================================================
-- 1. Empresa (cada cliente do Finanway; nenhuma lê os dados da outra)
-- =====================================================================
create table if not exists empresa (
  id                   serial primary key,
  razao_social         text not null check (btrim(razao_social) <> ''),
  nome_fantasia        text,
  cnpj                 text,                                   -- só dígitos (14) ou CPF (11) do MEI/produtor
  inscricao_estadual   text,
  inscricao_municipal  text,
  regime_tributario    text check (regime_tributario in ('MEI','SIMPLES','LUCRO_PRESUMIDO','LUCRO_REAL','ISENTO','OUTRO')),
  cep text, endereco text, numero text, complemento text, bairro text, cidade text, uf text,
  telefone text, email text, site text,
  logo_caminho         text,                                   -- bucket 'logos': <empresa>/<arquivo>
  ativa                boolean not null default true,
  criado_em            timestamptz not null default now()
);

-- =====================================================================
-- 2. Contas de login (globais) e papel por empresa
-- =====================================================================
-- usuario.papel é só a marca global: ADMIN_TI (conta de TI, qualquer empresa) ou USUARIO. O acesso de verdade é o
-- vínculo em usuario_empresa. empresa_atual_id = empresa escolhida no login: é o que as políticas RLS usam.
create table if not exists usuario (
  id                uuid primary key references auth.users(id) on delete cascade,
  nome              text not null,
  email             text not null unique,
  papel             text not null default 'USUARIO' check (papel in ('ADMIN_TI','USUARIO')),
  ativo             boolean not null default true,
  empresa_atual_id  int references empresa(id) on delete set null,
  criado_em         timestamptz not null default now()
);

-- Papéis por empresa:
--   DIRETOR         tudo, inclusive reabrir mês fechado
--   ADMIN           administração (usuários, empresa, auditoria) e o financeiro completo
--   FINANCEIRO      financeiro completo: lançamentos, títulos, cadastros, conciliação, orçamento, fechamento do mês
--   FINANCEIRO_AUX  lança e baixa títulos, importa extrato e anexa documentos; não exclui, não fecha mês, não mexe em cadastros
--   CONTADOR        consulta tudo do financeiro, relatórios e exportações; dá o parecer do fechamento do mês
create table if not exists usuario_empresa (
  usuario_id  uuid not null references usuario(id) on delete cascade,
  empresa_id  int not null references empresa(id) on delete cascade,
  papel       text not null check (papel in ('DIRETOR','ADMIN','FINANCEIRO','FINANCEIRO_AUX','CONTADOR')),
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now(),
  primary key (usuario_id, empresa_id)
);
create index if not exists ix_usuario_empresa_empresa on usuario_empresa (empresa_id);

-- Pré-liberação: o administrador informa o e-mail Google e o papel; no 1º login com o Google o vínculo é criado
create table if not exists liberacao_previa (
  empresa_id  int not null references empresa(id) on delete cascade,
  email       text not null check (email = lower(btrim(email)) and email like '%@%'),
  papel       text not null check (papel in ('DIRETOR','ADMIN','FINANCEIRO','FINANCEIRO_AUX','CONTADOR')),
  nome        text,
  criado_em   timestamptz not null default now(),
  criado_por  uuid default auth.uid() references usuario(id) on delete set null,
  usada_em    timestamptz,
  usuario_id  uuid references usuario(id) on delete set null,
  primary key (empresa_id, email)
);

-- Único lugar onde o e-mail do administrador TI é definido
create or replace function email_admin_ti() returns text
language sql immutable set search_path = public as $$ select 'onewayinf@gmail.com'::text $$;

-- Conta TI = e-mail do administrador TI E login pelo Google (e-mail/senha qualquer um cadastra com o e-mail que quiser)
create or replace function eh_conta_admin_ti(p_id uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce((select lower(email) = email_admin_ti() and coalesce(raw_app_meta_data->'providers' ? 'google', false)
                   from auth.users where id = p_id), false)
$$;

-- Proteção da conta TI: sempre ADMIN_TI, ativa, e-mail original; ninguém mais recebe ADMIN_TI
create or replace function fn_protege_admin_ti() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.papel = 'ADMIN_TI' and auth.uid() is not null then raise exception 'O administrador TI não pode ser excluído.'; end if;
    return old;
  end if;
  if eh_conta_admin_ti(new.id) then
    if tg_op = 'UPDATE' and auth.uid() is not null and auth.uid() <> new.id then
      raise exception 'Somente o próprio administrador TI pode alterar este usuário.';
    end if;
    new.papel := 'ADMIN_TI'; new.ativo := true; new.email := email_admin_ti();
  elsif new.papel = 'ADMIN_TI' then
    raise exception 'O papel Administrador TI é exclusivo e não pode ser atribuído a outro usuário.';
  end if;
  return new;
end $$;
drop trigger if exists trg_protege_admin_ti on usuario;
create trigger trg_protege_admin_ti before insert or update or delete on usuario for each row execute function fn_protege_admin_ti();

-- Primeiro login: TI (só Google) → ADMIN_TI; demais → conta USUARIO; vínculos vêm das pré-liberações (só Google)
create or replace function fn_novo_usuario_auth() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_nome text; v_email text; v_google boolean; v_lib record; v_primeira int;
begin
  v_email := lower(coalesce(new.email, ''));
  v_nome := left(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(v_email, '@', 1)), 80);
  v_google := coalesce(new.raw_app_meta_data->>'provider', '') = 'google';
  insert into usuario (id, nome, email, papel, ativo)
    values (new.id, v_nome, v_email, case when v_google and v_email = email_admin_ti() then 'ADMIN_TI' else 'USUARIO' end, true)
    on conflict (id) do nothing;
  if v_google then
    for v_lib in select * from liberacao_previa where email = v_email and usada_em is null order by criado_em loop
      insert into usuario_empresa (usuario_id, empresa_id, papel, ativo) values (new.id, v_lib.empresa_id, v_lib.papel, true)
        on conflict (usuario_id, empresa_id) do update set papel = excluded.papel, ativo = true;
      update liberacao_previa set usada_em = now(), usuario_id = new.id where empresa_id = v_lib.empresa_id and email = v_email;
      v_primeira := coalesce(v_primeira, v_lib.empresa_id);
    end loop;
    if v_primeira is not null then update usuario set empresa_atual_id = v_primeira where id = new.id; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_novo_usuario_auth on auth.users;
create trigger trg_novo_usuario_auth after insert on auth.users for each row execute function fn_novo_usuario_auth();

-- Pré-liberação de e-mail que já tem conta Google: cria o vínculo na hora
create or replace function fn_liberacao_previa_aplica() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid;
begin
  select u.id into v_uid from usuario u join auth.users a on a.id = u.id
   where u.email = new.email and coalesce(a.raw_app_meta_data->'providers' ? 'google', false);
  if v_uid is not null then
    insert into usuario_empresa (usuario_id, empresa_id, papel, ativo) values (v_uid, new.empresa_id, new.papel, true)
      on conflict (usuario_id, empresa_id) do update set papel = excluded.papel, ativo = true;
    update liberacao_previa set usada_em = now(), usuario_id = v_uid where empresa_id = new.empresa_id and email = new.email;
    update usuario set empresa_atual_id = coalesce(empresa_atual_id, new.empresa_id) where id = v_uid;
  end if;
  return null;
end $$;
drop trigger if exists trg_liberacao_previa_aplica on liberacao_previa;
create trigger trg_liberacao_previa_aplica after insert or update of papel, usada_em on liberacao_previa
  for each row when (new.usada_em is null) execute function fn_liberacao_previa_aplica();

-- =====================================================================
-- 3. Funções de contexto e permissão (usadas nas políticas RLS e nas funções de negócio)
--    Nas políticas, sempre como "(select f())": vira InitPlan, avaliada uma vez por consulta e não por linha.
-- =====================================================================
create or replace function eh_admin_ti() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select papel = 'ADMIN_TI' from usuario where id = auth.uid() and ativo), false) and eh_conta_admin_ti(auth.uid())
$$;
create or replace function empresa_atual() returns int
language sql stable security definer set search_path = public as $$
  select empresa_atual_id from usuario where id = auth.uid() and ativo
$$;
-- papel na empresa em uso (ADMIN_TI vale em qualquer empresa ativa)
create or replace function papel_atual() returns text
language sql stable security definer set search_path = public as $$
  select case when eh_admin_ti() then (select 'ADMIN_TI' from empresa where id = empresa_atual() and ativa)
              else (select ue.papel from usuario_empresa ue join empresa e on e.id = ue.empresa_id and e.ativa
                    where ue.usuario_id = auth.uid() and ue.empresa_id = empresa_atual() and ue.ativo) end
$$;
create or replace function usuario_ativo() returns boolean
language sql stable security definer set search_path = public as $$ select papel_atual() is not null $$;
-- usuários, empresa e auditoria
create or replace function eh_admin() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(papel_atual() in ('ADMIN_TI','DIRETOR','ADMIN'), false) $$;
-- reabrir mês fechado
create or replace function eh_diretor() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(papel_atual() in ('ADMIN_TI','DIRETOR'), false) $$;
-- financeiro completo: excluir, cadastros (contas, plano de contas, centros de custo), orçamento, fechar o mês
create or replace function eh_financeiro() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(papel_atual() in ('ADMIN_TI','DIRETOR','ADMIN','FINANCEIRO'), false) $$;
-- operação do dia a dia: lançar, baixar títulos, importar extrato, anexar, cadastrar cliente/fornecedor
create or replace function eh_operador() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(papel_atual() in ('ADMIN_TI','DIRETOR','ADMIN','FINANCEIRO','FINANCEIRO_AUX'), false) $$;
-- leitura do financeiro e relatórios (todos os papéis da empresa)
create or replace function eh_leitor() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(papel_atual() in ('ADMIN_TI','DIRETOR','ADMIN','FINANCEIRO','FINANCEIRO_AUX','CONTADOR'), false) $$;
-- parecer do fechamento do mês
create or replace function eh_contador() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(papel_atual() in ('ADMIN_TI','CONTADOR'), false) $$;

-- Os gatilhos de regras rodam ANTES do RLS conferir a linha nova: sem isto, uma linha com empresa_id de outra empresa
-- faria o gatilho ler e citar dados dela na mensagem de erro. Pelo app (com sessão) a linha tem de ser da empresa em
-- uso; scripts com conexão direta (sem auth.uid()) passam.
create or replace function confere_empresa(p_empresa_id int) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and p_empresa_id is distinct from empresa_atual() then
    raise exception 'new row violates row-level security policy: registro de outra empresa' using errcode = '42501';
  end if;
end $$;

-- empresas em que a conta pode entrar (tela de escolha)
create or replace function minhas_empresas()
returns table (empresa_id int, razao_social text, nome_fantasia text, papel text, logo_caminho text)
language sql stable security definer set search_path = public as $$
  select e.id, e.razao_social, e.nome_fantasia, 'ADMIN_TI', e.logo_caminho from empresa e
   where e.ativa and eh_admin_ti()
  union all
  select e.id, e.razao_social, e.nome_fantasia, ue.papel, e.logo_caminho
    from usuario_empresa ue join empresa e on e.id = ue.empresa_id
   where ue.usuario_id = auth.uid() and ue.ativo and e.ativa and not eh_admin_ti()
   and exists (select 1 from usuario u where u.id = auth.uid() and u.ativo)
  order by 3 nulls last, 2
$$;
create or replace function escolher_empresa(p_empresa_id int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sem sessão'; end if;
  if not exists (select 1 from minhas_empresas() where empresa_id = p_empresa_id) then raise exception 'Você não tem acesso a esta empresa'; end if;
  update usuario set empresa_atual_id = p_empresa_id where id = auth.uid();
end $$;

-- =====================================================================
-- 4. Carimbo de criação/atualização (ligado às tabelas em 0002/0003)
-- =====================================================================
create or replace function fn_carimbo() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.criado_por := coalesce(auth.uid(), new.criado_por); end if;
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end $$;

-- =====================================================================
-- 5. Auditoria completa (registros e logins)
-- =====================================================================
create table if not exists auditoria (
  id                bigserial primary key,
  empresa_id        int,
  tabela            text not null,
  registro_id       text not null,
  operacao          text not null,
  antes             jsonb,
  depois            jsonb,
  usuario_id        uuid,
  usuario_email     text,
  origem            text not null default 'app',      -- app | sistema (scripts com conexão direta)
  campos_alterados  text[],
  em                timestamptz not null default now()
);
create index if not exists ix_auditoria_empresa_em on auditoria (empresa_id, em desc);
create index if not exists ix_auditoria_reg on auditoria (tabela, registro_id);
comment on column auditoria.antes is 'INSERT: vazio · UPDATE: só os campos alterados + id/nome/descricao/data/valor · DELETE: linha inteira';
comment on column auditoria.depois is 'INSERT: linha inteira · UPDATE: só os campos alterados + id/nome/descricao/data/valor · DELETE: vazio';

-- Auditoria enxuta (Luminexus 0071): na alteração guarda só o que mudou e o que identifica o registro.
-- Scripts de carga podem ligar app.sem_auditoria = on na sessão (conexão direta ao banco, nunca pelo app).
create or replace function fn_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
declare rid text; v_uid uuid := auth.uid(); v_email text; v_campos text[]; v_origem text := 'app'; v_empresa int;
        v_old jsonb; v_new jsonb; v_chaves text[];
begin
  if coalesce(current_setting('app.sem_auditoria', true), '') = 'on' and v_uid is null then return coalesce(new, old); end if;
  if v_uid is not null then select email into v_email from usuario where id = v_uid;
  else v_origem := 'sistema'; v_email := coalesce(nullif(current_setting('app.operador', true), ''), current_user); end if;
  v_old := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_empresa := coalesce((coalesce(v_new, v_old)->>'empresa_id')::int, case when tg_table_name = 'empresa' then (coalesce(v_new, v_old)->>'id')::int end, empresa_atual());
  rid := coalesce(coalesce(v_new, v_old)->>'id',
                  (select string_agg(value, '|') from jsonb_each_text(coalesce(v_new, v_old)) where key in ('usuario_id','empresa_id','email','ano')));

  if tg_op = 'DELETE' then
    insert into auditoria(empresa_id, tabela, registro_id, operacao, antes, usuario_id, usuario_email, origem)
      values (v_empresa, tg_table_name, coalesce(rid, ''), 'DELETE', v_old, v_uid, v_email, v_origem);
    return old;
  elsif tg_op = 'UPDATE' then
    select array_agg(n.key) into v_campos
      from jsonb_each(v_new) n join jsonb_each(v_old) o on o.key = n.key
      where n.value is distinct from o.value and n.key not in ('atualizado_em','atualizado_por');
    if v_campos is null then return new; end if;
    v_chaves := v_campos || array['id','nome','razao_social','descricao','data','vencimento','valor'];
    insert into auditoria(empresa_id, tabela, registro_id, operacao, antes, depois, usuario_id, usuario_email, origem, campos_alterados)
      values (v_empresa, tg_table_name, coalesce(rid, ''), 'UPDATE',
              (select jsonb_object_agg(key, value) from jsonb_each(v_old) where key = any(v_chaves)),
              (select jsonb_object_agg(key, value) from jsonb_each(v_new) where key = any(v_chaves)),
              v_uid, v_email, v_origem, v_campos);
    return new;
  else
    insert into auditoria(empresa_id, tabela, registro_id, operacao, depois, usuario_id, usuario_email, origem)
      values (v_empresa, tg_table_name, coalesce(rid, ''), 'INSERT', v_new, v_uid, v_email, v_origem);
    return new;
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['empresa','usuario','usuario_empresa','liberacao_previa'] loop
    execute format('drop trigger if exists trg_aud_%s on %I', t, t);
    execute format('create trigger trg_aud_%s after insert or update or delete on %I for each row execute function fn_auditoria()', t, t);
  end loop;
end $$;

create table if not exists auditoria_login (
  id          bigserial primary key,
  email       text,
  usuario_id  uuid,
  evento      text not null check (evento in ('LOGIN_OK','LOGIN_FALHA','LOGOUT')),
  motivo      text,
  metodo      text,
  agente      text,
  em          timestamptz not null default now()
);
create index if not exists ix_auditoria_login_em on auditoria_login (em desc);
create index if not exists ix_auditoria_login_usuario on auditoria_login (usuario_id, em desc);

-- Única função aberta a anon (falha de senha antes de existir sessão), com limite por minuto/hora
create or replace function registrar_login(p_email text, p_evento text, p_motivo text default null, p_metodo text default null, p_agente text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_email text;
begin
  if p_evento not in ('LOGIN_OK','LOGIN_FALHA','LOGOUT') then return; end if;
  if v_uid is null then
    if p_evento <> 'LOGIN_FALHA' then return; end if;
    if (select count(*) filter (where em > now() - interval '1 minute') >= 10 or count(*) >= 200
          from auditoria_login where usuario_id is null and em > now() - interval '1 hour') then return; end if;
    v_email := left(lower(coalesce(p_email, '')), 200);
  else
    if (select count(*) from auditoria_login where usuario_id = v_uid and em > now() - interval '1 minute') >= 10 then return; end if;
    select lower(email) into v_email from auth.users where id = v_uid;
  end if;
  insert into auditoria_login (email, usuario_id, evento, motivo, metodo, agente)
    values (v_email, v_uid, p_evento, left(p_motivo, 200), left(p_metodo, 20), left(p_agente, 300));
end $$;

-- Retenção (Luminexus 0081, ajustada ao financeiro): auditoria de registros 13 meses (cobre o exercício e o
-- fechamento do ano anterior); entradas no sistema 6 meses (Marco Civil da Internet, art. 15). Agendada em 0006.
create or replace function limpar_auditoria() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from auditoria where em < now() - interval '13 months';
  delete from auditoria_login where em < now() - interval '6 months';
end $$;

notify pgrst, 'reload schema';
