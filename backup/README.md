# Backup do banco FinFlow (7 dias, um por dia da semana)

Mesmo modelo do Luminexus-backup. Os arquivos desta pasta vão para um repositório **privado separado**,
`FinFlow-backup` (assim o segredo `DB_URL`, que dá acesso total ao banco, não fica no repositório do código):

```
FinFlow-backup/
  .github/workflows/backup.yml   ← backup/.github/workflows/backup.yml
  verificacoes/                  ← backup/verificacoes/ (seguranca.sql, contagem.sql, stubs-restauracao.sql)
  README.md                      ← este arquivo
```

Sempre que `backup/verificacoes/seguranca.sql` mudar aqui, copie também para o FinFlow-backup (senão a conferência
diária acusa diferença).

O GitHub Actions roda todo dia às **00:30 (Brasília)** e copia o banco como ele estava ao fim do dia anterior. O arquivo
recebe o nome do dia da semana (`backup-1-segunda` … `backup-7-domingo`); na semana seguinte o do mesmo dia é substituído.
Sempre existem os últimos 7 dias.

- **Entra:** todas as tabelas do schema `public` (empresas, usuários, plano de contas, contas, clientes/fornecedores,
  títulos, lançamentos, orçamento, fechamentos), views e funções; e os arquivos do Storage (documentos e logos), à parte.
- **Fica de fora:** os dados de `auditoria` e `auditoria_login` (a estrutura vai, vazia) e os usuários de login (`auth.users`).
- **Formato:** `pg_dump --format=custom` criptografado com **age** (`.dump.age`). Sem a chave privada ninguém abre, nem
  quem tiver acesso ao GitHub.

## Verificações diárias (falha = e-mail do GitHub para o dono do repositório)

1. Mantém o Supabase acordado (`/auth/v1/health`): o plano gratuito pausa após 7 dias sem uso.
2. Testa a restauração num PostgreSQL 17 vazio e compara as linhas de cada tabela com o Supabase (falha abaixo de 90%).
3. Confere a segurança (`verificacoes/seguranca.sql`): tabela sem RLS, view sem `security_invoker`, objeto acessível por
   `anon`, função interna exposta, política sem filtro de empresa, administrador TI sem login Google, bucket público.

## Configuração (uma vez)

1. Gere o par de chaves age: `age-keygen -o finflow-backup-chave-privada.txt` (guarde no cofre de senhas; a linha
   `# public key: age1…` é a chave pública).
2. Crie o repositório privado `FinFlow-backup` com os arquivos acima.
3. Segredos (Settings › Secrets and variables › Actions): `DB_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_KEY`, `AGE_DESTINATARIO` (a chave pública age).
4. Actions › "Backup diário do banco" › **Run workflow** para conferir.

## Como abrir e restaurar

```bash
age -d -i finflow-backup-chave-privada.txt -o finflow-2026-10-21.dump finflow-2026-10-21.dump.age
# olhar numa base local (PostgreSQL 17):
createdb finflow_bkp && psql -d finflow_bkp -f verificacoes/stubs-restauracao.sql
pg_restore -d finflow_bkp --no-owner --no-privileges finflow-2026-10-21.dump
# voltar o Supabase inteiro ao backup (apaga o schema public de hoje):
pg_restore --clean --if-exists --no-owner --no-privileges --schema=public -d "$DB_URL" finflow-2026-10-21.dump
```

Depois de restaurar no Supabase, **reaplique `supabase/migrations/0005_rls.sql`** (o `--no-privileges` devolve as
permissões padrão do Supabase, que deixam o visitante sem login acessar as tabelas). Só uma tabela:
`pg_restore --data-only --table=lancamento -d "$DB_URL" arquivo.dump` (esvazie a tabela antes).

Arquivos: `age -d -i chave.txt -o x.tar.gz x.tar.gz.age && tar -xzf x.tar.gz` (pastas `documentos/` e `logos/` com os
mesmos caminhos do Storage).
