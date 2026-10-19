-- Fornecedor tira da medição um colaborador que não trabalhou na obra no mês.
-- Aplicada à parte, pelo SQL Editor, porque contém delete.
create or replace function public.remover_colaborador_medicao(p_medicao uuid, p_colaborador uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform app.medicao_editavel_pelo_fornecedor(p_medicao);
  delete from public.medicoes_colaboradores where medicao_id = p_medicao and colaborador_id = p_colaborador;
end $$;

revoke all on function public.remover_colaborador_medicao(uuid, uuid) from public, anon;
grant execute on function public.remover_colaborador_medicao(uuid, uuid) to authenticated;
