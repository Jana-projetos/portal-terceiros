-- =====================================================================
-- Portal de Gestão de Terceiros · Fase 1 (integração)
-- Modelo de dados, cálculo de vencimentos, pendências, ações e regras de acesso.
-- Projeto Supabase: Portal de Gestao de Terceiros (sa-east-1)
--
-- Princípios
--   * O fornecedor informa a DATA DE EMISSÃO; o vencimento é sempre calculado
--     pela tabela tipos_documento (exceto seguro de vida, que vence na
--     vigência final informada). Mudou o prazo na tabela, mudou o vencimento.
--   * Documentos da empresa (cartão CNPJ, PGR, PCMSO, LTCAT, seguro) ficam no
--     cadastro da empresa. Vale o envio aprovado de emissão mais recente; os
--     anteriores ficam como histórico de revisão.
--   * Liberação por colaborador e por obra, em duas etapas: aprovação do
--     administrador e validação final do TST da obra.
--   * Um login de acesso por empresa. O mesmo login pode responder por mais
--     de uma empresa (ex.: e-mail do escritório de contabilidade).
--   * Arquivos ficam no Storage só até o administrador baixar + 30 dias.
--   * O fornecedor nunca lê arquivos; o TST lê só dados digitados.
-- =====================================================================

create schema if not exists app;

-- ---------------------------------------------------------------------
-- 1. Tipos
-- ---------------------------------------------------------------------
create type public.perfil_usuario       as enum ('admin', 'tst', 'fornecedor');
create type public.situacao_colaborador as enum ('ativo', 'demitido', 'desistente');
create type public.status_documento     as enum ('em_analise', 'aprovado', 'devolvido', 'substituido');
create type public.status_alocacao      as enum ('em_cadastro', 'em_analise', 'pendente_fornecedor', 'aprovado_admin', 'liberado', 'encerrado');
create type public.regra_vencimento     as enum ('emissao_mais_prazo', 'vigencia_informada', 'sem_vencimento');
create type public.grupo_documento      as enum ('empresa', 'colaborador', 'obra');
create type public.origem_registro      as enum ('portal', 'migracao');

-- ---------------------------------------------------------------------
-- 2. Configuração
-- ---------------------------------------------------------------------
create table public.parametros (
  chave      text primary key,
  valor      text not null,
  descricao  text not null
);

create table public.tipos_documento (
  codigo                   text primary key,
  nome                     text not null,
  grupo                    public.grupo_documento not null,
  area                     text not null check (area in ('ADM', 'SST', 'OBRA')),
  regra                    public.regra_vencimento not null,
  validade_dias            integer check (validade_dias > 0),
  impeditivo               boolean not null default true,
  depende_da_funcao        boolean not null default false,  -- NRs: só quando a função exige
  so_subcontratada         boolean not null default false,  -- contrato entre as partes
  pode_dispensar           boolean not null default false,  -- ex.: LTCAT (N/I na planilha)
  enviado_pelo_fornecedor  boolean not null default true,   -- integração é registrada pela Emais
  ativo                    boolean not null default true,
  ordem                    integer not null default 0,
  observacao               text,
  atualizado_em            timestamptz not null default now(),
  atualizado_por           uuid,
  constraint prazo_coerente check ((regra = 'emissao_mais_prazo') = (validade_dias is not null))
);

create table public.tipos_documento_historico (
  id              bigint generated always as identity primary key,
  codigo          text not null references public.tipos_documento (codigo),
  campo           text not null,
  valor_anterior  text,
  valor_novo      text,
  motivo          text not null,
  alterado_por    uuid,
  alterado_em     timestamptz not null default now()
);

create table public.funcoes (
  id    uuid primary key default gen_random_uuid(),
  nome  text not null unique
);

-- Quais documentos dependentes da função (NRs) cada função exige.
create table public.funcoes_documentos (
  funcao_id    uuid not null references public.funcoes (id) on delete cascade,
  tipo_codigo  text not null references public.tipos_documento (codigo),
  primary key (funcao_id, tipo_codigo)
);

-- ---------------------------------------------------------------------
-- 3. Cadastros
-- ---------------------------------------------------------------------
create table public.obras (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null unique,
  codigo     text unique,              -- código SAP / centro de custo (segundo momento)
  ativa      boolean not null default true,
  criado_em  timestamptz not null default now()
);

create table public.empresas (
  id            uuid primary key default gen_random_uuid(),
  razao_social  text not null,
  cnpj          text not null unique check (cnpj ~ '^\d{14}$'),
  email_acesso  text,                  -- e-mail padrão escolhido pela empresa
  ativa         boolean not null default true,
  origem        public.origem_registro not null default 'portal',
  criado_em     timestamptz not null default now()
);

