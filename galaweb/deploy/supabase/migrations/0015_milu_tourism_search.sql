-- =========================================================
-- 0015 — Milu Turismo: jobs de búsqueda, subtareas con lease/retry,
--        opciones de vuelo/hotel, logística, registros de compra/reserva
--        internos, auditoría append-only, uso de IA (Haiku-only) y config.
--
-- Ejecutar UNA sola vez, DESPUÉS de 0012, 0013 y 0014. NO ejecutar desde
-- Claude. Aditiva y compatible: no altera precios, checkout, intake ni QR.
-- Requiere public.set_updated_at() (0001), bookings.uq_bookings_id_tenant y
-- booking_passenger_forms.uq_bpf_id_tenant (0014).
--
-- ENDURECIMIENTO DE INTEGRIDAD (revisión previa a aplicar):
--   · Integridad de tenant garantizada por el MOTOR (unique compuestas
--     (id, tenant_id) + FKs compuestas), no solo por el código.
--   · Cola robusta: claim/reclaim validan job padre (activo y en estado
--     reclamable), intentos, lease y parámetros; recuperación con backoff o
--     failed según intentos.
--   · Idempotencia de opciones: provider_result_key + result_version + índice
--     único parcial (una fila ACTIVA por clave lógica). Refresh versiona y
--     conserva historia (expired/inactive), no sobrescribe.
--   · Validaciones numéricas y de fechas por CHECK.
--   · Sin DELETE físico en Production: trigger BEFORE DELETE en las tablas de
--     datos; auditoría append-only (bloquea UPDATE y DELETE).
--
-- Política de conservación (sección 8):
--   · active=false (archivo lógico): jobs, opciones, logística, bookings, config.
--   · expired/cancelled (ciclo de vida): jobs y subtareas (status), opciones
--     (availability_status).
--   · Impiden DELETE por trigger: travel_search_jobs, travel_search_subtasks,
--     travel_flight_options, travel_hotel_options, travel_logistics,
--     travel_flight_bookings, travel_hotel_bookings, llm_usage_log.
--   · Append-only (UPDATE+DELETE bloqueados): travel_search_audit.
--   · Solo borrables en entorno local vacío (nunca Production): ninguna por
--     código; usar drop de esquema en un entorno de desarrollo aislado.
--
-- El LLM (Haiku) nunca es fuente de precio/disponibilidad; toda cifra proviene
-- de adapters. No incluye seeds que activen proveedores.
-- =========================================================

begin;

-- ---------- 0. Unique compuesta faltante en padre de 0014 (aditiva) ----------
-- Necesaria para la FK compuesta de travel_hotel_options.lodging_requirement_id.
-- id ya es PK (único), así que (id, tenant_id) es trivialmente único.
alter table public.booking_lodging_requirements
  drop constraint if exists uq_blr_id_tenant;
alter table public.booking_lodging_requirements
  add constraint uq_blr_id_tenant unique (id, tenant_id);

-- ---------- A. Job principal de búsqueda ----------
create table public.travel_search_jobs (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             text not null default 'hook-adventure',
  booking_id            uuid not null,
  passenger_form_id     uuid,
  search_type           text not null,
  status                text not null default 'queued',
  requested_by_user_id  uuid references auth.users(id),
  requirements_snapshot jsonb not null default '{}'::jsonb,   -- saneado, sin PII/documentos
  provider_status       jsonb not null default '{}'::jsonb,
  idempotency_key       text not null,
  started_at            timestamptz,
  completed_at          timestamptz,
  expires_at            timestamptz not null default (now() + interval '7 days'),
  sanitized_error       text,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint uq_tsj_id_tenant unique (id, tenant_id),
  constraint fk_tsj_booking_tenant foreign key (booking_id, tenant_id)
    references public.bookings (id, tenant_id) on delete restrict,
  constraint fk_tsj_form_tenant foreign key (passenger_form_id, tenant_id)
    references public.booking_passenger_forms (id, tenant_id) on delete restrict,
  constraint chk_tsj_type   check (search_type in ('flights','hotels','complete_trip')),
  constraint chk_tsj_status check (status in
    ('queued','running','completed','partial','failed','expired','cancelled'))
);
create unique index uq_tsj_active_idem
  on public.travel_search_jobs (tenant_id, idempotency_key) where active = true;
