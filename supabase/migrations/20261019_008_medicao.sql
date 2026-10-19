-- Medição mensal (F.48): documentos que comprovam o pagamento dos terceiros.
--
-- Uma medição por empresa, obra e competência (mês trabalhado), com entrega até o dia 25 do mês
-- seguinte. Os itens da empresa (folha, guias e comprovantes) e os coletivos (holerites, pontos, VT)
-- chegam em arquivos; a Emais confere item por item e, nos coletivos, colaborador por colaborador.
-- Passado o prazo sem aprovação, a medição aparece como retida.

-- ---------------------------------------------------------------------
-- Configuração dos itens
-- ---------------------------------------------------------------------
create table public.tipos_medicao (
  codigo            text primary key,
  item              text not null,            -- numeração do F.48 (1, 1.1, 2...)
  nome              text not null,
  coletivo          boolean not null default false,  -- um arquivo para todos, conferido por colaborador
  conferencias      text[] not null default '{}',     -- marcações por colaborador ligadas a este item
  impeditivo        boolean not null default true,
  quando_aplicavel  boolean not null default false,   -- o fornecedor pode marcar "não se aplica"
  ativo             boolean not null default true,
  ordem             integer not null
);

insert into public.tipos_medicao (codigo, item, nome, coletivo, conferencias, impeditivo, quando_aplicavel, ordem) values
  ('holerite',       '1',   'Holerite e comprovante de pagamento',                              true,  '{holerite,pg_holerite}', true, false, 10),
  ('adiantamento',   '1.1', 'Adiantamento salarial e comprovante de pagamento',                 true,  '{vale,pg_vale}',         true, true,  11),
  ('cartao_ponto',   '2',   'Cartão de ponto assinado',                                         true,  '{ponto}',                true, false, 20),
  ('folha',          '3',   'Folha de pagamento',                                               false, '{}',                     true, false, 30),
  ('vt',             '4',   'Comprovante de entrega de VT',                                     true,  '{vt}',                   true, true,  40),
  ('fgts_detalhe',   '5',   'Detalhe da guia do FGTS Digital (trabalhadores da CNO)',           false, '{re}',                   true, false, 50),
  ('fgts_guia',      '6',   'Guia do FGTS',                                                     false, '{}',                     true, false, 60),
  ('fgts_pagamento', '6.1', 'Comprovante de pagamento do FGTS',                                 false, '{}',                     true, false, 61),
  ('dctfweb',        '7',   'DCTFWeb mensal',                                                   false, '{}',                     true, false, 70),
  ('inss_guia',      '8',   'Guia do INSS',                                                     false, '{}',                     true, false, 80),
  ('inss_pagamento', '8.1', 'Comprovante de pagamento do INSS',                                 false, '{}',                     true, false, 81),
  ('darf_guia',      '9',   'DARF mensal',                                                      false, '{}',                     true, false, 90),
  ('darf_pagamento', '9.1', 'Comprovante de pagamento do DARF',                                 false, '{}',                     true, false, 91),
  ('seguro_vida',    '10',  'Seguro de vida (apólice, comprovante e relação de segurados)',     false, '{}',                     true, false, 100),
  ('rescisao',       '11',  'Documentos rescisórios',                                           false, '{}',                     true, true,  110);

-- E-mail para cobrança (a planilha tem a relação por empresa; o acesso ao portal pode ser outro).
alter table public.empresas add column if not exists email_contato text;

-- ---------------------------------------------------------------------
-- Medição
-- ---------------------------------------------------------------------
create type public.status_medicao as enum ('aberta', 'em_analise', 'pendente_fornecedor', 'aprovada');
create type public.status_item_medicao as enum ('nao_enviado', 'em_analise', 'aprovado', 'devolvido', 'nao_aplica');
create type public.situacao_colaborador_medicao as enum ('trabalhou', 'rescisao', 'dono', 'pj', 'afastado');

