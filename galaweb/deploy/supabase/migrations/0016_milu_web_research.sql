-- =========================================================
-- 0016 — Milu Live Travel Research (Fase 8D)
--        Investigación de precios/disponibilidad en páginas públicas
--        autorizadas mediante Anthropic Web Search / Web Fetch (Haiku).
--
-- Ejecutar UNA sola vez, DESPUÉS de 0015. NO ejecutar desde Claude.
-- ADITIVA y MÍNIMA: solo ALTERs. CERO tablas nuevas. No modifica FKs,
-- índices, triggers ni funciones existentes salvo lo estrictamente
-- necesario (un único CHECK de `kind` que PRESERVA todos sus valores
-- actuales y agrega los kinds de web research). No contiene SQL
-- destructivo sobre datos. RLS y permisos actuales intactos (las
-- columnas nuevas heredan RLS + revoke de sus tablas).
--
-- PRINCIPIOS (aprobados por el owner):
--   · Anthropic investiga/lee/extrae/compara precios publicados en
--     páginas públicas autorizadas, pero NO es la fuente oficial: la
--     fuente es siempre la página externa (research_source_url).
--   · Disponibilidad y revisión humana son conceptos SEPARADOS:
--     `availability_status` NO se toca; la revisión vive en la nueva
--     columna `research_review_status` (unverified/verified/rejected).
--   · Todo hallazgo nace `unverified`, guarda URL de origen y hora de
--     consulta (reutiliza `checked_at`), es solo para owner/admin y
--     requiere aprobación humana. Separado de Stripe/checkout/precios
--     comerciales. Sin compra/reserva/pago/envío automático al cliente.
--   · Compuerta DOBLE: env MILU_TOURISM_WEB_RESEARCH_ENABLED (código)
--     Y milu_settings.web_research_enabled (esta migración). Ambas en
--     false por defecto; ambas deben estar activas para permitir búsquedas.
--   · Actor de revisión: mismo patrón del proyecto → uuid references
--     auth.users(id) (idéntico a *_by_user_id / reviewed_by_user_id).
--
-- Reutiliza el motor de 0015 sin cambios: cola/lease/retry, idempotencia
-- (provider_result_key + result_version + índices únicos), FKs compuestas
-- por reserva, triggers no-delete y auditoría append-only.
-- =========================================================

begin;

-- ---------- 1. Subtareas: kinds de web research (PRESERVA los 5 actuales) ----------
-- Único CHECK existente que se modifica; se re-crea con TODOS los valores
-- anteriores + los dos nuevos kinds. El motor de cola no depende del kind.
alter table public.travel_search_subtasks drop constraint chk_tss_kind;
alter table public.travel_search_subtasks add constraint chk_tss_kind check (kind in
  ('flights_duffel','hotels_primary_provider','hotel_preferred_links',
   'anthropic_ranking','final_summary',
   'web_research_flights','web_research_lodging'));

-- ---------- 2. Contadores y costo por propuesta (job) ----------
-- Estado mutable para presupuesto duro, parada temprana y "Buscar
-- nuevamente" contabilizado. Tabla vacía → ADD COLUMN NOT NULL DEFAULT seguro.
alter table public.travel_search_jobs
  add column web_search_count  integer not null default 0,
  add column web_fetch_count   integer not null default 0,
  add column research_cost_usd  numeric not null default 0,
  add column rerun_count       integer not null default 0;
alter table public.travel_search_jobs
  add constraint chk_tsj_web_search_count check (web_search_count >= 0),
  add constraint chk_tsj_web_fetch_count  check (web_fetch_count  >= 0),
  add constraint chk_tsj_research_cost    check (research_cost_usd >= 0),
  add constraint chk_tsj_rerun_count      check (rerun_count       >= 0);