create index idx_tsj_tenant  on public.travel_search_jobs (tenant_id);
create index idx_tsj_booking on public.travel_search_jobs (booking_id);
create index idx_tsj_status  on public.travel_search_jobs (status);

alter table public.travel_search_jobs enable row level security;
revoke all on table public.travel_search_jobs from anon, authenticated;
create trigger trg_tsj_updated_at before update on public.travel_search_jobs
  for each row execute function public.set_updated_at();

-- ---------- B. Subtareas cortas con lease/retry ----------
create table public.travel_search_subtasks (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            text not null default 'hook-adventure',
  job_id               uuid not null,
  kind                 text not null,
  status               text not null default 'queued',
  attempt_count        integer not null default 0,
  max_attempts         integer not null default 3,
  timeout_ms           integer not null default 45000,
  next_attempt_at      timestamptz,
  locked_by            text,
  locked_at            timestamptz,
  lease_expires_at     timestamptz,
  heartbeat_at         timestamptz,
  last_sanitized_error text,
  progress             jsonb not null default '{}'::jsonb,
  started_at           timestamptz,
  completed_at         timestamptz,
  finished_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint uq_tss_id_tenant unique (id, tenant_id),
  constraint uq_tss_job_kind unique (job_id, kind),
  constraint fk_tss_job_tenant foreign key (job_id, tenant_id)
    references public.travel_search_jobs (id, tenant_id) on delete restrict,
  constraint chk_tss_kind   check (kind in
    ('flights_duffel','hotels_primary_provider','hotel_preferred_links',
     'anthropic_ranking','final_summary')),
  constraint chk_tss_status check (status in
    ('queued','running','completed','partial','failed','expired','cancelled')),
  constraint chk_tss_max_attempts check (max_attempts >= 1),
  constraint chk_tss_timeout check (timeout_ms > 0),
  constraint chk_tss_attempts check (attempt_count >= 0 and attempt_count <= max_attempts)
);
create index idx_tss_tenant on public.travel_search_subtasks (tenant_id);
create index idx_tss_job    on public.travel_search_subtasks (job_id);
create index idx_tss_ready  on public.travel_search_subtasks (tenant_id, status, created_at)
  where status in ('queued','partial');

alter table public.travel_search_subtasks enable row level security;
revoke all on table public.travel_search_subtasks from anon, authenticated;
create trigger trg_tss_updated_at before update on public.travel_search_subtasks
  for each row execute function public.set_updated_at();

-- ---------- C. Opciones de vuelo ----------
create table public.travel_flight_options (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             text not null default 'hook-adventure',
  search_job_id         uuid not null,
  booking_id            uuid not null,
  provider              text not null,
  provider_result_key   text not null,     -- clave estable del adapter (dedup)
  result_version        integer not null default 1,
  airline               text,
  source_reference      text,
  origin                text,
  destination           text,
  departure_at          timestamptz,
  arrival_at            timestamptz,
  return_departure_at   timestamptz,
  return_arrival_at     timestamptz,
  passenger_count       integer,
  cabin                 text,
  baggage_summary       text,
  fare_conditions       text,
  taxes_included        boolean,
  total_price_cents     integer,           -- oferta del proveedor (NO costo interno)
  currency              text default 'USD',
  purchase_url          text,              -- INTERNO (el equipo compra); nunca al cliente
  deeplink_expires_at   timestamptz,
  connection_risk       text,
  availability_status   text not null default 'searching',
  recommendation_score  numeric,
  recommendation_reason text,
  raw_snapshot_sanitized jsonb,
  checked_at            timestamptz,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint uq_tfo_id_tenant unique (id, tenant_id),
  constraint fk_tfo_job_tenant foreign key (search_job_id, tenant_id)
    references public.travel_search_jobs (id, tenant_id) on delete restrict,
  constraint fk_tfo_booking_tenant foreign key (booking_id, tenant_id)
    references public.bookings (id, tenant_id) on delete restrict,
  constraint chk_tfo_status check (availability_status in
    ('searching','api_quoted','official_link_only','manual_confirmation_required',
     'manual_confirmed','selected','approved_for_purchase','purchased',
     'rejected','expired','unavailable','provider_error','provider_no_content',
     'provider_not_configured')),
  constraint chk_tfo_conn check (connection_risk is null or connection_risk in ('low','medium','high')),
  constraint chk_tfo_version check (result_version >= 1),
  constraint chk_tfo_pax check (passenger_count is null or passenger_count >= 1),
  constraint chk_tfo_price check (total_price_cents is null or total_price_cents >= 0),
  constraint chk_tfo_score check (recommendation_score is null or (recommendation_score >= 0 and recommendation_score <= 100))
);
create index idx_tfo_job on public.travel_flight_options (search_job_id);
-- Idempotencia: una sola fila ACTIVA por clave lógica; refresh versiona y expira.
create unique index uq_tfo_active_key
  on public.travel_flight_options (search_job_id, provider, provider_result_key) where active = true;
