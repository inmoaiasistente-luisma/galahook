-- =====================================================================
-- LOAN-IX Booking Engine — Supabase migración 0002_harden_bookings
-- Modifica el esquema EXISTENTE con ALTER TABLE. No elimina tablas ni datos.
-- 0001_init_bookings permanece INTACTA (ya aplicada en el proyecto real).
-- Ejecutar como un único script (transacción atómica).
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1) VALIDACIÓN de datos ANTES de endurecer NOT NULL.
--    Si hay filas incompatibles, se lanza un error y se hace ROLLBACK.
--    No se inventan ni se modifican datos automáticamente.
-- ---------------------------------------------------------------------
do $$
declare n_tour integer; n_date integer;
begin
  select count(*) into n_tour from public.bookings where tour_name is null;
  if n_tour > 0 then
    raise exception
      'Migración 0002 abortada: % fila(s) en public.bookings con tour_name NULL. Corrígelas antes de continuar.', n_tour;
  end if;

  select count(*) into n_date from public.bookings where booking_date is null;
  if n_date > 0 then
    raise exception
      'Migración 0002 abortada: % fila(s) en public.bookings con booking_date NULL. Corrígelas antes de continuar.', n_date;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2) bookings.amount  ->  bookings.amount_cents   (rename idempotente)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (
        select 1 from information_schema.columns
        where table_schema='public' and table_name='bookings' and column_name='amount'
      )
     and not exists (
        select 1 from information_schema.columns
        where table_schema='public' and table_name='bookings' and column_name='amount_cents'
      )
  then
    alter table public.bookings rename column amount to amount_cents;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3) Nueva columna paid_at (la fija el webhook en payment_intent.succeeded)
-- ---------------------------------------------------------------------
alter table public.bookings add column if not exists paid_at timestamptz;

-- ---------------------------------------------------------------------
-- 4) Endurecer NOT NULL (los datos ya fueron validados en el paso 1)
-- ---------------------------------------------------------------------
alter table public.bookings alter column tour_name    set not null;
alter table public.bookings alter column booking_date set not null;

-- ---------------------------------------------------------------------
-- 5) Recrear chk_request_payment usando amount_cents
-- ---------------------------------------------------------------------
alter table public.bookings drop constraint if exists chk_request_payment;
alter table public.bookings add constraint chk_request_payment check (
  (request_type = 'quote'
     and payment_status = 'not_required'
     and amount_cents is null)
  or
  (request_type = 'booking'
     and payment_status in ('pending','processing','paid','failed','refunded')
     and amount_cents is not null and amount_cents > 0)
);

-- ---------------------------------------------------------------------
-- 6) Índices (crea los que falten; conserva los ya creados en 0001)
-- ---------------------------------------------------------------------
create index if not exists idx_bookings_booking_date   on public.bookings (booking_date);
create index if not exists idx_bookings_booking_status on public.bookings (booking_status);
create index if not exists idx_bookings_created_at     on public.bookings (created_at desc);
create index if not exists idx_bookings_payment_status on public.bookings (payment_status);
create index if not exists idx_bookings_email          on public.bookings (customer_email);
create index if not exists idx_bookings_tenant         on public.bookings (tenant_id);

-- =====================================================================
-- stripe_webhook_events — estado de procesamiento + backfill seguro
-- =====================================================================

-- 7) Nuevas columnas (nullable de momento, para poder backfillear)
alter table public.stripe_webhook_events add column if not exists processing_status text;
alter table public.stripe_webhook_events add column if not exists received_at       timestamptz;
alter table public.stripe_webhook_events add column if not exists last_error        text;

-- 8) Backfill de eventos antiguos ya existentes
update public.stripe_webhook_events
   set processing_status = 'processed'
 where processing_status is null;

update public.stripe_webhook_events
   set received_at = coalesce(processed_at, now())
 where received_at is null;

-- 9) Ahora sí: defaults / NOT NULL, y aflojar processed_at
alter table public.stripe_webhook_events
  alter column processing_status set default 'received',
  alter column processing_status set not null;

alter table public.stripe_webhook_events
  alter column received_at set default now(),
  alter column received_at set not null;

alter table public.stripe_webhook_events
  alter column processed_at drop not null;

alter table public.stripe_webhook_events
  alter column processed_at drop default;

-- 10) CHECK de processing_status
alter table public.stripe_webhook_events drop constraint if exists chk_webhook_processing_status;
alter table public.stripe_webhook_events add constraint chk_webhook_processing_status
  check (processing_status in ('received','processing','processed','failed'));

-- =====================================================================
-- Seguridad: RLS activo (ya lo estaba) + revocar privilegios heredados.
-- Sin políticas públicas. Solo el backend (SUPABASE_SECRET_KEY) accede,
-- y su rol hace bypass de RLS (el revoke afecta solo a anon/authenticated).
-- =====================================================================
alter table public.bookings              enable row level security;
alter table public.stripe_webhook_events enable row level security;

revoke all on table public.bookings              from anon, authenticated;
revoke all on table public.stripe_webhook_events from anon, authenticated;

commit;
