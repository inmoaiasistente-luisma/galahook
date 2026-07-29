# Milu Turismo — Design Document (automático-primero)

> Estado: **APROBADO** (arquitectura automático-primero + 5 reglas finales).
> Alcance de este doc: diseño de referencia para los bloques 8C–8F.
> **No** implementa código, **no** crea la migración 0015, **no** despliega Edge
> Functions, **no** crea secretos. La migración y las credenciales las ejecuta
> el owner manualmente.

## 0. Principio rector

Milu **busca automáticamente** vuelos y hoteles reales mediante *adapters* de
proveedores autorizados, **compara, prioriza y recomienda**, y presenta los
resultados **solo a owner/admin**. Anthropic **razona** (interpreta, compara,
deduplica, explica, traduce) pero **nunca** es fuente de precio, horario ni
disponibilidad: toda cifra proviene de un adapter o de una confirmación
autorizada, con su `checked_at`. La **compra y la reserva son siempre humanas e
internas**. El cliente recibe **únicamente** el itinerario final confirmado
(`customer_travel_confirmation`).

> **DECISIÓN CANÓNICA DE MODELOS (v1):**
> **PRIMERA VERSIÓN → Haiku-only.** Todas las tareas de IA usan exclusivamente
> Haiku 4.5. **FUTURO → Sonnet 5 opcional** para tareas complejas, activable solo
> por configuración (no rediseño). **OPUS → desactivado.** Sin routing automático,
> sin fallback automático, sin cambio silencioso de modelo.

## 1. Las cinco reglas finales (obligatorias)

1. **Compra/reserva exclusivamente internas.** No existe ningún flujo en el que
   el cliente compre por enlace. `purchase_url`/`booking_url` son **campos
   internos** que usa el equipo para comprar; **nunca** se envían al cliente. El
   cliente nunca recibe enlaces de compra, propuestas preliminares,
   comparaciones, costos, scores ni disponibilidad provisional.
2. **Duffel es candidato, no definitivo**, hasta pasar la **prueba de cobertura
   en sandbox** (matriz §9). Ruta sin resultado ⇒ estado `provider_no_content` +
   fallback manual autorizado.
3. **Worker en tareas cortas.** El job principal se descompone en subtareas
   (`flights_duffel`, `hotels_primary_provider`, `hotel_preferred_links`,
   `anthropic_ranking`, `final_summary`); cada una con timeout propio, guarda
   progreso, es reintentable e idempotente, puede terminar en `partial`, no
   borra resultados previos y libera el job para la siguiente ejecución. Ninguna
   petición HTTP queda abierta esperando a todos los proveedores.
4. **Costo Anthropic medido, no supuesto — Haiku-only en v1.** TODAS las tareas
   de IA usan exclusivamente **Haiku 4.5** en la primera versión (interpretación
   de requisitos, planificación, clasificación, normalización asistida,
   deduplicación, scoring, evaluación de conexiones, recomendaciones y su
   explicación, detección de datos incompletos, resúmenes, generación EN/ES,
   itinerario final y confirmación para revisión). Sin routing, sin Sonnet, sin
   Opus. El modelo se resuelve de `ANTHROPIC_MILU_TOURISM_MODEL` (valor inicial
   obligatorio `Haiku`) con flag `MILU_TOURISM_SONNET_ENABLED=false`; cambiar a
   Sonnet 5 en el futuro es **solo configuración**, con autorización del owner,
   nunca fallback ni cambio silencioso. Se registra por llamada: `model`,
   `model_version`, `purpose`, `input_tokens`, `output_tokens`,
   `cache_read_tokens`, `cache_write_tokens`, `estimated_cost_usd`, `job_id`,
   `booking_id`, `created_at`. Límites configurables por llamada / job / reserva
   / diario del tenant. QA mide el **costo real de una búsqueda completa con
   Haiku**; no se presupuesta Sonnet como costo operativo activo.
5. **Costos internos y márgenes** viven en el modelo interno
   (`provider_cost_cents`, `taxes_cents`, `fees_cents`, `final_paid_cents`,
   `currency`, `paid_by_user_id`, `paid_at`, `internal_notes`,
   `supplier_reference`), separados del dato del adapter, nunca enviados al
   adapter ni al cliente, integrables luego con Finanzas.

