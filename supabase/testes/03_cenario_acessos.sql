\set ON_ERROR_STOP off
\set VERBOSITY terse
-- ids
\set adm  '''00000000-0000-0000-0000-0000000000a1'''
\set tsta '''00000000-0000-0000-0000-0000000000b1'''
\set tstb '''00000000-0000-0000-0000-0000000000b2'''
\set f1   '''00000000-0000-0000-0000-0000000000c1'''
\set f2   '''00000000-0000-0000-0000-0000000000c2'''

-- ===== carga como serviço (sem login) =====
insert into auth.users values (:adm,'adm@emais.com'),(:tsta,'tsta@emais.com'),(:tstb,'tstb@emais.com'),(:f1,'contab@x.com'),(:f2,'f2@y.com');
insert into usuarios (id,nome,email,perfil) values (:adm,'Admin','adm@emais.com','admin'),(:tsta,'Marcelo','tsta@emais.com','tst'),
 (:tstb,'Mariano','tstb@emais.com','tst'),(:f1,'Escritório','contab@x.com','fornecedor'),(:f2,'Forn 2','f2@y.com','fornecedor');
insert into obras (id,nome) values ('10000000-0000-0000-0000-000000000001','MAIS PARQUE RIO PRETO'),('10000000-0000-0000-0000-000000000002','VISTA BELA');
insert into empresas (id,razao_social,cnpj) values ('20000000-0000-0000-0000-000000000001','EMPRESA UM','11111111000111'),
 ('20000000-0000-0000-0000-000000000002','EMPRESA DOIS','22222222000122'),('20000000-0000-0000-0000-000000000003','EMPRESA TRES','33333333000133');
-- f1 (escritório) responde por UM e TRES; f2 por DOIS
insert into usuarios_empresas values (:f1,'20000000-0000-0000-0000-000000000001'),(:f1,'20000000-0000-0000-0000-000000000003'),(:f2,'20000000-0000-0000-0000-000000000002');
\echo '--- T00 dois logins para a mesma empresa (deve FALHAR)'
insert into usuarios_empresas values (:f2,'20000000-0000-0000-0000-000000000001');
insert into tst_obras values (:tsta,'10000000-0000-0000-0000-000000000001'),(:tstb,'10000000-0000-0000-0000-000000000002');
insert into empresas_obras (empresa_id,obra_id) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
insert into funcoes (id,nome) values ('30000000-0000-0000-0000-000000000001','PEDREIRO');
insert into funcoes_documentos values ('30000000-0000-0000-0000-000000000001','nr18'),('30000000-0000-0000-0000-000000000001','nr35');

