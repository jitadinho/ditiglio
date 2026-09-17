-- ============================================================================
-- Di Tiglio Barber Club — banco completo
-- Execute este arquivo INTEIRO no SQL Editor do Supabase.
-- Pode ser executado mais de uma vez com segurança.
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ---------------------------------------------------------------- tipos -----
do $$ begin create type public.app_role as enum ('admin','barber','customer');
exception when duplicate_object then null; end $$;

do $$ begin create type public.appointment_status as enum
  ('pending_payment','confirmed','completed','cancelled','no_show');
exception when duplicate_object then null; end $$;

do $$ begin create type public.payment_status as enum
  ('pending','paid','failed','refunded','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin create type public.message_status as enum
  ('queued','sent','failed','skipped');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------ configuração --
create table if not exists public.settings (
  id integer primary key default 1 check (id = 1),
  deposit_percent integer not null default 40 check (deposit_percent between 0 and 100),
  payments_enabled boolean not null default false,
  whatsapp_enabled boolean not null default false,
  slot_step_minutes integer not null default 15 check (slot_step_minutes in (10,15,20,30)),
  min_lead_minutes integer not null default 30,
  min_cancel_hours integer not null default 2,
  birthday_discount_percent integer not null default 20 check (birthday_discount_percent between 0 and 100),
  birthday_coupon_days integer not null default 30,
  shop_phone text not null default '',
  shop_address text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ----------------------------------------------------------------- perfis ---
create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'customer'
);

create table if not exists public.barbers (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 100),
  specialty text not null default 'Corte e barba' check (char_length(specialty) between 2 and 120),
  phone text not null default '',
  work_start time not null default '09:00',
  work_end time not null default '19:00',
  lunch_start time default '12:00',
  lunch_end time default '13:00',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (work_start < work_end),
  check (lunch_start is null or lunch_end is null or lunch_start < lunch_end)
);

create table if not exists public.customers (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 3 and 120),
  email text not null,
  phone text not null check (char_length(phone) between 8 and 30),
  birth_date date not null check (birth_date between '1900-01-01' and '2100-01-01'),
  whatsapp_opt_in boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists customers_birthday_idx on public.customers
  ((extract(month from birth_date)), (extract(day from birth_date)));

-- --------------------------------------------------------------- serviços ---
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  description text not null default '',
  duration_minutes integer not null check (duration_minutes between 15 and 300),
  price_cents integer not null default 0 check (price_cents >= 0),
  sort_order integer not null default 0,
  active boolean not null default true
);

-- ----------------------------------------------------------------- planos ---
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tagline text not null default '',
  price_cents integer not null check (price_cents >= 0),
  period text not null default 'mensal',
  benefits text[] not null default '{}',
  highlight boolean not null default false,
  sort_order integer not null default 0,
  active boolean not null default true
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','active','past_due','cancelled')),
  started_at date,
  current_period_end date,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists subscriptions_customer_idx on public.subscriptions (customer_id);

-- ---------------------------------------------------------------- folgas ----
create table if not exists public.barber_days_off (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers(id) on delete cascade,
  off_date date not null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  unique (barber_id, off_date)
);
create index if not exists days_off_barber_date_idx on public.barber_days_off (barber_id, off_date);

-- ---------------------------------------------------------------- cupons ----
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  customer_id uuid references public.customers(id) on delete cascade,
  discount_percent integer not null check (discount_percent between 1 and 100),
  reason text not null default 'birthday',
  valid_from date not null default current_date,
  valid_until date not null,
  used_at timestamptz,
  used_appointment uuid,
  created_at timestamptz not null default now()
);
create index if not exists coupons_customer_idx on public.coupons (customer_id);

-- ---------------------------------------------------------- agendamentos ----
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  service_id uuid not null references public.services(id) on delete restrict,
  customer_name text not null check (char_length(customer_name) between 2 and 120),
  customer_phone text not null check (char_length(customer_phone) between 8 and 30),
  customer_email text not null default '',
  appointment_date date not null,
  start_time time not null,
  end_time time not null,
  price_cents integer not null default 0,
  deposit_cents integer not null default 0,
  discount_percent integer not null default 0,
  coupon_code text,
  status public.appointment_status not null default 'confirmed',
  notes text not null default '',
  cancelled_by uuid,
  cancel_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time < end_time),
  slot tsrange generated always as
    (tsrange((appointment_date + start_time), (appointment_date + end_time), '[)')) stored
);

