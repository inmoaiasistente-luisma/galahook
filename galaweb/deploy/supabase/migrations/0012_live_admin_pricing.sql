-- =====================================================================
-- GALÁPAGOS HOOK ADVENTURE — 0012_live_admin_pricing
-- ---------------------------------------------------------------------
-- Precios de PAQUETES administrables en vivo desde el panel (owner),
-- con Supabase como ÚNICA fuente de verdad. NO modifica migraciones
-- anteriores. NO toca Stripe, reservas históricas ni descuentos.
--
--   · public.package_prices          -> precio vigente por paquete
--       (una sola fila `published` por tenant_id + package_id).
--   · public.package_price_history   -> bitácora append-only (auditoría).
--
-- Estados: draft (no afecta Production) · published (vigente) ·
-- archived (retirado; no afecta Production). El servidor elige SIEMPRE
-- la fila `published`; sin ella, el checkout del paquete se BLOQUEA.
--
-- Semilla idempotente con los precios oficiales 2026 (published, v1).
-- Aplicar sobre el precio actual NO lo cambia (ON CONFLICT DO NOTHING).
--
-- IMPORTANTE: ejecutar UNA sola vez, manualmente, tras revisión.
-- (Esta migración NO se ejecuta desde Claude.)
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- A) PRECIOS DE PAQUETES (fuente de verdad)
-- ---------------------------------------------------------------------
create table public.package_prices (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             text not null default 'hook-adventure',
  package_id            text not null,                 -- p3 · p4 · p7 · p8sc · p8is
  base_price_cents      integer not null,              -- entero en CENTAVOS de USD
  currency              text not null default 'USD',
  status                text not null default 'draft', -- draft | published | archived
  pricing_version       integer,                       -- null solo en draft; entero en published/archived
  effective_from        timestamptz,
  published_at          timestamptz,
  published_by_user_id  uuid references auth.users(id),
  created_by_user_id    uuid references auth.users(id),
  updated_by_user_id    uuid references auth.users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint chk_pp_price            check (base_price_cents > 0),
  constraint chk_pp_currency         check (currency = 'USD'),
  constraint chk_pp_status           check (status in ('draft','published','archived')),
  -- Solo los ids de paquete admitidos (sin mayúsculas, espacios ni aliases).
  -- Añadir un paquete nuevo requiere ampliar este CHECK a propósito.
  constraint chk_pp_package          check (package_id in ('p3','p4','p7','p8sc','p8is')),
  constraint chk_pp_version_positive check (pricing_version is null or pricing_version >= 1),
  -- published/archived deben llevar versión; draft puede no llevarla
  constraint chk_pp_version_required check (status = 'draft' or pricing_version is not null)
);

comment on table public.package_prices is
  'Precio vigente de cada paquete (fuente de verdad). Una sola fila published por tenant+package. El servidor cobra SIEMPRE la fila published; sin ella el checkout del paquete se bloquea. Cambiar el precio NO reescribe reservas ya creadas (guardan su snapshot).';
comment on column public.package_prices.base_price_cents is
  'Precio por persona en CENTAVOS (entero). El frontend divide /100 solo para mostrar.';
comment on column public.package_prices.pricing_version is
  'Version monotonica creciente por paquete; aumenta en cada publicacion/rollback/reactivacion. null solo mientras la fila es draft.';

-- Unicidad: una sola fila PUBLISHED por paquete (garantiza precio único vigente).
create unique index uq_pp_published on public.package_prices (tenant_id, package_id) where status = 'published';
-- Un solo DRAFT por paquete (evita borradores duplicados).
create unique index uq_pp_draft     on public.package_prices (tenant_id, package_id) where status = 'draft';
-- Versiones distintas y auditables por paquete (nunca se reutiliza un número).
create unique index uq_pp_version    on public.package_prices (tenant_id, package_id, pricing_version) where pricing_version is not null;

create index idx_pp_tenant  on public.package_prices (tenant_id);
create index idx_pp_package on public.package_prices (package_id);
create index idx_pp_status  on public.package_prices (status);

create trigger trg_pp_updated_at before update on public.package_prices
  for each row execute function public.set_updated_at();

-- SERVER-ONLY: sin acceso directo del navegador. Solo endpoints con SECRET KEY.
alter table public.package_prices enable row level security;
revoke all on table public.package_prices from anon, authenticated;

-- ---------------------------------------------------------------------
-- B) HISTORIAL (append-only, auditoría)
-- ---------------------------------------------------------------------
create table public.package_price_history (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           text not null default 'hook-adventure',
  package_id          text not null,
  old_price_cents     integer,
  new_price_cents     integer,
  old_version         integer,
  new_version         integer,
  changed_by_user_id  uuid references auth.users(id),
  change_reason       text not null,                   -- OBLIGATORIO (incluida la semilla)
  action              text not null,                   -- publish | rollback | deactivate | reactivate
  created_at          timestamptz not null default now(),
  constraint chk_pph_action  check (action in ('publish','rollback','deactivate','reactivate')),
  constraint chk_pph_reason  check (char_length(btrim(change_reason)) >= 5),
  constraint chk_pph_package check (package_id in ('p3','p4','p7','p8sc','p8is'))
);

