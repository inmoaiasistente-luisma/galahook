-- =========================================================
-- 0019 — Fase 9: auditoría automática, documentos/comunicaciones
--        por reserva y recordatorios pre-viaje
-- ---------------------------------------------------------
-- PREPARADA, NO APLICADA. Requiere autorización del owner antes de ejecutar.
--
-- Añade CUATRO cosas, todas aditivas (no borra ni reescribe nada):
--   1) admin_audit_log — auditoría automática en segundo plano (usuario, fecha,
--      acción, valores antes/después). El owner NO escribe una razón: el
--      registro es automático.
--   2) booking_documents — documentos asociados a una reserva (tickets aéreos,
--      vouchers de hotel, itinerarios, instrucciones). Se guarda la REFERENCIA
--      (enlace + etiqueta), no el binario: no hay bucket de Storage en el
--      proyecto y no se introduce uno aquí.
--   3) booking_communications — bitácora de cada envío MANUAL desde la reserva
--      (destinatario, fecha/hora, tipo, estado, archivo enviado, usuario).
--      Va en tabla propia PORQUE email_notifications tiene
--      unique(booking_id, notification_type, recipient_email): esa restricción
--      es la garantía anti-duplicado de los correos transaccionales y NO debe
--      relajarse para permitir reenvíos manuales.
--   4) Recordatorios pre-viaje: 5 tipos nuevos en el CHECK de
--      email_notifications.notification_type + interruptor de pausa por reserva.
--      El UNIQUE existente da la idempotencia: cada etapa (7/5/3/1/0 días) se
--      envía como máximo UNA vez por reserva y destinatario.
--
-- Convención de la casa: FK compuesta (booking_id, tenant_id) →
-- bookings(id, tenant_id); set_updated_at(); RLS enable + revoke (solo el
-- backend con SUPABASE_SECRET_KEY); baja lógica con active=false.
--
-- Restricciones respetadas: no toca Stripe; no cambia pagos confirmados; no
-- recalcula reservas históricas; no borra datos ni funciones.
-- =========================================================
begin;

-- 1) Auditoría automática ----------------------------------------------------
create table public.admin_audit_log (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null default 'hook-adventure',
  actor_user_id uuid references auth.users(id),
  actor_email   text,
  actor_role    text,
  action        text not null,          -- p.ej. 'booking.update', 'cost_line.add'
  entity_type   text not null,          -- 'booking', 'package_price', 'content'…
  entity_id     text,                   -- uuid o clave de negocio (texto libre)
  before_data   jsonb,
  after_data    jsonb,
  created_at    timestamptz not null default now(),
  constraint chk_audit_actor_role check (
    actor_role is null or actor_role in ('owner', 'admin', 'staff'))
);
create index idx_audit_tenant_created on public.admin_audit_log (tenant_id, created_at desc);
create index idx_audit_entity on public.admin_audit_log (entity_type, entity_id);
create index idx_audit_actor on public.admin_audit_log (actor_user_id);

comment on table public.admin_audit_log is
  'Auditoría automática del panel admin. Se escribe en segundo plano y nunca bloquea la operación: si falla el registro, la acción del usuario continúa.';

alter table public.admin_audit_log enable row level security;
revoke all on table public.admin_audit_log from anon, authenticated;

-- 2) Documentos por reserva --------------------------------------------------
create table public.booking_documents (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          text not null default 'hook-adventure',
  booking_id         uuid not null,
  doc_type           text not null,
  label              text not null,
  url                text not null,
  notes              text,
  active             boolean not null default true,
  created_by_user_id uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint fk_bdoc_booking_tenant foreign key (booking_id, tenant_id)
    references public.bookings (id, tenant_id) on delete restrict,
  constraint chk_bdoc_type check (doc_type in (
    'air_ticket', 'hotel_voucher', 'itinerary', 'instructions',
    'insurance', 'receipt', 'other')),
  constraint chk_bdoc_url check (url ~* '^https://')
);
create index idx_bdoc_booking on public.booking_documents (booking_id);
create index idx_bdoc_tenant on public.booking_documents (tenant_id);

