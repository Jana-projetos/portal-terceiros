-- Data de admissão (registro) e data de nascimento no cadastro do colaborador.
--
-- As duas datas vêm das colunas DATA DE REGISTRO e DATA DE NASCIMENTO da planilha CONTROLE_DE_INTEGRAÇÃO
-- (a carga é feita à parte, fora do repositório, porque a planilha tem dados pessoais) e, daqui em diante,
-- o fornecedor informa no cadastro do colaborador. Ficam vazias quando a planilha não tinha a data.
-- Quem vê: as mesmas regras do restante do cadastro (administrativo, o próprio fornecedor e o TST da obra).
-- O Painel da obra (engenharia) não mostra.

alter table public.colaboradores add column if not exists data_admissao date;
alter table public.colaboradores add column if not exists data_nascimento date;
comment on column public.colaboradores.data_admissao is 'Data de admissão (registro em carteira) na empresa terceira.';
comment on column public.colaboradores.data_nascimento is 'Data de nascimento.';

alter table public.colaboradores drop constraint if exists colaboradores_datas_coerentes;
alter table public.colaboradores add constraint colaboradores_datas_coerentes check (
  (data_nascimento is null or data_nascimento >= date '1930-01-01')
  and (data_admissao is null or data_admissao >= date '1960-01-01')
  and (data_nascimento is null or data_admissao is null or data_admissao > data_nascimento)
);

-- Datas no futuro não cabem numa regra fixa da tabela; a conferência fica aqui.
create or replace function app.colaboradores_conferir_datas() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.data_nascimento is not null and new.data_nascimento > current_date - interval '14 years' then
    raise exception 'Data de nascimento inválida: confira o ano';
  end if;
  if new.data_admissao is not null and new.data_admissao > current_date + 90 then
    raise exception 'Data de admissão muito à frente: confira a data';
  end if;
  return new;
end $$;

drop trigger if exists colaboradores_conferir_datas on public.colaboradores;
create trigger colaboradores_conferir_datas before insert or update of data_nascimento, data_admissao on public.colaboradores
  for each row execute function app.colaboradores_conferir_datas();