## 2. Reglas de negocio ya aprobadas (sin cambios)

- Ida = día de inicio del paquete; regreso = día final del paquete; ajustables
  por owner/admin con motivo.
- Orden de hoteles — **Guayaquil:** Holiday Inn (aeropuerto) → tradicionales
  comparables → alternativas logísticas → Airbnb. **San Cristóbal:** Miconia →
  Casa Opuntia → tradicionales comparables → Airbnb. **Santa Cruz / Isabela /
  Quito:** preferidos → tradicionales → alternativas → Airbnb.
- Rango objetivo **configurable** USD 50–200 pp/noche (preferencia, no garantía).
- Airbnb solo por vías oficiales/autorizadas (sin scraping/CAPTCHA/login).
- `customer_travel_confirmation` idempotente.
- No crear una novena función Vercel. Worker vía Supabase Edge Functions + cola.
- Fase 9 (rediseño Admin) empieza tras cerrar 8C–8F.

## 3. Fuentes y proveedores (auditoría)

**Vuelos.** Primario candidato **Duffel** (cubre LATAM y Avianca, sandbox, sin
mínimo; $3/orden emitida + 1% managed content + $2/ancillary + $0.005/búsqueda
excedente). Alternativa a auditar: **Amadeus Self-Service**. Respaldo manual:
deeplink oficial LATAM/Avianca / Aeroregional.

**Hoteles.** Evaluar **Duffel Stays** (unifica vendor con vuelos), **Hotelbeds
APItude**, **Amadeus Hotel Search**, **Expedia Rapid**; **Booking Demand** hoy
cerrado a registros. Boutique Galápagos (Miconia, Casa Opuntia) probablemente
fuera de inventario mayorista ⇒ `not_in_provider_inventory` + enlace oficial
**interno** + `manual_confirmation_required` + búsqueda de alternativas.

**Anthropic** (razonador): **v1 usa solo Haiku 4.5** ($1/$5 por millón de
tokens). Sonnet 5 ($3/$15, intro $2/$10 hasta 2026-08-31) queda preparado para
el futuro solo por configuración; Opus desactivado. Nunca fuente de datos.

## 4. Diagrama de jobs y subtareas (regla 3)

```
[admin-router: milu-search-start]
        │  (crea job 'queued' idempotente + N subtareas 'queued')
        ▼
[travel_search_jobs] ── 1..N ──► [travel_search_subtasks]
        │
        │   pg_cron (cada ~1 min)  ó  disparo tras enqueue
        ▼
[Supabase Edge Function: milu-worker]  (claim de 1 subtarea lista)
        │
        ├─ flights_duffel ........ adapter vuelos → travel_flight_options
        ├─ hotels_primary_provider adapter hoteles → travel_hotel_options
        ├─ hotel_preferred_links .. enlaces oficiales internos + estados
        ├─ anthropic_ranking ...... razona/dedup/scoring sobre lo guardado
        └─ final_summary .......... arma borrador de logística (interno)
        │
        │  cada subtarea: timeout propio · guarda progreso · retry limitado
        │  · idempotente · puede quedar 'partial' · libera el job
        ▼
[travel_search_jobs.status] = running → partial/completed/failed
        │
        ▼
[admin-router: milu-search-status]  ← panel hace polling
```

Reglas de la cola:
- Un `travel_search_subtasks` = una unidad de trabajo corta que **cabe** en el
  límite de una Edge Function.
- El worker toma **una** subtarea lista (`FOR UPDATE SKIP LOCKED`), la ejecuta
  con su `timeout_ms`, guarda `progress`, marca `completed`/`partial`/`failed`,
  incrementa `attempts` y **termina** (no procesa todo el viaje).
- Un proveedor caído deja su subtarea en `partial`/`failed` sin borrar las
  opciones de otras subtareas; el job global queda `partial` si al menos una
  subtarea entregó resultados utilizables.
- `attempts >= max_attempts` ⇒ subtarea `failed` con `sanitized_error`.
- Idempotencia: `(job_id, kind)` único; reejecutar una subtarea no duplica
  opciones (upsert por `source_reference`).

