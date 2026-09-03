-- Di Tiglio Barber Club — banco, autenticação e segurança
-- Execute este arquivo inteiro no SQL Editor do Supabase.

create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('admin', 'barber');
exception when duplicate_object then null;
end $$;

create table if not exists public.barbers (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  specialty text not null default 'Corte e barba' check (char_length(specialty) between 2 and 120),
  work_start time not null default '09:00',
  work_end time not null default '18:00',
  slot_minutes integer not null default 60 check (slot_minutes in (30, 45, 60, 90)),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (work_start < work_end)
);

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'barber'
);

create table if not exists public.barber_days_off (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers(id) on delete cascade,
  off_date date not null,
  created_at timestamptz not null default now(),
  unique (barber_id, off_date)
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers(id) on delete restrict,
  customer_name text not null check (char_length(customer_name) between 2 and 100),
  customer_phone text not null check (char_length(customer_phone) between 8 and 30),
  service text not null check (char_length(service) between 2 and 120),
  appointment_date date not null,
  appointment_time time not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (barber_id, appointment_date, appointment_time)
);

create index if not exists appointments_barber_date_idx on public.appointments (barber_id, appointment_date);
create index if not exists days_off_barber_date_idx on public.barber_days_off (barber_id, off_date);

create or replace function public.is_admin(check_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = check_user and role = 'admin');
$$;

create or replace function public.handle_new_barber()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  start_value time := '09:00';
  end_value time := '18:00';
  slot_value integer := 60;
begin
  if coalesce(new.raw_user_meta_data->>'work_start', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    start_value := (new.raw_user_meta_data->>'work_start')::time;
  end if;
  if coalesce(new.raw_user_meta_data->>'work_end', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    end_value := (new.raw_user_meta_data->>'work_end')::time;
  end if;
  if start_value >= end_value then start_value := '09:00'; end_value := '18:00'; end if;
  if coalesce(new.raw_user_meta_data->>'slot_minutes', '') in ('30','45','60','90') then
    slot_value := (new.raw_user_meta_data->>'slot_minutes')::integer;
  end if;

  insert into public.barbers (id, name, specialty, work_start, work_end, slot_minutes)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1)),
    coalesce(nullif(trim(new.raw_user_meta_data->>'specialty'), ''), 'Corte e barba'),
    start_value, end_value, slot_value
  ) on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'barber') on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_barber();

create or replace function public.get_booked_slots(p_barber_id uuid, p_date date)
returns table (appointment_time time)
language sql stable security definer set search_path = '' as $$
  select a.appointment_time from public.appointments a
  where a.barber_id = p_barber_id and a.appointment_date = p_date and a.status <> 'cancelled'
  order by a.appointment_time;
$$;

create or replace function public.create_appointment(
  p_barber_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_service text,
  p_date date,
  p_time time
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  selected_barber public.barbers%rowtype;
  new_id uuid;
  current_sp_date date := (now() at time zone 'America/Sao_Paulo')::date;
  current_sp_time time := (now() at time zone 'America/Sao_Paulo')::time;
  offset_minutes integer;
begin
  if char_length(trim(p_customer_name)) not between 2 and 100
    or char_length(trim(p_customer_phone)) not between 8 and 30
    or char_length(trim(p_service)) not between 2 and 120 then
    raise exception 'Revise seu nome, telefone e serviço.';
  end if;
  if p_date < current_sp_date or (p_date = current_sp_date and p_time <= current_sp_time) then
    raise exception 'Escolha um horário futuro.';
  end if;

  select * into selected_barber from public.barbers where id = p_barber_id and active = true;
  if not found then raise exception 'Barbeiro indisponível.'; end if;
  if exists (select 1 from public.barber_days_off where barber_id = p_barber_id and off_date = p_date) then
    raise exception 'Este barbeiro está de folga nesta data.';
  end if;
  if p_time < selected_barber.work_start or p_time + make_interval(mins => selected_barber.slot_minutes) > selected_barber.work_end then
    raise exception 'Horário fora do expediente.';
  end if;
  offset_minutes := (extract(epoch from (p_time - selected_barber.work_start)) / 60)::integer;
  if mod(offset_minutes, selected_barber.slot_minutes) <> 0 then raise exception 'Horário inválido.'; end if;

  insert into public.appointments (barber_id, customer_name, customer_phone, service, appointment_date, appointment_time)
  values (p_barber_id, trim(p_customer_name), trim(p_customer_phone), trim(p_service), p_date, p_time)
  returning id into new_id;
  return new_id;
exception when unique_violation then
  raise exception 'Este horário acabou de ser reservado. Escolha outro.';
end;
$$;

alter table public.barbers enable row level security;
alter table public.user_roles enable row level security;
alter table public.barber_days_off enable row level security;
alter table public.appointments enable row level security;

drop policy if exists "barbers_public_read" on public.barbers;
create policy "barbers_public_read" on public.barbers for select using (active = true or id = auth.uid() or public.is_admin());
drop policy if exists "barbers_update_own_or_admin" on public.barbers;
create policy "barbers_update_own_or_admin" on public.barbers for update to authenticated using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

drop policy if exists "roles_read_own_or_admin" on public.user_roles;
create policy "roles_read_own_or_admin" on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "days_off_public_read" on public.barber_days_off;
create policy "days_off_public_read" on public.barber_days_off for select using (true);
drop policy if exists "days_off_insert_own_or_admin" on public.barber_days_off;
create policy "days_off_insert_own_or_admin" on public.barber_days_off for insert to authenticated with check (barber_id = auth.uid() or public.is_admin());
drop policy if exists "days_off_delete_own_or_admin" on public.barber_days_off;
create policy "days_off_delete_own_or_admin" on public.barber_days_off for delete to authenticated using (barber_id = auth.uid() or public.is_admin());

drop policy if exists "appointments_read_own_or_admin" on public.appointments;
create policy "appointments_read_own_or_admin" on public.appointments for select to authenticated using (barber_id = auth.uid() or public.is_admin());
drop policy if exists "appointments_update_own_or_admin" on public.appointments;
create policy "appointments_update_own_or_admin" on public.appointments for update to authenticated using (barber_id = auth.uid() or public.is_admin()) with check (barber_id = auth.uid() or public.is_admin());

grant usage on schema public to anon, authenticated;
grant select on public.barbers, public.barber_days_off to anon, authenticated;
grant select, update on public.barbers to authenticated;
grant select on public.user_roles to authenticated;
grant insert, delete on public.barber_days_off to authenticated;
grant select, update on public.appointments to authenticated;
revoke insert, delete on public.appointments from anon, authenticated;
grant execute on function public.get_booked_slots(uuid, date) to anon, authenticated;
grant execute on function public.create_appointment(uuid, text, text, text, date, time) to anon, authenticated;
grant execute on function public.is_admin(uuid) to authenticated;

-- Depois que o dono criar a própria conta pelo site, transforme-a em administradora:
-- update public.user_roles set role = 'admin'
-- where user_id = (select id from auth.users where email = 'SEU-EMAIL@EXEMPLO.COM');