-- ===== fornecedor 1 =====
select set_config('request.jwt.claim.sub', :f1, false); set role authenticated;
\echo '--- T01 f1 vê suas 2 empresas (esperado 2)'
select count(*) from empresas;
\echo '--- T02 f1 cadastra colaborador na EMPRESA UM (ok)'
insert into colaboradores (id,empresa_id,nome,cpf,funcao_id) values ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','JOSE DA SILVA','12345678901','30000000-0000-0000-0000-000000000001');
\echo '--- T03 f1 cadastra colaborador na EMPRESA DOIS (deve FALHAR)'
insert into colaboradores (empresa_id,nome,cpf) values ('20000000-0000-0000-0000-000000000002','INTRUSO','99999999999');
\echo '--- T04 f1 aloca na obra Rio Preto (ok) e na Vista Bela, onde a empresa não atua (deve FALHAR)'
insert into alocacoes (id,colaborador_id,obra_id) values ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
insert into alocacoes (colaborador_id,obra_id) values ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002');
\echo '--- T05 pendências iniciais: tudo nao_enviado; NR-18 e NR-35 exigidas pela função (esperado 17 linhas, contrato fora)'
select count(*) total, count(*) filter (where tipo_codigo in ('nr18','nr35')) nrs, count(*) filter (where tipo_codigo='contrato_subcontratacao') contrato, count(*) filter (where impeditivo) impeditivos from v_pendencias;
\echo '--- T06 envio com emissão futura (FALHA), sem aceite LGPD (FALHA), tentando forçar status aprovado (vira em_analise)'
insert into documentos (tipo_codigo,empresa_id,colaborador_id,data_emissao,aceite_lgpd_em) values ('aso','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',current_date+5,now());
insert into documentos (tipo_codigo,empresa_id,colaborador_id,data_emissao) values ('aso','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',current_date-10);
insert into documentos (id,tipo_codigo,empresa_id,colaborador_id,data_emissao,aceite_lgpd_em,status) values ('60000000-0000-0000-0000-000000000001','aso','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',current_date-350,now(),'aprovado');
select tipo_codigo, status from documentos;
\echo '--- T07 documento de empresa com colaborador (FALHA) e LTCAT dispensado (ok)'
insert into documentos (tipo_codigo,empresa_id,colaborador_id,data_emissao,aceite_lgpd_em) values ('pgr','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',current_date-10,now());
insert into documentos (tipo_codigo,empresa_id,dispensado,aceite_lgpd_em) values ('ltcat','20000000-0000-0000-0000-000000000001',true,now());
-- demais impeditivos
insert into documentos (tipo_codigo,empresa_id,colaborador_id,data_emissao,data_vencimento_informada,aceite_lgpd_em)
select t.codigo,'20000000-0000-0000-0000-000000000001', case when t.grupo='colaborador' then '40000000-0000-0000-0000-000000000001'::uuid end,
       current_date-30, case when t.regra='vigencia_informada' then current_date+200 end, now()
from tipos_documento t where t.enviado_pelo_fornecedor and t.codigo not in ('aso','ltcat','contrato_subcontratacao','nr05','nr06','nr10','nr11','nr12','nr20','nr33');
\echo '--- T08 arquivo: f1 registra arquivo do seu envio (ok), mas não consegue ler arquivos (esperado 0)'
insert into arquivos (documento_id,caminho,nome_original) values ('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001/60000000-0000-0000-0000-000000000001/aso.pdf','aso.pdf');
select count(*) arquivos_visiveis from arquivos;
\echo '--- T09 storage: f1 grava na pasta da EMPRESA UM (ok) e da EMPRESA DOIS (FALHA); não lê (0)'
insert into storage.objects (bucket_id,name) values ('documentos','20000000-0000-0000-0000-000000000001/60000000-0000-0000-0000-000000000001/aso.pdf');
insert into storage.objects (bucket_id,name) values ('documentos','20000000-0000-0000-0000-000000000002/x/invasao.pdf');
select count(*) from storage.objects;
\echo '--- T10 f1 tenta aprovar o próprio documento via update (0 linhas) e via função (FALHA)'
update documentos set status='aprovado';
select aprovar_documento('60000000-0000-0000-0000-000000000001');
\echo '--- T11 f1 manda para análise (ok)'
select enviar_para_analise('50000000-0000-0000-0000-000000000001');
reset role;

-- ===== fornecedor 2 não vê nada da EMPRESA UM =====
select set_config('request.jwt.claim.sub', :f2, false); set role authenticated;
\echo '--- T12 f2 vê colaboradores/documentos/alocações de outra empresa? (esperado 0 0 0)'
select (select count(*) from colaboradores), (select count(*) from documentos), (select count(*) from alocacoes);
reset role;

-- ===== administrador =====
select set_config('request.jwt.claim.sub', :adm, false); set role authenticated;
\echo '--- T13 admin vê arquivos e storage (1 e 1)'
select (select count(*) from arquivos), (select count(*) from storage.objects);
\echo '--- T14 aprovar alocação com tudo em análise (FALHA: impeditivos pendentes)'
select aprovar_alocacao('50000000-0000-0000-0000-000000000001');
\echo '--- T15 admin devolve o ASO; alocação volta ao fornecedor'
select devolver_documento('60000000-0000-0000-0000-000000000001','ASO sem assinatura do médico examinador');
select status from alocacoes;
-- aprova o resto
select aprovar_documento(id) from documentos where status='em_analise';
reset role;