## 5. Esquema SQL propuesto — `supabase/migrations/0015_milu_tourism_search.sql`

> **Propuesta** (no es el archivo de migración; no ejecutar). Todas las tablas:
> `tenant_id`, **RLS activo + `revoke all from anon, authenticated`**, **sin
> DELETE físico** (archivo `active=false` + expiración), FKs compuestas
> `(…, tenant_id)` hacia `bookings(id, tenant_id)` donde aplique, CHECK en
> enums, `checked_at`/`expires_at`/versión para refresh, snapshots saneados.
> Requiere `public.set_updated_at()` (0001) y `bookings.uq_bookings_id_tenant`
> (0014). Orden: 0012 · 0013 · 0014 · **0015**.

```sql
begin;

-- A. Job principal ------------------------------------------------------------
create table public.travel_search_jobs (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             text not null default 'hook-adventure',
  booking_id            uuid not null,
  passenger_form_id     uuid,
  search_type           text not null,   -- flights | hotels | complete_trip
  status                text not null default 'queued',
  requested_by_user_id  uuid references auth.users(id),
  requirements_snapshot jsonb not null default '{}'::jsonb,  -- saneado, sin PII
  provider_status       jsonb not null default '{}'::jsonb,
  idempotency_key       text not null,
  started_at            timestamptz,
  completed_at          timestamptz,
  expires_at            timestamptz not null default (now() + interval '7 days'),
  sanitized_error       text,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint fk_tsj_booking_tenant foreign key (booking_id, tenant_id)
    references public.bookings (id, tenant_id) on delete restrict,
  constraint chk_tsj_type   check (search_type in ('flights','hotels','complete_trip')),
  constraint chk_tsj_status check (status in
    ('queued','running','completed','partial','failed','expired','cancelled'))
);
create unique index uq_tsj_active_idem
  on public.travel_search_jobs (tenant_id, idempotency_key) where active = true;
create index idx_tsj_booking on public.travel_search_jobs (booking_id);
create index idx_tsj_status  on public.travel_search_jobs (status);

-- B. Subtareas cortas (regla 3) ----------------------------------------------
create table public.travel_search_subtasks (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       text not null default 'hook-adventure',
  job_id          uuid not null references public.travel_search_jobs(id) on delete restrict,
  kind            text not null,   -- flights_duffel | hotels_primary_provider |
                                   -- hotel_preferred_links | anthropic_ranking | final_summary
  status          text not null default 'queued',
  attempts        integer not null default 0,
  max_attempts    integer not null default 3,
  timeout_ms      integer not null default 45000,
  locked_by       text,
  locked_at       timestamptz,
  started_at      timestamptz,
  finished_at     timestamptz,
  progress        jsonb not null default '{}'::jsonb,
  sanitized_error text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint uq_tss_job_kind unique (job_id, kind),
  constraint chk_tss_kind   check (kind in
    ('flights_duffel','hotels_primary_provider','hotel_preferred_links',
     'anthropic_ranking','final_summary')),
  constraint chk_tss_status check (status in
    ('queued','running','completed','partial','failed','expired')),
  constraint chk_tss_attempts check (attempts >= 0 and attempts <= max_attempts)
);
create index idx_tss_ready on public.travel_search_subtasks (status, kind)
  where status in ('queued','partial');

-- C. Opciones de vuelo --------------------------------------------------------
create table public.travel_flight_options (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             text not null default 'hook-adventure',
  search_job_id         uuid not null references public.travel_search_jobs(id) on delete restrict,
  booking_id            uuid not null,
  provider              text not null,       -- duffel | manual | amadeus
  airline               text,                -- LATAM | Avianca | ...
  source_reference      text,                -- id de oferta del proveedor
  origin                text,                -- UIO | GYE
  destination           text,                -- SCY
  departure_at          timestamptz,
  arrival_at            timestamptz,
  return_departure_at   timestamptz,
  return_arrival_at     timestamptz,
  passenger_count       integer,
  cabin                 text,
  baggage_summary       text,
  fare_conditions       text,
  taxes_included        boolean,
  total_price_cents     integer,             -- oferta del proveedor (no interno)
  currency              text default 'USD',
  purchase_url          text,                -- INTERNO (equipo compra); nunca al cliente
  deeplink_expires_at   timestamptz,
  connection_risk       text,                -- low | medium | high
  availability_status   text not null default 'searching',
  recommendation_score  numeric,
  recommendation_reason text,
  raw_snapshot_sanitized jsonb,
  checked_at            timestamptz,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint chk_tfo_status check (availability_status in
    ('searching','api_quoted','official_link_only','manual_confirmation_required',
     'manual_confirmed','selected','approved_for_purchase','purchased',
     'rejected','expired','unavailable','provider_error','provider_no_content')),
  constraint chk_tfo_conn check (connection_risk is null or connection_risk in ('low','medium','high'))
);
create index idx_tfo_job on public.travel_flight_options (search_job_id);
create unique index uq_tfo_active_ref on public.travel_flight_options
  (search_job_id, provider, coalesce(source_reference,'')) where active = true;

-- D. Opciones de hotel --------------------------------------------------------
create table public.travel_hotel_options (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             text not null default 'hook-adventure',
  search_job_id         uuid not null references public.travel_search_jobs(id) on delete restrict,
  booking_id            uuid not null,
  lodging_requirement_id uuid,
  provider              text not null,       -- duffel_stays | hotelbeds | manual | airbnb_link
  destination           text not null,       -- quito|guayaquil|san_cristobal|santa_cruz|isabela
  hotel_name            text not null,
  preferred_hotel_id    uuid references public.hotel_search_preferences(id),
  is_preferred          boolean not null default false,
  is_airbnb             boolean not null default false,
  check_in_date         date,
  check_out_date        date,
  nights                integer,
  rooms                 integer,
  guest_count           integer,
  room_type             text,
  breakfast_included    boolean,
  cancellation_summary  text,
  taxes_included        boolean,
  price_per_night_cents integer,
  price_per_person_cents integer,
  total_price_cents     integer,             -- oferta del proveedor (no interno)
  currency              text default 'USD',
  in_target_range       boolean,
  booking_url           text,                -- INTERNO (equipo reserva); nunca al cliente
  location_notes        text,
  availability_status   text not null default 'searching',
  preferred_hotel_rejection_reason text,     -- sold_out|capacity_unavailable|dates_unavailable|
                                             -- exceeds_budget|unsuitable_cancellation|provider_error|
                                             -- not_in_provider_inventory
  recommendation_score  numeric,
  recommendation_reason text,
  raw_snapshot_sanitized jsonb,
  checked_at            timestamptz,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint chk_tho_dest check (destination in
    ('quito','guayaquil','san_cristobal','santa_cruz','isabela')),
  constraint chk_tho_status check (availability_status in
    ('searching','api_quoted','official_link_only','manual_confirmation_required',
     'manual_confirmed','selected','approved_for_booking','booked',
     'rejected','expired','unavailable','provider_error','not_in_provider_inventory')),
  constraint chk_tho_reject check (preferred_hotel_rejection_reason is null or
    preferred_hotel_rejection_reason in ('sold_out','capacity_unavailable','dates_unavailable',
    'exceeds_budget','unsuitable_cancellation','provider_error','not_in_provider_inventory'))
);
create index idx_tho_job  on public.travel_hotel_options (search_job_id);
create index idx_tho_dest on public.travel_hotel_options (destination);

-- E. Logística global ---------------------------------------------------------
create table public.travel_logistics (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             text not null default 'hook-adventure',
  booking_id            uuid not null,
  search_job_id         uuid references public.travel_search_jobs(id),
  status                text not null default 'searching',
  default_departure_date date,
  approved_departure_date date,
  default_return_date   date,
  approved_return_date  date,
  adjustment_reason     text,
  adjusted_by_user_id   uuid references auth.users(id),
  adjusted_at           timestamptz,
  customer_notified_at  timestamptz,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint uq_tl_booking unique (booking_id),
  constraint fk_tl_booking_tenant foreign key (booking_id, tenant_id)
    references public.bookings (id, tenant_id) on delete restrict,
  constraint chk_tl_status check (status in
    ('searching','options_ready','under_review','approved','purchasing',
     'partially_confirmed','fully_confirmed','customer_notified'))
);

-- F. Registro de compra de vuelo (interno, regla 5) ---------------------------
create table public.travel_flight_bookings (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           text not null default 'hook-adventure',
  booking_id          uuid not null,
  flight_option_id    uuid references public.travel_flight_options(id),
  airline             text,
  flight_number       text,
  locator             text,               -- PNR
  confirmation_code   text,
  selected_by_user_id uuid references auth.users(id),
  approved_by_user_id uuid references auth.users(id),
  purchased_by_user_id uuid references auth.users(id),
  provider_cost_cents integer,            -- costo interno
  taxes_cents         integer,
  fees_cents          integer,
  final_paid_cents    integer,
  currency            text default 'USD',
  paid_by_user_id     uuid references auth.users(id),
  paid_at             timestamptz,
  supplier_reference  text,
  internal_notes      text,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint fk_tfb_booking_tenant foreign key (booking_id, tenant_id)
    references public.bookings (id, tenant_id) on delete restrict
);

-- G. Registro de reserva de hotel (interno, regla 5) --------------------------
create table public.travel_hotel_bookings (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           text not null default 'hook-adventure',
  booking_id          uuid not null,
  hotel_option_id     uuid references public.travel_hotel_options(id),
  destination         text,
  hotel_name          text,
  confirmation_code   text,
  check_in_date       date,
  check_out_date      date,
  rooms               integer,
  booked_by_user_id   uuid references auth.users(id),
  approved_by_user_id uuid references auth.users(id),
  provider_cost_cents integer,
  taxes_cents         integer,
  fees_cents          integer,
  final_paid_cents    integer,
  currency            text default 'USD',
  paid_by_user_id     uuid references auth.users(id),
  paid_at             timestamptz,
  supplier_reference  text,
  internal_notes      text,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint fk_thb_booking_tenant foreign key (booking_id, tenant_id)
    references public.bookings (id, tenant_id) on delete restrict
);

-- H. Auditoría append-only ----------------------------------------------------
create table public.travel_search_audit (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       text not null default 'hook-adventure',
  booking_id      uuid,
  search_job_id   uuid,
  actor_type      text not null,   -- owner | admin | system
  actor_id        uuid,
  action          text not null,
  source          text,
  result          text not null,   -- success | failure
  sanitized_details jsonb,
  created_at      timestamptz not null default now(),
  constraint chk_tsa_actor  check (actor_type in ('owner','admin','system')),
  constraint chk_tsa_result check (result in ('success','failure'))
);
-- trigger forbid_mutation (BEFORE UPDATE OR DELETE) → raise, igual que package_price_history.

-- I. Log de uso de LLM (regla 4) ---------------------------------------------
create table public.llm_usage_log (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          text not null default 'hook-adventure',
  job_id             uuid,
  booking_id         uuid,
  subtask_kind       text,
  model              text not null,   -- v1: siempre claude-haiku-4-5
  model_version      text,            -- id/fecha exacta del modelo usado
  purpose            text not null,   -- requirements_parse | dedupe | scoring | summary | translate ...
  input_tokens       integer not null default 0,
  output_tokens      integer not null default 0,
  cache_read_tokens  integer not null default 0,
  cache_write_tokens integer not null default 0,
  estimated_cost_usd numeric not null default 0,
  created_at         timestamptz not null default now()
);
create index idx_llm_job     on public.llm_usage_log (job_id);
create index idx_llm_booking on public.llm_usage_log (booking_id);
create index idx_llm_created on public.llm_usage_log (created_at);

-- J. Configuración Milu (owner) ----------------------------------------------
create table public.milu_settings (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 text not null unique default 'hook-adventure',
  hotel_target_min_cents    integer not null default 5000,    -- USD 50 pp/noche
  hotel_target_max_cents    integer not null default 20000,   -- USD 200 pp/noche
  llm_max_cost_per_call_usd numeric not null default 0.50,
  llm_max_cost_per_job_usd  numeric not null default 2.00,
  llm_max_cost_per_booking_usd numeric not null default 5.00,
  llm_max_cost_daily_usd    numeric not null default 25.00,
  -- Modelo canónico v1: Haiku. La selección real vive en el env del worker
  -- (ANTHROPIC_MILU_TOURISM_MODEL='Haiku' + MILU_TOURISM_SONNET_ENABLED=false).
  -- Este espejo es informativo para el panel; NO habilita fallback automático.
  sonnet_enabled            boolean not null default false,   -- reservado (futuro, requiere autorización)
  primary_hotel_provider    text not null default 'manual',   -- duffel_stays|hotelbeds|manual
  updated_by_user_id        uuid references auth.users(id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- RLS + revoke + triggers set_updated_at para todas las tablas mutables.
-- (Detalle completo en la migración 0015 cuando se apruebe su implementación.)

commit;
```

