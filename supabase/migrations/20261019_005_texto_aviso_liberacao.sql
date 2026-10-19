-- Texto do e-mail de liberação: lista mais limpa (nome, função e empresa em colunas de texto simples)
-- e assunto sem separadores especiais, para colar no Outlook sem estranhamento.
create or replace function public.gerar_aviso_liberacao(p_obra uuid, p_alocacoes uuid[], p_destinatarios text)
returns public.avisos_liberacao
language plpgsql security definer set search_path = public as $$
declare
  v public.avisos_liberacao;
  nome_obra text;
  lista text;
  qtd integer;
begin
  if not app.eh_admin() then raise exception 'Apenas o administrador gera o aviso'; end if;
  select nome into nome_obra from public.obras where id = p_obra;
  if nome_obra is null then raise exception 'Obra não encontrada'; end if;

  select string_agg(format('- %s, %s (%s)', r.colaborador, coalesce(lower(r.funcao), 'função não informada'), r.empresa),
                    E'\n' order by r.empresa, r.colaborador),
         count(*)
    into lista, qtd
  from public.v_alocacoes_resumo r
  where r.alocacao_id = any (p_alocacoes) and r.obra_id = p_obra and r.status = 'liberado';
  if lista is null then raise exception 'Nenhuma alocação liberada nesta obra entre as selecionadas'; end if;

  insert into public.avisos_liberacao (obra_id, alocacoes, destinatarios, assunto, corpo)
  values (
    p_obra, p_alocacoes, p_destinatarios,
    format('Liberação para integração: %s (%s)', nome_obra, to_char(current_date, 'DD/MM/YYYY')),
    format(E'Olá,\n\n%s para a integração na obra %s:\n\n%s\n\nA documentação foi conferida pelo Gente e Gestão e validada pela Segurança do Trabalho da obra.\n\nAtenciosamente,\nGente e Gestão\nGrupo Emais',
           case when qtd = 1 then 'O colaborador abaixo está liberado' else 'Os colaboradores abaixo estão liberados' end,
           nome_obra, lista)
  )
  returning * into v;
  return v;
end $$;