select set_config('request.jwt.claim.sub', :f1, false); set role authenticated;
\echo '--- T16 f1 vê o motivo da devolução nas pendências'
select documento, situacao, motivo_devolucao from v_pendencias where situacao <> 'vigente' order by 1;
\echo '--- T17 f1 reenvia ASO (emissão de 350 dias atrás: vai ficar a_vencer) e manda de novo para análise'
insert into documentos (id,tipo_codigo,empresa_id,colaborador_id,data_emissao,aceite_lgpd_em) values ('60000000-0000-0000-0000-000000000002','aso','20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',current_date-350,now());
select enviar_para_analise('50000000-0000-0000-0000-000000000001');
reset role;

select set_config('request.jwt.claim.sub', :adm, false); set role authenticated;
select aprovar_documento('60000000-0000-0000-0000-000000000002');
\echo '--- T18 resumo antes de aprovar: impeditivos pendentes 0, ASO a vencer'
select colaborador, funcao, status, impeditivos_pendentes, pendentes_adm, pendentes_sst, a_vencer from v_alocacoes_resumo;
select documento, vencimento, dias_para_vencer, situacao from v_documentos_atuais where tipo_codigo='aso';
\echo '--- T19 admin aprova a alocação (ok)'
select aprovar_alocacao('50000000-0000-0000-0000-000000000001');
\echo '--- T20 admin altera prazo do ASO sem motivo direto na tabela (FALHA) e pela função (ok); vencimento recalcula'
update tipos_documento set validade_dias=180 where codigo='aso';
select alterar_tipo_documento('aso',180,null,'Teste de recálculo');
select documento, vencimento, situacao from v_documentos_atuais where tipo_codigo='aso';
select codigo,campo,valor_anterior,valor_novo,motivo from tipos_documento_historico;
select alterar_tipo_documento('aso',365,null,'Volta ao prazo da planilha');
reset role;

-- ===== TST =====
select set_config('request.jwt.claim.sub', :tstb, false); set role authenticated;
\echo '--- T21 TST de outra obra: não vê o colaborador (0) e não valida (FALHA)'
select count(*) from colaboradores;
select validar_alocacao_tst('50000000-0000-0000-0000-000000000001');
reset role;
select set_config('request.jwt.claim.sub', :tsta, false); set role authenticated;
\echo '--- T22 TST da obra: vê dados digitados (1 colaborador, documentos > 0) mas não arquivos (0)'
select (select count(*) from colaboradores), (select count(*) from documentos), (select count(*) from arquivos), (select count(*) from storage.objects);
\echo '--- T23 TST valida (ok) -> liberado'
select validar_alocacao_tst('50000000-0000-0000-0000-000000000001');
select status from alocacoes;
reset role;

select set_config('request.jwt.claim.sub', :adm, false); set role authenticated;
\echo '--- T24 e-mail de liberação pronto'
select assunto, corpo from gerar_aviso_liberacao('10000000-0000-0000-0000-000000000001', array['50000000-0000-0000-0000-000000000001'::uuid], 'tst@emais.com; eng@emais.com');
\echo '--- T25 download registra prazo de 30 dias'
select registrar_download(array(select id from arquivos));
select baixado_em is not null baixado, apagar_apos - current_date dias from arquivos;
\echo '--- T26 integração registrada e vencimento em 365 dias'
select registrar_integracao('50000000-0000-0000-0000-000000000001', current_date - 1);
select vencimento_integracao - data_integracao from v_alocacoes_resumo;
\echo '--- T27 histórico de eventos'
select tabela, acao, count(*) from eventos group by 1,2 order by 1,2;
reset role;

-- ===== anônimo =====
select set_config('request.jwt.claim.sub', '', false); set role anon;
\echo '--- T28 anônimo não vê nada (0 0)'
select (select count(*) from empresas), (select count(*) from colaboradores);
select aprovar_documento('60000000-0000-0000-0000-000000000002');
reset role;