Diez tablas: `travel_search_jobs`, `travel_search_subtasks`, `travel_flight_options`,
`travel_hotel_options`, `travel_logistics`, `travel_flight_bookings`,
`travel_hotel_bookings`, `travel_search_audit`, `llm_usage_log`, `milu_settings`.

## 6. Contratos de adapters

Interfaz única en `server/lib/milu-adapters/` — un adapter por fuente, cambiable
sin reescribir Milu.

```
// Entrada normalizada (derivada de buildTravelRequirements + fechas resueltas).
// searchFlights(req) -> NormalizedFlightOption[]
//   req = { origin, destination, departure_date, return_date, passengers:[{age_category}],
//           baggage, cabin }
// Cada NormalizedFlightOption:
//   { provider, airline, source_reference, origin, destination,
//     departure_at, arrival_at, return_departure_at, return_arrival_at,
//     passenger_count, cabin, baggage_summary, fare_conditions, taxes_included,
//     total_price_cents, currency, purchase_url, deeplink_expires_at,
//     availability_status, raw_snapshot_sanitized, checked_at }
//
// searchHotels(lodgingRequirement, preferences, settings) -> NormalizedHotelOption[]
//   Cada NormalizedHotelOption:
//   { provider, destination, hotel_name, is_preferred, is_airbnb, check_in_date,
//     check_out_date, nights, rooms, guest_count, room_type, breakfast_included,
//     cancellation_summary, taxes_included, price_per_night_cents,
//     price_per_person_cents, total_price_cents, currency, in_target_range,
//     booking_url, location_notes, availability_status,
//     preferred_hotel_rejection_reason, raw_snapshot_sanitized, checked_at }
```

