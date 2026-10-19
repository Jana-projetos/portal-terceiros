-- Desempenho das regras de acesso e das visões de pendências.
--
-- 1. As regras passam a chamar app.eh_admin() e auth.uid() dentro de (select ...), para o banco
--    calcular uma vez por consulta e não uma vez por linha.
-- 2. A checagem do TST por linha (tst_ve_colaborador / tst_ve_empresa) vira um conjunto calculado
--    uma vez (colaboradores_do_tst / empresas_do_tst).
-- 3. As visões de pendências cruzam documentos e exigências por igualdade, o que permite hash join.
-- 4. Atualiza as estatísticas das tabelas depois da carga.
--
-- Nenhuma regra muda de significado: cada perfil continua vendo exatamente o mesmo.
set search_path = public;

-- Colaboradores e empresas que o TST logado enxerga (alocados nas obras dele).
-- Devolvem um conjunto calculado uma vez por consulta, em vez de uma checagem por linha.
create or replace function app.colaboradores_do_tst() returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct a.colaborador_id
  from public.alocacoes a
  where a.obra_id in (select app.minhas_obras_tst());
$$;

create or replace function app.empresas_do_tst() returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct c.empresa_id
  from public.alocacoes a
  join public.colaboradores c on c.id = a.colaborador_id
  where a.obra_id in (select app.minhas_obras_tst());
$$;

revoke all on function app.colaboradores_do_tst() from public, anon;
revoke all on function app.empresas_do_tst() from public, anon;
grant execute on function app.colaboradores_do_tst() to authenticated;
grant execute on function app.empresas_do_tst() to authenticated;

-- Regras de acesso
alter policy "alterar" on public.alocacoes
  using ((select app.eh_admin()))
  with check ((select app.eh_admin()));

alter policy "excluir" on public.alocacoes
  using (((select app.eh_admin()) OR ((status = 'em_cadastro'::status_alocacao) AND (colaborador_id IN ( SELECT c.id FROM colaboradores c WHERE (c.empresa_id IN ( SELECT app.minhas_empresas() AS minhas_empresas)))))));

alter policy "inserir" on public.alocacoes
  with check (((select app.eh_admin()) OR (colaborador_id IN ( SELECT c.id FROM colaboradores c WHERE (c.empresa_id IN ( SELECT app.minhas_empresas() AS minhas_empresas))))));

alter policy "leitura" on public.alocacoes
  using (((select app.eh_admin()) OR (obra_id IN ( SELECT app.minhas_obras_tst() AS minhas_obras_tst)) OR (colaborador_id IN ( SELECT c.id FROM colaboradores c WHERE (c.empresa_id IN ( SELECT app.minhas_empresas() AS minhas_empresas))))));

alter policy "admin" on public.arquivos
  using ((select app.eh_admin()))
  with check ((select app.eh_admin()));

alter policy "inserir" on public.arquivos
  with check ((documento_id IN ( SELECT d.id FROM documentos d WHERE ((d.status = 'em_analise'::status_documento) AND (d.empresa_id IN ( SELECT app.minhas_empresas() AS minhas_empresas))))));

alter policy "admin" on public.avisos_liberacao
  using ((select app.eh_admin()))
  with check ((select app.eh_admin()));

alter policy "alterar" on public.colaboradores
  using (((select app.eh_admin()) OR (empresa_id IN ( SELECT app.minhas_empresas() AS minhas_empresas))))
  with check (((select app.eh_admin()) OR (empresa_id IN ( SELECT app.minhas_empresas() AS minhas_empresas))));

alter policy "excluir" on public.colaboradores
  using ((select app.eh_admin()));

alter policy "inserir" on public.colaboradores
  with check (((select app.eh_admin()) OR (empresa_id IN ( SELECT app.minhas_empresas() AS minhas_empresas))));

alter policy "leitura" on public.colaboradores
  using (((select app.eh_admin()) OR (empresa_id IN ( SELECT app.minhas_empresas() AS minhas_empresas)) OR (id in (select app.colaboradores_do_tst()))));

alter policy "admin" on public.colaboradores_documentos_extras
  using ((select app.eh_admin()))
  with check ((select app.eh_admin()));

