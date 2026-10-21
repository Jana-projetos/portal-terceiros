-- Documentos controlados: conteúdo e revisão ficam no banco, para uma nova revisão não depender de
-- mudança no site. O portal monta o PDF no layout do documento a partir destes dados.
--
-- Marcação no texto: **negrito**, _itálico_, {CONTRATANTE} (trocado por "EMAIS" + nome da obra).

create table public.modelos_documento (
  codigo        text primary key,
  titulo        text not null,
  setor         text not null,
  data_revisao  text not null,   -- como aparece no cabeçalho, ex.: 01.08.2025
  revisao       text not null,   -- ex.: 03
  conteudo      jsonb not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);

alter table public.modelos_documento enable row level security;
create policy leitura on public.modelos_documento for select to authenticated using (true);
create policy admin on public.modelos_documento for all to authenticated
  using ((select app.eh_admin())) with check ((select app.eh_admin()));
grant select on public.modelos_documento to authenticated;

insert into public.modelos_documento (codigo, titulo, setor, data_revisao, revisao, conteudo) values (
  'lista_presenca_integracao',
  'DECLARAÇÃO DE RECEBIMENTO DE TREINAMENTO',
  'SEGURANÇA DO TRABALHO',
  '01.08.2025',
  '03',
  jsonb_build_object(
    'contratante', 'EMAIS {OBRA}',
    'titulo_corpo', 'DECLARAÇÃO',
    'declaracao', jsonb_build_array(
      'Declaro ter recebido da **{CONTRATANTE}**, as instruções quanto às normas e procedimentos de Segurança do Trabalho para novos funcionários através da integração antes do início das minhas atividades, estabelecido pela empresa em conformidade com a Norma Regulamentadora NR-1, itens 1.7 e NR-18, item 18.14 da portaria nº. 3.214 de 08 de junho de 1.978 e artigos 157 e 158 da Consolidação das Leis do Trabalho – CLT, conforme conteúdo programático abaixo.',
      'Declaro ainda, ter conhecimento de minhas obrigações quanto ao cumprimento do Regulamento Interno e da Ordem de Serviço, e que o descumprimento dos mesmos constitui ato faltoso passível de penalidade prevista em Lei: **1ª** Ocorrência - Advertência Verbal; **2ª** Ocorrência - Advertência por Escrito; **3ª** Ocorrência – Suspensão, **4ª** Ocorrência **a)** _demissão por justa causa para funcionários da Emais Urbanismo_ **-b)** _Proibição de entrar nas obras da empresa, para os terceirizados._'
    ),
    'titulo_conteudo', 'CONTEÚDO PROGRAMÁTICO:',
    'conteudo_esquerda', jsonb_build_array(
      '**1-** Noções Preliminares de Segurança e Valorização da Vida;',
      '**2-** Principais riscos de acidentes na Construção Civil, (Soterramento, Queda de Altura, Queda de Materiais, Choque Elétrico, Perfuração de pés com materiais pontiagudos e etc);',
      '**3-** Equipamentos de Proteção Coletiva – EPC`s, tais como: Máquinas e Equipamentos, Fechamento Provisório, Guarda-corpo; Plataformas de Proteção (Bandejas), Placas de Sinalização, etc;',
      '**4-** Saúde e Higiene Pessoal;',
      '**5-** Ordem de Serviço referente à função do funcionário;',
      '**6-** Uso de escadas e andaimes;',
      '**7-** Preservação do patrimônio da empresa;',
      '**8-** APR`s;'
    ),
    'conteudo_direita', jsonb_build_array(
      '**9-** Apresentação e utilização de Equipamentos de Proteção Individual – EPI`s, tais como:',
      '– Proteção para Cabeça: CAPACETE DE SEGURANÇA;',
      '– Proteção para os Olhos: ÓCULOS DE SEGURANÇA, PROTETOR FACIAL;',
      '– Proteção Respiratória: MASCARA E PROTETOR RESPIRATÓRIO;',
      '– Proteção para as Mãos: LUVAS DE RASPA, LUVA DE PVC, LUVA DE LATEX, ETC;',
      '– Proteção para Pés: BOTINA DE SEGURANÇA, BOTA DE BORRACHA;',
      '– Proteção para os Ouvidos: PROTETOR AURICULAR DE INSERÇÃO E TIPO CONCHA;',
      '– Proteção contra Quedas de Altura: CINTO DE SEGURANÇA, LINHA DE VIDA.',
      '**10-**Segurança no Trabalho em Maquinas e Equipamentos;',
      '**11-** POP – Atividade de escavações; **12-** Rota de Fuga.'
    ),
    'carga_horaria', '4H',
    'rotulo_instrutor', 'Instrutora',
    'funcao_instrutor', 'Tec. Segurança Do Trabalho',
    'linhas_por_pagina', 7
  )
);
