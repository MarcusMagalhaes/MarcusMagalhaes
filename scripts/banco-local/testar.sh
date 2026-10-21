#!/usr/bin/env bash
# Testa o banco do Finanway num PostgreSQL limpo: stubs do Supabase → migrações (duas vezes: precisam ser reexecutáveis)
# → testes de regras e permissões (testes.sql) → conferência de segurança (backup/verificacoes/seguranca.sql).
#   npm run banco:testar
# Sem PGHOST: cria um cluster temporário em .banco-local/ (precisa do PostgreSQL instalado; como root, roda com o
# usuário postgres). Com PGHOST/PGUSER/PGPASSWORD (CI): usa o servidor indicado e cria o banco finanway_teste.
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"
BANCO=finanway_teste
PARAR=""

if [ -z "${PGHOST:-}" ]; then
  BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
  [ -n "$BIN" ] || { echo "PostgreSQL não encontrado (instale ou defina PGHOST)"; exit 1; }
  DADOS="$RAIZ/.banco-local"
  rm -rf "$DADOS"; mkdir -p "$DADOS"
  COMO=""; [ "$(id -u)" = "0" ] && { chown postgres "$DADOS"; COMO="runuser -u postgres --"; }
  $COMO "$BIN/initdb" -D "$DADOS/dados" -U postgres -A trust --locale=C.UTF-8 >/dev/null
  $COMO "$BIN/pg_ctl" -D "$DADOS/dados" -o "-p 54329 -k $DADOS -c listen_addresses=''" -l "$DADOS/log.txt" -w start >/dev/null
  PARAR="$COMO $BIN/pg_ctl -D $DADOS/dados -m fast stop"
  trap 'eval "$PARAR" >/dev/null; rm -rf "$DADOS"' EXIT
  export PGHOST="$DADOS" PGPORT=54329 PGUSER=postgres
fi

psql -X -q -d postgres -c "drop database if exists $BANCO" -c "create database $BANCO" >/dev/null
P="psql -X -q -v ON_ERROR_STOP=1 -d $BANCO"
$P -f "$RAIZ/scripts/banco-local/stubs-supabase.sql" >/dev/null
for volta in 1 2; do
  for f in "$RAIZ"/supabase/migrations/*.sql; do
    $P -f "$f" >/dev/null 2>"$RAIZ/.erro-migracao.txt" || { echo "ERRO na migração $(basename "$f") (volta $volta):"; cat "$RAIZ/.erro-migracao.txt"; rm -f "$RAIZ/.erro-migracao.txt"; exit 1; }
  done
  echo "migrações aplicadas (volta $volta)"
done
rm -f "$RAIZ/.erro-migracao.txt"
$P -o /dev/null -f "$RAIZ/scripts/banco-local/testes.sql"
PROBLEMAS="$($P -At -F' : ' -f "$RAIZ/backup/verificacoes/seguranca.sql")"
if [ -n "$PROBLEMAS" ]; then echo "SEGURANÇA: problemas encontrados:"; echo "$PROBLEMAS" | sed 's/^/  /'; exit 1; fi
echo "SEGURANÇA: nenhuma tabela sem RLS, nada aberto ao visitante sem login, políticas filtrando a empresa"