alter policy "leitura" on public.colaboradores_documentos_extras
  using (((select app.eh_admin()) OR (colaborador_id IN ( SELECT c.id FROM colaboradores c WHERE (c.empresa_id IN ( SELECT app.minhas_empresas() AS minhas_empresas)))) OR (colaborador_id in (select app.colaboradores_do_tst()))));

alter policy "alterar" on public.documentos
  using ((select app.eh_admin()))
  with check ((select app.eh_admin()));

alter policy "inserir" on public.documentos
  with check (((select app.eh_admin()) OR (empresa_id IN ( SELECT app.minhas_empresas() AS minhas_empresas))));

alter policy "leitura" on public.documentos
  using (((select app.eh_admin()) OR (empresa_id IN ( SELECT app.minhas_empresas() AS minhas_empresas)) OR ((colaborador_id IS NOT NULL) AND (colaborador_id in (select app.colaboradores_do_tst()))) OR ((colaborador_id IS NULL) AND (empresa_id in (select app.empresas_do_tst())))));

alter policy "admin" on public.empresas
  using ((select app.eh_admin()))
  with check ((select app.eh_admin()));

alter policy "leitura" on public.empresas
  using (((select app.eh_admin()) OR (id IN ( SELECT app.minhas_empresas() AS minhas_empresas)) OR (id in (select app.empresas_do_tst()))));

alter policy "admin" on public.empresas_obras
  using ((select app.eh_admin()))
  with check ((select app.eh_admin()));

alter policy "leitura" on public.empresas_obras
  using (((select app.eh_admin()) OR (empresa_id IN ( SELECT app.minhas_empresas() AS minhas_empresas)) OR (obra_id IN ( SELECT app.minhas_obras_tst() AS minhas_obras_tst))));

alter policy "admin" on public.eventos
  using ((select app.eh_admin()));

alter policy "admin" on public.funcoes
  using ((select app.eh_admin()))
  with check ((select app.eh_admin()));

alter policy "admin" on public.funcoes_documentos
  using ((select app.eh_admin()))
  with check ((select app.eh_admin()));

alter policy "admin" on public.obras
  using ((select app.eh_admin()))
  with check ((select app.eh_admin()));

alter policy "admin" on public.parametros
  using ((select app.eh_admin()))
  with check ((select app.eh_admin()));

alter policy "admin" on public.tipos_documento
  using ((select app.eh_admin()))
  with check ((select app.eh_admin()));

alter policy "admin" on public.tipos_documento_historico
  using ((select app.eh_admin()));

alter policy "admin" on public.tst_obras
  using ((select app.eh_admin()))
  with check ((select app.eh_admin()));

alter policy "proprio_ou_admin" on public.tst_obras
  using (((usuario_id = (select auth.uid())) OR (select app.eh_admin())));

alter policy "admin" on public.usuarios
  using ((select app.eh_admin()))
  with check ((select app.eh_admin()));

alter policy "proprio_ou_admin" on public.usuarios
  using (((id = (select auth.uid())) OR (select app.eh_admin())));

alter policy "admin" on public.usuarios_empresas
  using ((select app.eh_admin()))
  with check ((select app.eh_admin()));

alter policy "proprio_ou_admin" on public.usuarios_empresas
  using (((usuario_id = (select auth.uid())) OR (select app.eh_admin())));

alter policy "admin apaga arquivos" on storage.objects
  using (((bucket_id = 'documentos'::text) AND (select app.eh_admin())));

alter policy "admin le arquivos" on storage.objects
  using (((bucket_id = 'documentos'::text) AND (select app.eh_admin())));

alter policy "fornecedor envia arquivos da propria empresa" on storage.objects
  with check (((bucket_id = 'documentos'::text) AND ((storage.foldername(name))[1] IN ( SELECT (e.e)::text AS e FROM app.minhas_empresas() e(e)))));

