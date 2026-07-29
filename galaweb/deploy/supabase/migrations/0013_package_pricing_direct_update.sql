-- =====================================================================
-- GALÁPAGOS HOOK ADVENTURE — 0013_package_pricing_direct_update
-- ---------------------------------------------------------------------
-- (A) FIX de "Could not complete" al publicar:
--     La RPC publish_package_price_atomic archivaba el DRAFT usado
--     (status draft->archived) pero el draft tiene pricing_version NULL,
--     y el constraint chk_pp_version_required exigía versión a TODA fila
--     no-draft -> violación -> rollback -> error genérico en el panel.
--     Se relaja el constraint: solo las filas PUBLISHED requieren versión
--     (una fila archivada que nunca se publicó puede no tener versión).
--
-- (B) Flujo directo del owner (un solo clic "Update live price"):
--     Nueva RPC atómica que publica un precio nuevo SIN pasar por un draft
--     visible. El backend rellena el motivo automáticamente
--     ('owner_direct_update'); el owner nunca escribe una razón.
--     Mantiene: fuente de verdad, versionado, historial append-only,
--     atomicidad (advisory lock + FOR UPDATE), y solo service_role ejecuta.
--
-- NO modifica migraciones anteriores. NO toca Stripe, reservas ni descuentos.
-- Ejecutar UNA sola vez, manualmente, tras revisión.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- (A) Constraint: solo PUBLISHED requiere pricing_version.
--     (draft o archived-nunca-publicado pueden tener versión NULL)
-- ---------------------------------------------------------------------
alter table public.package_prices drop constraint if exists chk_pp_version_required;
alter table public.package_prices
  add constraint chk_pp_version_required check (status <> 'published' or pricing_version is not null);

-- ---------------------------------------------------------------------
-- (B) ACTUALIZACIÓN DIRECTA (owner): archiva el published actual, publica
--     el nuevo precio como nueva versión y registra el historial. En UNA
--     transacción; si algo falla, se revierte y el precio anterior sigue
--     publicado. NO usa draft (no puede violar el constraint). El precio
--     llega del handler owner-only; el motivo lo pone el backend.
-- ---------------------------------------------------------------------
create or replace function public.update_package_price_atomic(
  p_tenant text, p_package text, p_price_cents integer, p_user uuid, p_reason text
) returns public.package_prices
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old  public.package_prices;
  v_new  public.package_prices;
  v_next integer;
begin
  if p_tenant is null or length(p_tenant) = 0 then raise exception 'INVALID_TENANT'; end if;
  if p_package is null or length(p_package) = 0 then raise exception 'INVALID_PACKAGE'; end if;
  if p_price_cents is null or p_price_cents <= 0 then raise exception 'INVALID_PRICE'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if p_user is null then raise exception 'INVALID_ACTOR'; end if;

  perform pg_advisory_xact_lock(hashtext(p_tenant || '|' || p_package)::bigint);

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
    (p_tenant, p_package, p_price_cents, 'USD', 'published', v_next, now(), now(), p_user, p_user, p_user)
  returning * into v_new;

  insert into public.package_price_history
    (tenant_id, package_id, old_price_cents, new_price_cents, old_version, new_version, changed_by_user_id, change_reason, action)
  values
    (p_tenant, p_package, v_old.base_price_cents, p_price_cents, v_old.pricing_version, v_next, p_user, btrim(p_reason), 'publish');

  return v_new;
end;
$$;

revoke execute on function public.update_package_price_atomic(text,text,integer,uuid,text) from public, anon, authenticated;
grant  execute on function public.update_package_price_atomic(text,text,integer,uuid,text) to service_role;

commit;

-- =====================================================================
-- FIN 0013. Verificación (solo lectura) tras aplicar:
--   -- 1) el constraint quedó relajado:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'chk_pp_version_required';
--   -- 2) la nueva función existe:
--   select proname from pg_proc where proname = 'update_package_price_atomic';
-- =====================================================================
