-- =========================================================
-- 0020 — Subida real de documentos por reserva (Fase 9, corrección)
-- ---------------------------------------------------------
-- PREPARADA, NO APLICADA. Requiere autorización del owner antes de ejecutar.
--
-- Convierte `booking_documents` (0019, ya aplicada) de "solo enlace" a
-- "enlace O archivo subido":
--   · Bucket PRIVADO de Supabase Storage `booking-documents` con límite de
--     tamaño y tipos permitidos (JPG/PNG/WEBP/PDF/DOC/DOCX).
--   · Metadatos del archivo en la fila: source, storage_path,
--     original_filename, mime_type, file_size, uploaded_at,
--     sent_to_passenger_at.
--   · `url` pasa a ser NULLABLE: una fila de subida no tiene enlace externo.
--
-- Seguridad: el bucket es PRIVADO (public=false) y NO se crean políticas para
-- anon/authenticated. Solo el backend (SUPABASE_SECRET_KEY, que salta RLS)
-- toca los objetos, y siempre entrega URLs FIRMADAS temporales. Nunca hay una
-- URL pública permanente de un documento privado.
--
-- Restricciones respetadas: aditiva; no borra columnas ni datos; no toca
-- Stripe; no modifica reservas históricas.
-- =========================================================
begin;

-- 1) Metadatos de archivo en booking_documents ------------------------------
alter table public.booking_documents
  add column if not exists source              text not null default 'link',
  add column if not exists storage_path        text,
  add column if not exists original_filename   text,
  add column if not exists mime_type           text,
  add column if not exists file_size           bigint,
  add column if not exists uploaded_at         timestamptz,
  add column if not exists sent_to_passenger_at timestamptz;

-- `url` deja de ser obligatorio: las subidas no llevan enlace externo.
alter table public.booking_documents alter column url drop not null;

-- El CHECK de 0019 exigía url https siempre; ahora url puede ser null (subida).
alter table public.booking_documents drop constraint if exists chk_bdoc_url;
alter table public.booking_documents
  add constraint chk_bdoc_url check (url is null or url ~* '^https://');

alter table public.booking_documents drop constraint if exists chk_bdoc_source;
alter table public.booking_documents
  add constraint chk_bdoc_source check (source in ('link', 'upload'));

-- Coherencia: un enlace necesita url; una subida necesita storage_path.
alter table public.booking_documents drop constraint if exists chk_bdoc_source_ref;
alter table public.booking_documents
  add constraint chk_bdoc_source_ref check (
    (source = 'link'   and url is not null) or
    (source = 'upload' and storage_path is not null));

alter table public.booking_documents drop constraint if exists chk_bdoc_file_size;
alter table public.booking_documents
  add constraint chk_bdoc_file_size check (file_size is null or file_size >= 0);

create index if not exists idx_bdoc_storage_path
  on public.booking_documents (storage_path) where storage_path is not null;

-- 2) Bucket privado de Storage ----------------------------------------------
-- 15 MiB (15 * 1024 * 1024 = 15728640). Ajustable aquí y en DOCUMENT_MAX_BYTES.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'booking-documents', 'booking-documents', false, 15728640,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- NOTA: no se añaden políticas en storage.objects a propósito. El bucket es
-- privado y solo el service_role (backend) accede; las descargas del cliente
-- pasan por URLs firmadas de corta duración generadas en el servidor.

commit;