Reglas de todo adapter:
- **Nunca inventa** precios/disponibilidad; si el proveedor no devuelve una ruta
  o propiedad, marca `provider_no_content` / `not_in_provider_inventory`.
- `purchase_url`/`booking_url` validados contra el **allowlist** antes de
  devolverse; enlace fuera de lista ⇒ se descarta.
- Recibe **solo datos mínimos** (§ Seguridad); nunca documentos/tokens/secretos/
  finanzas.

Adapters previstos:
- **8C:** `manual` (respaldo, arma enlaces oficiales internos + estados) y
  `stub` para pruebas del pipeline sin proveedor vivo.
- **8D:** `duffel` (vuelos) tras pasar la matriz sandbox.
- **8E:** proveedor hotelero elegido (`duffel_stays`/`hotelbeds`/…) + `airbnb_link`.

## 7. Contrato del worker (Edge Function)

`milu-worker` (Supabase Edge Function, Deno). **No** procesa todo el viaje.

```
run():
  1. claim: SELECT 1 subtarea 'queued'|'partial' del tenant (FOR UPDATE SKIP LOCKED),
     status→'running', locked_by/locked_at, attempts+1.
  2. despacha por kind:
       flights_duffel            → adapter.searchFlights → upsert travel_flight_options
       hotels_primary_provider   → adapter.searchHotels  → upsert travel_hotel_options
       hotel_preferred_links     → manual.preferredLinks → upsert (official_link_only/manual_*)
       anthropic_ranking         → llm.rank(...)         → recommendation_score/reason (+llm_usage_log)
       final_summary             → llm.summary(...)      → travel_logistics (borrador interno)
  3. respeta timeout_ms; si excede → status 'partial' + progress, sin borrar lo hecho.
  4. cierra subtarea: 'completed' | 'partial' | 'failed' (+sanitized_error).
  5. recomputa job.status: completed si todas completed; partial si alguna partial/failed
     pero hay resultados; failed si todas failed.
  6. termina (una subtarea por invocación). El scheduler vuelve por la siguiente.
```

