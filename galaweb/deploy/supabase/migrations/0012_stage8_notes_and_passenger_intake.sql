-- =========================================================
-- 0012 — Etapa 8: notas de paquetes, intake de pasajeros,
--        alojamiento (5 destinos + connection_tbd), hoteles
--        preferidos, documentos cifrados (AES-256-GCM + keyring),
--        auditoria de acceso a documentos y emails auditables.
--
-- Ejecutar UNA sola vez. NO ejecutar desde Claude.
-- Requiere public.set_updated_at() (migracion 0001).
--
-- Seguridad de datos:
--   * RLS activo + revoke: solo el backend (SUPABASE_SECRET_KEY) accede.
--   * FK compuestas (id, tenant_id): el motor garantiza que padre e hijo
--     comparten tenant, no solo el codigo de aplicacion.
--   * document_number NUNCA se guarda en claro: cifrado autenticado
--     (ver server/lib/passenger-crypto.js). Solo se guarda ciphertext,
--     iv, auth_tag, last4 y key_id.
--   * Borrado logico: FK sensibles con ON DELETE RESTRICT (nunca cascade).
-- =========================================================

begin;

-- ---------- 0. Objetivo de FK compuesta en bookings ----------
-- (id) ya es unico por PK; anadimos (id, tenant_id) como destino de FK.
alter table public.bookings
  drop constraint if exists uq_bookings_id_tenant;
alter table public.bookings
  add constraint uq_bookings_id_tenant unique (id, tenant_id);

