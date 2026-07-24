-- LOAN-IX Booking Engine — Supabase schema (Step 1)

-- helper updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- bookings
create table if not exists public.bookings (
  id                        uuid primary key default gen_random_uuid(),
  booking_code              text not null unique,
  tenant_id                 text not null default 'hook-adventure',
  request_type              text not null default 'booking',
  tour_id                   text not null,
  tour_name                 text,
  unit                      text,
  booking_date              date,
  guests                    integer not null default 1,
  customer_name             text not null,
  customer_email            text not null,
  customer_phone            text,
  notes                     text,
  amount                    integer,
  currency                  text not null default 'usd',
  payment_status            text not null default 'pending',
  booking_status            text not null default 'new',
  stripe_payment_intent_id  text unique,
  metadata                  jsonb not null default '{}'::jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint chk_request_type   check (request_type in ('booking','quote')),
  constraint chk_unit           check (unit is null or unit in ('person','boat')),
  constraint chk_guests         check (guests > 0),
  constraint chk_payment_status check (payment_status in
      ('pending','processing','paid','failed','refunded','not_required')),
  constraint chk_booking_status check (booking_status in
      ('new','pending_payment','confirmed','cancelled','completed','failed')),
  constraint chk_request_payment check (
    (request_type = 'quote'
       and payment_status = 'not_required'
       and amount is null)
    or
    (request_type = 'booking'
       and payment_status in ('pending','processing','paid','failed','refunded')
       and amount is not null and amount > 0)
  )
);

comment on table public.bookings is
  'Reservas y cotizaciones. Las reservas se crean pending y las confirma el webhook de Stripe.';

create index if not exists idx_bookings_created_at     on public.bookings (created_at desc);
create index if not exists idx_bookings_tenant         on public.bookings (tenant_id);
create index if not exists idx_bookings_payment_status on public.bookings (payment_status);
create index if not exists idx_bookings_email          on public.bookings (customer_email);

drop trigger if exists trg_bookings_updated_at on public.bookings;
create trigger trg_bookings_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- stripe_webhook_events (idempotencia)
create table if not exists public.stripe_webhook_events (
  id              uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type      text not null,
  processed_at    timestamptz not null default now(),
  payload         jsonb
);

comment on table public.stripe_webhook_events is
  'Registro de eventos de Stripe procesados. stripe_event_id UNIQUE impide el doble procesamiento.';

-- Row Level Security (sin políticas para anon → solo el backend con service_role escribe)
alter table public.bookings              enable row level security;
alter table public.stripe_webhook_events enable row level security;