-- Visões
-- Chave de comparação do colaborador: documentos da empresa não têm colaborador (null).
-- Com a chave preenchida, o banco consegue cruzar exigências e documentos por igualdade (hash join),
-- em vez de comparar linha a linha.
create or replace view public.v_documentos_atuais with (security_invoker = true) as
with atuais as (
  select distinct on (d.empresa_id, d.colaborador_id, d.tipo_codigo) d.*
  from public.documentos d
  where d.status = 'aprovado'
  order by d.empresa_id, d.colaborador_id, d.tipo_codigo,
           coalesce(d.data_emissao, d.data_vencimento_informada) desc nulls last, d.analisado_em desc
)
select
  a.id, a.tipo_codigo, t.nome as documento, t.grupo, t.area, t.impeditivo,
  a.empresa_id, a.colaborador_id, a.data_emissao, a.dispensado,
  case
    when a.dispensado then null
    when t.regra = 'emissao_mais_prazo' then a.data_emissao + t.validade_dias
    when t.regra = 'vigencia_informada' then a.data_vencimento_informada
  end as vencimento,
  v.dias_para_vencer,
  case
    when a.dispensado then 'dispensado'
    when v.dias_para_vencer is null then 'vigente'
    when v.dias_para_vencer <= 0 then 'vencido'
    when v.dias_para_vencer <= app.param_int('dias_a_vencer') then 'a_vencer'
    else 'vigente'
  end as situacao,
  coalesce(a.colaborador_id, '00000000-0000-0000-0000-000000000000'::uuid) as chave_colaborador
from atuais a
join public.tipos_documento t on t.codigo = a.tipo_codigo
cross join lateral (
  select (case
            when a.dispensado then null
            when t.regra = 'emissao_mais_prazo' then a.data_emissao + t.validade_dias
            when t.regra = 'vigencia_informada' then a.data_vencimento_informada
          end) - current_date as dias_para_vencer
) v;

create or replace view public.v_documentos_em_aberto with (security_invoker = true) as
select distinct on (d.empresa_id, d.colaborador_id, d.tipo_codigo)
  d.id, d.tipo_codigo, d.empresa_id, d.colaborador_id, d.status, d.motivo_devolucao, d.enviado_em,
  coalesce(d.colaborador_id, '00000000-0000-0000-0000-000000000000'::uuid) as chave_colaborador
from public.documentos d
where d.status in ('em_analise', 'devolvido')
order by d.empresa_id, d.colaborador_id, d.tipo_codigo, d.enviado_em desc;

create or replace view public.v_pendencias with (security_invoker = true) as
select
  e.alocacao_id, e.obra_id, e.colaborador_id, e.empresa_id, e.tipo_codigo,
  t.nome as documento, t.grupo, t.area, t.impeditivo,
  atual.vencimento, atual.dias_para_vencer,
  ab.status as status_envio_aberto, ab.motivo_devolucao,
  case
    -- um documento aprovado e válido continua valendo enquanto a renovação é analisada
    when atual.id is not null and atual.situacao <> 'vencido' then atual.situacao   -- vigente, a_vencer, dispensado
    when ab.status = 'devolvido'  then 'devolvido'
    when ab.status = 'em_analise' then 'em_analise'
    when atual.id is null         then 'nao_enviado'
    else 'vencido'
  end as situacao
from public.v_exigencias e
join public.tipos_documento t on t.codigo = e.tipo_codigo
cross join lateral (
  select case when t.grupo = 'colaborador' then e.colaborador_id
              else '00000000-0000-0000-0000-000000000000'::uuid end as chave_colaborador
) k
left join public.v_documentos_atuais atual
  on atual.empresa_id = e.empresa_id and atual.tipo_codigo = e.tipo_codigo
 and atual.chave_colaborador = k.chave_colaborador
left join public.v_documentos_em_aberto ab
  on ab.empresa_id = e.empresa_id and ab.tipo_codigo = e.tipo_codigo
 and ab.chave_colaborador = k.chave_colaborador;

-- Estatísticas das tabelas: sem elas o banco subestima o volume e escolhe planos lentos.
-- Tabelas pequenas (como tipos_documento) não chegam a ser analisadas automaticamente.
analyze public.tipos_documento, public.parametros, public.funcoes, public.funcoes_documentos,
        public.obras, public.empresas, public.empresas_obras, public.usuarios, public.usuarios_empresas,
        public.tst_obras, public.colaboradores, public.colaboradores_documentos_extras,
        public.alocacoes, public.documentos, public.arquivos, public.eventos;