comment on table public.package_price_history is
  'Bitacora append-only de cambios de precio de paquetes. NO se borra fisicamente (trigger lo impide). Cada publicacion/rollback/deactivate/reactivate registra valor anterior y nuevo, version, usuario y motivo.';

create index idx_pph_tenant  on public.package_price_history (tenant_id);
create index idx_pph_package on public.package_price_history (package_id);
create index idx_pph_created on public.package_price_history (created_at desc);
create index idx_pph_action  on public.package_price_history (action);

alter table public.package_price_history enable row level security;
revoke all on table public.package_price_history from anon, authenticated;

-- Historial REALMENTE append-only: prohibir UPDATE y DELETE (incluso al
-- service_role). El sistema normal solo puede AGREGAR filas nuevas.
create or replace function public.forbid_mutation_package_price_history()
returns trigger language plpgsql as $$
begin
  raise exception 'package_price_history is append-only; % is not allowed', tg_op;
end;
$$;

create trigger trg_pph_no_mutation before update or delete on public.package_price_history
  for each row execute function public.forbid_mutation_package_price_history();

-- ---------------------------------------------------------------------
-- C) OPERACIONES ATÓMICAS (RPC) — publicar / rollback / (des)activar
--    Todo en UNA transacción: si algo falla, se revierte por completo y el
--    precio anterior sigue publicado. Serializadas por (tenant_id, package_id)
--    con advisory lock + SELECT ... FOR UPDATE (sin condiciones de carrera).
--    SECURITY DEFINER con search_path fijo. Solo ejecutables por service_role.
--    El backend mantiene requireAdmin/sameOrigin/sesión y pasa el user_id real.
-- ---------------------------------------------------------------------

-- PUBLICAR: publica un DRAFT REAL identificado por id. El precio publicado se
-- lee ÚNICAMENTE de ese draft (nunca del navegador ni del handler). Bloquea el
-- draft (FOR UPDATE), valida tenant/package/status/precio, archiva el published
-- anterior, crea la nueva versión con el precio del draft, ARCHIVA el draft
-- usado (idempotencia: un segundo intento con el mismo draft_id ya no lo
-- encuentra en 'draft' -> DRAFT_NOT_FOUND) y registra el historial.
create or replace function public.publish_package_price_atomic(
  p_tenant text, p_package text, p_draft_id uuid, p_user uuid, p_reason text
) returns public.package_prices
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_draft public.package_prices;
  v_old   public.package_prices;
  v_new   public.package_prices;
  v_next  integer;
begin
  if p_tenant is null or length(p_tenant) = 0 then raise exception 'INVALID_TENANT'; end if;
  if p_package is null or length(p_package) = 0 then raise exception 'INVALID_PACKAGE'; end if;
  if p_draft_id is null then raise exception 'DRAFT_NOT_FOUND'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if p_user is null then raise exception 'INVALID_ACTOR'; end if;

  perform pg_advisory_xact_lock(hashtext(p_tenant || '|' || p_package)::bigint);

  -- El draft es la ÚNICA fuente del precio. Se bloquea para evitar carreras.
  select * into v_draft from public.package_prices where id = p_draft_id for update;
  if v_draft.id is null or v_draft.status <> 'draft' then raise exception 'DRAFT_NOT_FOUND'; end if;
  if v_draft.tenant_id <> p_tenant then raise exception 'DRAFT_TENANT_MISMATCH'; end if;
  if v_draft.package_id <> p_package then raise exception 'DRAFT_PACKAGE_MISMATCH'; end if;
  if v_draft.base_price_cents is null or v_draft.base_price_cents <= 0 then raise exception 'INVALID_PRICE'; end if;

  select * into v_old from public.package_prices
   where tenant_id = p_tenant and package_id = p_package and status = 'published'
   for update;

  select coalesce(max(pricing_version), 0) + 1 into v_next
    from public.package_prices
   where tenant_id = p_tenant and package_id = p_package and pricing_version is not null;

  if v_old.id is not null then
    update public.package_prices set status = 'archived', updated_by_user_id = p_user, updated_at = now()
     where id = v_old.id;
  end if;

  insert into public.package_prices
    (tenant_id, package_id, base_price_cents, currency, status, pricing_version, effective_from, published_at, published_by_user_id, created_by_user_id, updated_by_user_id)
  values
    (p_tenant, p_package, v_draft.base_price_cents, 'USD', 'published', v_next, now(), now(), p_user, p_user, p_user)
  returning * into v_new;

  -- consume EXACTAMENTE el draft publicado (no otros borradores).
  update public.package_prices set status = 'archived', updated_by_user_id = p_user, updated_at = now()
   where id = v_draft.id;

  insert into public.package_price_history
    (tenant_id, package_id, old_price_cents, new_price_cents, old_version, new_version, changed_by_user_id, change_reason, action)
  values
    (p_tenant, p_package, v_old.base_price_cents, v_draft.base_price_cents, v_old.pricing_version, v_next, p_user, btrim(p_reason), 'publish');

  return v_new;
