# Teste das regras de acesso

Roda as migrações num Postgres local com uma imitação mínima do Supabase (perfis `anon`, `authenticated`, `auth.uid()` e armazenamento) e confere, com dados fictícios, o que cada perfil consegue ver e fazer.

```bash
createdb portal_teste
psql -d portal_teste -f 01_stubs_supabase.sql
psql -d portal_teste -f ../migrations/20261019_001_modelo_fase1.sql
psql -d portal_teste -f ../migrations/20261019_002_ajustes_migracao.sql
psql -d portal_teste -f ../migrations/20261019_004_desempenho_regras_acesso.sql
psql -d portal_teste -f 02_privilegios_padrao.sql
psql -d portal_teste -f 03_cenario_acessos.sql
```

O cenário cria três empresas, dois fornecedores, dois TSTs e um administrativo, e mostra o resultado de cada consulta e ação com o login de cada um.
