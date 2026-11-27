-- =====================================================================
-- LOAN-IX Booking Engine — 0028_booking_deposits
-- Depósito del 30 % en reservas: plan de pago (completo o depósito + saldo),
-- fechas congeladas al reservar, pago del saldo y cancelación automática.
--
-- ORDEN DE DESPLIEGUE: aplicar en Preview, luego en Producción ANTES del merge.
-- Es aditiva: las reservas existentes quedan con
-- payment_plan = 'full' y las columnas nuevas en NULL, así que siguen siendo
-- válidas con las restricciones nuevas.
--
-- Cambios:
-- 1) bookings: columnas del plan de depósito/saldo + 3 checks nuevos
--    (chk_payment_plan, chk_balance_payment_method, chk_deposit_amounts).
-- 2) payment_status admite 'deposit_paid' (chk_payment_status y
--    chk_request_payment recreados, conservando todos los valores y ramas
--    de 0001/0002).
-- 3) email_notifications admite 9 tipos nuevos (chk_email_notification_type
--    recreado, conservando los 15 de 0019).
-- 4) Índice de apoyo para el barrido diario de saldos.
--
-- No borra tablas ni datos.
-- =====================================================================

begin;

-- 1) Columnas nuevas en bookings.
alter table public.bookings
  add column if not exists payment_plan text not null default 'full',
  add column if not exists deposit_cents int,
  add column if not exists balance_cents int,
  add column if not exists balance_due_date date,
  add column if not exists deposit_refundable_until date,
  add column if not exists balance_refundable_until date,
  add column if not exists deposit_paid_at timestamptz,
  add column if not exists balance_paid_at timestamptz,
  add column if not exists balance_payment_intent_id text unique,
  add column if not exists balance_payment_method text,
  add column if not exists balance_offline_note text,
  add column if not exists deposit_terms_version text,
  add column if not exists deposit_terms_accepted_at timestamptz,
  add column if not exists auto_cancelled_at timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists needs_review_reason text;

alter table public.bookings
  drop constraint if exists chk_payment_plan;
alter table public.bookings
  add constraint chk_payment_plan check (payment_plan in ('full', 'deposit'));

alter table public.bookings
  drop constraint if exists chk_balance_payment_method;
alter table public.bookings
  add constraint chk_balance_payment_method check (
    balance_payment_method is null
    or balance_payment_method in ('stripe', 'cash', 'transfer'));

-- Solo las reservas con depósito deben cuadrar: depósito + saldo = total.
-- Las de pago completo no se ven afectadas.
alter table public.bookings
  drop constraint if exists chk_deposit_amounts;
alter table public.bookings
  add constraint chk_deposit_amounts check (
    payment_plan <> 'deposit'
    or (deposit_cents is not null
        and balance_cents is not null
        and deposit_cents > 0
        and balance_cents > 0
        and deposit_cents + balance_cents = amount_cents
        and balance_due_date is not null));

-- 2) payment_status: se agrega 'deposit_paid' (depósito cobrado, saldo pendiente).
alter table public.bookings
  drop constraint if exists chk_payment_status;
alter table public.bookings
  add constraint chk_payment_status check (payment_status in (
    'pending', 'processing', 'paid', 'failed', 'refunded', 'not_required',
    'deposit_paid'));

alter table public.bookings
  drop constraint if exists chk_request_payment;
alter table public.bookings
  add constraint chk_request_payment check (
    (request_type = 'quote'
      and payment_status = 'not_required'
      and amount_cents is null)
    or
    (request_type = 'booking'
      and payment_status in ('pending', 'processing', 'paid', 'failed', 'refunded', 'deposit_paid')
      and amount_cents is not null
      and amount_cents > 0));

-- 3) email_notifications: tipos nuevos del depósito y del saldo.
alter table public.email_notifications
  drop constraint if exists chk_email_notification_type;
alter table public.email_notifications
  add constraint chk_email_notification_type check (notification_type in (
    -- 0007 (sin cambios)
    'customer_booking_confirmation', 'owner_booking_notification',
    'customer_quote_acknowledgement', 'owner_quote_notification',
    'customer_agency_confirmation', 'owner_agency_notification',
    -- 0014 (formulario de pasajeros)
    'customer_passenger_form_invitation', 'owner_passenger_form_submitted',
    'customer_passenger_form_changes_requested', 'customer_passenger_form_completed',
    -- 0019 (recordatorios pre-viaje)
    'pretrip_reminder_d7', 'pretrip_reminder_d5', 'pretrip_reminder_d3',
    'pretrip_reminder_d1', 'pretrip_reminder_d0',
    -- 0028 (depósito y saldo)
    'customer_deposit_confirmation', 'owner_deposit_notification',
    'balance_reminder_d7', 'balance_reminder_d6',
    'customer_deposit_cancelled', 'owner_deposit_cancelled',
    'customer_balance_receipt', 'owner_balance_received',
    'owner_payment_review'));

-- 4) Índice de apoyo para el barrido diario de saldos.
create index if not exists idx_bookings_tenant_plan_status_date
  on public.bookings (tenant_id, payment_plan, payment_status, booking_date);

commit;