create table public.medicoes (
  id                    uuid primary key default gen_random_uuid(),
  empresa_id            uuid not null references public.empresas (id),
  obra_id               uuid references public.obras (id),   -- nulo só no histórico da planilha (sem obra)
  competencia           date not null check (extract(day from competencia) = 1),
  prazo                 date not null,
  status                public.status_medicao not null default 'aberta',
  primeiro_envio_em     timestamptz,
  enviada_em            timestamptz,
  conferente            text,
  ultima_analise_em     timestamptz,
  ultima_cobranca_em    timestamptz,
  observacao            text,
  qtd_colaboradores     integer,
  origem                public.origem_registro not null default 'portal',
  criado_por            uuid default auth.uid(),
  criado_em             timestamptz not null default now()
);
create unique index medicao_unica on public.medicoes (empresa_id, coalesce(obra_id, '00000000-0000-0000-0000-000000000000'::uuid), competencia);
create index medicoes_competencia on public.medicoes (competencia, status);

create table public.medicoes_itens (
  id             uuid primary key default gen_random_uuid(),
  medicao_id     uuid not null references public.medicoes (id) on delete cascade,
  tipo_codigo    text not null references public.tipos_medicao (codigo),
  status         public.status_item_medicao not null default 'nao_enviado',
  versao         integer not null default 0,
  justificativa  text,              -- quando o fornecedor marca "não se aplica"
  motivo_devolucao text,
  enviado_em     timestamptz,
  analisado_em   timestamptz,
  analisado_por  uuid,
  unique (medicao_id, tipo_codigo)
);

create table public.medicoes_arquivos (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references public.medicoes_itens (id) on delete cascade,
  versao         integer not null,
  caminho        text not null unique,   -- {empresa_id}/medicao/{medicao_id}/{tipo}/{versao}-{arquivo}
  nome_original  text not null,
  tamanho_bytes  bigint,
  tipo_mime      text,
  enviado_em     timestamptz not null default now(),
  baixado_em     timestamptz,
  baixado_por    uuid,
  apagar_apos    date,
  apagado_em     timestamptz
);

-- Colaboradores do mês e a conferência de cada um nos itens coletivos.
-- conferencia: {"holerite": "ok" | "pendente" | "na", "pg_holerite": ..., "vale", "pg_vale", "vt", "ponto", "re"}
create table public.medicoes_colaboradores (
  id              uuid primary key default gen_random_uuid(),
  medicao_id      uuid not null references public.medicoes (id) on delete cascade,
  colaborador_id  uuid references public.colaboradores (id),
  nome            text not null,
  situacao        public.situacao_colaborador_medicao not null default 'trabalhou',
  conferencia     jsonb not null default '{}'::jsonb,
  observacao      text
);
create unique index medicao_colaborador_unico on public.medicoes_colaboradores (medicao_id, colaborador_id) where colaborador_id is not null;

-- ---------------------------------------------------------------------
-- Visão: situação de cada medição, com prazo e pendências
-- ---------------------------------------------------------------------
create view public.v_medicoes with (security_invoker = true) as
select
  m.id, m.empresa_id, e.razao_social as empresa, e.cnpj, coalesce(e.email_contato, e.email_acesso) as email_cobranca,
  m.obra_id, o.nome as obra, m.competencia, m.prazo, m.status, m.primeiro_envio_em, m.enviada_em,
  m.conferente, m.ultima_analise_em, m.ultima_cobranca_em, m.observacao, m.origem,
  coalesce(m.qtd_colaboradores, (select count(*) from public.medicoes_colaboradores c where c.medicao_id = m.id))::integer as qtd_colaboradores,
  (m.primeiro_envio_em is not null and (m.primeiro_envio_em at time zone 'America/Sao_Paulo')::date <= m.prazo) as entregue_no_prazo,
  (m.status <> 'aprovada' and current_date > m.prazo) as retida,
  (select count(*) from public.medicoes_itens i join public.tipos_medicao t on t.codigo = i.tipo_codigo
    where i.medicao_id = m.id and t.impeditivo and i.status in ('nao_enviado', 'devolvido'))::integer as itens_pendentes,
  (select count(*) from public.medicoes_itens i where i.medicao_id = m.id and i.status = 'em_analise')::integer as itens_em_analise,
  (select count(*) from public.medicoes_itens i where i.medicao_id = m.id and i.status = 'devolvido')::integer as itens_devolvidos,
  (select count(*) from public.medicoes_colaboradores c
    where c.medicao_id = m.id and exists (select 1 from jsonb_each_text(c.conferencia) x where x.value = 'pendente'))::integer as colaboradores_pendentes
