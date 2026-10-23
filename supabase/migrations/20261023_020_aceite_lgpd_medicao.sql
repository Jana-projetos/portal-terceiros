-- Aceite de LGPD também no envio dos arquivos da medição.
--
-- Os documentos de colaborador e de empresa já exigem o aceite e guardam aceite_lgpd_em.
-- Agora o envio de arquivo da medição (holerites, ponto, folha, guias etc.) também exige o aceite,
-- e cada arquivo guarda a data e hora em que ele foi dado. Marcar "não se aplica" não envia dado
-- pessoal, então não pede aceite.
-- O texto do termo mudou em 23/10/2026 (site/src/componentes/TermoLgpd.tsx): aceites a partir desta
-- data, em documentos ou na medição, são do texto novo.

alter table public.medicoes_arquivos add column if not exists aceite_lgpd_em timestamptz;

drop function if exists public.enviar_item_medicao(uuid, text, jsonb, boolean, text);

create or replace function public.enviar_item_medicao(
  p_medicao uuid, p_tipo text, p_arquivos jsonb, p_nao_aplica boolean, p_justificativa text, p_aceite_lgpd boolean default null
)
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
    if not coalesce(p_aceite_lgpd, false) then raise exception 'É preciso aceitar o termo de LGPD para enviar'; end if;
    if jsonb_array_length(coalesce(p_arquivos, '[]'::jsonb)) = 0 then raise exception 'Anexe o arquivo de %', t.nome; end if;
    prefixo := m.empresa_id::text || '/medicao/' || m.id::text || '/' || p_tipo || '/' || (i.versao + 1)::text || '-';
    for arq in select * from jsonb_array_elements(p_arquivos) loop
      if left(arq->>'caminho', length(prefixo)) <> prefixo then raise exception 'Arquivo fora da pasta da medição'; end if;
      insert into public.medicoes_arquivos (item_id, versao, caminho, nome_original, tamanho_bytes, tipo_mime, aceite_lgpd_em)
      values (i.id, i.versao + 1, arq->>'caminho', arq->>'nome', (arq->>'tamanho')::bigint, arq->>'tipo', now());
    end loop;
    update public.medicoes_itens set status = 'em_analise', justificativa = null, motivo_devolucao = null,
           enviado_em = now(), versao = versao + 1 where id = i.id;
  end if;
  perform app.registrar_evento('medicoes_itens', i.id, 'enviado',
    jsonb_build_object('tipo', p_tipo, 'nao_aplica', coalesce(p_nao_aplica, false), 'aceite_lgpd', coalesce(p_aceite_lgpd, false)));
end $$;

revoke all on function public.enviar_item_medicao(uuid, text, jsonb, boolean, text, boolean) from public, anon;
grant execute on function public.enviar_item_medicao(uuid, text, jsonb, boolean, text, boolean) to authenticated;