do $$ begin
  alter table public.appointments
    add constraint appointments_no_overlap
    exclude using gist (barber_id with =, slot with &&)
    where (status <> 'cancelled');
exception when duplicate_table then null; when duplicate_object then null; end $$;

create index if not exists appointments_barber_date_idx on public.appointments (barber_id, appointment_date);
create index if not exists appointments_customer_idx on public.appointments (customer_id, appointment_date desc);

-- ------------------------------------------------------------ pagamentos ----
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('deposit','balance','full','plan')),
  appointment_id uuid references public.appointments(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  amount_cents integer not null check (amount_cents >= 0),
  provider text not null default 'manual',
  provider_ref text,
  status public.payment_status not null default 'pending',
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists payments_customer_idx on public.payments (customer_id, created_at desc);

-- --------------------------------------------------------- fila WhatsApp ----
create table if not exists public.message_queue (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  to_phone text not null,
  template text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.message_status not null default 'queued',
  scheduled_for timestamptz not null default now(),
  attempts integer not null default 0,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists message_queue_pending_idx on public.message_queue (status, scheduled_for);

-- ============================================================== funções =====

create or replace function public.is_admin(check_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = check_user and role = 'admin');
$$;

create or replace function public.is_staff(check_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = check_user and role in ('admin','barber'));
$$;

-- Cadastro automático: barbeiro OU cliente, conforme o metadado "role".
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  wanted text := coalesce(meta->>'role', 'customer');
  start_value time := '09:00';
  end_value   time := '19:00';
  lunch_a time := '12:00';
  lunch_b time := '13:00';
  birth date;
begin
  if wanted = 'barber' then
    if coalesce(meta->>'work_start','') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      start_value := (meta->>'work_start')::time; end if;
    if coalesce(meta->>'work_end','') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      end_value := (meta->>'work_end')::time; end if;
    if start_value >= end_value then start_value := '09:00'; end_value := '19:00'; end if;
    if coalesce(meta->>'lunch_start','') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      lunch_a := (meta->>'lunch_start')::time; end if;
    if coalesce(meta->>'lunch_end','') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      lunch_b := (meta->>'lunch_end')::time; end if;
    if lunch_a >= lunch_b then lunch_a := null; lunch_b := null; end if;

    insert into public.barbers (id, name, specialty, phone, work_start, work_end, lunch_start, lunch_end)
    values (
      new.id,
      coalesce(nullif(trim(meta->>'name'),''), split_part(new.email,'@',1)),
      coalesce(nullif(trim(meta->>'specialty'),''), 'Corte e barba'),
      coalesce(nullif(trim(meta->>'phone'),''), ''),
      start_value, end_value, lunch_a, lunch_b
    ) on conflict (id) do nothing;
    insert into public.user_roles (user_id, role) values (new.id, 'barber') on conflict (user_id) do nothing;
  else
    begin birth := (meta->>'birth_date')::date; exception when others then birth := null; end;
    insert into public.customers (id, full_name, email, phone, birth_date, whatsapp_opt_in)
    values (
      new.id,
      coalesce(nullif(trim(meta->>'full_name'),''), split_part(new.email,'@',1)),
      new.email,
      coalesce(nullif(trim(meta->>'phone'),''), '00000000'),
      coalesce(birth, date '1990-01-01'),
      coalesce((meta->>'whatsapp_opt_in')::boolean, true)
    ) on conflict (id) do nothing;
    insert into public.user_roles (user_id, role) values (new.id, 'customer') on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute procedure public.handle_new_user();

-- ------------------------------------------------- horários disponíveis -----
-- Respeita: jornada, almoço, folga, agendamentos existentes e antecedência.
create or replace function public.get_availability(
  p_barber_id uuid,
  p_date date,
  p_service_id uuid,
  p_exclude_appointment uuid default null
) returns table (slot_time time, slot_end time)
language plpgsql stable security definer set search_path = '' as $$
declare
  b public.barbers%rowtype;
  s public.services%rowtype;
  cfg public.settings%rowtype;
  cursor_time time;
  finish_time time;
  now_sp timestamp;
  guard integer := 0;
begin
  select * into cfg from public.settings where id = 1;
  select * into b from public.barbers where id = p_barber_id and active = true;
  if not found then return; end if;
  select * into s from public.services where id = p_service_id and active = true;
  if not found then return; end if;
  if exists (select 1 from public.barber_days_off d where d.barber_id = p_barber_id and d.off_date = p_date) then
    return;
  end if;

  now_sp := (now() at time zone 'America/Sao_Paulo');
  cursor_time := b.work_start;

  while cursor_time + make_interval(mins => s.duration_minutes) <= b.work_end loop
    guard := guard + 1;
    exit when guard > 300;                       -- proteção contra virada de dia
    finish_time := cursor_time + make_interval(mins => s.duration_minutes);
    exit when finish_time <= cursor_time;        -- passou da meia-noite

    if not (b.lunch_start is not null and b.lunch_end is not null
            and cursor_time < b.lunch_end and finish_time > b.lunch_start)
       and (p_date + cursor_time) > now_sp + make_interval(mins => cfg.min_lead_minutes)
       and not exists (
             select 1 from public.appointments a
             where a.barber_id = p_barber_id
               and a.appointment_date = p_date
               and a.status <> 'cancelled'
               and (p_exclude_appointment is null or a.id <> p_exclude_appointment)
               and a.start_time < finish_time
               and a.end_time > cursor_time)
    then
      slot_time := cursor_time; slot_end := finish_time; return next;
    end if;

    cursor_time := cursor_time + make_interval(mins => cfg.slot_step_minutes);
  end loop;
end;
$$;

-- -------------------------------------------------- validação compartilhada --
create or replace function public.assert_slot_is_free(
  p_barber_id uuid, p_service_id uuid, p_date date, p_time time, p_exclude uuid default null
) returns public.services
language plpgsql stable security definer set search_path = '' as $$
declare
  b public.barbers%rowtype;
  s public.services%rowtype;
  cfg public.settings%rowtype;
  finish_time time;
begin
  select * into cfg from public.settings where id = 1;
  select * into s from public.services where id = p_service_id and active = true;
  if not found then raise exception 'Serviço indisponível.'; end if;
  select * into b from public.barbers where id = p_barber_id and active = true;
  if not found then raise exception 'Barbeiro indisponível.'; end if;

  finish_time := p_time + make_interval(mins => s.duration_minutes);
  if finish_time <= p_time then raise exception 'Horário fora do expediente deste barbeiro.'; end if;

  if (p_date + p_time) <= (now() at time zone 'America/Sao_Paulo') + make_interval(mins => cfg.min_lead_minutes) then
    raise exception 'Escolha um horário com pelo menos % minutos de antecedência.', cfg.min_lead_minutes;
  end if;
  if exists (select 1 from public.barber_days_off d where d.barber_id = p_barber_id and d.off_date = p_date) then
    raise exception 'Este barbeiro está de folga nesta data.';
  end if;
  if p_time < b.work_start or finish_time > b.work_end then
    raise exception 'Horário fora do expediente deste barbeiro.';
  end if;
  if b.lunch_start is not null and b.lunch_end is not null
     and p_time < b.lunch_end and finish_time > b.lunch_start then
    raise exception 'Este horário cai no intervalo de almoço.';
  end if;
  if exists (
      select 1 from public.appointments a
      where a.barber_id = p_barber_id and a.appointment_date = p_date
        and a.status <> 'cancelled'
        and (p_exclude is null or a.id <> p_exclude)
        and a.start_time < finish_time and a.end_time > p_time) then
    raise exception 'Este horário acabou de ser reservado. Escolha outro.';
  end if;

  return s;
end;
$$;

-- ------------------------------------------------------------- agendar ------
create or replace function public.create_appointment(
  p_barber_id uuid,
  p_service_id uuid,
  p_date date,
  p_time time,
  p_coupon_code text default null,
  p_notes text default '',
  p_customer_name text default null,
  p_customer_phone text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  cfg public.settings%rowtype;
  s public.services%rowtype;
  c public.customers%rowtype;
  cup public.coupons%rowtype;
  final_price integer;
  disc integer := 0;
  dep integer := 0;
  new_status public.appointment_status;
  new_id uuid;
  v_name text; v_phone text; v_email text := '';
begin
  if uid is null then raise exception 'Entre na sua conta para agendar.'; end if;
  select * into cfg from public.settings where id = 1;
  s := public.assert_slot_is_free(p_barber_id, p_service_id, p_date, p_time);

  select * into c from public.customers where id = uid;
  if found then
    v_name := c.full_name; v_phone := c.phone; v_email := c.email;
  elsif public.is_staff(uid) then
    v_name := trim(coalesce(p_customer_name, ''));
    v_phone := trim(coalesce(p_customer_phone, ''));
    if char_length(v_name) < 2 or char_length(v_phone) < 8 then
      raise exception 'Informe nome e telefone do cliente.';
    end if;
  else
    raise exception 'Complete seu cadastro antes de agendar.';
  end if;

  final_price := s.price_cents;
  if p_coupon_code is not null and trim(p_coupon_code) <> '' then
    select * into cup from public.coupons
      where upper(code) = upper(trim(p_coupon_code))
        and used_at is null
        and (customer_id is null or customer_id = uid)
        and p_date between valid_from and valid_until;
    if not found then raise exception 'Cupom inválido, expirado ou já utilizado.'; end if;
    disc := cup.discount_percent;
    final_price := round(s.price_cents * (100 - disc) / 100.0);
  end if;

  if cfg.payments_enabled and cfg.deposit_percent > 0 then
    dep := round(final_price * cfg.deposit_percent / 100.0);
    new_status := 'pending_payment';
  else
    dep := round(final_price * cfg.deposit_percent / 100.0); -- valor informativo do sinal
    new_status := 'confirmed';
  end if;

  insert into public.appointments (
    barber_id, customer_id, service_id, customer_name, customer_phone, customer_email,
    appointment_date, start_time, end_time, price_cents, deposit_cents,
    discount_percent, coupon_code, status, notes)
  values (
    p_barber_id, c.id, p_service_id, v_name, v_phone, v_email,
    p_date, p_time, p_time + make_interval(mins => s.duration_minutes),
    final_price, dep, disc, nullif(trim(coalesce(p_coupon_code,'')),''), new_status,
    left(coalesce(p_notes,''), 500))
  returning id into new_id;

  if cup.id is not null then
    update public.coupons set used_at = now(), used_appointment = new_id where id = cup.id;
  end if;

  if cfg.payments_enabled and dep > 0 then
    insert into public.payments (kind, appointment_id, customer_id, amount_cents, status)
    values ('deposit', new_id, c.id, dep, 'pending');
  end if;

  insert into public.message_queue (customer_id, to_phone, template, payload)
  values (c.id, v_phone,
    case when new_status = 'pending_payment' then 'appointment_awaiting_payment' else 'appointment_confirmed' end,
    jsonb_build_object(
      'name', v_name, 'service', s.name, 'date', to_char(p_date,'DD/MM/YYYY'),
      'time', to_char(p_time,'HH24:MI'), 'appointment_id', new_id,
      'price', to_char(final_price/100.0,'FM999990.00'),
      'deposit', to_char(dep/100.0,'FM999990.00')));

  return new_id;
exception when exclusion_violation then
  raise exception 'Este horário acabou de ser reservado. Escolha outro.';
end;
$$;

-- ------------------------------------------------------------ cancelar ------
create or replace function public.cancel_appointment(p_id uuid, p_reason text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  a public.appointments%rowtype;
  cfg public.settings%rowtype;
  is_owner boolean;
  is_pro boolean;
begin
  if uid is null then raise exception 'Você precisa estar conectado.'; end if;
  select * into cfg from public.settings where id = 1;
  select * into a from public.appointments where id = p_id;
  if not found then raise exception 'Agendamento não encontrado.'; end if;
  if a.status = 'cancelled' then raise exception 'Este agendamento já foi cancelado.'; end if;

  is_owner := a.customer_id = uid;
  is_pro := a.barber_id = uid or public.is_admin(uid);
  if not (is_owner or is_pro) then raise exception 'Sem permissão para cancelar.'; end if;

  if is_owner and not is_pro
     and (a.appointment_date + a.start_time) < (now() at time zone 'America/Sao_Paulo') + make_interval(hours => cfg.min_cancel_hours) then
    raise exception 'Cancelamentos só até % horas antes. Fale com a barbearia.', cfg.min_cancel_hours;
  end if;

  update public.appointments
    set status = 'cancelled', cancelled_by = uid,
        cancel_reason = left(coalesce(p_reason,''), 300), updated_at = now()
    where id = p_id;

  update public.coupons set used_at = null, used_appointment = null where used_appointment = p_id;
  update public.payments set status = 'cancelled' where appointment_id = p_id and status = 'pending';

  insert into public.message_queue (customer_id, to_phone, template, payload)
  values (a.customer_id, a.customer_phone, 'appointment_cancelled',
    jsonb_build_object('name', a.customer_name, 'date', to_char(a.appointment_date,'DD/MM/YYYY'),
                       'time', to_char(a.start_time,'HH24:MI'), 'by', case when is_owner then 'cliente' else 'barbearia' end));
end;
$$;

-- ------------------------------------------------------------ remarcar ------
create or replace function public.reschedule_appointment(
  p_id uuid, p_date date, p_time time, p_service_id uuid default null, p_barber_id uuid default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  a public.appointments%rowtype;
  s public.services%rowtype;
  target_service uuid;
  target_barber uuid;
begin
  if uid is null then raise exception 'Você precisa estar conectado.'; end if;
  select * into a from public.appointments where id = p_id;
  if not found then raise exception 'Agendamento não encontrado.'; end if;
  if a.status = 'cancelled' then raise exception 'Agendamento cancelado não pode ser remarcado.'; end if;
  if not (a.customer_id = uid or a.barber_id = uid or public.is_admin(uid)) then
    raise exception 'Sem permissão para remarcar.'; end if;

  target_service := coalesce(p_service_id, a.service_id);
  target_barber := coalesce(p_barber_id, a.barber_id);
  s := public.assert_slot_is_free(target_barber, target_service, p_date, p_time, p_id);

  update public.appointments
    set barber_id = target_barber, service_id = target_service,
        appointment_date = p_date, start_time = p_time,
        end_time = p_time + make_interval(mins => s.duration_minutes),
        price_cents = round(s.price_cents * (100 - a.discount_percent) / 100.0),
        status = (case when a.status = 'pending_payment' then 'pending_payment' else 'confirmed' end)::public.appointment_status,
        updated_at = now()
    where id = p_id;

  insert into public.message_queue (customer_id, to_phone, template, payload)
  values (a.customer_id, a.customer_phone, 'appointment_rescheduled',
    jsonb_build_object('name', a.customer_name, 'service', s.name,
                       'date', to_char(p_date,'DD/MM/YYYY'), 'time', to_char(p_time,'HH24:MI')));
exception when exclusion_violation then
  raise exception 'Este horário acabou de ser reservado. Escolha outro.';
end;
$$;

-- ------------------------------------------------ campanha de aniversário ---
create or replace function public.queue_birthday_campaign(p_date date default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  target date := coalesce(p_date, (now() at time zone 'America/Sao_Paulo')::date);
  cfg public.settings%rowtype;
  rec record;
  new_code text;
  total integer := 0;
begin
  select * into cfg from public.settings where id = 1;
  for rec in
    select c.* from public.customers c
    where extract(month from c.birth_date) = extract(month from target)
      and extract(day from c.birth_date) = extract(day from target)
      and c.whatsapp_opt_in = true
      and not exists (
        select 1 from public.coupons k
        where k.customer_id = c.id and k.reason = 'birthday'
          and extract(year from k.created_at at time zone 'America/Sao_Paulo') = extract(year from target))
  loop
    new_code := 'NIVER' || upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 6));
    insert into public.coupons (code, customer_id, discount_percent, reason, valid_from, valid_until)
    values (new_code, rec.id, cfg.birthday_discount_percent, 'birthday',
            target, target + cfg.birthday_coupon_days);

    insert into public.message_queue (customer_id, to_phone, template, payload)
    values (rec.id, rec.phone, 'birthday',
      jsonb_build_object('name', split_part(rec.full_name,' ',1), 'code', new_code,
                         'discount', cfg.birthday_discount_percent,
                         'valid_until', to_char(target + cfg.birthday_coupon_days,'DD/MM/YYYY')));
    total := total + 1;
  end loop;
  return total;
end;
$$;

-- ----------------------------------------------- lembrete 24h antes (cron) --
create or replace function public.queue_appointment_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  target date := ((now() at time zone 'America/Sao_Paulo')::date + 1);
  total integer := 0;
begin
  insert into public.message_queue (customer_id, to_phone, template, payload)
  select a.customer_id, a.customer_phone, 'appointment_reminder',
         jsonb_build_object('name', a.customer_name, 'service', s.name,
                            'date', to_char(a.appointment_date,'DD/MM/YYYY'),
                            'time', to_char(a.start_time,'HH24:MI'))
  from public.appointments a
  join public.services s on s.id = a.service_id
  where a.appointment_date = target
    and a.status in ('confirmed','pending_payment')
    and not exists (
      select 1 from public.message_queue m
      where m.template = 'appointment_reminder'
        and m.payload->>'date' = to_char(a.appointment_date,'DD/MM/YYYY')
        and m.to_phone = a.customer_phone
        and m.payload->>'time' = to_char(a.start_time,'HH24:MI'));
  get diagnostics total = row_count;
  return total;
end;
$$;

-- ================================================================= RLS ======

alter table public.settings          enable row level security;
alter table public.user_roles        enable row level security;
alter table public.barbers           enable row level security;
alter table public.customers         enable row level security;
alter table public.services          enable row level security;
alter table public.plans             enable row level security;
alter table public.subscriptions     enable row level security;
alter table public.barber_days_off   enable row level security;
alter table public.coupons           enable row level security;
alter table public.appointments      enable row level security;
alter table public.payments          enable row level security;
alter table public.message_queue     enable row level security;

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select using (true);
drop policy if exists settings_admin on public.settings;
create policy settings_admin on public.settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists roles_read_own_or_admin on public.user_roles;
create policy roles_read_own_or_admin on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists barbers_public_read on public.barbers;
create policy barbers_public_read on public.barbers for select
  using (active = true or id = auth.uid() or public.is_admin());
drop policy if exists barbers_update_own_or_admin on public.barbers;
create policy barbers_update_own_or_admin on public.barbers for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

drop policy if exists customers_own on public.customers;
create policy customers_own on public.customers for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists customers_update_own on public.customers;
create policy customers_update_own on public.customers for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

drop policy if exists services_public_read on public.services;
create policy services_public_read on public.services for select using (active = true or public.is_staff());
drop policy if exists services_admin_write on public.services;
create policy services_admin_write on public.services for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists plans_public_read on public.plans;
create policy plans_public_read on public.plans for select using (active = true or public.is_admin());
drop policy if exists plans_admin_write on public.plans;
create policy plans_admin_write on public.plans for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists subscriptions_own on public.subscriptions;
create policy subscriptions_own on public.subscriptions for select to authenticated
  using (customer_id = auth.uid() or public.is_admin());
drop policy if exists subscriptions_insert_own on public.subscriptions;
create policy subscriptions_insert_own on public.subscriptions for insert to authenticated
  with check (customer_id = auth.uid());
drop policy if exists subscriptions_admin_write on public.subscriptions;
create policy subscriptions_admin_write on public.subscriptions for update to authenticated
  using (customer_id = auth.uid() or public.is_admin()) with check (customer_id = auth.uid() or public.is_admin());

drop policy if exists days_off_public_read on public.barber_days_off;
create policy days_off_public_read on public.barber_days_off for select using (true);
drop policy if exists days_off_write_own_or_admin on public.barber_days_off;
create policy days_off_write_own_or_admin on public.barber_days_off for insert to authenticated
  with check (barber_id = auth.uid() or public.is_admin());
drop policy if exists days_off_delete_own_or_admin on public.barber_days_off;
create policy days_off_delete_own_or_admin on public.barber_days_off for delete to authenticated
  using (barber_id = auth.uid() or public.is_admin());

drop policy if exists coupons_own on public.coupons;
create policy coupons_own on public.coupons for select to authenticated
  using (customer_id = auth.uid() or public.is_staff());
drop policy if exists coupons_admin_write on public.coupons;
create policy coupons_admin_write on public.coupons for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists appointments_read on public.appointments;
create policy appointments_read on public.appointments for select to authenticated
  using (customer_id = auth.uid() or barber_id = auth.uid() or public.is_admin());
drop policy if exists appointments_update_staff on public.appointments;
create policy appointments_update_staff on public.appointments for update to authenticated
  using (barber_id = auth.uid() or public.is_admin()) with check (barber_id = auth.uid() or public.is_admin());

drop policy if exists payments_own on public.payments;
create policy payments_own on public.payments for select to authenticated
  using (customer_id = auth.uid() or public.is_admin());

drop policy if exists message_queue_admin on public.message_queue;
create policy message_queue_admin on public.message_queue for select to authenticated
  using (public.is_admin());

-- =============================================================== grants =====
grant usage on schema public to anon, authenticated;

grant select on public.settings, public.services, public.plans,
                 public.barbers, public.barber_days_off to anon, authenticated;
grant select on public.customers, public.appointments, public.coupons,
                 public.payments, public.subscriptions, public.user_roles,
                 public.message_queue to authenticated;
grant update on public.barbers, public.customers, public.appointments, public.subscriptions to authenticated;
grant insert on public.subscriptions to authenticated;
grant insert, delete on public.barber_days_off to authenticated;
grant insert, update, delete on public.services, public.plans, public.coupons to authenticated;
grant update on public.settings to authenticated;

revoke insert, delete on public.appointments from anon, authenticated;
revoke insert, update, delete on public.message_queue from anon, authenticated;

grant execute on function public.get_availability(uuid, date, uuid, uuid) to anon, authenticated;
grant execute on function public.create_appointment(uuid, uuid, date, time, text, text, text, text) to authenticated;
grant execute on function public.cancel_appointment(uuid, text) to authenticated;
grant execute on function public.reschedule_appointment(uuid, date, time, uuid, uuid) to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.is_staff(uuid) to authenticated;
-- Rotinas internas: só a service_role (Edge Functions / cron) pode executar.
revoke execute on function public.queue_birthday_campaign(date) from public;
revoke execute on function public.queue_appointment_reminders() from public;
revoke execute on function public.assert_slot_is_free(uuid, uuid, date, time, uuid) from public;
revoke execute on function public.handle_new_user() from public;

-- ========================================================== dados iniciais ==

insert into public.services (name, description, duration_minutes, price_cents, sort_order)
select * from (values
  ('Corte',                        'Corte completo com finalização.',              30,  6000, 1),
  ('Barba',                        'Toalha quente, navalha e finalização.',        30,  4500, 2),
  ('Corte + Barba',                'O combo clássico da casa.',                    60,  9500, 3),
  ('Corte + Barba + Extra',        'Combo com sobrancelha, pigmentação ou hidratação.', 90, 13000, 4)
) as seed(name, description, duration_minutes, price_cents, sort_order)
where not exists (select 1 from public.services);

insert into public.plans (name, tagline, price_cents, benefits, highlight, sort_order)
select * from (values
  ('Essencial', 'Para quem mantém o corte sempre em dia.', 11900,
   array['2 cortes por mês','10% de desconto em barba','Agendamento prioritário'], false, 1),
  ('Premium', 'O mais escolhido do clube.', 19900,
   array['4 cortes por mês','2 barbas por mês','15% em produtos','Agendamento prioritário'], true, 2),
  ('Black', 'Barba e cabelo sempre impecáveis.', 29900,
   array['Cortes ilimitados','Barba ilimitada','20% em produtos','Horário reservado fixo'], false, 3)
) as seed(name, tagline, price_cents, benefits, highlight, sort_order)
where not exists (select 1 from public.plans);

-- ============================================================================
-- Depois de criar a conta do dono pelo site (botão "Sou barbeiro"), rode:
--
-- update public.user_roles set role = 'admin'
-- where user_id = (select id from auth.users where email = 'SEU-EMAIL@EXEMPLO.COM');
--
-- Para ligar pagamentos e WhatsApp quando estiver pronto:
-- update public.settings set payments_enabled = true, whatsapp_enabled = true where id = 1;
-- ============================================================================