end;
$$;

-- ROLLBACK: publica el precio de la versión anterior como una NUEVA versión.
create or replace function public.rollback_package_price_atomic(
  p_tenant text, p_package text, p_user uuid, p_reason text
) returns public.package_prices
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cur  public.package_prices;
  v_prev public.package_prices;
  v_new  public.package_prices;
  v_next integer;
begin
  if p_tenant is null or length(p_tenant) = 0 then raise exception 'INVALID_TENANT'; end if;
  if p_package is null or length(p_package) = 0 then raise exception 'INVALID_PACKAGE'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if p_user is null then raise exception 'INVALID_ACTOR'; end if;

  perform pg_advisory_xact_lock(hashtext(p_tenant || '|' || p_package)::bigint);

  select * into v_cur from public.package_prices
   where tenant_id = p_tenant and package_id = p_package and status = 'published'
   for update;

  select * into v_prev from public.package_prices
   where tenant_id = p_tenant and package_id = p_package and status = 'archived' and pricing_version is not null
     and (v_cur.pricing_version is null or pricing_version < v_cur.pricing_version)
   order by pricing_version desc limit 1;

  if v_prev.id is null then raise exception 'NO_PREVIOUS'; end if;

  select coalesce(max(pricing_version), 0) + 1 into v_next
    from public.package_prices
   where tenant_id = p_tenant and package_id = p_package and pricing_version is not null;

  if v_cur.id is not null then
    update public.package_prices set status = 'archived', updated_by_user_id = p_user, updated_at = now()
     where id = v_cur.id;
  end if;

  insert into public.package_prices
    (tenant_id, package_id, base_price_cents, currency, status, pricing_version, effective_from, published_at, published_by_user_id, created_by_user_id, updated_by_user_id)
  values
    (p_tenant, p_package, v_prev.base_price_cents, 'USD', 'published', v_next, now(), now(), p_user, p_user, p_user)
  returning * into v_new;

  update public.package_prices set status = 'archived', updated_by_user_id = p_user, updated_at = now()
   where tenant_id = p_tenant and package_id = p_package and status = 'draft';

  insert into public.package_price_history
    (tenant_id, package_id, old_price_cents, new_price_cents, old_version, new_version, changed_by_user_id, change_reason, action)
  values
    (p_tenant, p_package, v_cur.base_price_cents, v_prev.base_price_cents, v_cur.pricing_version, v_next, p_user, btrim(p_reason), 'rollback');

  return v_new;
end;
$$;

-- DESACTIVAR / REACTIVAR:
--   deactivate → archiva el published (deja 0 published; ignora p_source_id).
--   reactivate → republica una VERSIÓN IDENTIFICADA (p_source_id) como nueva
--     versión. El precio se lee de esa fila archivada, NUNCA de un monto libre.
create or replace function public.set_package_price_active_atomic(
  p_tenant text, p_package text, p_action text, p_user uuid, p_reason text, p_source_id uuid
) returns public.package_prices
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cur    public.package_prices;
  v_source public.package_prices;
  v_new    public.package_prices;
  v_next   integer;
