-- ============================================================================
-- Di Tiglio — limpeza da versão antiga
--
-- RODE ESTE ARQUIVO **ANTES** DE `schema.sql`, e SOMENTE se o seu projeto
-- Supabase já tinha a versão anterior do site instalada.
--
-- ATENÇÃO: isto APAGA os agendamentos e os cadastros de barbeiro existentes.
-- As contas de login (auth.users) NÃO são apagadas — os perfis são recriados
-- como clientes no próximo login, então recadastre os barbeiros pelo botão
-- "Sou barbeiro" depois de rodar o schema novo.
--
-- Se você tem agendamentos de verdade que não quer perder, exporte antes:
--   select * from public.appointments;
-- ============================================================================

drop trigger if exists on_auth_user_created on auth.users;

drop function if exists public.create_appointment(uuid, text, text, text, date, time);
drop function if exists public.get_booked_slots(uuid, date);
drop function if exists public.handle_new_barber();

drop table if exists public.appointments cascade;
drop table if exists public.barber_days_off cascade;
drop table if exists public.barbers cascade;
drop table if exists public.user_roles cascade;

-- Agora rode o arquivo schema.sql inteiro.
