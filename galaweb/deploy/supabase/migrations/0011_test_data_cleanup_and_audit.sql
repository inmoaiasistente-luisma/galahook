-- =====================================================================
-- LOAN-IX Booking Engine — 0011_test_data_cleanup_and_audit
-- Limpieza SEGURA de datos de prueba: BORRADO LÓGICO con auditoría.
-- No hay DELETE físico. Las filas retiradas conservan pago, QR y emails
-- y solo desaparecen de las vistas operativas porque TODAS las consultas
-- filtran deleted_at IS NULL. Marcar (is_test) y archivar (deleted_at)
-- son acciones EXCLUSIVAS del owner, ejecutadas server-side.
-- Ejecutar UNA sola vez. No modifica migraciones anteriores.
-- =====================================================================
begin;

-- 1) Columnas de marca TEST y borrado lógico
alter table public.bookings
  add column if not exists is_test                boolean not null default false,
  add column if not exists deleted_at             timestamptz,
  add column if not exists deleted_by_user_id     uuid references auth.users(id),
  add column if not exists deletion_reason        text,
  add column if not exists test_marked_at         timestamptz,
  add column if not exists test_marked_by_user_id uuid references auth.users(id);

-- 2) Coherencia del borrado lógico: si está archivada, consta quién y por qué (>=5 car.)
alter table public.bookings
  add constraint chk_booking_soft_delete check (
    deleted_at is null
    or (deleted_by_user_id is not null
        and deletion_reason is not null
        and length(btrim(deletion_reason)) >= 5)
  );

-- 3) Coherencia de la marca TEST: si is_test, consta quién y cuándo
alter table public.bookings
  add constraint chk_booking_test_flag check (
    is_test = false
    or (test_marked_at is not null and test_marked_by_user_id is not null)
  );

-- 4) Índices
create index if not exists idx_bookings_tenant_is_test on public.bookings (tenant_id, is_test);
create index if not exists idx_bookings_tenant_deleted on public.bookings (tenant_id, deleted_at);
create index if not exists idx_bookings_created_at     on public.bookings (created_at);
create index if not exists idx_bookings_customer_email on public.bookings (customer_email);
-- booking_code ya tiene índice por su restricción UNIQUE (no se duplica).

-- 5) RLS activo, sin políticas: solo el backend (SUPABASE_SECRET_KEY) accede
alter table public.bookings enable row level security;
revoke all on table public.bookings from anon, authenticated;

comment on column public.bookings.is_test is
  'TRUE solo si el owner la marco explicitamente. NUNCA se infiere por nombre, email, codigo, monto ni fecha.';
comment on column public.bookings.deleted_at is
  'Borrado logico. Si no es null, la fila se excluye de panel, agenda, calendario, finanzas, QR y notificaciones.';

commit;
