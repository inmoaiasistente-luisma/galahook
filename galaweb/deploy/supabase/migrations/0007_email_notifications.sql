-- =====================================================================
-- LOAN-IX Booking Engine — 0007_email_notifications
-- Registro idempotente de correos. La unicidad
-- (booking_id, notification_type, recipient_email) es la garantia de que
-- un mismo correo NUNCA se envia dos veces, aunque haya reintentos de
-- Stripe, doble clic o ejecucion concurrente.
-- Ejecutar UNA sola vez.
-- =====================================================================
begin;

create table public.email_notifications (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid not null references public.bookings(id) on delete cascade,
  tenant_id           text not null,
  notification_type   text not null,
  recipient_email     text not null,
  status              text not null default 'pending',
  provider_message_id text,
  attempts            integer not null default 0,
  last_error          text,
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint chk_email_notification_type check (notification_type in (
    'customer_booking_confirmation','owner_booking_notification',
    'customer_quote_acknowledgement','owner_quote_notification',
    'customer_agency_confirmation','owner_agency_notification')),
  constraint chk_email_status   check (status in ('pending','sending','sent','failed','skipped')),
  constraint chk_email_attempts check (attempts >= 0),
  constraint uq_email_notification unique (booking_id, notification_type, recipient_email)
);

comment on table public.email_notifications is
  'Un correo por (reserva, tipo, destinatario). La restriccion UNIQUE impide duplicados por reintentos de Stripe, doble clic o concurrencia.';

create index idx_email_notif_booking    on public.email_notifications (booking_id);
create index idx_email_notif_tenant     on public.email_notifications (tenant_id);
create index idx_email_notif_status     on public.email_notifications (status);
create index idx_email_notif_created_at on public.email_notifications (created_at desc);
create index idx_email_notif_recipient  on public.email_notifications (recipient_email);

-- reutiliza la funcion creada en la migracion 0001
create trigger trg_email_notifications_updated_at
  before update on public.email_notifications
  for each row execute function public.set_updated_at();

-- RLS activo y sin politicas: solo el backend (SUPABASE_SECRET_KEY) accede.
alter table public.email_notifications enable row level security;
revoke all on table public.email_notifications from anon, authenticated;

commit;