- **Disparo:** `pg_cron` (cada ~1 min) invoca `milu-worker`, o disparo tras
  `enqueue`. El worker itera claims mientras le quede presupuesto de tiempo.
- **Recuperación:** subtarea `running` con `locked_at` viejo (> lease) se
  reclama.
- **Idempotencia:** upsert por `source_reference`; reejecutar no duplica.
- **Aislamiento de proveedor:** un proveedor caído no afecta a las otras
  subtareas.
- **Secretos** (`DUFFEL_*`, proveedor hotelero, `ANTHROPIC_API_KEY`) viven en
  los *Edge Function secrets* de Supabase, no en Vercel. (No se crean ahora.)

## 8. Modelo de costos Anthropic (regla 4 — Haiku-only en v1)

- **Modelo único v1: Haiku 4.5** para TODAS las tareas de IA (interpretación,
  planificación, clasificación, normalización asistida, dedup, scoring,
  evaluación de conexiones, recomendaciones + explicación, detección de datos
  incompletos, resúmenes, EN/ES, itinerario y confirmación para revisión). **Sin
  routing, sin Sonnet, sin Opus.**
- **Selección por configuración, no por código:** `ANTHROPIC_MILU_TOURISM_MODEL`
  (valor inicial obligatorio `Haiku`), con flag `MILU_TOURISM_SONNET_ENABLED`
  (inicial `false`). Un helper `resolveMiluModel()` mapea `'Haiku'` →
  `claude-haiku-4-5`; solo si el flag está activado **y** el owner autoriza,
  `'Sonnet'` → `claude-sonnet-5`. **Nunca** hay fallback automático ni cambio
  silencioso; Opus nunca se resuelve.