create index idx_tfo_version
  on public.travel_flight_options (search_job_id, provider, provider_result_key, result_version);

alter table public.travel_flight_options enable row level security;
revoke all on table public.travel_flight_options from anon, authenticated;
create trigger trg_tfo_updated_at before update on public.travel_flight_options
  for each row execute function public.set_updated_at();

-- ---------- D. Opciones de hotel ----------
create table public.travel_hotel_options (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              text not null default 'hook-adventure',
  search_job_id          uuid not null,
  booking_id             uuid not null,
  lodging_requirement_id uuid,
  provider               text not null,
  provider_result_key    text not null,    -- clave estable del adapter (dedup)
  result_version         integer not null default 1,
  destination            text not null,
  hotel_name             text not null,
  preferred_hotel_id     uuid references public.hotel_search_preferences(id),
  is_preferred           boolean not null default false,
  is_airbnb              boolean not null default false,
  check_in_date          date,
  check_out_date         date,
  nights                 integer,
  rooms                  integer,
  guest_count            integer,
  room_type              text,
  breakfast_included     boolean,
  cancellation_summary   text,
  taxes_included         boolean,
  price_per_night_cents  integer,
  price_per_person_cents integer,
  total_price_cents      integer,          -- oferta del proveedor (NO costo interno)
  currency               text default 'USD',
  in_target_range        boolean,
  booking_url            text,             -- INTERNO (el equipo reserva); nunca al cliente
  location_notes         text,
  availability_status    text not null default 'searching',
  preferred_hotel_rejection_reason text,
  recommendation_score   numeric,
  recommendation_reason  text,
  raw_snapshot_sanitized jsonb,
  checked_at             timestamptz,
  active                 boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint uq_tho_id_tenant unique (id, tenant_id),
  constraint fk_tho_job_tenant foreign key (search_job_id, tenant_id)
    references public.travel_search_jobs (id, tenant_id) on delete restrict,
  constraint fk_tho_booking_tenant foreign key (booking_id, tenant_id)
    references public.bookings (id, tenant_id) on delete restrict,
  constraint fk_tho_lodging_tenant foreign key (lodging_requirement_id, tenant_id)
    references public.booking_lodging_requirements (id, tenant_id) on delete restrict,
  constraint chk_tho_dest check (destination in
    ('quito','guayaquil','san_cristobal','santa_cruz','isabela')),
  constraint chk_tho_status check (availability_status in
    ('searching','api_quoted','official_link_only','manual_confirmation_required',
     'manual_confirmed','selected','approved_for_booking','booked',
     'rejected','expired','unavailable','provider_error','not_in_provider_inventory',
     'provider_not_configured','provider_no_content')),
  constraint chk_tho_reject check (preferred_hotel_rejection_reason is null or
    preferred_hotel_rejection_reason in ('sold_out','capacity_unavailable','dates_unavailable',
    'exceeds_budget','unsuitable_cancellation','provider_error','not_in_provider_inventory')),
  constraint chk_tho_version check (result_version >= 1),
  constraint chk_tho_nights check (nights is null or nights >= 0),
  constraint chk_tho_rooms check (rooms is null or rooms >= 1),
  constraint chk_tho_guests check (guest_count is null or guest_count >= 1),
  constraint chk_tho_ppn check (price_per_night_cents is null or price_per_night_cents >= 0),
  constraint chk_tho_ppp check (price_per_person_cents is null or price_per_person_cents >= 0),
  constraint chk_tho_total check (total_price_cents is null or total_price_cents >= 0),
  constraint chk_tho_score check (recommendation_score is null or (recommendation_score >= 0 and recommendation_score <= 100)),
  constraint chk_tho_dates check (check_in_date is null or check_out_date is null or check_out_date > check_in_date)
);
create index idx_tho_job  on public.travel_hotel_options (search_job_id);
create index idx_tho_dest on public.travel_hotel_options (destination);
-- Idempotencia por requerimiento de alojamiento (null → centinela).
create unique index uq_tho_active_key
  on public.travel_hotel_options
     (search_job_id, provider, provider_result_key,
      coalesce(lodging_requirement_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where active = true;
create index idx_tho_version
  on public.travel_hotel_options (search_job_id, provider, provider_result_key, result_version);

alter table public.travel_hotel_options enable row level security;
revoke all on table public.travel_hotel_options from anon, authenticated;
create trigger trg_tho_updated_at before update on public.travel_hotel_options
  for each row execute function public.set_updated_at();

-- ---------- E. Logística global (una por reserva) ----------
create table public.travel_logistics (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              text not null default 'hook-adventure',
  booking_id             uuid not null,
  search_job_id          uuid,
  status                 text not null default 'searching',
  default_departure_date date,
  approved_departure_date date,
  default_return_date    date,
  approved_return_date   date,
  adjustment_reason      text,
  adjusted_by_user_id    uuid references auth.users(id),
  adjusted_at            timestamptz,
  customer_notified_at   timestamptz,
  active                 boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint uq_tl_booking unique (booking_id),
  constraint fk_tl_booking_tenant foreign key (booking_id, tenant_id)
    references public.bookings (id, tenant_id) on delete restrict,
  constraint fk_tl_job_tenant foreign key (search_job_id, tenant_id)
    references public.travel_search_jobs (id, tenant_id) on delete restrict,
  constraint chk_tl_status check (status in
    ('searching','options_ready','under_review','approved','purchasing',
     'partially_confirmed','fully_confirmed','customer_notified'))
);
create index idx_tl_tenant on public.travel_logistics (tenant_id);

alter table public.travel_logistics enable row level security;
revoke all on table public.travel_logistics from anon, authenticated;
create trigger trg_tl_updated_at before update on public.travel_logistics
  for each row execute function public.set_updated_at();

-- ---------- F. Registro de compra de vuelo (interno) ----------
create table public.travel_flight_bookings (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            text not null default 'hook-adventure',
  booking_id           uuid not null,
  flight_option_id     uuid,
  airline              text,
  flight_number        text,
  locator              text,
  confirmation_code    text,
  selected_by_user_id  uuid references auth.users(id),
  approved_by_user_id  uuid references auth.users(id),
  purchased_by_user_id uuid references auth.users(id),
  provider_cost_cents  integer,            -- costo interno (nunca al cliente)
  taxes_cents          integer,
  fees_cents           integer,
  final_paid_cents     integer,
  currency             text default 'USD',
  paid_by_user_id      uuid references auth.users(id),
  paid_at              timestamptz,
  supplier_reference   text,
  internal_notes       text,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint fk_tfb_booking_tenant foreign key (booking_id, tenant_id)
    references public.bookings (id, tenant_id) on delete restrict,
  constraint fk_tfb_option_tenant foreign key (flight_option_id, tenant_id)
    references public.travel_flight_options (id, tenant_id) on delete restrict,
  constraint chk_tfb_cost check (provider_cost_cents is null or provider_cost_cents >= 0),
  constraint chk_tfb_taxes check (taxes_cents is null or taxes_cents >= 0),
  constraint chk_tfb_fees check (fees_cents is null or fees_cents >= 0),
  constraint chk_tfb_paid check (final_paid_cents is null or final_paid_cents >= 0)
);
create index idx_tfb_booking on public.travel_flight_bookings (booking_id);

alter table public.travel_flight_bookings enable row level security;
revoke all on table public.travel_flight_bookings from anon, authenticated;
create trigger trg_tfb_updated_at before update on public.travel_flight_bookings
  for each row execute function public.set_updated_at();

-- ---------- G. Registro de reserva de hotel (interno) ----------
create table public.travel_hotel_bookings (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            text not null default 'hook-adventure',
  booking_id           uuid not null,
  hotel_option_id      uuid,
  destination          text,
  hotel_name           text,
  confirmation_code    text,
  check_in_date        date,
  check_out_date       date,
  rooms                integer,
  booked_by_user_id    uuid references auth.users(id),
  approved_by_user_id  uuid references auth.users(id),
  provider_cost_cents  integer,            -- costo interno (nunca al cliente)
  taxes_cents          integer,
  fees_cents           integer,
  final_paid_cents     integer,
  currency             text default 'USD',
  paid_by_user_id      uuid references auth.users(id),
  paid_at              timestamptz,
  supplier_reference   text,
  internal_notes       text,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint fk_thb_booking_tenant foreign key (booking_id, tenant_id)
    references public.bookings (id, tenant_id) on delete restrict,
  constraint fk_thb_option_tenant foreign key (hotel_option_id, tenant_id)
    references public.travel_hotel_options (id, tenant_id) on delete restrict,
  constraint chk_thb_cost check (provider_cost_cents is null or provider_cost_cents >= 0),
  constraint chk_thb_taxes check (taxes_cents is null or taxes_cents >= 0),
  constraint chk_thb_fees check (fees_cents is null or fees_cents >= 0),
  constraint chk_thb_paid check (final_paid_cents is null or final_paid_cents >= 0),
  constraint chk_thb_dates check (check_in_date is null or check_out_date is null or check_out_date > check_in_date)
);
create index idx_thb_booking on public.travel_hotel_bookings (booking_id);

alter table public.travel_hotel_bookings enable row level security;
revoke all on table public.travel_hotel_bookings from anon, authenticated;
create trigger trg_thb_updated_at before update on public.travel_hotel_bookings
  for each row execute function public.set_updated_at();

-- ---------- H. Auditoría append-only ----------
create table public.travel_search_audit (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         text not null default 'hook-adventure',
  booking_id        uuid,
  search_job_id     uuid,
  actor_type        text not null,
  actor_id          uuid,
  action            text not null,
  source            text,
  result            text not null,
  sanitized_details jsonb,
  created_at        timestamptz not null default now(),
  constraint chk_tsa_actor  check (actor_type in ('owner','admin','system')),
  constraint chk_tsa_result check (result in ('success','failure'))
);
create index idx_tsa_tenant  on public.travel_search_audit (tenant_id);
create index idx_tsa_job     on public.travel_search_audit (search_job_id);
create index idx_tsa_created on public.travel_search_audit (created_at);

alter table public.travel_search_audit enable row level security;
revoke all on table public.travel_search_audit from anon, authenticated;

create or replace function public.forbid_mutation_travel_search_audit()
returns trigger language plpgsql as $$
begin
  raise exception 'travel_search_audit is append-only';
end $$;
create trigger trg_forbid_mutation_travel_search_audit
  before update or delete on public.travel_search_audit
  for each row execute function public.forbid_mutation_travel_search_audit();

-- ---------- I. Log de uso de IA (Haiku-only v1) ----------
create table public.llm_usage_log (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          text not null default 'hook-adventure',
  job_id             uuid,
  booking_id         uuid,
  subtask_id         uuid,
  subtask_kind       text,
  model              text not null,          -- v1: siempre claude-haiku-4-5
  model_version      text,
  purpose            text not null,
  input_tokens       integer not null default 0,
  output_tokens      integer not null default 0,
  cache_read_tokens  integer not null default 0,
  cache_write_tokens integer not null default 0,
  estimated_cost_usd numeric not null default 0,
  latency_ms         integer,
  status             text not null default 'completed',
  created_at         timestamptz not null default now(),
  -- job_id/subtask_id, cuando existan, deben pertenecer al mismo tenant.
  constraint fk_llm_job_tenant foreign key (job_id, tenant_id)
    references public.travel_search_jobs (id, tenant_id) on delete restrict,
  constraint fk_llm_subtask_tenant foreign key (subtask_id, tenant_id)
    references public.travel_search_subtasks (id, tenant_id) on delete restrict,
  constraint chk_llm_in check (input_tokens >= 0),
  constraint chk_llm_out check (output_tokens >= 0),
  constraint chk_llm_cr check (cache_read_tokens >= 0),
  constraint chk_llm_cw check (cache_write_tokens >= 0),
  constraint chk_llm_cost check (estimated_cost_usd >= 0),
  constraint chk_llm_latency check (latency_ms is null or latency_ms >= 0)
);
create index idx_llm_tenant  on public.llm_usage_log (tenant_id);
create index idx_llm_job      on public.llm_usage_log (job_id);
create index idx_llm_booking  on public.llm_usage_log (booking_id);
create index idx_llm_created  on public.llm_usage_log (created_at);

alter table public.llm_usage_log enable row level security;
revoke all on table public.llm_usage_log from anon, authenticated;

-- ---------- J. Configuración de Milu (owner) ----------
create table public.milu_settings (
  id                           uuid primary key default gen_random_uuid(),
  tenant_id                    text not null unique default 'hook-adventure',
  hotel_target_min_cents       integer not null default 5000,     -- USD 50 pp/noche
  hotel_target_max_cents       integer not null default 20000,    -- USD 200 pp/noche
  llm_max_cost_per_call_usd    numeric not null default 0.50,
  llm_max_cost_per_job_usd     numeric not null default 2.00,
  llm_max_cost_per_booking_usd numeric not null default 5.00,
  llm_max_cost_daily_usd       numeric not null default 25.00,
  -- Modelo canónico v1: Haiku (por env ANTHROPIC_MILU_TOURISM_MODEL). Este
  -- espejo es informativo para el panel; NO habilita fallback automático.
  sonnet_enabled               boolean not null default false,
  primary_hotel_provider       text not null default 'manual',
  updated_by_user_id           uuid references auth.users(id),
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  constraint chk_ms_provider check (primary_hotel_provider in ('manual','duffel_stays','hotelbeds','expedia_rapid')),
  constraint chk_ms_min check (hotel_target_min_cents >= 0),
  constraint chk_ms_range check (hotel_target_max_cents >= hotel_target_min_cents),
  constraint chk_ms_caps check (llm_max_cost_per_call_usd >= 0 and llm_max_cost_per_job_usd >= 0
    and llm_max_cost_per_booking_usd >= 0 and llm_max_cost_daily_usd >= 0)
);
alter table public.milu_settings enable row level security;
revoke all on table public.milu_settings from anon, authenticated;
create trigger trg_ms_updated_at before update on public.milu_settings
  for each row execute function public.set_updated_at();

insert into public.milu_settings (tenant_id) values ('hook-adventure')
  on conflict (tenant_id) do nothing;

-- ---------- K. Funciones de cola (reclamo/recuperación endurecidas) ----------
-- Reclama UNA subtarea lista con FOR UPDATE SKIP LOCKED. Valida parámetros y
-- que el job padre esté activo y en estado reclamable. Rechaza (raise) worker
-- vacío o lease fuera de rango. Solo service_role.
create or replace function public.milu_claim_next_subtask(
  p_tenant text, p_worker text, p_lease_seconds integer
) returns public.travel_search_subtasks
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.travel_search_subtasks;
begin
  if p_tenant is null or length(btrim(p_tenant)) = 0 then
    raise exception 'milu_claim: invalid tenant';
  end if;
  if p_worker is null or length(btrim(p_worker)) = 0 then
    raise exception 'milu_claim: invalid worker';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 15 or p_lease_seconds > 300 then
    raise exception 'milu_claim: lease_seconds out of range (15-300)';
  end if;

  select s.* into v_row
    from public.travel_search_subtasks s
    join public.travel_search_jobs j
      on j.id = s.job_id and j.tenant_id = s.tenant_id
   where s.tenant_id = p_tenant
     and s.status in ('queued','partial')
     and s.attempt_count < s.max_attempts
     and (s.lease_expires_at is null or s.lease_expires_at < now())
     and (s.next_attempt_at is null or s.next_attempt_at <= now())
     and j.active = true
     and j.status in ('queued','running','partial')
   order by s.created_at asc
   for update of s skip locked
   limit 1;
  if not found then return null; end if;

  update public.travel_search_subtasks
     set status = 'running',
         locked_by = p_worker,
         locked_at = now(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         heartbeat_at = now(),
         attempt_count = attempt_count + 1,
         started_at = coalesce(started_at, now()),
         updated_at = now()
   where id = v_row.id
  returning * into v_row;
  return v_row;
end $$;

-- Recupera leases vencidos: requeue (con backoff) si quedan intentos, o failed
-- si se agotaron. Nunca toca subtareas de jobs cancelled/expired/failed/
-- completed/inactive. Devuelve {"requeued": n, "failed": n}. Solo service_role.
create or replace function public.milu_reclaim_expired_leases(p_tenant text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_requeued integer := 0; v_failed integer := 0;
begin
  with elig as (
    select s.id, s.attempt_count
      from public.travel_search_subtasks s
      join public.travel_search_jobs j on j.id = s.job_id and j.tenant_id = s.tenant_id
     where s.tenant_id = p_tenant and s.status = 'running'
       and s.lease_expires_at is not null and s.lease_expires_at < now()
       and j.active = true and j.status in ('queued','running','partial')
       and s.attempt_count < s.max_attempts
  ), upd as (
    update public.travel_search_subtasks s
       set status = 'queued', locked_by = null, locked_at = null,
           lease_expires_at = null, heartbeat_at = null,
           next_attempt_at = now() + make_interval(secs => least(300, 30 * greatest(s.attempt_count, 1))),
           updated_at = now()
      from elig where s.id = elig.id
    returning s.id
  ) select count(*) into v_requeued from upd;

  with elig2 as (
    select s.id
      from public.travel_search_subtasks s
      join public.travel_search_jobs j on j.id = s.job_id and j.tenant_id = s.tenant_id
     where s.tenant_id = p_tenant and s.status = 'running'
       and s.lease_expires_at is not null and s.lease_expires_at < now()
       and j.active = true and j.status in ('queued','running','partial')
       and s.attempt_count >= s.max_attempts
  ), upd2 as (
    update public.travel_search_subtasks s
       set status = 'failed', finished_at = now(), locked_by = null, locked_at = null,
           lease_expires_at = null, heartbeat_at = null, updated_at = now()
      from elig2 where s.id = elig2.id
    returning s.id
  ) select count(*) into v_failed from upd2;

  return jsonb_build_object('requeued', v_requeued, 'failed', v_failed);
end $$;

revoke execute on function public.milu_claim_next_subtask(text, text, integer) from public, anon, authenticated;
grant  execute on function public.milu_claim_next_subtask(text, text, integer) to service_role;
revoke execute on function public.milu_reclaim_expired_leases(text) from public, anon, authenticated;
grant  execute on function public.milu_reclaim_expired_leases(text) to service_role;

-- ---------- L. Sin DELETE físico (trigger en tablas de datos) ----------
-- Permite UPDATE (archivo lógico / cambios de estado) pero bloquea DELETE en
-- Production. La auditoría bloquea además UPDATE (append-only) más arriba.
create or replace function public.milu_forbid_physical_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'physical delete is not allowed on % (use active=false / expired)', tg_table_name;
end $$;

create trigger trg_no_delete_tsj  before delete on public.travel_search_jobs      for each row execute function public.milu_forbid_physical_delete();
create trigger trg_no_delete_tss  before delete on public.travel_search_subtasks  for each row execute function public.milu_forbid_physical_delete();
create trigger trg_no_delete_tfo  before delete on public.travel_flight_options   for each row execute function public.milu_forbid_physical_delete();
create trigger trg_no_delete_tho  before delete on public.travel_hotel_options    for each row execute function public.milu_forbid_physical_delete();
create trigger trg_no_delete_tl   before delete on public.travel_logistics        for each row execute function public.milu_forbid_physical_delete();
create trigger trg_no_delete_tfb  before delete on public.travel_flight_bookings  for each row execute function public.milu_forbid_physical_delete();
create trigger trg_no_delete_thb  before delete on public.travel_hotel_bookings   for each row execute function public.milu_forbid_physical_delete();
create trigger trg_no_delete_llm  before delete on public.llm_usage_log           for each row execute function public.milu_forbid_physical_delete();

commit;