from public.medicoes m
join public.empresas e on e.id = m.empresa_id
left join public.obras o on o.id = m.obra_id;

-- ---------------------------------------------------------------------
-- Regras de acesso: leitura para o administrativo e para o fornecedor da empresa.
-- Gravação só pelas funções abaixo.
-- ---------------------------------------------------------------------
alter table public.tipos_medicao enable row level security;
alter table public.medicoes enable row level security;
alter table public.medicoes_itens enable row level security;
alter table public.medicoes_arquivos enable row level security;
alter table public.medicoes_colaboradores enable row level security;

create policy leitura on public.tipos_medicao for select to authenticated using (true);
create policy admin   on public.tipos_medicao for all to authenticated using ((select app.eh_admin())) with check ((select app.eh_admin()));

create policy leitura on public.medicoes for select to authenticated
  using ((select app.eh_admin()) or empresa_id in (select app.minhas_empresas()));
create policy leitura on public.medicoes_itens for select to authenticated
  using (medicao_id in (select m.id from public.medicoes m where (select app.eh_admin()) or m.empresa_id in (select app.minhas_empresas())));
create policy leitura on public.medicoes_colaboradores for select to authenticated
  using (medicao_id in (select m.id from public.medicoes m where (select app.eh_admin()) or m.empresa_id in (select app.minhas_empresas())));
-- Arquivos: o fornecedor vê nome e data do que enviou; abrir o arquivo continua só com o administrativo (armazenamento).
create policy leitura on public.medicoes_arquivos for select to authenticated
  using (item_id in (select i.id from public.medicoes_itens i join public.medicoes m on m.id = i.medicao_id
                     where (select app.eh_admin()) or m.empresa_id in (select app.minhas_empresas())));

grant select on public.tipos_medicao, public.medicoes, public.medicoes_itens, public.medicoes_arquivos, public.medicoes_colaboradores, public.v_medicoes to authenticated;