-- ---------- 3. Telemetría separada de herramientas (llm_usage_log) ----------
-- Registro separado de búsquedas y fetches (los tokens y estimated_cost_usd
-- ya existen). Tabla vacía → seguro.
alter table public.llm_usage_log
  add column web_search_requests integer not null default 0,
  add column web_fetch_requests  integer not null default 0;
alter table public.llm_usage_log
  add constraint chk_llm_web_search_requests check (web_search_requests >= 0),
  add constraint chk_llm_web_fetch_requests  check (web_fetch_requests  >= 0);

-- ---------- 4. Evidencia + revisión humana en opciones de VUELO ----------
-- availability_status NO se toca (disponibilidad ≠ revisión). retrieved_at
-- reutiliza checked_at; precio/moneda reutilizan total_price_cents/currency.
alter table public.travel_flight_options
  add column research_source_url         text,
  add column research_review_status      text,   -- null | unverified | verified | rejected
  add column research_reviewed_by_user_id uuid references auth.users(id),
  add column research_reviewed_at         timestamptz;
alter table public.travel_flight_options
  -- valores permitidos (nullable: resultados que no son web research)
  add constraint chk_tfo_review_status check (
    research_review_status is null or research_review_status in ('unverified','verified','rejected')),
  -- si provider = 'web_research', la revisión es obligatoria
  add constraint chk_tfo_review_provider check (
    provider <> 'web_research' or research_review_status is not null),
  -- si hay revisión, debe existir URL de origen no vacía
  add constraint chk_tfo_review_source check (
    research_review_status is null or (research_source_url is not null and research_source_url <> '')),
  -- verified/rejected exigen actor+fecha; unverified los mantiene nulos
  add constraint chk_tfo_review_actor check (
    research_review_status is null
    or (research_review_status = 'unverified'
        and research_reviewed_by_user_id is null and research_reviewed_at is null)
    or (research_review_status in ('verified','rejected')
        and research_reviewed_by_user_id is not null and research_reviewed_at is not null));

-- ---------- 5. Evidencia + revisión humana en opciones de HOTEL (idéntico) ----------
alter table public.travel_hotel_options
  add column research_source_url         text,
  add column research_review_status      text,
  add column research_reviewed_by_user_id uuid references auth.users(id),
  add column research_reviewed_at         timestamptz;
alter table public.travel_hotel_options
  add constraint chk_tho_review_status check (
    research_review_status is null or research_review_status in ('unverified','verified','rejected')),
  add constraint chk_tho_review_provider check (
    provider <> 'web_research' or research_review_status is not null),
  add constraint chk_tho_review_source check (
    research_review_status is null or (research_source_url is not null and research_source_url <> '')),
  add constraint chk_tho_review_actor check (
    research_review_status is null
    or (research_review_status = 'unverified'
        and research_reviewed_by_user_id is null and research_reviewed_at is null)
    or (research_review_status in ('verified','rejected')
        and research_reviewed_by_user_id is not null and research_reviewed_at is not null));

-- ---------- 6. Config editable por owner (mitad DB de la compuerta doble) ----------
-- web_research_enabled = mitad DB (default false). La otra mitad es el env
-- MILU_TOURISM_WEB_RESEARCH_ENABLED (código). Ambas deben ser true.
alter table public.milu_settings
  add column web_research_enabled                    boolean not null default false,
  add column web_research_max_searches               integer not null default 6,
  add column web_research_max_fetches                integer not null default 2,
  add column web_research_max_content_tokens_per_fetch integer not null default 4000,
  add column web_research_max_cost_per_job_usd        numeric not null default 0.30;
alter table public.milu_settings
  add constraint chk_ms_wr_searches check (web_research_max_searches between 1 and 20),
  add constraint chk_ms_wr_fetches  check (web_research_max_fetches  between 0 and 10),
  add constraint chk_ms_wr_content  check (web_research_max_content_tokens_per_fetch > 0),
  add constraint chk_ms_wr_cost     check (web_research_max_cost_per_job_usd >= 0);

commit;
