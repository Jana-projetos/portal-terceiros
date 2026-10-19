-- Ajustes para a carga da base atual
-- 1. Colaborador pode entrar sem CPF válido, marcado como pendente de correção.
alter table public.colaboradores alter column cpf drop not null;
alter table public.colaboradores add column pendencia_cadastro text;
comment on column public.colaboradores.pendencia_cadastro is 'O que precisa ser corrigido no cadastro (ex.: CPF ausente). Nulo = cadastro ok.';

-- 2. NR obrigatória a mais para um colaborador específico, além das da função.
create table public.colaboradores_documentos_extras (
  colaborador_id  uuid not null references public.colaboradores (id) on delete cascade,
  tipo_codigo     text not null references public.tipos_documento (codigo),
  motivo          text,
  incluido_por    uuid default auth.uid(),
  incluido_em     timestamptz not null default now(),
  primary key (colaborador_id, tipo_codigo)
);
alter table public.colaboradores_documentos_extras enable row level security;
create policy leitura on public.colaboradores_documentos_extras for select to authenticated
  using (app.eh_admin()
         or colaborador_id in (select c.id from public.colaboradores c where c.empresa_id in (select app.minhas_empresas()))
         or app.tst_ve_colaborador(colaborador_id));
create policy admin on public.colaboradores_documentos_extras for all to authenticated
  using (app.eh_admin()) with check (app.eh_admin());

create or replace view public.v_exigencias with (security_invoker = true) as
select a.id as alocacao_id, a.obra_id, c.id as colaborador_id, c.empresa_id, t.codigo as tipo_codigo
from public.alocacoes a
join public.colaboradores c on c.id = a.colaborador_id
join public.tipos_documento t on t.ativo and t.enviado_pelo_fornecedor
left join public.empresas_obras eo on eo.empresa_id = c.empresa_id and eo.obra_id = a.obra_id
where a.status <> 'encerrado'
  and c.situacao = 'ativo'
  and (
    (t.grupo = 'colaborador' and (
        not t.depende_da_funcao
        or exists (select 1 from public.funcoes_documentos fd where fd.funcao_id = c.funcao_id and fd.tipo_codigo = t.codigo)
        or exists (select 1 from public.colaboradores_documentos_extras x where x.colaborador_id = c.id and x.tipo_codigo = t.codigo)))
    or
    (t.grupo = 'empresa' and (not t.so_subcontratada or coalesce(eo.subcontratada, false)))
  );

-- 3. Área de carga (fora da API). Apagada depois da conferência.
create schema if not exists migracao;
revoke all on schema migracao from public, anon, authenticated;
create table migracao.integracao (
  linha int primary key, obra text, cnpj text, empresa text, nome text, cpf text, funcao text,
  situacao text, sub text, principal_cnpj text, ini date, ult date, liberado text, data_integracao date,
  rg text, ctps text, ficha text, esocial text, contrato text, seguro_vig date,
  cartao_cnpj text, pgr text, pcmso text, ltcat text, aso text, os text, vacinacao text, epi text,
  nr05 text, nr06 text, nr10 text, nr11 text, nr12 text, nr18 text, nr20 text, nr33 text, nr35 text
);
alter table migracao.integracao enable row level security;