begin
  if p_tenant is null or length(p_tenant) = 0 then raise exception 'INVALID_TENANT'; end if;
  if p_package is null or length(p_package) = 0 then raise exception 'INVALID_PACKAGE'; end if;
  if p_action not in ('deactivate','reactivate') then raise exception 'INVALID_ACTION'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if p_user is null then raise exception 'INVALID_ACTOR'; end if;

  perform pg_advisory_xact_lock(hashtext(p_tenant || '|' || p_package)::bigint);

  if p_action = 'deactivate' then
    select * into v_cur from public.package_prices
     where tenant_id = p_tenant and package_id = p_package and status = 'published'
     for update;
    if v_cur.id is null then raise exception 'NOT_PUBLISHED'; end if;

    update public.package_prices set status = 'archived', updated_by_user_id = p_user, updated_at = now()
     where id = v_cur.id
     returning * into v_new;

    insert into public.package_price_history
      (tenant_id, package_id, old_price_cents, new_price_cents, old_version, new_version, changed_by_user_id, change_reason, action)
    values
      (p_tenant, p_package, v_cur.base_price_cents, null, v_cur.pricing_version, null, p_user, btrim(p_reason), 'deactivate');

    return v_new;
  else
    if p_source_id is null then raise exception 'SOURCE_NOT_FOUND'; end if;

    select * into v_cur from public.package_prices
     where tenant_id = p_tenant and package_id = p_package and status = 'published'
     for update;
    if v_cur.id is not null then raise exception 'ALREADY_PUBLISHED'; end if;

    -- La versión a reactivar debe existir, ser de este tenant/package, estar
    -- archivada y tener versión. El precio se toma de ella (no de un monto libre).
    select * into v_source from public.package_prices where id = p_source_id for update;
    if v_source.id is null or v_source.status <> 'archived' or v_source.pricing_version is null then raise exception 'SOURCE_NOT_FOUND'; end if;
    if v_source.tenant_id <> p_tenant or v_source.package_id <> p_package then raise exception 'SOURCE_NOT_FOUND'; end if;

    select coalesce(max(pricing_version), 0) + 1 into v_next
      from public.package_prices
     where tenant_id = p_tenant and package_id = p_package and pricing_version is not null;

    insert into public.package_prices
      (tenant_id, package_id, base_price_cents, currency, status, pricing_version, effective_from, published_at, published_by_user_id, created_by_user_id, updated_by_user_id)
    values
      (p_tenant, p_package, v_source.base_price_cents, 'USD', 'published', v_next, now(), now(), p_user, p_user, p_user)
    returning * into v_new;

    insert into public.package_price_history
      (tenant_id, package_id, old_price_cents, new_price_cents, old_version, new_version, changed_by_user_id, change_reason, action)
    values
      (p_tenant, p_package, null, v_source.base_price_cents, v_source.pricing_version, v_next, p_user, btrim(p_reason), 'reactivate');

    return v_new;
  end if;
end;
$$;

-- Permisos: SOLO el backend (service_role) puede ejecutar los RPC. Nunca anon,
-- authenticated ni PUBLIC. El backend ya valida requireAdmin/owner/sameOrigin.
revoke execute on function public.publish_package_price_atomic(text,text,uuid,uuid,text)           from public, anon, authenticated;
revoke execute on function public.rollback_package_price_atomic(text,text,uuid,text)               from public, anon, authenticated;
revoke execute on function public.set_package_price_active_atomic(text,text,text,uuid,text,uuid)   from public, anon, authenticated;
grant  execute on function public.publish_package_price_atomic(text,text,uuid,uuid,text)           to service_role;
grant  execute on function public.rollback_package_price_atomic(text,text,uuid,text)               to service_role;
grant  execute on function public.set_package_price_active_atomic(text,text,text,uuid,text,uuid)   to service_role;

-- ---------------------------------------------------------------------
-- D) SEMILLA — precios oficiales vigentes 2026 (published, version 1)
--    Idempotente: si ya existe un published para el paquete, no hace nada
--    (no cambia el precio actual). tenant_id = 'hook-adventure' (=TENANT_ID).
-- ---------------------------------------------------------------------
insert into public.package_prices
  (tenant_id, package_id, base_price_cents, currency, status, pricing_version, effective_from, published_at)
values
  ('hook-adventure', 'p3',   349900, 'USD', 'published', 1, now(), now()),
  ('hook-adventure', 'p4',   399900, 'USD', 'published', 1, now(), now()),
  ('hook-adventure', 'p7',   479900, 'USD', 'published', 1, now(), now()),
  ('hook-adventure', 'p8sc', 531900, 'USD', 'published', 1, now(), now()),
  ('hook-adventure', 'p8is', 531900, 'USD', 'published', 1, now(), now())
on conflict (tenant_id, package_id) where status = 'published' do nothing;

-- Semilla del historial: registra el origen v1 de cada precio sembrado
-- (idempotente: no duplica si ya hay un 'publish' con new_version=1).
insert into public.package_price_history
  (tenant_id, package_id, old_price_cents, new_price_cents, old_version, new_version, action, change_reason)
select pp.tenant_id, pp.package_id, null, pp.base_price_cents, null, 1, 'publish', 'Initial seed (2026 canonical prices)'
from public.package_prices pp
where pp.status = 'published' and pp.pricing_version = 1
  and not exists (
    select 1 from public.package_price_history h
    where h.tenant_id = pp.tenant_id and h.package_id = pp.package_id
      and h.action = 'publish' and h.new_version = 1
  );

commit;

-- =====================================================================
-- FIN 0012_live_admin_pricing.
-- Verificación sugerida (solo lectura) tras aplicar:
--   select package_id, base_price_cents, status, pricing_version
--   from public.package_prices where status='published' order by package_id;
-- Debe devolver 5 filas: p3=349900, p4=399900, p7=479900,
--   p8sc=531900, p8is=531900.
-- =====================================================================