comment on table public.booking_documents is
  'Referencias a documentos del viajero (enlace https + etiqueta). No almacena binarios: el archivo vive en el servicio del owner y aquí se guarda el enlace que se envía al pasajero.';

alter table public.booking_documents enable row level security;
revoke all on table public.booking_documents from anon, authenticated;
create trigger trg_bdoc_updated_at before update on public.booking_documents
  for each row execute function public.set_updated_at();

-- 3) Bitácora de comunicaciones manuales -------------------------------------
create table public.booking_communications (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          text not null default 'hook-adventure',
  booking_id         uuid not null,
  channel            text not null default 'email',
  message_type       text not null,
  recipient          text not null,
  subject            text,
  body_preview       text,
  document_id        uuid references public.booking_documents(id),
  document_label     text,
  status             text not null default 'sent',
  provider_message_id text,
  error_message      text,
  sent_by_user_id    uuid references auth.users(id),
  sent_by_name       text,
  created_at         timestamptz not null default now(),
  constraint fk_bcomm_booking_tenant foreign key (booking_id, tenant_id)
    references public.bookings (id, tenant_id) on delete restrict,
  constraint chk_bcomm_channel check (channel in ('email', 'whatsapp')),
  constraint chk_bcomm_status check (status in ('sent', 'failed')),
  constraint chk_bcomm_type check (message_type in (
    'qr_resend', 'confirmation_resend', 'air_ticket', 'hotel_voucher',
    'itinerary', 'instructions', 'change_notice', 'reminder_manual', 'other'))
);
create index idx_bcomm_booking on public.booking_communications (booking_id, created_at desc);
create index idx_bcomm_tenant on public.booking_communications (tenant_id);
create index idx_bcomm_status on public.booking_communications (status);

comment on table public.booking_communications is
  'Un registro por envío MANUAL hecho desde el detalle de la reserva: destinatario, fecha/hora, tipo, estado, archivo enviado y usuario que ejecutó la acción. Los correos transaccionales automáticos siguen en email_notifications.';

alter table public.booking_communications enable row level security;
revoke all on table public.booking_communications from anon, authenticated;

-- 4) Recordatorios pre-viaje -------------------------------------------------
-- 4a) Interruptor por reserva (pausar / reanudar). Por defecto: activos.
alter table public.bookings
  add column if not exists reminders_paused boolean not null default false,
  add column if not exists reminders_paused_at timestamptz,
  add column if not exists reminders_paused_by_user_id uuid references auth.users(id);

-- 4b) Tipos nuevos en el CHECK. Se reescribe la lista COMPLETA (los seis tipos
--     originales de 0007 se conservan íntegros) y se añaden las cinco etapas.
--     La restricción uq_email_notification (booking_id, notification_type,
--     recipient_email) hace que cada etapa se envíe UNA sola vez.
alter table public.email_notifications
  drop constraint if exists chk_email_notification_type;

alter table public.email_notifications
  add constraint chk_email_notification_type check (notification_type in (
    -- 0007 (sin cambios)
    'customer_booking_confirmation', 'owner_booking_notification',
    'customer_quote_acknowledgement', 'owner_quote_notification',
    'customer_agency_confirmation', 'owner_agency_notification',
    -- 0014 (formulario de pasajeros) — ya en uso
    'customer_passenger_form_invitation', 'owner_passenger_form_submitted',
    'customer_passenger_form_changes_requested', 'customer_passenger_form_completed',
    -- 0019 (recordatorios pre-viaje: 7, 5, 3, 1 y 0 días antes)
    'pretrip_reminder_d7', 'pretrip_reminder_d5', 'pretrip_reminder_d3',
    'pretrip_reminder_d1', 'pretrip_reminder_d0'));

-- Índice de apoyo para el barrido diario del cron (reservas por fecha de viaje).
create index if not exists idx_bookings_tenant_booking_date
  on public.bookings (tenant_id, booking_date);

commit;
