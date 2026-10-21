# Aplica arquivos SQL de supabase/migrations/ no banco do Supabase (pooler, porta 5432), na ordem dada, cada um numa
# transação. Para no primeiro erro e mostra a linha.
#   python scripts/aplicar_migracoes.py 0001_base.sql 0002_cadastros.sql …      (ou: --todas)
# Conexão: variável DB_URL (postgresql://postgres.<ref>:SENHA@aws-0-<região>.pooler.supabase.com:5432/postgres) ou o
# arquivo credenciais/db-url.txt (fora do git). Antes de aplicar na produção, rode `npm run banco:testar`.
import os, re, sys
import psycopg2
sys.stdout.reconfigure(encoding="utf-8")

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
PASTA = os.path.join(RAIZ, "supabase", "migrations")

def url_do_banco():
    if os.environ.get("DB_URL"): return os.environ["DB_URL"]
    arq = os.path.join(RAIZ, "credenciais", "db-url.txt")
    if os.path.exists(arq): return open(arq, encoding="utf-8").read().strip()
    sys.exit("Defina DB_URL ou crie credenciais/db-url.txt")

nomes = sys.argv[1:]
if nomes == ["--todas"]: nomes = sorted(f for f in os.listdir(PASTA) if f.endswith(".sql"))
if not nomes: sys.exit("uso: python scripts/aplicar_migracoes.py <arquivo.sql> … | --todas")

con = psycopg2.connect(url_do_banco(), sslmode="require")
con.autocommit = False
for nome in nomes:
    sql = open(os.path.join(PASTA, nome), encoding="utf-8").read()
    cur = con.cursor()
    try:
        cur.execute("set local lock_timeout = '5s'")   # nunca segurar as tabelas da produção esperando (Luminexus, 19/10)
        cur.execute(sql)
        con.commit()
        print("OK  ", nome)
    except Exception as e:
        con.rollback()
        msg = str(e)
        print("ERRO", nome, "->", msg.strip())
        m = re.search(r"LINE (\d+):", msg)
        if m:
            n = int(m[1]); linhas = sql.splitlines()
            print("   contexto:", "\n   ".join(linhas[max(0, n - 3):n + 2]))
        sys.exit(1)
cur = con.cursor()
cur.execute("select count(*) from pg_tables where schemaname='public'"); print("tabelas em public:", cur.fetchone()[0])
cur.execute("select count(*) from empresa"); print("empresas:", cur.fetchone()[0])
cur.execute("select id, public from storage.buckets order by id"); print("buckets:", cur.fetchall())
con.close()
