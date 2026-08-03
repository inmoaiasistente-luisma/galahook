-- =========================================================
-- 0022 — Contador de visitas del sitio público (panel solo-owner)
-- ---------------------------------------------------------
-- PREPARADA, NO APLICADA. Requiere autorización del owner antes de ejecutar.
--
-- Registra una fila por cada visita a una página PÚBLICA. El panel "Visitas"
-- (solo owner) muestra: total de visitas, personas únicas aproximadas, hoy,
-- últimos 7 días, y una tabla con hora de ingreso / página / país / dispositivo.
--
-- PRIVACIDAD: no se guarda IP, ni nombre, ni ningún dato personal. Solo el país
-- a grandes rasgos (cabecera geo del servidor) y un identificador ANÓNIMO de
-- primera parte (un código al azar en el navegador) para contar personas únicas.
-- Se marca is_bot para poder excluir rastreadores automáticos de los conteos.
--
-- Convención de la casa: tenant_id text default 'hook-adventure';
-- RLS enable + revoke (solo el backend con SUPABASE_SECRET_KEY accede).
-- Aditiva: no borra ni cambia nada existente.
-- =========================================================
begin;

create table public.page_views (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   text not null default 'hook-adventure',
  path        text not null,                 -- ruta pública, sin query ni hash
  visitor_id  text,                          -- id anónimo (localStorage), sin PII
  country     text,                          -- país aproximado (ISO-2), coarse
  device      text,                          -- 'mobile' | 'tablet' | 'desktop'
  referrer_host text,                        -- host de procedencia (sin ruta/query)
  is_bot      boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint chk_pv_device check (device is null or device in ('mobile', 'tablet', 'desktop')),
  constraint chk_pv_country check (country is null or country ~ '^[A-Z]{2}$')
);
create index idx_pv_tenant_created on public.page_views (tenant_id, created_at desc);
create index idx_pv_tenant_visitor on public.page_views (tenant_id, visitor_id);
create index idx_pv_tenant_bot_created on public.page_views (tenant_id, is_bot, created_at desc);

comment on table public.page_views is
  'Una fila por visita a una página pública. Sin datos personales: no guarda IP ni identidad; solo país aproximado y un id anónimo de primera parte para contar personas únicas. is_bot permite excluir rastreadores de los conteos.';

alter table public.page_views enable row level security;
revoke all on table public.page_views from anon, authenticated;

-- Estadísticas agregadas para el panel. Los límites de tiempo (inicio de "hoy"
-- y de los últimos 7 días en hora de Galápagos) se calculan en el servidor y se
-- pasan como parámetros para no depender de la zona horaria de la base.
create or replace function public.page_view_stats(
  p_tenant text,
  p_today_start timestamptz,
  p_week_start timestamptz
) returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'total_visits',    count(*) filter (where not is_bot),
    'unique_visitors', count(distinct visitor_id) filter (where not is_bot and visitor_id is not null),
    'today_visits',    count(*) filter (where not is_bot and created_at >= p_today_start),
    'today_unique',    count(distinct visitor_id) filter (where not is_bot and visitor_id is not null and created_at >= p_today_start),
    'week_visits',     count(*) filter (where not is_bot and created_at >= p_week_start),
    'week_unique',     count(distinct visitor_id) filter (where not is_bot and visitor_id is not null and created_at >= p_week_start),
    'bot_visits',      count(*) filter (where is_bot)
  )
  from public.page_views
  where tenant_id = p_tenant;
$$;

revoke all on function public.page_view_stats(text, timestamptz, timestamptz) from anon, authenticated;

commit;
