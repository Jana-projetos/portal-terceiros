# Portal de Terceiros

Portal do Grupo Emais para os fornecedores das obras cadastrarem colaboradores e enviarem documentos. O administrativo confere e libera, e o TST da obra dá a validação final.

- **Site:** https://jana-projetos.github.io/portal-terceiros/
- **Banco e login:** Supabase, projeto `ntjhkengoqpcyjsjawbw`

## Como está organizado

| Pasta | O que tem |
|---|---|
| `supabase/migrations` | Estrutura do banco, na ordem em que foi aplicada no Supabase |
| `supabase/testes` | Teste das regras de acesso (quem vê o quê), para rodar num Postgres local |
| `site` | O site (React + Vite), publicado no GitHub Pages |
| `.github/workflows` | Publicação automática do site a cada atualização da branch `main` |

### Migrações do banco

| Arquivo | O que faz |
|---|---|
| `20261019_001_modelo_fase1.sql` | Tabelas, regras de vencimento, regras de acesso por perfil, ações do fluxo (enviar, aprovar, devolver, validar) e armazenamento privado dos arquivos |
| `20261019_002_ajustes_migracao.sql` | CPF opcional com aviso de pendência de cadastro, NR extra por colaborador e área temporária da carga da planilha |
| `20261019_003_remover_area_migracao.sql` | Remove a área temporária depois da carga |
| `20261019_004_desempenho_regras_acesso.sql` | Deixa as regras de acesso e as visões de pendências rápidas (mesmo resultado, sem estourar o tempo limite do Supabase) |

Os arquivos usados para carregar a planilha `CONTROLE_DE_INTEGRAÇÃO` não estão neste repositório, porque têm CPFs. O repositório é público: nenhum dado pessoal, senha ou chave secreta entra aqui.

## Perfis

| Perfil | Vê |
|---|---|
| Fornecedor | Só os dados da própria empresa |
| Administrativo | Tudo, e é o único que abre os arquivos enviados |
| TST da obra | Os dados digitados das obras pelas quais responde, sem acesso aos arquivos |

Quem decide o que cada pessoa vê é o banco (regras de acesso por linha). O site usa só a chave pública do Supabase.

## Configuração do login no Supabase (feita uma vez)

Em **Authentication > URL Configuration**:

- **Site URL:** `https://jana-projetos.github.io/portal-terceiros/`
- **Redirect URLs:** `https://jana-projetos.github.io/portal-terceiros/**` e, para testes no computador, `http://localhost:5173/**`

Em **Authentication > Sign In / Providers**, desligar **Allow new users to sign up**. Os acessos são criados pelo administrativo, ninguém se cadastra sozinho.

O envio de e-mail padrão do Supabase tem limite baixo por hora. Para uso com fornecedores, configurar o SMTP do domínio da Emais em **Authentication > Emails > SMTP Settings**.

## Primeiro acesso do administrativo

1. Em **Authentication > Users > Add user**, criar o usuário com e-mail e senha (marcar *Auto Confirm User*).
2. No **SQL Editor**, ligar o usuário ao perfil:

```sql
insert into public.usuarios (id, nome, email, perfil)
select id, 'Nome da pessoa', email, 'admin' from auth.users where email = 'email@emais.com';
```

Logins de fornecedores e TSTs serão criados pelo próprio portal, na tela do administrativo.

## Rodar o site no computador

```bash
cd site
cp .env.exemplo .env.local   # preencher a chave pública
npm install
npm run dev                  # abre em http://localhost:5173/portal-terceiros/
```

## Publicação

Cada atualização na `main` que mexe em `site/` dispara o workflow **Publicar site**, que gera o site e publica no GitHub Pages. Na primeira vez, em **Settings > Pages**, escolher **Source: GitHub Actions**.
