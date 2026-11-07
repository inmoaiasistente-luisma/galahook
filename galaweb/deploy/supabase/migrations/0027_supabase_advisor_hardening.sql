-- =====================================================================
-- LOAN-IX Booking Engine — 0027_supabase_advisor_hardening
-- Corrige los avisos de seguridad del Advisor de Supabase vistos el
-- 2026-11-06 en Producción.
-- APLICADA en Producción el 2026-11-07 con autorización del owner. Después,
-- el Advisor solo muestra rls_enabled_no_policy (intencional) y el aviso de
-- contraseñas filtradas (ajuste de Auth).
--
-- Riesgo real, en corto:
--
-- 1) sync_sold_at() era SECURITY DEFINER y anon/authenticated podían
--    ejecutarla por /rest/v1/rpc/sync_sold_at. En la práctica no se puede
--    abusar: es una función de trigger (PostgreSQL se niega a ejecutarla
--    fuera de un trigger) y solo copia paid_at a sold_at dentro de la fila
--    NEW, sin leer ni escribir ninguna tabla. Tampoco necesita privilegios
--    del dueño, así que pasa a SECURITY INVOKER y solo service_role (el
--    backend) conserva EXECUTE.
--    El trigger trg_bookings_sync_sold_at sigue igual: PostgreSQL revisa
--    EXECUTE al crear un trigger, no al dispararlo, y quienes escriben en
--    bookings (el backend con service_role y el panel de Supabase con
--    postgres) mantienen el permiso de todos modos. anon/authenticated no
--    pueden escribir en bookings (revoke + RLS sin políticas).
--
-- 2) search_path mutable en set_updated_at, forbid_mutation_package_price_history,
--    forbid_mutation_travel_search_audit, milu_forbid_physical_delete y
--    page_view_stats. Con un search_path manipulado, un nombre sin esquema
--    podría resolverse hacia un objeto ajeno. Riesgo bajo: ninguna es
--    SECURITY DEFINER y anon/authenticated no escriben en sus tablas. Se fija
--    search_path = '' como en 0005 y 0006. Sus cuerpos solo usan funciones de
--    pg_catalog (now, count, jsonb_build_object), que siempre se encuentran,
--    y la única tabla que leen ya va calificada (public.page_views).
--
-- 3) page_view_stats: 0022 revocó anon/authenticated pero no PUBLIC, así que
--    cualquiera seguía pudiendo llamarla (sin obtener datos, porque
--    page_views está cerrada). Se revoca de PUBLIC y queda solo para
--    service_role, que es como la llama el panel.
--
-- No toca tablas, datos, triggers, RLS ni políticas. El aviso
-- rls_enabled_no_policy es intencional (tablas solo del backend).
-- La protección de contraseñas filtradas es un ajuste de Auth en el panel
-- de Supabase, no SQL.
-- =====================================================================
begin;

-- 1) sync_sold_at: sin privilegios del dueño y fuera de la API pública
alter function public.sync_sold_at() security invoker;
revoke execute on function public.sync_sold_at() from public, anon, authenticated;
grant  execute on function public.sync_sold_at() to service_role;

-- 2) search_path fijo
alter function public.set_updated_at()                        set search_path = '';
alter function public.forbid_mutation_package_price_history() set search_path = '';
alter function public.forbid_mutation_travel_search_audit()   set search_path = '';
alter function public.milu_forbid_physical_delete()           set search_path = '';
alter function public.page_view_stats(text, timestamptz, timestamptz) set search_path = '';

-- 3) page_view_stats: solo el backend
revoke execute on function public.page_view_stats(text, timestamptz, timestamptz) from public, anon, authenticated;
grant  execute on function public.page_view_stats(text, timestamptz, timestamptz) to service_role;

commit;
