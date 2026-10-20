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
| `supabase/functions` | Função `gerenciar-acesso`: cria acessos e gera o link de primeiro acesso ou de nova senha |
| `.github/workflows` | Publicação automática do site a cada atualização da branch `main` |

### Migrações do banco

| Arquivo | O que faz |
|---|---|
| `20261019_001_modelo_fase1.sql` | Tabelas, regras de vencimento, regras de acesso por perfil, ações do fluxo (enviar, aprovar, devolver, validar) e armazenamento privado dos arquivos |
| `20261019_002_ajustes_migracao.sql` | CPF opcional com aviso de pendência de cadastro, NR extra por colaborador e área temporária da carga da planilha |
| `20261019_003_remover_area_migracao.sql` | Remove a área temporária depois da carga |
| `20261019_004_desempenho_regras_acesso.sql` | Deixa as regras de acesso e as visões de pendências rápidas (mesmo resultado, sem estourar o tempo limite do Supabase) |
| `20261019_005_texto_aviso_liberacao.sql` | Texto do e-mail de liberação gerado para o Outlook |
| `20261019_006_envio_fornecedor.sql` | Envio de documento com arquivo numa operação só, e envio para análise só com os obrigatórios enviados |
| `20261019_007_integracao_tst.sql` | Turmas de integração na obra: lista de presença, confirmação dos presentes e registro da data pelo TST ou pelo administrativo |
| `20261019_008_medicao.sql` | Medição mensal (F.48): itens, medição por empresa, obra e mês, arquivos, conferência por colaborador e as ações de envio e conferência |
| `20261019_009_medicao_remover_colaborador.sql` | Fornecedor tira da medição quem não trabalhou no mês (aplicada à parte, pelo SQL Editor) |

Os arquivos usados para carregar as planilhas `CONTROLE_DE_INTEGRAÇÃO` e de medição mensal não estão neste repositório, porque têm CPFs. O repositório é público: nenhum dado pessoal, senha ou chave secreta entra aqui.

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

Os demais acessos (fornecedores, TSTs e outros do administrativo) são criados no portal, em **Acessos**. O portal gera o link de primeiro acesso e monta o e-mail; o administrativo envia pelo Outlook. Nenhum e-mail sai do Supabase nesse fluxo.

O link vale pelo prazo definido em **Authentication > Sign In / Providers > Email > Email OTP Expiration**. O padrão é 1 hora; para dar tempo de o fornecedor abrir o e-mail, o recomendado é 86400 segundos (24 horas).

### Publicar a função de acessos

A função fica em `supabase/functions/gerenciar-acesso` e é publicada com o Supabase CLI (`supabase functions deploy gerenciar-acesso --no-verify-jwt`). Ela confere sozinha se quem chama é administrativo ativo e usa a chave de serviço, que só existe no ambiente do Supabase.

## Nome dos arquivos baixados

Na **Análise de documentos**, "Baixar todos" (ou "Baixar desta empresa") junta os arquivos num ZIP, com uma pasta por empresa quando há mais de uma. Cada arquivo sai com o nome `AAAAMMDD_documento_colaborador`, por exemplo `20261010_ASO_AUGUSTO FRANCISCO DE LIMA.pdf`:

- a data é a emissão do documento; nos tipos sem emissão (RG, CTPS, seguro) vale o dia do envio;
- nos documentos da empresa, no lugar do colaborador vai a razão social;
- quando um documento tem mais de um arquivo, entra "(1 de 2)", "(2 de 2)".

O download individual usa o mesmo nome. O prazo de 30 dias para apagar o arquivo começa no primeiro download.

## Medição mensal (F.48)

Uma medição por empresa, obra e mês trabalhado, com entrega até o dia 25 do mês seguinte.

- **Fornecedor**, em **Medição**: escolhe a obra e o mês e começa. A lista de colaboradores já vem com quem está liberado ou em liberação na obra; ele ajusta a situação de cada um (trabalhou, rescisão, sócio, PJ, afastado), tira quem não trabalhou e inclui quem faltou. Envia um arquivo por item (holerites, pontos e VT podem vir num arquivo só) ou marca "não se aplica" com justificativa nos itens que aceitam (adiantamento, VT, rescisão). Só consegue enviar para conferência com todos os itens enviados.
- **Administrativo**, em **Medição**: painel do mês com as medições para conferir, com o fornecedor, retidas, aprovadas e as empresas com liberados que não começaram. Na conferência, aprova ou devolve cada item, marca colaborador por colaborador (holerite, pagamento, vale, VT, ponto, RE) e conclui: sem pendência, a medição fica aprovada; com pendência, volta para o fornecedor. A cobrança e o aviso de retenção para a engenharia da obra saem prontos para o Outlook.
- **Histórico por empresa** (aba dentro de Medição): uma linha por empresa e uma coluna por mês, com a situação de cada medição (OK, conferir, pendente, retida). Clicando na célula, abre a medição.
- **Retida**: medição não aprovada depois do prazo.
- "Baixar todos" gera um ZIP com os arquivos no nome `AAAAMM_documento_empresa`, por exemplo `202609_Holerite_EMPRESA LTDA (1 de 2).pdf`.

O histórico de março a agosto de 2026 veio da planilha de medição, sem obra (a planilha não tinha essa informação), com a conferência por colaborador das abas de março a maio.

## Indicadores

Em **Indicadores** (só administrativo), com filtro de obra e período:

- **Medição:** medições aprovadas por mês, entrega até o dia 25, tempo de conferência da Emais (dias úteis do envio à conclusão), itens pendentes nas entregas parciais e ranking dos 10 piores e 10 melhores fornecedores (só meses com prazo vencido).
- **Liberação:** tempo de liberação (do envio para análise à validação do TST, separado em Emais e TST), liberados com documento vencido ou faltando (por obra e por documento) e rankings de fornecedores nos dois.

As metas ficam em `site/src/lib/indicadores.ts` (`METAS`). Entrega no prazo e tempo de conferência só existem a partir das medições feitas no portal, porque a planilha não tinha essas datas.

## Rodar o site no computador

```bash
cd site
cp .env.exemplo .env.local   # preencher a chave pública
npm install
npm run dev                  # abre em http://localhost:5173/portal-terceiros/
```

## Publicação

Cada atualização na `main` dispara o workflow **Publicar site**, que gera o site e publica no GitHub Pages. Na primeira vez, em **Settings > Pages**, escolher **Source: GitHub Actions**.
