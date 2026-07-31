-- =========================================================
-- 0018 — Finanzas reales por reserva (Fase 9, Etapa 3)
-- ---------------------------------------------------------
-- PREPARADA, NO APLICADA. Requiere autorización del owner antes de ejecutar.
-- Añade:
--   1) Estado financiero por reserva: sin configurar / estimado / confirmado.
--   2) Líneas de costo itemizadas por reserva (categoría, cantidad, costo unitario…).
--
-- Diseño MÍNIMO y NO destructivo:
--   · REUTILIZA bookings.cost_cents (snapshot escalar existente que suma
--     finance-summary con el contrato null = "sin dato", nunca 0). Las líneas
--     de costo se "confirman" a mano por reserva y ENTONCES el servidor fija
--     cost_cents = SUMA(líneas activas) + cost_status='confirmed'. Nunca
--     automático, nunca sobre históricas.
--   · REUTILIZA tour_financial_settings (0010) como PLANTILLA de costos por
--     producto (no se toca aquí).
--   · Convención de la casa: FK compuesta (booking_id, tenant_id) →
--     bookings(id, tenant_id); set_updated_at(); RLS revoke (solo servidor);
--     montos integer en centavos con CHECK >= 0.
--
-- Restricciones respetadas: no toca Stripe; no cambia pagos confirmados; no
-- recalcula reservas históricas (solo re-etiqueta estado, sin cambiar dinero);
-- no borra datos (líneas con active=false = baja lógica).
-- =========================================================
begin;

-- 1) Estado financiero por reserva ------------------------------------------
alter table public.bookings
  add column if not exists cost_status text not null default 'unset',
  add column if not exists cost_confirmed_at timestamptz,
  add column if not exists cost_confirmed_by_user_id uuid references auth.users(id);

alter table public.bookings
  add constraint chk_bookings_cost_status
  check (cost_status in ('unset', 'estimated', 'confirmed'));

-- Clasificación inicial (SOLO etiqueta; NO cambia ningún monto): una reserva
-- que ya trae snapshot de costo de plantilla queda 'estimated'; sin costo →
-- 'unset'. OPCIONAL — el owner puede quitar este UPDATE si prefiere dejar todo
-- en 'unset' hasta revisar cada reserva.
update public.bookings
  set cost_status = 'estimated'
  where cost_cents is not null and cost_status = 'unset' and deleted_at is null;

-- 2) Líneas de costo por reserva (itemizado real) ---------------------------
create table public.booking_cost_lines (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            text not null default 'hook-adventure',
  booking_id           uuid not null,
  category             text not null,
  description          text,
  quantity             numeric(12,3) not null default 1,
  unit_cost_cents      integer not null,
  -- total = cantidad × costo unitario, calculado por la BASE DE DATOS (server-side,
  -- no manipulable desde el cliente). El endpoint también valida las entradas.
  total_cents          integer generated always as (round(quantity * unit_cost_cents)::integer) stored,
  currency             text not null default 'usd',
  vendor               text,
  notes                text,
  active               boolean not null default true,
  created_by_user_id   uuid references auth.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint fk_bcl_booking_tenant foreign key (booking_id, tenant_id)
    references public.bookings (id, tenant_id) on delete restrict,
  constraint chk_bcl_category check (category in (
    'flight', 'hotel_mainland', 'hotel_galapagos', 'operator', 'transport',
    'interisland_boat', 'food', 'fuel', 'captain', 'crew', 'bait_ice', 'guide',
    'entrance_fees', 'commission', 'taxes', 'other')),
  constraint chk_bcl_quantity check (quantity > 0),
  constraint chk_bcl_unit_cost check (unit_cost_cents >= 0)
);
create index idx_bcl_booking on public.booking_cost_lines (booking_id);
create index idx_bcl_tenant on public.booking_cost_lines (tenant_id);

alter table public.booking_cost_lines enable row level security;
revoke all on table public.booking_cost_lines from anon, authenticated;
create trigger trg_bcl_updated_at before update on public.booking_cost_lines
  for each row execute function public.set_updated_at();

commit;