- **Registro por llamada** en `llm_usage_log`: `model`, `model_version`,
  `purpose`, input/output/cache tokens, `estimated_cost_usd`, `job_id`,
  `booking_id`, `created_at`.
- **Límites** (`milu_settings`, configurables): por llamada / job / reserva /
  diario del tenant. Al superar un límite, la subtarea LLM se salta con
  `partial` y `sanitized_error='llm_budget_exceeded'` (nunca bloquea la parte de
  datos del adapter).
- **Prompt caching** del `requirements_snapshot` para abaratar refresh.
- **QA mide el costo real de una búsqueda completa con Haiku** y entrega mínimo,
  promedio, percentil alto y costo por búsqueda completa. **No** se presupuesta
  Sonnet como costo operativo activo; **no** se fija todavía una cifra definitiva.
- **Futura migración a Sonnet 5:** requiere autorización explícita del owner,
  infraestructura validada, presupuesto aprobado, pruebas de costo y calidad,
  feature flag activada y QA sin regresiones — **por configuración, no
  rediseño**.

## 9. Matriz sandbox de Duffel (criterio de aprobación — se ejecuta en 8D)

Rutas × aerolíneas × pasajeros, en **sandbox**:

| Ruta | LATAM | Avianca | adult | child | infant | equipaje | impuestos | expiración |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| GYE→SCY | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| UIO→SCY | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| SCY→GYE | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| SCY→UIO | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| ida+vuelta | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |

Aprobación Duffel ⇔ para las rutas cubiertas: devuelve opciones utilizables,
precio total coherente, horarios válidos, equipaje/condiciones normalizadas,
`checked_at`+`expires_at`, **sin inventar cobertura**. Ruta sin resultado ⇒
`provider_no_content` + fallback manual autorizado (no se descarta Duffel para
las rutas que sí cubre).

## 10. Handlers y rutas (todo por admin-router; sin 9ª función)