-- ---------- A. Notas importantes por paquete ----------
create table public.tour_important_notes (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 text not null default 'hook-adventure',
  tour_id                   text not null,
  title_en                  text not null default '',
  title_es                  text not null default '',
  content_en                text not null default '',
  content_es                text not null default '',
  active                    boolean not null default true,
  requires_acknowledgement  boolean not null default false,
  display_order             integer not null default 0,
  created_by_user_id        uuid references auth.users(id),
  updated_by_user_id        uuid references auth.users(id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint chk_tin_display_order check (display_order >= 0)
);
create index idx_tin_tenant      on public.tour_important_notes (tenant_id);
create index idx_tin_tenant_tour on public.tour_important_notes (tenant_id, tour_id);
create index idx_tin_active      on public.tour_important_notes (active);

alter table public.tour_important_notes enable row level security;
revoke all on table public.tour_important_notes from anon, authenticated;

create trigger trg_tour_important_notes_updated_at
  before update on public.tour_important_notes
  for each row execute function public.set_updated_at();

-- ---------- B. Formulario de intake por reserva ----------
create table public.booking_passenger_forms (
  id                             uuid primary key default gen_random_uuid(),
  booking_id                     uuid not null,
  tenant_id                      text not null default 'hook-adventure',
  public_id                      uuid not null unique default gen_random_uuid(),
  token_version                  integer not null default 1,
  status                         text not null default 'pending',
  preferred_connection_city      text,
  international_flights_purchased boolean,
  ecuador_arrival_date           date,
  ecuador_arrival_time           text,
  arrival_airport                text,
  connection_notes               text,
  submission_version             integer not null default 0,
  review_cycle                   integer not null default 0,
  submitted_at                   timestamptz,
  reviewed_at                    timestamptz,
  reviewed_by_user_id            uuid references auth.users(id),
  changes_requested_note         text,
  expires_at                     timestamptz not null default (now() + interval '30 days'),
  active                         boolean not null default true,
  revoked_at                     timestamptz,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now(),
  constraint uq_bpf_booking     unique (booking_id),
  constraint uq_bpf_id_tenant   unique (id, tenant_id),
  constraint fk_bpf_booking_tenant foreign key (booking_id, tenant_id)
    references public.bookings (id, tenant_id) on delete restrict,
  constraint chk_bpf_token_version check (token_version > 0),
  constraint chk_bpf_expires check (expires_at > created_at),
  constraint chk_bpf_status check (status in
    ('pending','in_progress','submitted','reviewed','changes_requested','complete')),
  constraint chk_bpf_city check (preferred_connection_city is null
    or preferred_connection_city in ('quito','guayaquil','either')),
  constraint chk_bpf_revoked check ((active = true and revoked_at is null)
                                 or (active = false and revoked_at is not null))
);
create index idx_bpf_tenant     on public.booking_passenger_forms (tenant_id);
create index idx_bpf_status     on public.booking_passenger_forms (status);
create index idx_bpf_active     on public.booking_passenger_forms (active);
create index idx_bpf_expires_at on public.booking_passenger_forms (expires_at);

alter table public.booking_passenger_forms enable row level security;
revoke all on table public.booking_passenger_forms from anon, authenticated;

create trigger trg_booking_passenger_forms_updated_at
  before update on public.booking_passenger_forms
  for each row execute function public.set_updated_at();

-- ---------- C. Pasajeros (document_number CIFRADO, nunca en claro) ----------
create table public.booking_passengers (
  id                             uuid primary key default gen_random_uuid(),
  passenger_form_id              uuid not null,
  tenant_id                      text not null default 'hook-adventure',
  passenger_number               integer not null,
  legal_first_name               text not null default '',
  legal_middle_name              text,
  legal_last_name                text not null default '',
  date_of_birth                  date,
  nationality                    text,
  gender                         text,
  document_type                  text,
  -- Documento cifrado AES-256-GCM (AAD liga tenant+form+numero+tipo). Sin claro.
  document_number_ciphertext     text,
  document_number_iv             text,
  document_number_auth_tag       text,
  document_number_last4          text,
  document_number_key_id         text,
  document_expiration_date       date,
  issuing_country                text,
  special_assistance             text,
  dietary_requirements           text,
  -- Minimizacion: solo necesidades operativas de accesibilidad/movilidad,
  -- nunca diagnosticos ni historiales medicos.
  accessibility_or_mobility_needs text,
  baggage_notes                  text,
  active                         boolean not null default true,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now(),
  constraint uq_passenger_form_number unique (passenger_form_id, passenger_number),
  constraint fk_bp_form_tenant foreign key (passenger_form_id, tenant_id)
    references public.booking_passenger_forms (id, tenant_id) on delete restrict,
  constraint chk_bp_number check (passenger_number > 0),
  constraint chk_bp_doctype check (document_type is null
    or document_type in ('passport','national_id','other')),
  constraint chk_bp_gender check (gender is null
    or gender in ('male','female','x','undisclosed')),
  constraint chk_bp_last4 check (document_number_last4 is null
    or document_number_last4 ~ '^[0-9A-Za-z]{1,4}$')
);
create index idx_bp_form   on public.booking_passengers (passenger_form_id);
create index idx_bp_tenant on public.booking_passengers (tenant_id);

alter table public.booking_passengers enable row level security;
revoke all on table public.booking_passengers from anon, authenticated;

create trigger trg_booking_passengers_updated_at
  before update on public.booking_passengers
  for each row execute function public.set_updated_at();

-- ---------- D. Alojamiento normalizado (5 destinos + connection_tbd) ----------
-- No lleva booking_id: la reserva se obtiene via passenger_form_id ->
-- booking_passenger_forms.booking_id (evita apuntar a reservas distintas).
create table public.booking_lodging_requirements (
  id                       uuid primary key default gen_random_uuid(),
  passenger_form_id        uuid not null,
  tenant_id                text not null default 'hook-adventure',
  destination              text not null,
  lodging_required         boolean not null default true,
  check_in_date            date,
  check_out_date           date,
  nights                   integer,
  guest_count              integer,
  rooms_required           integer,
  room_preferences         text,
  approximate_budget_cents integer,
  accessibility_notes      text,
  lodging_notes            text,
  source                   text not null default 'customer',
  status                   text not null default 'pending',
  active                   boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint fk_blr_form_tenant foreign key (passenger_form_id, tenant_id)
    references public.booking_passenger_forms (id, tenant_id) on delete restrict,
  constraint chk_blr_destination check (destination in
    ('quito','guayaquil','san_cristobal','santa_cruz','isabela','connection_tbd')),
  constraint chk_blr_source check (source in ('customer','itinerary','owner')),
  constraint chk_blr_status check (status in
    ('pending','ready_for_search','options_found','selected','booked','not_required')),
  constraint chk_blr_dates  check (check_in_date is null or check_out_date is null
                                   or check_out_date > check_in_date),
  constraint chk_blr_nights check (nights is null or nights >= 0),
  constraint chk_blr_nights_match check (check_in_date is null or check_out_date is null
                                   or nights is null
                                   or nights = (check_out_date - check_in_date)),
  constraint chk_blr_rooms  check (rooms_required is null or rooms_required >= 0),
  constraint chk_blr_guests check (guest_count is null or guest_count >= 1),
  constraint chk_blr_budget check (approximate_budget_cents is null or approximate_budget_cents >= 0),
  -- connection_tbd nunca debe llegar a busqueda hasta resolverse a quito/guayaquil.
  constraint chk_blr_tbd_pending check (destination <> 'connection_tbd'
    or status in ('pending','not_required'))
);
create index idx_blr_form        on public.booking_lodging_requirements (passenger_form_id);
create index idx_blr_tenant      on public.booking_lodging_requirements (tenant_id);
create index idx_blr_destination on public.booking_lodging_requirements (destination);
create index idx_blr_status      on public.booking_lodging_requirements (status);

-- Unicidad robusta con fechas NULL: no permite dos requerimientos ACTIVOS
-- identicos por (formulario, destino, entrada, salida). Un registro archivado
-- (active=false) libera el hueco para una decision operativa intencional.
create unique index uq_blr_active_form_dest_dates
  on public.booking_lodging_requirements
     (passenger_form_id, destination,
      coalesce(check_in_date,  date '0001-01-01'),
      coalesce(check_out_date, date '0001-01-01'))
  where active = true;

alter table public.booking_lodging_requirements enable row level security;
revoke all on table public.booking_lodging_requirements from anon, authenticated;

create trigger trg_booking_lodging_requirements_updated_at
  before update on public.booking_lodging_requirements
  for each row execute function public.set_updated_at();

-- ---------- E. Hoteles preferidos (configurable owner/admin) ----------
create table public.hotel_search_preferences (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          text not null default 'hook-adventure',
  destination        text not null,
  hotel_name         text not null,
  priority           integer not null default 1,
  active             boolean not null default true,
  preference_notes   text,
  -- El conector autorizado resolvera la identidad real del hotel en la etapa
  -- de busqueda; aqui NO se asume ningun ID de Booking/Google/Expedia.
  search_aliases     jsonb not null default '[]'::jsonb,
  provider_reference jsonb,
  created_by_user_id uuid references auth.users(id),
  updated_by_user_id uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint chk_hsp_destination check (destination in
    ('quito','guayaquil','san_cristobal','santa_cruz','isabela')),
  constraint chk_hsp_priority check (priority >= 1),
  constraint uq_hsp_dest_hotel unique (tenant_id, destination, hotel_name)
);
create index idx_hsp_tenant_dest on public.hotel_search_preferences (tenant_id, destination);
create index idx_hsp_active      on public.hotel_search_preferences (active);

alter table public.hotel_search_preferences enable row level security;
revoke all on table public.hotel_search_preferences from anon, authenticated;

create trigger trg_hotel_search_preferences_updated_at
  before update on public.hotel_search_preferences
  for each row execute function public.set_updated_at();

-- Semilla idempotente de preferencias iniciales (owner/admin puede editar).
insert into public.hotel_search_preferences (tenant_id, destination, hotel_name, priority, preference_notes) values
  ('hook-adventure','guayaquil','Holiday Inn (cercano al aeropuerto)',1,'Preferido por cercania al aeropuerto de Guayaquil.'),
  ('hook-adventure','san_cristobal','Miconia',1,'Primera opcion en San Cristobal.'),
  ('hook-adventure','san_cristobal','Casa Opuntia',2,'Segunda opcion en San Cristobal.')
on conflict (tenant_id, destination, hotel_name) do nothing;

-- ---------- F. Emails auditables (idempotency_key + historial de intentos) ----------
alter table public.email_notifications
  add column if not exists idempotency_key text;

-- Backfill: misma garantia previa (un correo por booking + tipo + destinatario
-- normalizado), ahora expresada como idempotency_key.
update public.email_notifications
  set idempotency_key = notification_type || ':' || booking_id::text || ':' || lower(btrim(recipient_email))
  where idempotency_key is null and recipient_email is not null;

-- La idempotencia pasa a basarse en idempotency_key: permite EVENTOS nuevos por
-- ronda/version (p.ej. changes_requested:{form}:cycle:2) sin perder historial,
-- algo que la restriccion antigua (booking_id, tipo, recipient) impedia.
alter table public.email_notifications drop constraint if exists uq_email_notification;
drop index if exists public.uq_email_notification_normalized;
create unique index uq_email_notification_idem
  on public.email_notifications (tenant_id, idempotency_key)
  where idempotency_key is not null;

create table public.email_notification_attempts (
  id                  uuid primary key default gen_random_uuid(),
  notification_id     uuid not null references public.email_notifications(id) on delete restrict,
  tenant_id           text not null default 'hook-adventure',
  attempt_number      integer not null,
  status              text not null,
  provider_message_id text,
  sanitized_error     text,
  recipient_masked    text,
  created_at          timestamptz not null default now(),
  constraint uq_ena_notif_attempt unique (notification_id, attempt_number),
  constraint chk_ena_status  check (status in ('pending','sent','failed')),
  constraint chk_ena_attempt check (attempt_number >= 1)
);
create index idx_ena_notification on public.email_notification_attempts (notification_id);
create index idx_ena_tenant       on public.email_notification_attempts (tenant_id);

alter table public.email_notification_attempts enable row level security;
revoke all on table public.email_notification_attempts from anon, authenticated;

-- Amplia los tipos permitidos con los 4 nuevos de la Etapa 8.
alter table public.email_notifications drop constraint if exists chk_email_notification_type;
alter table public.email_notifications add constraint chk_email_notification_type
  check (notification_type in (
    'customer_booking_confirmation','owner_booking_notification',
    'customer_quote_acknowledgement','owner_quote_notification',
    'customer_agency_confirmation','owner_agency_notification',
    'customer_passenger_form_invitation','owner_passenger_form_submitted',
    'customer_passenger_form_changes_requested','customer_passenger_form_completed'
  ));

-- ---------- G. Auditoria persistente de acceso a documentos ----------
-- NUNCA guarda numero de documento, ciphertext, token ni secretos.
create table public.passenger_document_access_audit (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            text not null default 'hook-adventure',
  passenger_id         uuid references public.booking_passengers(id) on delete restrict,
  passenger_form_id    uuid references public.booking_passenger_forms(id) on delete restrict,
  booking_id           uuid references public.bookings(id) on delete restrict,
  accessed_by_user_id  uuid references auth.users(id),
  accessed_by_role     text,
  action               text not null,
  access_reason        text,
  result               text not null,
  masked_ip            text,
  user_agent_sanitized text,
  created_at           timestamptz not null default now(),
  constraint chk_pdaa_action check (action in
    ('reveal','decrypt_failed','rotate_key','export_for_authorized_provider')),
  constraint chk_pdaa_result check (result in ('success','failure'))
);
create index idx_pdaa_tenant    on public.passenger_document_access_audit (tenant_id);
create index idx_pdaa_passenger on public.passenger_document_access_audit (passenger_id);
create index idx_pdaa_user      on public.passenger_document_access_audit (accessed_by_user_id);
create index idx_pdaa_created   on public.passenger_document_access_audit (created_at);

alter table public.passenger_document_access_audit enable row level security;
revoke all on table public.passenger_document_access_audit from anon, authenticated;

-- ---------- H. Rate limiting (endpoint publico del formulario) ----------
-- Ventana deslizante simple: una fila por peticion; se cuenta por bucket_key
-- (p.ej. IP enmascarada + accion) dentro de la ventana. Limpieza perezosa.
create table public.rate_limit_hits (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  text not null default 'hook-adventure',
  bucket_key text not null,
  created_at timestamptz not null default now()
);
create index idx_rlh_bucket_created on public.rate_limit_hits (bucket_key, created_at);
create index idx_rlh_created        on public.rate_limit_hits (created_at);

alter table public.rate_limit_hits enable row level security;
revoke all on table public.rate_limit_hits from anon, authenticated;

-- ---------- I. Columnas nuevas en bookings ----------
alter table public.bookings
  add column if not exists important_notes_snapshot      jsonb not null default '[]'::jsonb,
  add column if not exists notes_acknowledged_at         timestamptz,
  add column if not exists notes_acknowledgement_version text,
  add column if not exists passenger_intake_status       text not null default 'form_not_created',
  add column if not exists passenger_intake_completed_at timestamptz;

alter table public.bookings drop constraint if exists chk_bookings_intake_status;
alter table public.bookings add constraint chk_bookings_intake_status
  check (passenger_intake_status in
    ('form_not_created','form_pending','form_in_progress','form_submitted',
     'form_reviewed','changes_requested','logistics_ready'));

commit;
