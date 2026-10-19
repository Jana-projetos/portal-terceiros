-- Supabase concede por padrão estes privilégios nas tabelas do schema public
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage on all sequences in schema public to anon, authenticated;