| Acción (ROUTES) | Rol | Bloque | Propósito |
|---|---|---|---|
| `milu-search-start` | owner/admin | 8C | crea job + subtareas (idempotente, gate) |
| `milu-search-status` | owner/admin/staff* | 8C | estado del job + opciones (staff: proyección reducida) |
| `milu-search-cancel` | owner/admin | 8C | cancela job/subtareas pendientes |
| `milu-options-list` | owner/admin | 8C | lista opciones vuelo/hotel del job |
| `milu-settings-get` | owner/admin | 8C | rango objetivo, caps, proveedor, modelo (Haiku v1) |
| `milu-settings-save` | owner | 8C | edita configuración |
| `milu-flight-select` / `milu-hotel-select` | owner/admin | 8F | selección |
| `milu-logistics-approve` | owner/admin | 8F | aprobar compra/reserva |
| `milu-booking-record` | owner/admin | 8F | registrar localizadores/costos internos |
| `milu-confirmation-send` | owner/admin | 8F | enviar `customer_travel_confirmation` |

`*staff`: `milu-search-status` con proyección reducida (sin presupuesto, sin
enlaces internos, solo logística aprobada); resto de acciones Milu → 403.

## 11. UI — subsección "Milu Turismo" (dentro de Pasajeros y logística)

- **8C (solo lectura + control de búsqueda):** requisitos del viaje; estado del
  job y subtareas; fuentes consultadas; última actualización; opciones (cuando
  existan) en solo lectura; alertas/errores saneados; **acciones Buscar /
  Actualizar / Cancelar**; **configuración** (rango objetivo, caps, opus flag,
  proveedor) para owner.
- **8F:** selección de vuelo/hoteles, aprobación, registro de compra/costos
  internos, marcar logística lista y enviar confirmación.
- **Staff:** vista reducida; sin presupuesto/enlaces internos; solo logística
  aprobada.

## 12. Confirmación al cliente

`customer_travel_confirmation` (idempotente por `idempotency_key`), enviado
**solo** al marcar la logística lista, construido desde
`travel_flight_bookings`/`travel_hotel_bookings` (localizadores confirmados) +
`travel_logistics`. Incluye vuelos (aerolínea, nº, origen/destino, fechas,
horarios, aeropuerto, equipaje, localizador, check-in), hoteles (hotel,
dirección, fechas, habitaciones, desayuno, instrucciones, código) y logística
(traslados, punto de encuentro, contacto, itinerario, recomendaciones).
**Nunca** incluye `provider_cost_cents`, fees, márgenes, opciones descartadas,
costos comparativos, scores, enlaces internos ni secretos.

## 13. Seguridad

Datos mínimos al adapter: pasajeros, categoría de edad, nacionalidad si se
requiere, fechas, origen/destino, equipaje, habitaciones, asistencia operativa,
presupuesto de alojamiento. **Nunca** documentos, tokens, secretos,
diagnósticos ni finanzas internas. **Allowlist** para `purchase_url`/
`booking_url` (latamairlines.com, avianca.com, sitios oficiales de hoteles/IHG,
dominio del proveedor hotelero, airbnb.com). Sanear URLs, errores, snapshots,
logs. `travel_search_audit` append-only. Milu nunca inventa precio ni
disponibilidad.

## 14. Riesgos y rollback

| Riesgo | Mitigación | Rollback |
|---|---|---|
| Boutique Galápagos sin API | estados + enlace oficial interno + alternativas | — |
| Precios cambian | `checked_at`/`expires_at` + refresh versiona | — |
| Duffel no cubre ruta | `provider_no_content` + fallback manual | mantener manual |
| Costo Anthropic | Haiku-only + caps por call/job/booking/día + log | bajar caps (Sonnet nunca activo en v1) |
| Fuga PII | contrato mínimo + allowlist + saneo + auditoría | — |
| Doble clic | idempotencia + unique parcial | — |
| Worker/timeout | subtareas cortas + parciales + retry | reejecutar subtarea |
| Alucinación de precios | LLM nunca es fuente; cifra del adapter | — |
| Migración 0015 problemática | no ejecutada por Claude; el owner la aplica | tablas nuevas e independientes; `drop`/revert manual |
| 8C rompe algo existente | ≤8 funciones, suites previas verdes en QA | rama feature revertible; no merge a main sin QA |

**Rollback general de 8C:** todo el trabajo vive en una rama feature
(`feat/stage-8c-milu-tourism`); no se mergea a main hasta QA verde; la migración
0015 solo agrega tablas nuevas independientes (no altera precios/checkout/intake)
y puede revertirse con `drop table` en Supabase si el owner lo decide. La Edge
Function y los secretos no existen hasta que el owner los cree.