create table public.usuarios (
  id         uuid primary key references auth.users (id) on delete cascade,
  nome       text not null,
  email      text not null unique,
  perfil     public.perfil_usuario not null,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

-- Um login por empresa (unique empresa_id); um login pode cobrir várias empresas.
create table public.usuarios_empresas (
  usuario_id  uuid not null references public.usuarios (id) on delete cascade,
  empresa_id  uuid not null unique references public.empresas (id) on delete cascade,
  primary key (usuario_id, empresa_id)
);

create table public.tst_obras (
  usuario_id  uuid not null references public.usuarios (id) on delete cascade,
  obra_id     uuid not null references public.obras (id) on delete cascade,
  primary key (usuario_id, obra_id)
);

-- Em quais obras a empresa presta serviço, e se como subcontratada.
create table public.empresas_obras (
  id                    uuid primary key default gen_random_uuid(),
  empresa_id            uuid not null references public.empresas (id) on delete cascade,
  obra_id               uuid not null references public.obras (id) on delete cascade,
  subcontratada         boolean not null default false,
  empresa_principal_id  uuid references public.empresas (id),
  ativo                 boolean not null default true,
  unique (empresa_id, obra_id)
);

create table public.colaboradores (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas (id),
  nome          text not null,
  cpf           text not null check (cpf ~ '^\d{11}$'),
  funcao_id     uuid references public.funcoes (id),
  funcao_texto  text,                  -- como o fornecedor descreveu
  situacao      public.situacao_colaborador not null default 'ativo',
  origem        public.origem_registro not null default 'portal',
  criado_por    uuid default auth.uid(),
  criado_em     timestamptz not null default now(),
  unique (empresa_id, cpf)
);

-- Liberação vale por obra: um colaborador pode ter uma alocação aberta por obra.
create table public.alocacoes (
  id                  uuid primary key default gen_random_uuid(),
  colaborador_id      uuid not null references public.colaboradores (id) on delete cascade,
  obra_id             uuid not null references public.obras (id),
  status              public.status_alocacao not null default 'em_cadastro',
  inicio_conferencia  timestamptz,
  aprovado_admin_por  uuid,
  aprovado_admin_em   timestamptz,
  validado_tst_por    uuid,
  validado_tst_em     timestamptz,
  data_integracao     date,
  observacao          text,
  origem              public.origem_registro not null default 'portal',
  criado_por          uuid default auth.uid(),
  criado_em           timestamptz not null default now()
);
create unique index alocacao_aberta_unica on public.alocacoes (colaborador_id, obra_id) where status <> 'encerrado';

-- ---------------------------------------------------------------------
-- 4. Documentos, arquivos e histórico
-- ---------------------------------------------------------------------
-- Cada envio é uma linha. Documento de empresa: colaborador_id nulo.
create table public.documentos (
  id                         uuid primary key default gen_random_uuid(),
  tipo_codigo                text not null references public.tipos_documento (codigo),
  empresa_id                 uuid not null references public.empresas (id),
  colaborador_id             uuid references public.colaboradores (id) on delete cascade,
  data_emissao               date,
  data_vencimento_informada  date,     -- só seguro de vida (vigência final)
  dispensado                 boolean not null default false,
  dados                      jsonb not null default '{}'::jsonb,  -- ex.: carga horária, entidade do curso
  status                     public.status_documento not null default 'em_analise',
  motivo_devolucao           text,
  aceite_lgpd_em             timestamptz,
  enviado_por                uuid default auth.uid(),
  enviado_em                 timestamptz not null default now(),
  analisado_por              uuid,
  analisado_em               timestamptz,
  origem                     public.origem_registro not null default 'portal'
);
create index documentos_chave on public.documentos (empresa_id, colaborador_id, tipo_codigo, data_emissao desc);

create table public.arquivos (
  id             uuid primary key default gen_random_uuid(),
  documento_id   uuid not null references public.documentos (id) on delete cascade,
  caminho        text not null unique,   -- {empresa_id}/{documento_id}/{arquivo} no bucket "documentos"
  nome_original  text not null,
  tamanho_bytes  bigint,
  tipo_mime      text,
  enviado_em     timestamptz not null default now(),
  baixado_em     timestamptz,
  baixado_por    uuid,
  apagar_apos    date,                   -- baixado_em + dias_guarda_arquivo
  apagado_em     timestamptz
);

create table public.eventos (
  id           bigint generated always as identity primary key,
  tabela       text not null,
  registro_id  uuid not null,
  acao         text not null,
  detalhe      jsonb not null default '{}'::jsonb,
  usuario_id   uuid default auth.uid(),
  criado_em    timestamptz not null default now()
);
create index eventos_registro on public.eventos (tabela, registro_id, criado_em);

-- E-mail de liberação gerado pronto; o administrador envia pelo Outlook.
create table public.avisos_liberacao (
  id                  uuid primary key default gen_random_uuid(),
  obra_id             uuid not null references public.obras (id),
  alocacoes           uuid[] not null,
  destinatarios       text,
  assunto             text not null,
  corpo               text not null,
  gerado_por          uuid default auth.uid(),
  gerado_em           timestamptz not null default now(),
  marcado_enviado_em  timestamptz
);

-- ---------------------------------------------------------------------
-- 5. Funções de apoio às regras de acesso (schema app, não exposto na API)
-- ---------------------------------------------------------------------
create or replace function app.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.perfil = 'admin' and u.ativo);
$$;

create or replace function app.minhas_empresas() returns setof uuid
language sql stable security definer set search_path = public as $$
  select ue.empresa_id
  from public.usuarios_empresas ue
  join public.usuarios u on u.id = ue.usuario_id
  where ue.usuario_id = auth.uid() and u.perfil = 'fornecedor' and u.ativo;
$$;

create or replace function app.minhas_obras_tst() returns setof uuid
language sql stable security definer set search_path = public as $$
  select t.obra_id
  from public.tst_obras t
  join public.usuarios u on u.id = t.usuario_id
  where t.usuario_id = auth.uid() and u.perfil = 'tst' and u.ativo;
$$;

create or replace function app.tst_ve_colaborador(p_colaborador uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.alocacoes a
    where a.colaborador_id = p_colaborador and a.obra_id in (select app.minhas_obras_tst())
  );
$$;

create or replace function app.tst_ve_empresa(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.alocacoes a
    join public.colaboradores c on c.id = a.colaborador_id
    where c.empresa_id = p_empresa and a.obra_id in (select app.minhas_obras_tst())
  );
$$;

create or replace function app.param_int(p_chave text) returns integer
language sql stable security definer set search_path = public as $$
  select valor::integer from public.parametros where chave = p_chave;
$$;

