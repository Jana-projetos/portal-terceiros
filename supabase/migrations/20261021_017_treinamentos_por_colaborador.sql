-- Obrigatoriedade dos treinamentos (NR) por colaborador, definida pelo administrativo.
--
-- A regra padrão continua vindo da função (funcoes_documentos). Para um colaborador específico o
-- administrativo pode marcar uma NR como obrigatória a mais (exige = true) ou como não obrigatória
-- (exige = false), sempre com o motivo. Só vale para os documentos que dependem da função (as NRs).
-- Sem registro, vale a função.

alter table public.colaboradores_documentos_extras add column if not exists exige boolean not null default true;
comment on table public.colaboradores_documentos_extras is
  'Exceção à regra da função para um colaborador: exige = true torna a NR obrigatória, exige = false tira a obrigatoriedade.';

-- Confere o tipo e registra a mudança no histórico do colaborador.
create or replace function app.extras_antes_gravar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.tipos_documento t where t.codigo = new.tipo_codigo and t.depende_da_funcao) then
    raise exception 'Só os treinamentos que dependem da função podem ser ajustados por colaborador';
  end if;
  if coalesce(btrim(new.motivo), '') = '' then
    raise exception 'Informe o motivo da alteração';
  end if;
  new.incluido_por := auth.uid();
  new.incluido_em := now();
  return new;
end $$;

create or replace function app.extras_registrar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  perform app.registrar_evento('colaboradores', r.colaborador_id,
    case when tg_op = 'DELETE' then 'treinamento_regra_da_funcao' else 'treinamento_ajustado' end,
    jsonb_build_object('tipo', r.tipo_codigo, 'exige', case when tg_op = 'DELETE' then null else r.exige end, 'motivo', r.motivo));
  return null;
end $$;

drop trigger if exists extras_antes_gravar on public.colaboradores_documentos_extras;
create trigger extras_antes_gravar before insert or update on public.colaboradores_documentos_extras
  for each row execute function app.extras_antes_gravar();

drop trigger if exists extras_registrar on public.colaboradores_documentos_extras;
create trigger extras_registrar after insert or update or delete on public.colaboradores_documentos_extras
  for each row execute function app.extras_registrar();

-- Exigências: a função manda, a não ser que o colaborador tenha exceção.
create or replace view public.v_exigencias with (security_invoker = true) as
select a.id as alocacao_id, a.obra_id, c.id as colaborador_id, c.empresa_id, t.codigo as tipo_codigo
from public.alocacoes a
join public.colaboradores c on c.id = a.colaborador_id
join public.tipos_documento t on t.ativo and t.enviado_pelo_fornecedor
left join public.empresas_obras eo on eo.empresa_id = c.empresa_id and eo.obra_id = a.obra_id
left join public.colaboradores_documentos_extras x on x.colaborador_id = c.id and x.tipo_codigo = t.codigo
where a.status <> 'encerrado'
  and c.situacao = 'ativo'
  and (
    (t.grupo = 'colaborador' and (
        not t.depende_da_funcao
        or coalesce(x.exige,
             exists (select 1 from public.funcoes_documentos fd where fd.funcao_id = c.funcao_id and fd.tipo_codigo = t.codigo))))
    or
    (t.grupo = 'empresa' and (not t.so_subcontratada or coalesce(eo.subcontratada, false)))
  );
