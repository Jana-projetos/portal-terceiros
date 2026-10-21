-- Perfil da engenharia da obra: acompanha, só leitura, a integração, a conformidade documental e a
-- medição das obras ligadas ao acesso. Fica numa migração à parte porque o novo valor do enum só pode
-- ser usado depois de gravado.
alter type public.perfil_usuario add value if not exists 'engenharia';
