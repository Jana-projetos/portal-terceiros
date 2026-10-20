-- Fila de cobranças por e-mail.
--
-- O portal monta os e-mails no calendário combinado (lembrete da medição no dia 20, cobrança e aviso de
-- retenção no dia 26, documentos que vencem em 30 dias, 15 dias ou já venceram). Nesta fase quem envia é
-- uma pessoa: abre no Outlook, confere e clica em enviar. Esta tabela guarda o que já foi aberto ou
-- dispensado, para a cobrança não voltar para a fila. Quando o envio ficar automático, o mesmo registro
-- passa a ser feito pelo envio.

create table public.cobrancas (
  id             uuid primary key default gen_random_uuid(),
  tipo           text not null check (tipo in ('lembrete_medicao', 'cobranca_medicao', 'retencao_obra', 'vencimento_documento')),
  -- lembrete e cobrança: competência:empresa; retenção: competência:obra;
  -- documento: faixa:empresa:tipo de documento:colaborador:vencimento (um registro por documento e faixa)
  referencia     text not null,
  empresa_id     uuid references public.empresas (id),
  obra_id        uuid references public.obras (id),
  competencia    date,
  situacao       text not null default 'aberta_no_outlook' check (situacao in ('aberta_no_outlook', 'dispensada')),
  destinatarios  text,
  assunto        text,
  registrada_em  timestamptz not null default now(),
  registrada_por uuid default auth.uid()
);
create unique index cobranca_unica on public.cobrancas (tipo, referencia);
create index cobrancas_registro on public.cobrancas (registrada_em);

alter table public.cobrancas enable row level security;
create policy admin on public.cobrancas for all to authenticated
  using ((select app.eh_admin())) with check ((select app.eh_admin()));
grant select, insert on public.cobrancas to authenticated;

-- Quem recebe o aviso de retenção em cada obra (engenharia), igual para todo o administrativo.
alter table public.obras add column if not exists emails_engenharia text;
