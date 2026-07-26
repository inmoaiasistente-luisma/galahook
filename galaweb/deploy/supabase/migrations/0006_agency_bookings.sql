-- =====================================================================
-- LOAN-IX Booking Engine — 0006_agency_bookings
-- Ventas directas (agencia / telefono / presencial) que no pasan por Stripe.
-- Migracion incremental con ALTER. No borra ni modifica pagos existentes.
-- Ejecutar UNA sola vez.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1) Columnas nuevas
-- ---------------------------------------------------------------------
alter table public.bookings add column if not exists sales_channel      text;
alter table public.bookings add column if not exists payment_method     text;
alter table public.bookings add column if not exists created_by_user_id uuid references auth.users(id);
alter table public.bookings add column if not exists created_by_name    text;
alter table public.bookings add column if not exists sold_at            timestamptz;

comment on column public.bookings.sales_channel is
  'Canal de venta: web (Stripe) o agency (venta directa registrada en el panel).';
comment on column public.bookings.sold_at is
  'FECHA CONTABLE: momento en que entro el dinero. Para agency = instante del registro; para web = paid_at. El resumen financiero filtra por esta columna, NO por booking_date.';
comment on column public.bookings.created_by_user_id is
  'Usuario del panel que registro la venta directa. Lo fija el servidor desde la sesion validada.';

-- ---------------------------------------------------------------------
-- 2) Backfill de las reservas existentes (todas son del canal web)
-- ---------------------------------------------------------------------
update public.bookings set sales_channel = 'web'
 where sales_channel is null;

update public.bookings set payment_method = 'stripe'
 where payment_method is null and stripe_payment_intent_id is not null;

-- La fecha contable de una reserva web es el instante del cobro (paid_at).
update public.bookings set sold_at = paid_at
 where sold_at is null
   and paid_at is not null;

-- ---------------------------------------------------------------------
-- 3) sales_channel pasa a obligatorio con default 'web'
-- ---------------------------------------------------------------------
alter table public.bookings alter column sales_channel set default 'web';
alter table public.bookings alter column sales_channel set not null;

-- ---------------------------------------------------------------------
-- 4) customer_email pasa a opcional: una venta presencial puede no tener
--    correo. El endpoint web sigue exigiendolo a nivel de API.
-- ---------------------------------------------------------------------
alter table public.bookings alter column customer_email drop not null;

-- ---------------------------------------------------------------------
-- 5) sold_at siempre poblado cuando hay cobro.
--    El webhook de Stripe escribe paid_at; este trigger deriva sold_at
--    sin necesidad de modificar el webhook. Asi el resumen financiero
--    incluye tanto las ventas web como las de agencia.
--
--    security definer + search_path = '' como endurecimiento estandar.
--    El cuerpo solo toca campos de NEW: no referencia ningun objeto que
--    necesite calificacion de esquema.
-- ---------------------------------------------------------------------
create or replace function public.sync_sold_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sold_at is null and new.paid_at is not null then
    new.sold_at := new.paid_at;
  end if;
  return new;
end;
$$;

comment on function public.sync_sold_at() is
  'Deriva sold_at (fecha contable) desde paid_at cuando falta, para que las ventas web entren en el resumen financiero sin modificar el webhook de Stripe.';

drop trigger if exists trg_bookings_sync_sold_at on public.bookings;
create trigger trg_bookings_sync_sold_at
  before insert or update of paid_at on public.bookings
  for each row execute function public.sync_sold_at();

-- ---------------------------------------------------------------------
-- 6) Constraints
-- ---------------------------------------------------------------------
alter table public.bookings drop constraint if exists chk_sales_channel;
alter table public.bookings add constraint chk_sales_channel
  check (sales_channel in ('web','agency'));

alter table public.bookings drop constraint if exists chk_payment_method;
alter table public.bookings add constraint chk_payment_method
  check (payment_method is null or payment_method in
    ('stripe','cash','card','bank_transfer','zelle','other'));

-- Integridad de la venta directa: exige el estado correcto y la trazabilidad
-- completa. booking_status admite confirmed/cancelled/completed para permitir
-- cancelar o cerrar una venta sin romper el constraint, pero bloquea los
-- estados new, pending_payment y failed, y cualquier request_type distinto
-- de 'booking'.
alter table public.bookings drop constraint if exists chk_agency_integrity;
alter table public.bookings add constraint chk_agency_integrity check (
  sales_channel <> 'agency'
  or (
    request_type = 'booking'
    and payment_status = 'paid'
    and booking_status in ('confirmed','cancelled','completed')
    and stripe_payment_intent_id is null
    and payment_method is not null
    and sold_at is not null
    and created_by_user_id is not null
    and created_by_name is not null
  )
);

-- ---------------------------------------------------------------------
-- 7) Indices
-- ---------------------------------------------------------------------
create index if not exists idx_bookings_sales_channel  on public.bookings (sales_channel);
create index if not exists idx_bookings_sold_at        on public.bookings (sold_at desc);
create index if not exists idx_bookings_created_by     on public.bookings (created_by_user_id);
create index if not exists idx_bookings_payment_method on public.bookings (payment_method);

-- ---------------------------------------------------------------------
-- 8) RLS sigue activo y sin politicas publicas (heredado de 0001/0002)
-- ---------------------------------------------------------------------
alter table public.bookings enable row level security;
revoke all on table public.bookings from anon, authenticated;

commit;