-- ---------------------------------------------------------------------
-- 6. Gatilhos
-- ---------------------------------------------------------------------
-- 6.1 Histórico genérico
create or replace function app.registrar_evento(p_tabela text, p_id uuid, p_acao text, p_detalhe jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.eventos (tabela, registro_id, acao, detalhe) values (p_tabela, p_id, p_acao, coalesce(p_detalhe, '{}'::jsonb));
$$;

-- 6.2 Envio de documento: validações e campos controlados pelo sistema
create or replace function app.antes_inserir_documento() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t public.tipos_documento;
  emp_colab uuid;
begin
  select * into t from public.tipos_documento where codigo = new.tipo_codigo;
  if not t.ativo then raise exception 'Tipo de documento % está inativo', new.tipo_codigo; end if;
  if not t.enviado_pelo_fornecedor then raise exception '% não é enviado pelo fornecedor', t.nome; end if;

  -- documento de empresa x de colaborador
  if t.grupo = 'empresa' and new.colaborador_id is not null then
    raise exception '% é documento da empresa: não informe colaborador', t.nome;
  end if;
  if t.grupo = 'colaborador' then
    if new.colaborador_id is null then raise exception '% exige o colaborador', t.nome; end if;
    select empresa_id into emp_colab from public.colaboradores where id = new.colaborador_id;
    if emp_colab is distinct from new.empresa_id then raise exception 'Colaborador não pertence à empresa informada'; end if;
  end if;

  -- datas
  if new.dispensado and not t.pode_dispensar then raise exception '% não pode ser dispensado', t.nome; end if;
  if not new.dispensado then
    if t.regra = 'emissao_mais_prazo' and new.data_emissao is null then
      raise exception 'Informe a data de emissão de %', t.nome;
    end if;
    if t.regra = 'vigencia_informada' and new.data_vencimento_informada is null then
      raise exception 'Informe a vigência final de %', t.nome;
    end if;
  end if;
  if new.data_emissao > current_date then
    raise exception 'A data de emissão de % não pode ser futura', t.nome;
  end if;

  -- campos do sistema: quem chega pela API (fornecedor ou admin) não escolhe status
  if auth.uid() is not null then
    new.origem := 'portal';
    new.enviado_por := auth.uid();
    new.enviado_em := now();
    new.status := 'em_analise';
    new.motivo_devolucao := null;
    new.analisado_por := null;
    new.analisado_em := null;
    if new.aceite_lgpd_em is null then raise exception 'É preciso aceitar o termo de LGPD para enviar'; end if;
  end if;
  return new;
end $$;

create trigger documentos_antes_inserir before insert on public.documentos
for each row execute function app.antes_inserir_documento();

-- Novo envio substitui envios anteriores do mesmo documento que ainda estavam em aberto.
create or replace function app.depois_inserir_documento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.documentos d set status = 'substituido'
  where d.id <> new.id
    and d.empresa_id = new.empresa_id
    and d.colaborador_id is not distinct from new.colaborador_id
    and d.tipo_codigo = new.tipo_codigo
    and d.status in ('em_analise', 'devolvido');
  perform app.registrar_evento('documentos', new.id, 'enviado',
    jsonb_build_object('tipo', new.tipo_codigo, 'colaborador_id', new.colaborador_id, 'origem', new.origem));
  return new;
end $$;

create trigger documentos_depois_inserir after insert on public.documentos
for each row execute function app.depois_inserir_documento();

create or replace function app.status_mudou() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    perform app.registrar_evento(tg_table_name, new.id, 'status',
      jsonb_build_object('de', old.status, 'para', new.status));
  end if;
  return new;
end $$;

create trigger documentos_status after update of status on public.documentos
for each row execute function app.status_mudou();
create trigger alocacoes_status after update of status on public.alocacoes
for each row execute function app.status_mudou();

create or replace function app.depois_inserir_alocacao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform app.registrar_evento('alocacoes', new.id, 'criada', jsonb_build_object('obra_id', new.obra_id, 'origem', new.origem));
  return new;
end $$;
create trigger alocacoes_depois_inserir after insert on public.alocacoes
for each row execute function app.depois_inserir_alocacao();

-- Fornecedor só cria alocação em cadastro, e só em obra onde a empresa atua.
create or replace function app.antes_inserir_alocacao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not app.eh_admin() then
    new.status := 'em_cadastro';
    new.origem := 'portal';
    if not exists (
      select 1 from public.empresas_obras eo
      join public.colaboradores c on c.empresa_id = eo.empresa_id
      where c.id = new.colaborador_id and eo.obra_id = new.obra_id and eo.ativo
    ) then
      raise exception 'A empresa não está cadastrada nesta obra. Fale com a Emais.';
    end if;
  end if;
  return new;
end $$;
create trigger alocacoes_antes_inserir before insert on public.alocacoes
for each row execute function app.antes_inserir_alocacao();

-- Fornecedor não troca o colaborador de empresa.
create or replace function app.antes_alterar_colaborador() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.empresa_id is distinct from old.empresa_id and not app.eh_admin() and auth.uid() is not null then
    raise exception 'Não é possível trocar o colaborador de empresa';
  end if;
  if new.situacao <> 'ativo' and old.situacao = 'ativo' then
    update public.alocacoes set status = 'encerrado' where colaborador_id = new.id and status <> 'encerrado';
  end if;
  return new;
end $$;
create trigger colaboradores_antes_alterar before update on public.colaboradores
for each row execute function app.antes_alterar_colaborador();

-- Mudança de prazo ou de impeditivo exige motivo (gravado pela função alterar_tipo_documento).
create or replace function app.antes_alterar_tipo() returns trigger
language plpgsql security definer set search_path = public as $$
declare motivo text := nullif(current_setting('app.motivo', true), '');
begin
  if (new.validade_dias is distinct from old.validade_dias or new.impeditivo is distinct from old.impeditivo
      or new.regra is distinct from old.regra or new.ativo is distinct from old.ativo) then
    if motivo is null and auth.uid() is not null then
      raise exception 'Informe o motivo da alteração (use a função alterar_tipo_documento)';
    end if;
    if new.validade_dias is distinct from old.validade_dias then
      insert into public.tipos_documento_historico (codigo, campo, valor_anterior, valor_novo, motivo, alterado_por)
      values (new.codigo, 'validade_dias', old.validade_dias::text, new.validade_dias::text, coalesce(motivo, 'carga'), auth.uid());
    end if;
    if new.impeditivo is distinct from old.impeditivo then
      insert into public.tipos_documento_historico (codigo, campo, valor_anterior, valor_novo, motivo, alterado_por)
      values (new.codigo, 'impeditivo', old.impeditivo::text, new.impeditivo::text, coalesce(motivo, 'carga'), auth.uid());
    end if;
    if new.regra is distinct from old.regra then
      insert into public.tipos_documento_historico (codigo, campo, valor_anterior, valor_novo, motivo, alterado_por)
      values (new.codigo, 'regra', old.regra::text, new.regra::text, coalesce(motivo, 'carga'), auth.uid());
    end if;
    if new.ativo is distinct from old.ativo then
      insert into public.tipos_documento_historico (codigo, campo, valor_anterior, valor_novo, motivo, alterado_por)
      values (new.codigo, 'ativo', old.ativo::text, new.ativo::text, coalesce(motivo, 'carga'), auth.uid());
    end if;
  end if;
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end $$;
create trigger tipos_documento_antes_alterar before update on public.tipos_documento
for each row execute function app.antes_alterar_tipo();

-- ---------------------------------------------------------------------
-- 7. Visões: vencimentos, exigências e pendências
-- ---------------------------------------------------------------------
-- 7.1 Documento atual de cada chave = envio APROVADO de emissão mais recente.
create view public.v_documentos_atuais with (security_invoker = true) as
with atuais as (
  select distinct on (d.empresa_id, d.colaborador_id, d.tipo_codigo) d.*
  from public.documentos d
  where d.status = 'aprovado'
  order by d.empresa_id, d.colaborador_id, d.tipo_codigo,
           coalesce(d.data_emissao, d.data_vencimento_informada) desc nulls last, d.analisado_em desc
)
select
  a.id, a.tipo_codigo, t.nome as documento, t.grupo, t.area, t.impeditivo,
  a.empresa_id, a.colaborador_id, a.data_emissao, a.dispensado,
  case
    when a.dispensado then null
    when t.regra = 'emissao_mais_prazo' then a.data_emissao + t.validade_dias
    when t.regra = 'vigencia_informada' then a.data_vencimento_informada
  end as vencimento,
  v.dias_para_vencer,
  case
    when a.dispensado then 'dispensado'
    when v.dias_para_vencer is null then 'vigente'
    when v.dias_para_vencer <= 0 then 'vencido'
    when v.dias_para_vencer <= app.param_int('dias_a_vencer') then 'a_vencer'
    else 'vigente'
  end as situacao
from atuais a
join public.tipos_documento t on t.codigo = a.tipo_codigo
cross join lateral (
  select (case
            when a.dispensado then null
            when t.regra = 'emissao_mais_prazo' then a.data_emissao + t.validade_dias
            when t.regra = 'vigencia_informada' then a.data_vencimento_informada
          end) - current_date as dias_para_vencer
) v;

-- 7.2 Envio mais recente ainda não aprovado (em análise ou devolvido).
create view public.v_documentos_em_aberto with (security_invoker = true) as
select distinct on (d.empresa_id, d.colaborador_id, d.tipo_codigo)
  d.id, d.tipo_codigo, d.empresa_id, d.colaborador_id, d.status, d.motivo_devolucao, d.enviado_em
from public.documentos d
where d.status in ('em_analise', 'devolvido')
order by d.empresa_id, d.colaborador_id, d.tipo_codigo, d.enviado_em desc;

-- 7.3 O que cada alocação exige: documentos do colaborador (NRs só se a função
--     exige) + documentos da empresa (contrato só se subcontratada na obra).
create view public.v_exigencias with (security_invoker = true) as
select a.id as alocacao_id, a.obra_id, c.id as colaborador_id, c.empresa_id, t.codigo as tipo_codigo
from public.alocacoes a
join public.colaboradores c on c.id = a.colaborador_id
join public.tipos_documento t on t.ativo and t.enviado_pelo_fornecedor
left join public.empresas_obras eo on eo.empresa_id = c.empresa_id and eo.obra_id = a.obra_id
where a.status <> 'encerrado'
  and c.situacao = 'ativo'
  and (
    (t.grupo = 'colaborador' and (not t.depende_da_funcao or exists (
        select 1 from public.funcoes_documentos fd where fd.funcao_id = c.funcao_id and fd.tipo_codigo = t.codigo)))
    or
    (t.grupo = 'empresa' and (not t.so_subcontratada or coalesce(eo.subcontratada, false)))
  );

-- 7.4 Pendências por alocação e documento, com o motivo.
create view public.v_pendencias with (security_invoker = true) as
select
  e.alocacao_id, e.obra_id, e.colaborador_id, e.empresa_id, e.tipo_codigo,
  t.nome as documento, t.grupo, t.area, t.impeditivo,
  atual.vencimento, atual.dias_para_vencer,
  ab.status as status_envio_aberto, ab.motivo_devolucao,
  case
    -- um documento aprovado e válido continua valendo enquanto a renovação é analisada
    when atual.id is not null and atual.situacao <> 'vencido' then atual.situacao   -- vigente, a_vencer, dispensado
    when ab.status = 'devolvido'  then 'devolvido'
    when ab.status = 'em_analise' then 'em_analise'
    when atual.id is null         then 'nao_enviado'
    else 'vencido'
  end as situacao
from public.v_exigencias e
join public.tipos_documento t on t.codigo = e.tipo_codigo
left join public.v_documentos_atuais atual
  on atual.empresa_id = e.empresa_id and atual.tipo_codigo = e.tipo_codigo
 and atual.colaborador_id is not distinct from (case when t.grupo = 'colaborador' then e.colaborador_id end)
left join public.v_documentos_em_aberto ab
  on ab.empresa_id = e.empresa_id and ab.tipo_codigo = e.tipo_codigo
 and ab.colaborador_id is not distinct from (case when t.grupo = 'colaborador' then e.colaborador_id end);

-- 7.5 Resumo por alocação: o que trava, ADM x SST, e vencimento da integração.
create view public.v_alocacoes_resumo with (security_invoker = true) as
select
  a.id as alocacao_id, a.status, a.obra_id, o.nome as obra,
  c.id as colaborador_id, c.nome as colaborador, coalesce(f.nome, c.funcao_texto) as funcao,
  c.empresa_id, emp.razao_social as empresa,
  a.inicio_conferencia, a.aprovado_admin_em, a.validado_tst_em, a.data_integracao,
  a.data_integracao + (select validade_dias from public.tipos_documento where codigo = 'integracao') as vencimento_integracao,
  count(p.*) filter (where p.impeditivo and p.situacao in ('nao_enviado', 'em_analise', 'devolvido', 'vencido')) as impeditivos_pendentes,
  count(p.*) filter (where p.impeditivo and p.area = 'ADM' and p.situacao in ('nao_enviado', 'em_analise', 'devolvido', 'vencido')) as pendentes_adm,
  count(p.*) filter (where p.impeditivo and p.area = 'SST' and p.situacao in ('nao_enviado', 'em_analise', 'devolvido', 'vencido')) as pendentes_sst,
  count(p.*) filter (where p.situacao = 'devolvido') as devolvidos,
  count(p.*) filter (where p.situacao = 'em_analise') as em_analise,
  count(p.*) filter (where p.situacao = 'a_vencer') as a_vencer,
  extract(day from coalesce(a.aprovado_admin_em, now()) - a.inicio_conferencia)::integer as dias_em_analise
from public.alocacoes a
join public.colaboradores c on c.id = a.colaborador_id
join public.empresas emp on emp.id = c.empresa_id
join public.obras o on o.id = a.obra_id
left join public.funcoes f on f.id = c.funcao_id
left join public.v_pendencias p on p.alocacao_id = a.id
group by a.id, o.nome, c.id, f.nome, emp.razao_social;

-- ---------------------------------------------------------------------
-- 8. Ações (chamadas pelo portal via RPC)
-- ---------------------------------------------------------------------
-- Fornecedor: terminou de enviar, manda para análise.
create or replace function public.enviar_para_analise(p_alocacao uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.alocacoes;
begin
  select al.* into a from public.alocacoes al join public.colaboradores c on c.id = al.colaborador_id
  where al.id = p_alocacao and c.empresa_id in (select app.minhas_empresas());
  if a.id is null then raise exception 'Alocação não encontrada'; end if;
  if a.status not in ('em_cadastro', 'pendente_fornecedor') then raise exception 'Esta alocação já está em análise ou liberada'; end if;
  update public.alocacoes set status = 'em_analise', inicio_conferencia = coalesce(inicio_conferencia, now()) where id = p_alocacao;
end $$;

-- Administrador: aprova um documento.
create or replace function public.aprovar_documento(p_documento uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.eh_admin() then raise exception 'Apenas o administrador aprova documentos'; end if;
  update public.documentos set status = 'aprovado', analisado_por = auth.uid(), analisado_em = now(), motivo_devolucao = null
  where id = p_documento and status = 'em_analise';
  if not found then raise exception 'Documento não está em análise'; end if;
end $$;

-- Administrador: devolve um documento com motivo; as alocações afetadas voltam ao fornecedor.
create or replace function public.devolver_documento(p_documento uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare d public.documentos;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrador devolve documentos'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da devolução'; end if;
  update public.documentos set status = 'devolvido', motivo_devolucao = p_motivo, analisado_por = auth.uid(), analisado_em = now()
  where id = p_documento and status = 'em_analise' returning * into d;
  if d.id is null then raise exception 'Documento não está em análise'; end if;
  update public.alocacoes a set status = 'pendente_fornecedor'
  from public.colaboradores c
  where c.id = a.colaborador_id and a.status = 'em_analise'
    and (a.colaborador_id = d.colaborador_id or (d.colaborador_id is null and c.empresa_id = d.empresa_id));
end $$;

-- Administrador: aprova a alocação (primeira etapa). Exige zero impeditivo pendente.
create or replace function public.aprovar_alocacao(p_alocacao uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.v_alocacoes_resumo;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrador aprova'; end if;
  select * into r from public.v_alocacoes_resumo where alocacao_id = p_alocacao;
  if r.alocacao_id is null then raise exception 'Alocação não encontrada'; end if;
  if r.status <> 'em_analise' then raise exception 'A alocação precisa estar em análise'; end if;
  if r.impeditivos_pendentes > 0 then raise exception 'Ainda há % documento(s) impeditivo(s) pendente(s)', r.impeditivos_pendentes; end if;
  update public.alocacoes set status = 'aprovado_admin', aprovado_admin_por = auth.uid(), aprovado_admin_em = now() where id = p_alocacao;
end $$;

-- TST da obra: validação final (segunda etapa) -> liberado.
create or replace function public.validar_alocacao_tst(p_alocacao uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a public.alocacoes;
begin
  select * into a from public.alocacoes where id = p_alocacao;
  if a.id is null or a.obra_id not in (select app.minhas_obras_tst()) then raise exception 'Alocação fora das suas obras'; end if;
  if a.status <> 'aprovado_admin' then raise exception 'A alocação ainda não foi aprovada pelo administrador'; end if;
  update public.alocacoes set status = 'liberado', validado_tst_por = auth.uid(), validado_tst_em = now() where id = p_alocacao;
end $$;

-- TST da obra: devolve ao administrador com motivo (ponto em aberto 3 do PRD).
create or replace function public.devolver_alocacao_tst(p_alocacao uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare a public.alocacoes;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo'; end if;
  select * into a from public.alocacoes where id = p_alocacao;
  if a.id is null or a.obra_id not in (select app.minhas_obras_tst()) then raise exception 'Alocação fora das suas obras'; end if;
  if a.status <> 'aprovado_admin' then raise exception 'Só é possível devolver uma alocação aprovada pelo administrador'; end if;
  update public.alocacoes set status = 'em_analise', observacao = p_motivo, aprovado_admin_por = null, aprovado_admin_em = null where id = p_alocacao;
  perform app.registrar_evento('alocacoes', p_alocacao, 'devolvida_tst', jsonb_build_object('motivo', p_motivo));
end $$;

-- Administrador: registra a data da integração na obra.
create or replace function public.registrar_integracao(p_alocacao uuid, p_data date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.eh_admin() then raise exception 'Apenas o administrador registra a integração'; end if;
  if p_data > current_date then raise exception 'A data da integração não pode ser futura'; end if;
  update public.alocacoes set data_integracao = p_data where id = p_alocacao and status = 'liberado';
  if not found then raise exception 'A alocação precisa estar liberada'; end if;
  perform app.registrar_evento('alocacoes', p_alocacao, 'integracao', jsonb_build_object('data', p_data));
end $$;

-- Administrador: marca arquivos como baixados; o prazo de guarda começa a contar.
create or replace function public.registrar_download(p_arquivos uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare dias integer := app.param_int('dias_guarda_arquivo');
begin
  if not app.eh_admin() then raise exception 'Apenas o administrador baixa arquivos'; end if;
  update public.arquivos set baixado_em = coalesce(baixado_em, now()), baixado_por = coalesce(baixado_por, auth.uid()),
         apagar_apos = coalesce(apagar_apos, current_date + dias)
  where id = any (p_arquivos);
  insert into public.eventos (tabela, registro_id, acao, detalhe)
  select 'arquivos', id, 'download', jsonb_build_object('caminho', caminho) from public.arquivos where id = any (p_arquivos);
end $$;

-- Administrador: altera prazo ou impeditivo de um tipo, com motivo obrigatório.
create or replace function public.alterar_tipo_documento(p_codigo text, p_validade_dias integer, p_impeditivo boolean, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.eh_admin() then raise exception 'Apenas o administrador altera a tabela de prazos'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da alteração'; end if;
  perform set_config('app.motivo', p_motivo, true);
  update public.tipos_documento
  set validade_dias = coalesce(p_validade_dias, validade_dias), impeditivo = coalesce(p_impeditivo, impeditivo)
  where codigo = p_codigo;
  if not found then raise exception 'Tipo de documento % não existe', p_codigo; end if;
end $$;

-- Administrador: gera o e-mail de liberação pronto para envio pelo Outlook.
create or replace function public.gerar_aviso_liberacao(p_obra uuid, p_alocacoes uuid[], p_destinatarios text)
returns public.avisos_liberacao
language plpgsql security definer set search_path = public as $$
declare
  v public.avisos_liberacao;
  nome_obra text;
  lista text;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrador gera o aviso'; end if;
  select nome into nome_obra from public.obras where id = p_obra;
  select string_agg(format('- %s (%s) · %s', r.colaborador, coalesce(r.funcao, 'função não informada'), r.empresa), E'\n' order by r.empresa, r.colaborador)
    into lista
  from public.v_alocacoes_resumo r
  where r.alocacao_id = any (p_alocacoes) and r.obra_id = p_obra and r.status = 'liberado';
  if lista is null then raise exception 'Nenhuma alocação liberada nesta obra entre as selecionadas'; end if;
  insert into public.avisos_liberacao (obra_id, alocacoes, destinatarios, assunto, corpo)
  values (p_obra, p_alocacoes, p_destinatarios,
          format('Colaboradores liberados para integração · %s · %s', nome_obra, to_char(current_date, 'DD/MM/YYYY')),
          format(E'Olá,\n\nOs colaboradores abaixo estão liberados para a integração na obra %s:\n\n%s\n\nDocumentação conferida pelo Gente e Gestão e validada pela Segurança do Trabalho da obra.\n\nAtenciosamente,\nGente e Gestão · Grupo Emais', nome_obra, lista))
  returning * into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 9. Regras de acesso por linha (RLS)
-- ---------------------------------------------------------------------
alter table public.parametros                 enable row level security;
alter table public.tipos_documento            enable row level security;
alter table public.tipos_documento_historico  enable row level security;
alter table public.funcoes                    enable row level security;
alter table public.funcoes_documentos         enable row level security;
alter table public.obras                      enable row level security;
alter table public.empresas                   enable row level security;
alter table public.usuarios                   enable row level security;
alter table public.usuarios_empresas          enable row level security;
alter table public.tst_obras                  enable row level security;
alter table public.empresas_obras             enable row level security;
alter table public.colaboradores              enable row level security;
alter table public.alocacoes                  enable row level security;
alter table public.documentos                 enable row level security;
alter table public.arquivos                   enable row level security;
alter table public.eventos                    enable row level security;
alter table public.avisos_liberacao           enable row level security;

-- Configuração: todos os logados leem; só o admin escreve.
create policy leitura on public.parametros         for select to authenticated using (true);
create policy admin   on public.parametros         for all    to authenticated using (app.eh_admin()) with check (app.eh_admin());
create policy leitura on public.tipos_documento    for select to authenticated using (true);
create policy admin   on public.tipos_documento    for all    to authenticated using (app.eh_admin()) with check (app.eh_admin());
create policy admin   on public.tipos_documento_historico for select to authenticated using (app.eh_admin());
create policy leitura on public.funcoes            for select to authenticated using (true);
create policy admin   on public.funcoes            for all    to authenticated using (app.eh_admin()) with check (app.eh_admin());
create policy leitura on public.funcoes_documentos for select to authenticated using (true);
create policy admin   on public.funcoes_documentos for all    to authenticated using (app.eh_admin()) with check (app.eh_admin());
create policy leitura on public.obras              for select to authenticated using (true);
create policy admin   on public.obras              for all    to authenticated using (app.eh_admin()) with check (app.eh_admin());

-- Pessoas e vínculos
create policy proprio_ou_admin on public.usuarios          for select to authenticated using (id = auth.uid() or app.eh_admin());
create policy admin            on public.usuarios          for all    to authenticated using (app.eh_admin()) with check (app.eh_admin());
create policy proprio_ou_admin on public.usuarios_empresas for select to authenticated using (usuario_id = auth.uid() or app.eh_admin());
create policy admin            on public.usuarios_empresas for all    to authenticated using (app.eh_admin()) with check (app.eh_admin());
create policy proprio_ou_admin on public.tst_obras         for select to authenticated using (usuario_id = auth.uid() or app.eh_admin());
create policy admin            on public.tst_obras         for all    to authenticated using (app.eh_admin()) with check (app.eh_admin());

-- Empresas
create policy leitura on public.empresas for select to authenticated
  using (app.eh_admin() or id in (select app.minhas_empresas()) or app.tst_ve_empresa(id));
create policy admin   on public.empresas for all to authenticated using (app.eh_admin()) with check (app.eh_admin());

create policy leitura on public.empresas_obras for select to authenticated
  using (app.eh_admin() or empresa_id in (select app.minhas_empresas()) or obra_id in (select app.minhas_obras_tst()));
create policy admin   on public.empresas_obras for all to authenticated using (app.eh_admin()) with check (app.eh_admin());

-- Colaboradores
create policy leitura on public.colaboradores for select to authenticated
  using (app.eh_admin() or empresa_id in (select app.minhas_empresas()) or app.tst_ve_colaborador(id));
create policy inserir on public.colaboradores for insert to authenticated
  with check (app.eh_admin() or empresa_id in (select app.minhas_empresas()));
create policy alterar on public.colaboradores for update to authenticated
  using (app.eh_admin() or empresa_id in (select app.minhas_empresas()))
  with check (app.eh_admin() or empresa_id in (select app.minhas_empresas()));
create policy excluir on public.colaboradores for delete to authenticated using (app.eh_admin());

-- Alocações (mudança de status só pelas funções da seção 8)
create policy leitura on public.alocacoes for select to authenticated
  using (app.eh_admin()
         or obra_id in (select app.minhas_obras_tst())
         or colaborador_id in (select c.id from public.colaboradores c where c.empresa_id in (select app.minhas_empresas())));
create policy inserir on public.alocacoes for insert to authenticated
  with check (app.eh_admin()
              or colaborador_id in (select c.id from public.colaboradores c where c.empresa_id in (select app.minhas_empresas())));
create policy alterar on public.alocacoes for update to authenticated using (app.eh_admin()) with check (app.eh_admin());
create policy excluir on public.alocacoes for delete to authenticated
  using (app.eh_admin()
         or (status = 'em_cadastro' and colaborador_id in (select c.id from public.colaboradores c where c.empresa_id in (select app.minhas_empresas()))));

-- Documentos: fornecedor envia e acompanha; nunca altera um envio (reenvia um novo).
create policy leitura on public.documentos for select to authenticated
  using (app.eh_admin()
         or empresa_id in (select app.minhas_empresas())
         or (colaborador_id is not null and app.tst_ve_colaborador(colaborador_id))
         or (colaborador_id is null and app.tst_ve_empresa(empresa_id)));
create policy inserir on public.documentos for insert to authenticated
  with check (app.eh_admin() or empresa_id in (select app.minhas_empresas()));
create policy alterar on public.documentos for update to authenticated using (app.eh_admin()) with check (app.eh_admin());

-- Arquivos: só o admin lê. O fornecedor só registra o arquivo de um envio seu em análise.
create policy admin   on public.arquivos for all to authenticated using (app.eh_admin()) with check (app.eh_admin());
create policy inserir on public.arquivos for insert to authenticated
  with check (documento_id in (select d.id from public.documentos d
                               where d.status = 'em_analise' and d.empresa_id in (select app.minhas_empresas())));

-- Histórico e avisos: só o admin.
create policy admin on public.eventos          for select to authenticated using (app.eh_admin());
create policy admin on public.avisos_liberacao for all    to authenticated using (app.eh_admin()) with check (app.eh_admin());

-- Permissões de execução
revoke all on schema app from public;
grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;
revoke execute on function app.registrar_evento(text, uuid, text, jsonb) from authenticated;
revoke execute on function public.enviar_para_analise(uuid), public.aprovar_documento(uuid), public.devolver_documento(uuid, text),
  public.aprovar_alocacao(uuid), public.validar_alocacao_tst(uuid), public.devolver_alocacao_tst(uuid, text),
  public.registrar_integracao(uuid, date), public.registrar_download(uuid[]), public.alterar_tipo_documento(text, integer, boolean, text),
  public.gerar_aviso_liberacao(uuid, uuid[], text) from public, anon;
grant execute on function public.enviar_para_analise(uuid), public.aprovar_documento(uuid), public.devolver_documento(uuid, text),
  public.aprovar_alocacao(uuid), public.validar_alocacao_tst(uuid), public.devolver_alocacao_tst(uuid, text),
  public.registrar_integracao(uuid, date), public.registrar_download(uuid[]), public.alterar_tipo_documento(text, integer, boolean, text),
  public.gerar_aviso_liberacao(uuid, uuid[], text) to authenticated;

-- ---------------------------------------------------------------------
-- 10. Armazenamento de arquivos (bucket privado)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/heic'])
on conflict (id) do nothing;

-- Caminho: {empresa_id}/{documento_id}/{arquivo}
create policy "fornecedor envia arquivos da propria empresa" on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos'
              and (storage.foldername(name))[1] in (select e::text from app.minhas_empresas() e));
create policy "admin le arquivos" on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and app.eh_admin());
create policy "admin apaga arquivos" on storage.objects for delete to authenticated
  using (bucket_id = 'documentos' and app.eh_admin());

-- ---------------------------------------------------------------------
-- 11. Carga inicial de configuração
-- ---------------------------------------------------------------------
insert into public.parametros (chave, valor, descricao) values
  ('dias_a_vencer',       '30',      'A partir de quantos dias antes do vencimento o documento fica "a vencer"'),
  ('alertas_dias',        '30,15,0', 'Dias antes do vencimento em que saem os alertas (fase 2)'),
  ('dias_guarda_arquivo', '30',      'Dias que o arquivo fica no sistema depois do download, antes de ser apagado'),
  ('prazo_medicao_dia',   '25',      'Dia do mês seguinte para entrega da medição (fase 2)');

-- Prazos das fórmulas da planilha CONTROLE_DE_INTEGRAÇÃO.
-- "impeditivo" segue a fórmula atual da planilha; seguro de vida, vacinação e
-- contrato ficam como não impeditivos até a definição na configuração.
insert into public.tipos_documento
  (codigo, nome, grupo, area, regra, validade_dias, impeditivo, depende_da_funcao, so_subcontratada, pode_dispensar, enviado_pelo_fornecedor, ordem, observacao) values
  ('cartao_cnpj',  'Cartão CNPJ',                  'empresa',     'ADM', 'emissao_mais_prazo', 180, true,  false, false, false, true, 10, null),
  ('seguro_vida',  'Seguro de vida (apólice, comprovante e relação de segurados)', 'empresa', 'ADM', 'vigencia_informada', null, false, false, false, false, true, 20, 'Vence na vigência final informada. F.48 classifica como impeditivo.'),
  ('contrato_subcontratacao', 'Contrato de serviço entre as partes', 'empresa', 'ADM', 'sem_vencimento', null, false, false, true, false, true, 30, 'Só em subcontratação ou quarteirização'),
  ('pgr',          'PGR / Inventário de risco',    'empresa',     'SST', 'emissao_mais_prazo', 365, true,  false, false, false, true, 40, 'Prazo a validar com a Segurança do Trabalho'),
  ('pcmso',        'PCMSO',                        'empresa',     'SST', 'emissao_mais_prazo', 365, true,  false, false, false, true, 50, null),
  ('ltcat',        'LTCAT',                        'empresa',     'SST', 'emissao_mais_prazo', 730, true,  false, false, true,  true, 60, 'Pode ser dispensado (N/I na planilha)'),
  ('rg_cpf',       'RG e CPF ou CNH',              'colaborador', 'ADM', 'sem_vencimento',     null, true, false, false, false, true, 110, null),
  ('ctps',         'CTPS ou Carteira Digital',     'colaborador', 'ADM', 'sem_vencimento',     null, true, false, false, true,  true, 120, 'N/A na planilha para sócios e PJ'),
  ('ficha_registro','Ficha de registro assinada',  'colaborador', 'ADM', 'sem_vencimento',     null, true, false, false, true,  true, 130, null),
  ('esocial',      'eSocial',                      'colaborador', 'ADM', 'sem_vencimento',     null, true, false, false, true,  true, 140, null),
  ('aso',          'ASO',                          'colaborador', 'SST', 'emissao_mais_prazo', 365, true,  false, false, false, true, 150, 'Dado de saúde: arquivo só com o administrador'),
  ('os',           'Ordem de serviço (conforme PGR)', 'colaborador', 'SST', 'sem_vencimento',  null, true, false, false, false, true, 160, null),
  ('vacinacao',    'Carteira de vacinação',        'colaborador', 'SST', 'sem_vencimento',     null, false, false, false, false, true, 170, 'F.48 classifica como impeditivo'),
  ('epi',          'Ficha de EPI com C.A. vigentes','colaborador', 'SST', 'sem_vencimento',    null, true, false, false, false, true, 180, null),
  ('nr05',         'NR-05',                        'colaborador', 'SST', 'emissao_mais_prazo', 730, true,  true,  false, false, true, 205, 'Prazo a validar com a Segurança do Trabalho'),
  ('nr06',         'NR-06',                        'colaborador', 'SST', 'emissao_mais_prazo', 730, true,  true,  false, false, true, 206, 'Prazo a validar com a Segurança do Trabalho'),
  ('nr10',         'NR-10',                        'colaborador', 'SST', 'emissao_mais_prazo', 730, true,  true,  false, false, true, 210, 'Prazo a validar com a Segurança do Trabalho'),
  ('nr11',         'NR-11',                        'colaborador', 'SST', 'emissao_mais_prazo', 730, true,  true,  false, false, true, 211, 'Prazo a validar com a Segurança do Trabalho'),
  ('nr12',         'NR-12',                        'colaborador', 'SST', 'emissao_mais_prazo', 730, true,  true,  false, false, true, 212, 'Prazo a validar com a Segurança do Trabalho'),
  ('nr18',         'NR-18',                        'colaborador', 'SST', 'emissao_mais_prazo', 730, true,  true,  false, false, true, 218, 'Prazo a validar com a Segurança do Trabalho'),
  ('nr20',         'NR-20',                        'colaborador', 'SST', 'emissao_mais_prazo', 730, true,  true,  false, false, true, 220, 'Prazo a validar com a Segurança do Trabalho'),
  ('nr33',         'NR-33',                        'colaborador', 'SST', 'emissao_mais_prazo', 730, true,  true,  false, false, true, 233, 'Prazo a validar com a Segurança do Trabalho'),
  ('nr35',         'NR-35',                        'colaborador', 'SST', 'emissao_mais_prazo', 730, true,  true,  false, false, true, 235, 'Prazo a validar com a Segurança do Trabalho'),
  ('integracao',   'Integração na obra',           'obra',        'OBRA','emissao_mais_prazo', 365, false, false, false, false, false, 300, 'Registrada pela Emais depois da liberação');
