-- =========================================================
-- 0023 — Bandeja de mensajes de contacto (pedido interno)
-- ---------------------------------------------------------
-- PREPARADA, NO APLICADA. Requiere autorización del owner antes de ejecutar.
--
-- Guarda cada mensaje que un visitante envía desde el sitio público:
--   · el formulario de Contacto, y
--   · el aviso de visitante recurrente ("nudge").
-- El panel "Mensajes" (owner Y admin) los lista, permite marcar estado y
-- responder por correo (mailto). Un correo interno avisa al buzón del owner
-- y, si el visitante dejó email, se le envía una confirmación automática.
--
-- PRIVACIDAD: solo lo que el visitante escribe voluntariamente (nombre,
-- email/WhatsApp, interés, mensaje). País aproximado (cabecera geo) para
-- contexto. No se guarda IP.
--
-- Convención de la casa: tenant_id text default 'hook-adventure';
-- RLS enable + revoke (solo el backend con SUPABASE_SECRET_KEY accede).
-- Aditiva: no borra ni cambia nada existente.
-- =========================================================
begin;

create table public.contact_messages (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    text not null default 'hook-adventure',
  created_at   timestamptz not null default now(),
  name         text not null,                 -- nombre que dejó el visitante
  email        text,                          -- al menos email o phone (chk_cm_contact)
  phone        text,                          -- WhatsApp / teléfono
  interest     text,                          -- en qué está interesado
  message      text,                          -- mensaje libre (opcional)
  source       text not null default 'contact_form',  -- 'contact_form' | 'visit_nudge'
  source_page  text,                          -- ruta pública desde donde escribió
  lang         text,                          -- 'en' | 'es'
  country      text,                          -- país aproximado (ISO-2), coarse
  status       text not null default 'new',   -- 'new' | 'read' | 'replied' | 'archived'
  handled_by   text,                          -- email del owner/admin que lo atendió
  handled_at   timestamptz,
  constraint chk_cm_status  check (status in ('new', 'read', 'replied', 'archived')),
  constraint chk_cm_source  check (source in ('contact_form', 'visit_nudge')),
  constraint chk_cm_lang    check (lang is null or lang in ('en', 'es')),
  constraint chk_cm_country check (country is null or country ~ '^[A-Z]{2}$'),
  -- Debe haber al menos una vía de contacto para poder responder.
  constraint chk_cm_contact check (email is not null or phone is not null)
);
create index idx_cm_tenant_created on public.contact_messages (tenant_id, created_at desc);
create index idx_cm_tenant_status  on public.contact_messages (tenant_id, status);

comment on table public.contact_messages is
  'Mensajes de contacto del sitio público (formulario + aviso de visitante recurrente). Solo datos que el visitante deja voluntariamente + país aproximado. Sin IP. El panel Mensajes (owner y admin) los gestiona.';

alter table public.contact_messages enable row level security;
revoke all on table public.contact_messages from anon, authenticated;

commit;
