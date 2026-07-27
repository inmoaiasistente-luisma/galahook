-- =====================================================================
-- LOAN-IX Booking Engine — 0010_finance_and_discounts
-- Costos por tour + reglas de descuento configurables + snapshot
-- financiero por reserva. NO modifica migraciones anteriores.
-- El orden importa: discount_rules antes que la FK de bookings.
-- Ejecutar UNA sola vez.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- A) COSTOS POR TOUR
-- ---------------------------------------------------------------------
create table public.tour_financial_settings (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           text not null,
  tour_id             text not null,
  cost_per_pax_cents  integer not null default 0,
  fixed_cost_cents    integer not null default 0,
  active              boolean not null default true,
  created_by_user_id  uuid references auth.users(id),
  updated_by_user_id  uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint uq_tour_financial unique (tenant_id, tour_id),
  constraint chk_cost_per_pax check (cost_per_pax_cents >= 0),
  constraint chk_cost_fixed   check (fixed_cost_cents  >= 0)
);

comment on table public.tour_financial_settings is
  'Costos por tour (fijo + por pax) para el modulo de finanzas. costo total = fixed_cost_cents + cost_per_pax_cents * guests. Cambiarlo NO altera reservas historicas.';

create index idx_tfs_tenant on public.tour_financial_settings (tenant_id);
create index idx_tfs_tour   on public.tour_financial_settings (tour_id);
create index idx_tfs_active on public.tour_financial_settings (active);

create trigger trg_tfs_updated_at before update on public.tour_financial_settings
  for each row execute function public.set_updated_at();

alter table public.tour_financial_settings enable row level security;
revoke all on table public.tour_financial_settings from anon, authenticated;

-- ---------------------------------------------------------------------
-- B) REGLAS DE DESCUENTO
-- ---------------------------------------------------------------------
create table public.discount_rules (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           text not null,
  name                text not null,
  tour_id             text,                     -- null = todos los tours pagables
  discount_type       text not null,
  percentage_bps      integer,
  amount_cents        integer,
  min_guests          integer not null default 1,
  max_guests          integer,
  starts_at           timestamptz,
  ends_at             timestamptz,
  priority            integer not null default 0,
  active              boolean not null default true,
  created_by_user_id  uuid references auth.users(id),
  updated_by_user_id  uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint chk_discount_type  check (discount_type in ('percentage','fixed_total','fixed_per_pax')),
  constraint chk_discount_value check (
    (discount_type = 'percentage'
      and percentage_bps between 1 and 10000 and amount_cents is null)
    or (discount_type in ('fixed_total','fixed_per_pax')
      and amount_cents > 0 and percentage_bps is null)),
  constraint chk_discount_guests check (min_guests >= 1 and (max_guests is null or max_guests >= min_guests)),
  constraint chk_discount_dates  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

comment on table public.discount_rules is
  'Reglas de descuento configurables por owner. Reemplazan al 20% fijo. No se borran fisicamente: se activan/desactivan con active. El servidor elige UNA regla, nunca acumula.';

create index idx_dr_tenant   on public.discount_rules (tenant_id);
create index idx_dr_tour     on public.discount_rules (tour_id);
create index idx_dr_active   on public.discount_rules (active);
create index idx_dr_starts   on public.discount_rules (starts_at);
create index idx_dr_ends     on public.discount_rules (ends_at);
create index idx_dr_priority on public.discount_rules (priority desc);

create trigger trg_dr_updated_at before update on public.discount_rules
  for each row execute function public.set_updated_at();

alter table public.discount_rules enable row level security;
revoke all on table public.discount_rules from anon, authenticated;

-- ---------------------------------------------------------------------
-- C) SNAPSHOT FINANCIERO EN BOOKINGS
-- ---------------------------------------------------------------------
alter table public.bookings add column if not exists gross_amount_cents integer;
alter table public.bookings add column if not exists discount_cents     integer not null default 0;
alter table public.bookings add column if not exists discount_rule_id   uuid references public.discount_rules(id);
alter table public.bookings add column if not exists cost_cents         integer;
alter table public.bookings add column if not exists pricing_snapshot   jsonb not null default '{}'::jsonb;

comment on column public.bookings.pricing_snapshot is
  'Fotografia comercial no secreta del calculo (precio base, unidad, guests, regla aplicada, costos usados, calculated_at). Cambiar costos/descuentos NO reescribe reservas ya creadas.';

-- Backfill seguro: gross = amount para las que ya tienen importe; el costo
-- historico NO se inventa (queda null). discount_cents ya es 0 por defecto.
update public.bookings
   set gross_amount_cents = amount_cents
 where amount_cents is not null and gross_amount_cents is null;

alter table public.bookings add constraint chk_booking_pricing check (
  (gross_amount_cents is null or gross_amount_cents >= 0)
  and discount_cents >= 0
  and (
    amount_cents is null
    or gross_amount_cents is null
    or (gross_amount_cents >= amount_cents
        and discount_cents = gross_amount_cents - amount_cents)
  )
);

create index idx_bookings_discount_rule on public.bookings (discount_rule_id);
create index idx_bookings_cost_cents     on public.bookings (cost_cents);

commit;
