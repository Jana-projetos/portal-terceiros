-- Envio de documentos pelo fornecedor e envio do colaborador para análise.
--
-- 1. enviar_documento: grava o documento e os arquivos numa só operação, depois que o
--    portal sobe os arquivos para o armazenamento. Roda com as permissões de quem chama,
--    então valem as regras de acesso e as validações de data e de LGPD já existentes.
-- 2. enviar_para_analise passa a exigir que nenhum documento impeditivo esteja faltando,
--    devolvido ou vencido (os que estão em análise contam como enviados).

create or replace function public.enviar_documento(
  p_id           uuid,
  p_tipo         text,
  p_empresa      uuid,
  p_colaborador  uuid,
  p_data_emissao date,
  p_vencimento   date,
  p_dispensado   boolean,
  p_dados        jsonb,
  p_arquivos     jsonb,
  p_aceite_lgpd  boolean
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  arq jsonb;
  prefixo text := p_empresa::text || '/' || p_id::text || '/';
begin
  if not coalesce(p_aceite_lgpd, false) then
    raise exception 'É preciso aceitar o termo de LGPD para enviar';
  end if;
  if not coalesce(p_dispensado, false) and jsonb_array_length(coalesce(p_arquivos, '[]'::jsonb)) = 0 then
    raise exception 'Anexe o arquivo do documento';
  end if;

  insert into public.documentos (id, tipo_codigo, empresa_id, colaborador_id, data_emissao, data_vencimento_informada,
                                 dispensado, dados, aceite_lgpd_em)
  values (p_id, p_tipo, p_empresa, p_colaborador, p_data_emissao, p_vencimento,
          coalesce(p_dispensado, false), coalesce(p_dados, '{}'::jsonb), now());

  for arq in select * from jsonb_array_elements(coalesce(p_arquivos, '[]'::jsonb)) loop
    if left(arq->>'caminho', length(prefixo)) <> prefixo then
      raise exception 'Arquivo fora da pasta do documento';
    end if;
    insert into public.arquivos (documento_id, caminho, nome_original, tamanho_bytes, tipo_mime)
    values (p_id, arq->>'caminho', arq->>'nome', (arq->>'tamanho')::bigint, arq->>'tipo');
  end loop;

  return p_id;
end $$;

revoke all on function public.enviar_documento(uuid, text, uuid, uuid, date, date, boolean, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.enviar_documento(uuid, text, uuid, uuid, date, date, boolean, jsonb, jsonb, boolean) to authenticated;

create or replace function public.enviar_para_analise(p_alocacao uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  a public.alocacoes;
  faltando text;
begin
  select al.* into a from public.alocacoes al join public.colaboradores c on c.id = al.colaborador_id
  where al.id = p_alocacao and c.empresa_id in (select app.minhas_empresas());
  if a.id is null then raise exception 'Alocação não encontrada'; end if;
  if a.status not in ('em_cadastro', 'pendente_fornecedor') then raise exception 'Esta alocação já está em análise ou liberada'; end if;

  select string_agg(p.documento, ', ' order by p.documento) into faltando
  from public.v_pendencias p
  where p.alocacao_id = p_alocacao and p.impeditivo and p.situacao in ('nao_enviado', 'devolvido', 'vencido');
  if faltando is not null then
    raise exception 'Antes de enviar para análise, envie: %', faltando;
  end if;

  update public.alocacoes set status = 'em_analise', inicio_conferencia = coalesce(inicio_conferencia, now()) where id = p_alocacao;
end $$;
