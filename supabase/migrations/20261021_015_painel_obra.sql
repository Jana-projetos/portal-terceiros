-- Painel da obra para a engenharia (e também para o TST e o administrativo).
--
-- As obras do acesso da engenharia ficam na mesma tabela de obras do TST (tst_obras).
-- A leitura é feita por uma função que confere a obra e devolve só o necessário para acompanhar:
-- nomes, funções, situação e pendências. Sem CPF, sem arquivos e sem os documentos da medição.

create or replace function app.minhas_obras_painel() returns setof uuid
language sql stable security definer set search_path = public as $$
  select t.obra_id
  from public.tst_obras t
  join public.usuarios u on u.id = t.usuario_id
  where t.usuario_id = auth.uid() and u.perfil in ('tst', 'engenharia') and u.ativo;
$$;

create or replace function public.painel_obras() returns table (id uuid, nome text)
language sql stable security definer set search_path = public as $$
  select o.id, o.nome from public.obras o
  where o.ativa and (app.eh_admin() or o.id in (select app.minhas_obras_painel()))
  order by o.nome;
$$;

create or replace function public.painel_obra(p_obra uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  resultado jsonb;
begin
  if not (app.eh_admin() or p_obra in (select app.minhas_obras_painel())) then
    raise exception 'Obra fora do seu acesso';
  end if;

  -- Pendências calculadas uma vez para a obra inteira (a visão é pesada; por colaborador ficaria lento).
  with pend as (
    select p.alocacao_id, p.documento, p.situacao, p.vencimento
    from public.v_pendencias p
    where p.obra_id = p_obra and p.impeditivo and p.situacao in ('nao_enviado', 'devolvido', 'vencido', 'em_analise', 'a_vencer')
  ), por_alocacao as (
    select alocacao_id,
      jsonb_agg(jsonb_build_object('documento', documento, 'situacao', situacao, 'vencimento', vencimento) order by documento)
        filter (where situacao <> 'a_vencer') as pendencias,
      jsonb_agg(jsonb_build_object('documento', documento, 'vencimento', vencimento) order by vencimento)
        filter (where situacao = 'a_vencer') as a_vencer
    from pend group by alocacao_id
  )
  select jsonb_build_object(
    'obra', (select nome from public.obras where id = p_obra),
    'colaboradores', coalesce((
      select jsonb_agg(jsonb_build_object(
        'alocacao_id', a.alocacao_id, 'colaborador', a.colaborador, 'funcao', a.funcao, 'empresa_id', a.empresa_id, 'empresa', a.empresa,
        'status', a.status, 'data_integracao', a.data_integracao, 'vencimento_integracao', a.vencimento_integracao,
        'liberado_em', a.validado_tst_em,
        'pendencias', coalesce(pa.pendencias, '[]'::jsonb),
        'a_vencer', coalesce(pa.a_vencer, '[]'::jsonb)
      ) order by a.empresa, a.colaborador)
      from public.v_alocacoes_resumo a
      left join por_alocacao pa on pa.alocacao_id = a.alocacao_id
      where a.obra_id = p_obra and a.status <> 'encerrado'
    ), '[]'::jsonb),
    'medicoes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'empresa_id', m.empresa_id, 'empresa', m.empresa, 'competencia', m.competencia, 'prazo', m.prazo,
        'tolerancia', m.tolerancia, 'status', m.status, 'retida', m.retida, 'em_atraso', m.em_atraso,
        'prazo_combinado', m.prazo_combinado, 'primeiro_envio_em', m.primeiro_envio_em, 'ultima_analise_em', m.ultima_analise_em,
        'itens_pendentes', coalesce((
          select jsonb_agg(t.item || '. ' || t.nome order by t.ordem)
          from public.medicoes_itens i join public.tipos_medicao t on t.codigo = i.tipo_codigo
          where i.medicao_id = m.id and t.impeditivo and i.status in ('nao_enviado', 'devolvido')
        ), '[]'::jsonb)
      ) order by m.competencia desc, m.empresa)
      from public.v_medicoes m
      where m.obra_id = p_obra
    ), '[]'::jsonb),
    'integracoes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'data', i.data, 'horario', i.horario, 'local', i.local, 'responsavel', i.responsavel,
        'concluida_em', i.concluida_em,
        'participantes', (select count(*) from public.integracoes_participantes x where x.integracao_id = i.id),
        'presentes', (select count(*) from public.integracoes_participantes x where x.integracao_id = i.id and x.presente)
      ) order by i.data desc)
      from public.integracoes i
      where i.obra_id = p_obra and i.cancelada_em is null and i.data >= current_date - 90
    ), '[]'::jsonb)
  ) into resultado;
  return resultado;
end $$;

revoke all on function public.painel_obras() from public, anon;
revoke all on function public.painel_obra(uuid) from public, anon;
grant execute on function public.painel_obras() to authenticated;
grant execute on function public.painel_obra(uuid) to authenticated;
grant execute on function app.minhas_obras_painel() to authenticated;
