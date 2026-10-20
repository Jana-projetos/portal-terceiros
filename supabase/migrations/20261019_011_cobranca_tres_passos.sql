-- Cobrança da medição em três passos e e-mail semanal de documentos para a integração.
--
-- Dia 20: lembrete. Dia 26: notificação de atraso com tolerância até o dia 30 (as guias vencem no dia 20).
-- Depois do dia 30: retenção do pagamento e aviso à engenharia, salvo quando há data combinada com o
-- fornecedor (registrada pelo administrativo quando ele responde à notificação).

alter table public.medicoes add column if not exists prazo_combinado date;
alter table public.medicoes add column if not exists prazo_combinado_obs text;

create or replace view public.v_medicoes with (security_invoker = true) as
select
  m.id, m.empresa_id, e.razao_social as empresa, e.cnpj, coalesce(e.email_contato, e.email_acesso) as email_cobranca,
  m.obra_id, o.nome as obra, m.competencia, m.prazo, m.status, m.primeiro_envio_em, m.enviada_em,
  m.conferente, m.ultima_analise_em, m.ultima_cobranca_em, m.observacao, m.origem,
  coalesce(m.qtd_colaboradores, (select count(*) from public.medicoes_colaboradores c where c.medicao_id = m.id))::integer as qtd_colaboradores,
  (m.primeiro_envio_em is not null and (m.primeiro_envio_em at time zone 'America/Sao_Paulo')::date <= m.prazo) as entregue_no_prazo,
  -- Retida: não aprovada depois da tolerância (dia 30, ou o último dia do mês) e da data combinada, se houver.
  (m.status <> 'aprovada' and current_date > greatest(t.tolerancia, coalesce(m.prazo_combinado, t.tolerancia))) as retida,
  (select count(*) from public.medicoes_itens i join public.tipos_medicao t2 on t2.codigo = i.tipo_codigo
    where i.medicao_id = m.id and t2.impeditivo and i.status in ('nao_enviado', 'devolvido'))::integer as itens_pendentes,
  (select count(*) from public.medicoes_itens i where i.medicao_id = m.id and i.status = 'em_analise')::integer as itens_em_analise,
  (select count(*) from public.medicoes_itens i where i.medicao_id = m.id and i.status = 'devolvido')::integer as itens_devolvidos,
  (select count(*) from public.medicoes_colaboradores c
    where c.medicao_id = m.id and exists (select 1 from jsonb_each_text(c.conferencia) x where x.value = 'pendente'))::integer as colaboradores_pendentes,
  m.prazo_combinado, m.prazo_combinado_obs, t.tolerancia,
  (m.status <> 'aprovada' and current_date > m.prazo and current_date <= greatest(t.tolerancia, coalesce(m.prazo_combinado, t.tolerancia))) as em_atraso
from public.medicoes m
join public.empresas e on e.id = m.empresa_id
left join public.obras o on o.id = m.obra_id
cross join lateral (select least((date_trunc('month', m.prazo) + interval '1 month - 1 day')::date, m.prazo + 5) as tolerancia) t;

create or replace function public.combinar_prazo_medicao(p_medicao uuid, p_data date, p_obs text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app.eh_admin() then raise exception 'Apenas o administrativo registra a data combinada'; end if;
  update public.medicoes set prazo_combinado = p_data, prazo_combinado_obs = nullif(trim(p_obs), '') where id = p_medicao;
  perform app.registrar_evento('medicoes', p_medicao, 'prazo_combinado', jsonb_build_object('data', p_data, 'obs', p_obs));
end $$;
revoke all on function public.combinar_prazo_medicao(uuid, date, text) from public, anon;
grant execute on function public.combinar_prazo_medicao(uuid, date, text) to authenticated;

-- Novos tipos na fila de cobranças.
alter table public.cobrancas drop constraint cobrancas_tipo_check;
alter table public.cobrancas add constraint cobrancas_tipo_check check (tipo in (
  'lembrete_medicao', 'notificacao_medicao', 'cobranca_medicao', 'retencao_obra', 'vencimento_documento', 'integracao_documentos'));

-- Assinatura dos e-mails de cobrança (o administrativo pode trocar na tela de Cobranças).
insert into public.parametros (chave, valor, descricao) values
  ('cobranca_setor', 'Gente e Gestão', 'Setor que assina os e-mails de cobrança'),
  ('cobranca_contato', 'gente10@emais.com | (17) 3512-4716', 'E-mail e telefone na assinatura dos e-mails de cobrança')
on conflict (chave) do nothing;
