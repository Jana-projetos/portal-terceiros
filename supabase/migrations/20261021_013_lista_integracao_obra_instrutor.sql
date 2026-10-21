-- Lista de presença da integração: a declaração cita o nome da obra como está no cadastro
-- (controle de integração) e o rodapé usa "Instrutor(a)".
update public.modelos_documento
set conteudo = conteudo || jsonb_build_object('contratante', '{OBRA}', 'rotulo_instrutor', 'Instrutor(a)'),
    atualizado_em = now()
where codigo = 'lista_presenca_integracao';
