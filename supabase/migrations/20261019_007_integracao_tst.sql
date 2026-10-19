-- Integração na obra conduzida pelo TST.
--
-- O TST (ou o administrativo) monta uma turma de integração com os liberados da obra, baixa a
-- lista de presença em PDF para colher as assinaturas e, depois da integração, confirma quem
-- esteve presente. Só os presentes recebem a data da integração.

create table public.integracoes (
  id            uuid primary key default gen_random_uuid(),
  obra_id       uuid not null references public.obras (id),
  data          date not null,
  horario       text,
  local         text,
  responsavel   text not null,
  criado_por    uuid default auth.uid(),
  criado_em     timestamptz not null default now(),
  concluida_em  timestamptz,
  concluida_por uuid,
  cancelada_em  timestamptz
);
create index integracoes_obra on public.integracoes (obra_id, data desc);

create table public.integracoes_participantes (
  integracao_id uuid not null references public.integracoes (id) on delete cascade,
  alocacao_id   uuid not null references public.alocacoes (id) on delete cascade,
  presente      boolean,
  primary key (integracao_id, alocacao_id)
);
create index integracoes_participantes_alocacao on public.integracoes_participantes (alocacao_id);

alter table public.integracoes enable row level security;
alter table public.integracoes_participantes enable row level security;

-- Leitura: administrativo e TST da obra. Gravação só pelas funções abaixo.
create policy leitura on public.integracoes for select to authenticated
  using ((select app.eh_admin()) or obra_id in (select app.minhas_obras_tst()));
create policy leitura on public.integracoes_participantes for select to authenticated
  using (integracao_id in (select i.id from public.integracoes i
                           where (select app.eh_admin()) or i.obra_id in (select app.minhas_obras_tst())));

grant select on public.integracoes, public.integracoes_participantes to authenticated;

create or replace function app.pode_integrar(p_obra uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.eh_admin() or p_obra in (select app.minhas_obras_tst());
$$;

-- Monta a turma e devolve o registro (o PDF é gerado no navegador com estes dados).
create or replace function public.criar_integracao(
  p_obra uuid, p_data date, p_horario text, p_local text, p_responsavel text, p_alocacoes uuid[]
) returns public.integracoes
language plpgsql security definer set search_path = public as $$
declare
  i public.integracoes;
  invalidas integer;
begin
  if not app.pode_integrar(p_obra) then raise exception 'Obra fora do seu acesso'; end if;
  if p_data is null then raise exception 'Informe a data da integração'; end if;
  if coalesce(trim(p_responsavel), '') = '' then raise exception 'Informe o responsável pela integração'; end if;
  if coalesce(array_length(p_alocacoes, 1), 0) = 0 then raise exception 'Escolha pelo menos um participante'; end if;

  select count(*) into invalidas
  from unnest(p_alocacoes) x(id)
  left join public.alocacoes a on a.id = x.id and a.obra_id = p_obra and a.status = 'liberado'
  where a.id is null;
  if invalidas > 0 then raise exception 'Só entram na integração colaboradores liberados nesta obra'; end if;

  insert into public.integracoes (obra_id, data, horario, local, responsavel)
  values (p_obra, p_data, nullif(trim(p_horario), ''), nullif(trim(p_local), ''), trim(p_responsavel))
  returning * into i;

  insert into public.integracoes_participantes (integracao_id, alocacao_id)
  select i.id, x.id from (select distinct unnest(p_alocacoes) as id) x;

  perform app.registrar_evento('integracoes', i.id, 'criada', jsonb_build_object('participantes', array_length(p_alocacoes, 1)));
  return i;
end $$;

-- Confirma a presença. Os presentes recebem a data da integração.
create or replace function public.concluir_integracao(p_integracao uuid, p_presentes uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  i public.integracoes;
  qtd integer;
begin
  select * into i from public.integracoes where id = p_integracao;
  if i.id is null or not app.pode_integrar(i.obra_id) then raise exception 'Integração não encontrada'; end if;
  if i.concluida_em is not null then raise exception 'Esta integração já foi concluída'; end if;
  if i.cancelada_em is not null then raise exception 'Esta integração foi cancelada'; end if;
  if i.data > current_date then raise exception 'A integração está marcada para %. Confirme a presença no dia ou depois.', to_char(i.data, 'DD/MM/YYYY'); end if;

  update public.integracoes_participantes
  set presente = (alocacao_id = any (coalesce(p_presentes, '{}')))
  where integracao_id = p_integracao;

  update public.alocacoes a set data_integracao = i.data
  from public.integracoes_participantes p
  where p.integracao_id = p_integracao and p.presente and a.id = p.alocacao_id and a.status = 'liberado';
  get diagnostics qtd = row_count;

  update public.integracoes set concluida_em = now(), concluida_por = auth.uid() where id = p_integracao;
  perform app.registrar_evento('integracoes', p_integracao, 'concluida', jsonb_build_object('presentes', qtd));
  return qtd;
end $$;

create or replace function public.cancelar_integracao(p_integracao uuid) returns void
language plpgsql security definer set search_path = public as $$
declare i public.integracoes;
begin
  select * into i from public.integracoes where id = p_integracao;
  if i.id is null or not app.pode_integrar(i.obra_id) then raise exception 'Integração não encontrada'; end if;
  if i.concluida_em is not null then raise exception 'Uma integração concluída não pode ser cancelada'; end if;
  update public.integracoes set cancelada_em = now() where id = p_integracao;
  perform app.registrar_evento('integracoes', p_integracao, 'cancelada', '{}'::jsonb);
end $$;

-- Registro avulso de integração: passa a valer também para o TST da obra.
create or replace function public.registrar_integracao(p_alocacao uuid, p_data date) returns void
language plpgsql security definer set search_path = public as $$
declare a public.alocacoes;
begin
  select * into a from public.alocacoes where id = p_alocacao;
  if a.id is null or not app.pode_integrar(a.obra_id) then raise exception 'Apenas o administrativo ou o TST da obra registra a integração'; end if;
  if p_data > current_date then raise exception 'A data da integração não pode ser futura'; end if;
  if a.status <> 'liberado' then raise exception 'A alocação precisa estar liberada'; end if;
  update public.alocacoes set data_integracao = p_data where id = p_alocacao;
  perform app.registrar_evento('alocacoes', p_alocacao, 'integracao', jsonb_build_object('data', p_data));
end $$;

revoke all on function public.criar_integracao(uuid, date, text, text, text, uuid[]) from public, anon;
revoke all on function public.concluir_integracao(uuid, uuid[]) from public, anon;
revoke all on function public.cancelar_integracao(uuid) from public, anon;
grant execute on function public.criar_integracao(uuid, date, text, text, text, uuid[]) to authenticated;
grant execute on function public.concluir_integracao(uuid, uuid[]) to authenticated;
grant execute on function public.cancelar_integracao(uuid) to authenticated;
grant execute on function app.pode_integrar(uuid) to authenticated;
