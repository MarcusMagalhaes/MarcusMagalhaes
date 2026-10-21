# Confere a segurança do banco do Supabase com as mesmas regras do CI e do backup diário (backup/verificacoes/seguranca.sql):
# RLS em todas as tabelas, views com security_invoker, nada acessível/executável por anon (exceto registrar_login), funções
# internas fechadas, security definer com search_path fixo, políticas filtrando a empresa em uso, índice por empresa_id,
# administrador TI só com login Google e buckets privados. Mostra também as políticas por tabela.
#   python scripts/conferir_seguranca.py      (conexão: DB_URL ou credenciais/db-url.txt, como aplicar_migracoes.py)
import os, sys
sys.stdout.reconfigure(encoding="utf-8")
from conexao import RAIZ, conectar

con = conectar()
cur = con.cursor()
cur.execute("select tablename, count(*) from pg_policies where schemaname='public' group by 1 order by 1")
print("políticas por tabela:", ", ".join(f"{t} ({n})" for t, n in cur.fetchall()))
cur.execute(open(os.path.join(RAIZ, "backup", "verificacoes", "seguranca.sql"), encoding="utf-8").read())
problemas = cur.fetchall()
for p, o in problemas: print(f"✗ {p}: {o}")
print("\nRESULTADO:", "OK, nenhum problema" if not problemas else f"{len(problemas)} problema(s)")
con.close()
sys.exit(1 if problemas else 0)
