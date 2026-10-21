# Conexão ao banco do Supabase para os scripts (aplicar_migracoes.py, conferir_seguranca.py). URL em DB_URL ou em
# credenciais/db-url.txt. Se o pooler responder "tenant/user not found" (servidor de outra região ou do outro grupo, aws-0 ×
# aws-1 — aconteceu no Luminexus e no Finanway), procura o servidor certo nas regiões do Supabase e avisa qual usar.
import os, re, sys
from urllib.parse import urlsplit, urlunsplit
import psycopg2

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
REGIOES = ["sa-east-1", "us-east-1", "us-east-2", "us-west-1", "us-west-2", "ca-central-1", "eu-central-1", "eu-west-1",
           "eu-west-2", "eu-west-3", "eu-north-1", "ap-southeast-1", "ap-southeast-2", "ap-northeast-1", "ap-northeast-2", "ap-south-1"]

def url_do_banco():
    if os.environ.get("DB_URL"): return os.environ["DB_URL"].strip()
    arq = os.path.join(RAIZ, "credenciais", "db-url.txt")
    if os.path.exists(arq): return open(arq, encoding="utf-8").read().strip()
    sys.exit("Defina DB_URL ou crie credenciais/db-url.txt")

def _trocar_host(url, host):
    p = urlsplit(url)
    credenciais, _, resto = p.netloc.rpartition("@")
    porta = resto.split(":")[1] if ":" in resto else "5432"
    return urlunsplit((p.scheme, f"{credenciais}@{host}:{porta}", p.path, p.query, p.fragment))

def conectar():
    url = url_do_banco()
    try:
        return psycopg2.connect(url, sslmode="require", connect_timeout=10)
    except psycopg2.OperationalError as e:
        if not re.search(r"tenant.*not found|Tenant or user not found", str(e), re.I): raise
        host_original = urlsplit(url).hostname
        print(f"O pooler {host_original} não conhece este projeto; procurando o servidor certo…")
        for regiao in REGIOES:
            for n in (0, 1):
                host = f"aws-{n}-{regiao}.pooler.supabase.com"
                if host == host_original: continue
                try:
                    con = psycopg2.connect(_trocar_host(url, host), sslmode="require", connect_timeout=6)
                except psycopg2.OperationalError as e2:
                    if re.search(r"tenant.*not found|Tenant or user not found|could not translate|timeout", str(e2), re.I): continue
                    raise
                print(f"::warning::Conectado por {host}. Troque o servidor no segredo DB_URL de {host_original} para {host}.")
                return con
        raise
