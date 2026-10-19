-- Remove a área temporária usada na carga da planilha CONTROLE_DE_INTEGRAÇÃO.
-- Os dados já estão nas tabelas do portal; a área guardava uma cópia da planilha com CPFs.
drop schema if exists migracao cascade;