-- ---------------------------------------------------------------------
-- Funções
-- ---------------------------------------------------------------------
create or replace function app.pode_medicao(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.eh_admin() or p_empresa in (select app.minhas_empresas());
$$;

-- Abre (ou devolve a já aberta) a medição da empresa na obra e no mês.
-- Traz os colaboradores liberados na obra; o fornecedor ajusta depois.
create or replace function public.abrir_medicao(p_empresa uuid, p_obra uuid, p_competencia date) returns public.medicoes
language plpgsql security definer set search_path = public as $$
declare
  m public.medicoes;
  comp date := date_trunc('month', p_competencia)::date;
  dia integer := coalesce(app.param_int('prazo_medicao_dia'), 25);
begin
  if not app.pode_medicao(p_empresa) then raise exception 'Empresa fora do seu acesso'; end if;
  if comp > date_trunc('month', current_date)::date then raise exception 'A competência não pode ser futura'; end if;
  if not exists (select 1 from public.empresas_obras where empresa_id = p_empresa and obra_id = p_obra and ativo) then
    raise exception 'A empresa não está cadastrada nesta obra';
  end if;

  select * into m from public.medicoes where empresa_id = p_empresa and obra_id = p_obra and competencia = comp;
  if m.id is not null then return m; end if;

  insert into public.medicoes (empresa_id, obra_id, competencia, prazo)
  values (p_empresa, p_obra, comp, (comp + interval '1 month')::date + (dia - 1))
  returning * into m;

  insert into public.medicoes_itens (medicao_id, tipo_codigo)
  select m.id, t.codigo from public.tipos_medicao t where t.ativo;

  insert into public.medicoes_colaboradores (medicao_id, colaborador_id, nome)
  select distinct on (c.id) m.id, c.id, c.nome
  from public.alocacoes a join public.colaboradores c on c.id = a.colaborador_id
  where a.obra_id = p_obra and c.empresa_id = p_empresa and a.status in ('liberado', 'aprovado_admin', 'em_analise')
    and c.situacao = 'ativo';

  perform app.registrar_evento('medicoes', m.id, 'aberta', jsonb_build_object('competencia', comp));
  return m;
end $$;

create or replace function app.medicao_editavel_pelo_fornecedor(p_medicao uuid) returns public.medicoes
language plpgsql stable security definer set search_path = public as $$
declare m public.medicoes;
begin
  select * into m from public.medicoes where id = p_medicao;
  if m.id is null or not app.pode_medicao(m.empresa_id) then raise exception 'Medição não encontrada'; end if;
  if not app.eh_admin() and m.status not in ('aberta', 'pendente_fornecedor') then
    raise exception 'A medição está em conferência na Emais. Aguarde a análise.';
  end if;
  return m;
end $$;

-- Fornecedor: situação de um colaborador no mês (ou inclui alguém da empresa que não estava na lista).
create or replace function public.definir_colaborador_medicao(p_medicao uuid, p_colaborador uuid, p_situacao public.situacao_colaborador_medicao, p_observacao text default null)
returns void language plpgsql security definer set search_path = public as $$
declare m public.medicoes; c public.colaboradores;
begin
  m := app.medicao_editavel_pelo_fornecedor(p_medicao);
  select * into c from public.colaboradores where id = p_colaborador;
  if c.id is null or c.empresa_id <> m.empresa_id then raise exception 'Colaborador não é desta empresa'; end if;
  insert into public.medicoes_colaboradores (medicao_id, colaborador_id, nome, situacao, observacao)
  values (p_medicao, c.id, c.nome, p_situacao, nullif(trim(p_observacao), ''))
  on conflict (medicao_id, colaborador_id) where colaborador_id is not null
  do update set situacao = excluded.situacao, observacao = coalesce(excluded.observacao, medicoes_colaboradores.observacao);
end $$;

-- Fornecedor: envia (ou reenvia) os arquivos de um item, ou marca "não se aplica".
create or replace function public.enviar_item_medicao(p_medicao uuid, p_tipo text, p_arquivos jsonb, p_nao_aplica boolean, p_justificativa text)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.medicoes;
  t public.tipos_medicao;
  i public.medicoes_itens;
  arq jsonb;
  prefixo text;
begin
  m := app.medicao_editavel_pelo_fornecedor(p_medicao);
  select * into t from public.tipos_medicao where codigo = p_tipo;
  select * into i from public.medicoes_itens where medicao_id = p_medicao and tipo_codigo = p_tipo;
  if i.id is null then raise exception 'Item não encontrado'; end if;
  if i.status = 'aprovado' then raise exception '% já foi aprovado', t.nome; end if;

  if coalesce(p_nao_aplica, false) then
    if not t.quando_aplicavel then raise exception '% é obrigatório', t.nome; end if;
    if coalesce(trim(p_justificativa), '') = '' then raise exception 'Explique por que não se aplica'; end if;
    update public.medicoes_itens set status = 'em_analise', justificativa = trim(p_justificativa), motivo_devolucao = null,
           enviado_em = now(), versao = versao + 1 where id = i.id;
  else
    if jsonb_array_length(coalesce(p_arquivos, '[]'::jsonb)) = 0 then raise exception 'Anexe o arquivo de %', t.nome; end if;
    prefixo := m.empresa_id::text || '/medicao/' || m.id::text || '/' || p_tipo || '/' || (i.versao + 1)::text || '-';
    for arq in select * from jsonb_array_elements(p_arquivos) loop
      if left(arq->>'caminho', length(prefixo)) <> prefixo then raise exception 'Arquivo fora da pasta da medição'; end if;
      insert into public.medicoes_arquivos (item_id, versao, caminho, nome_original, tamanho_bytes, tipo_mime)
      values (i.id, i.versao + 1, arq->>'caminho', arq->>'nome', (arq->>'tamanho')::bigint, arq->>'tipo');
    end loop;
    update public.medicoes_itens set status = 'em_analise', justificativa = null, motivo_devolucao = null,
           enviado_em = now(), versao = versao + 1 where id = i.id;
  end if;
  perform app.registrar_evento('medicoes_itens', i.id, 'enviado', jsonb_build_object('tipo', p_tipo, 'nao_aplica', coalesce(p_nao_aplica, false)));
end $$;

-- Fornecedor: manda a medição para a conferência da Emais.
create or replace function public.enviar_medicao(p_medicao uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.medicoes; faltando text;
begin
  m := app.medicao_editavel_pelo_fornecedor(p_medicao);
  if m.status not in ('aberta', 'pendente_fornecedor') then raise exception 'A medição já está em conferência'; end if;
  select string_agg(t.item || '. ' || t.nome, '; ' order by t.ordem) into faltando
  from public.medicoes_itens i join public.tipos_medicao t on t.codigo = i.tipo_codigo
  where i.medicao_id = p_medicao and t.impeditivo and i.status in ('nao_enviado', 'devolvido');
  if faltando is not null then raise exception 'Antes de enviar, falta: %', faltando; end if;
  if not exists (select 1 from public.medicoes_colaboradores where medicao_id = p_medicao) then
    raise exception 'Informe os colaboradores que trabalharam na obra no mês';
  end if;
  update public.medicoes set status = 'em_analise', enviada_em = now(), primeiro_envio_em = coalesce(primeiro_envio_em, now()) where id = p_medicao;
  perform app.registrar_evento('medicoes', p_medicao, 'enviada', '{}'::jsonb);
end $$;

-- Administrativo: aprova ou devolve um item.
create or replace function public.avaliar_item_medicao(p_item uuid, p_aprovar boolean, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare i public.medicoes_itens;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrativo confere a medição'; end if;
  select * into i from public.medicoes_itens where id = p_item;
  if i.id is null then raise exception 'Item não encontrado'; end if;
  if p_aprovar then
    if i.status <> 'em_analise' then raise exception 'Só é possível aprovar um item enviado'; end if;
    update public.medicoes_itens set status = case when i.justificativa is not null and i.status = 'em_analise' then 'nao_aplica'::public.status_item_medicao else 'aprovado' end,
           motivo_devolucao = null, analisado_em = now(), analisado_por = auth.uid() where id = p_item;
  else
    if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da devolução'; end if;
    update public.medicoes_itens set status = 'devolvido', motivo_devolucao = trim(p_motivo), analisado_em = now(), analisado_por = auth.uid() where id = p_item;
  end if;
  update public.medicoes set ultima_analise_em = now(), conferente = (select nome from public.usuarios where id = auth.uid()) where id = i.medicao_id;
end $$;

-- Administrativo: conferência de um colaborador nos itens coletivos.
create or replace function public.conferir_colaborador_medicao(p_linha uuid, p_conferencia jsonb, p_situacao public.situacao_colaborador_medicao default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app.eh_admin() then raise exception 'Apenas o administrativo confere a medição'; end if;
  if exists (select 1 from jsonb_each_text(coalesce(p_conferencia, '{}')) x where x.value not in ('ok', 'pendente', 'na')) then
    raise exception 'Marcação inválida';
  end if;
  update public.medicoes_colaboradores
  set conferencia = coalesce(p_conferencia, '{}'), situacao = coalesce(p_situacao, situacao)
  where id = p_linha;
end $$;

-- Administrativo: fecha a conferência. Tudo certo = aprovada; senão volta ao fornecedor.
create or replace function public.concluir_conferencia_medicao(p_medicao uuid) returns public.status_medicao
language plpgsql security definer set search_path = public as $$
declare
  m public.medicoes;
  em_aberto integer;
  pendentes integer;
  novo public.status_medicao;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrativo confere a medição'; end if;
  select * into m from public.medicoes where id = p_medicao;
  if m.id is null then raise exception 'Medição não encontrada'; end if;
  select count(*) into em_aberto from public.medicoes_itens where medicao_id = p_medicao and status = 'em_analise';
  if em_aberto > 0 then raise exception 'Ainda há % item(ns) sem conferência', em_aberto; end if;

  select count(*) into pendentes
  from public.medicoes_itens i join public.tipos_medicao t on t.codigo = i.tipo_codigo
  where i.medicao_id = p_medicao and t.impeditivo and i.status in ('nao_enviado', 'devolvido');
  pendentes := pendentes + (select count(*) from public.medicoes_colaboradores c
                            where c.medicao_id = p_medicao and exists (select 1 from jsonb_each_text(c.conferencia) x where x.value = 'pendente'));

  novo := case when pendentes = 0 then 'aprovada' else 'pendente_fornecedor' end;
  update public.medicoes set status = novo, ultima_analise_em = now(),
         conferente = (select nome from public.usuarios where id = auth.uid()) where id = p_medicao;
  perform app.registrar_evento('medicoes', p_medicao, 'conferida', jsonb_build_object('status', novo, 'pendencias', pendentes));
  return novo;
end $$;

create or replace function public.registrar_cobranca_medicao(p_medicoes uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.eh_admin() then raise exception 'Apenas o administrativo registra cobranças'; end if;
  update public.medicoes set ultima_cobranca_em = now() where id = any (p_medicoes);
end $$;

-- Administrativo: arquivos baixados para o SharePoint; o prazo de guarda começa a contar.
create or replace function public.registrar_download_medicao(p_arquivos uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare dias integer := app.param_int('dias_guarda_arquivo');
begin
  if not app.eh_admin() then raise exception 'Apenas o administrador baixa arquivos'; end if;
  update public.medicoes_arquivos set baixado_em = coalesce(baixado_em, now()), baixado_por = coalesce(baixado_por, auth.uid()),
         apagar_apos = coalesce(apagar_apos, current_date + dias)
  where id = any (p_arquivos);
end $$;

revoke all on function public.abrir_medicao(uuid, uuid, date) from public, anon;
revoke all on function public.definir_colaborador_medicao(uuid, uuid, public.situacao_colaborador_medicao, text) from public, anon;
revoke all on function public.enviar_item_medicao(uuid, text, jsonb, boolean, text) from public, anon;
revoke all on function public.enviar_medicao(uuid) from public, anon;
revoke all on function public.avaliar_item_medicao(uuid, boolean, text) from public, anon;
revoke all on function public.conferir_colaborador_medicao(uuid, jsonb, public.situacao_colaborador_medicao) from public, anon;
revoke all on function public.concluir_conferencia_medicao(uuid) from public, anon;
revoke all on function public.registrar_cobranca_medicao(uuid[]) from public, anon;
revoke all on function public.registrar_download_medicao(uuid[]) from public, anon;
grant execute on function public.abrir_medicao(uuid, uuid, date) to authenticated;
grant execute on function public.definir_colaborador_medicao(uuid, uuid, public.situacao_colaborador_medicao, text) to authenticated;
grant execute on function public.enviar_item_medicao(uuid, text, jsonb, boolean, text) to authenticated;
grant execute on function public.enviar_medicao(uuid) to authenticated;
grant execute on function public.avaliar_item_medicao(uuid, boolean, text) to authenticated;
grant execute on function public.conferir_colaborador_medicao(uuid, jsonb, public.situacao_colaborador_medicao) to authenticated;
grant execute on function public.concluir_conferencia_medicao(uuid) to authenticated;
grant execute on function public.registrar_cobranca_medicao(uuid[]) to authenticated;
grant execute on function public.registrar_download_medicao(uuid[]) to authenticated;
grant execute on function app.pode_medicao(uuid) to authenticated;
grant execute on function app.medicao_editavel_pelo_fornecedor(uuid) to authenticated;
