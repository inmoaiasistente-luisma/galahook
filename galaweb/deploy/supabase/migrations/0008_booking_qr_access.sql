-- =====================================================================
-- LOAN-IX Booking Engine — 0008_booking_qr_access
-- Acceso QR por reserva.
--
-- NO se guarda el token: solo un identificador publico opaco (public_id)
-- y una version. El token se firma con HMAC-SHA256 y QR_SIGNING_SECRET,
-- y se verifica recalculando la firma. Asi se puede regenerar el QR en
-- cualquier momento, rotarlo (token_version+1) o revocarlo (active=false)
-- sin exponer datos personales ni identificadores internos.
-- Ejecutar UNA sola vez.
-- =====================================================================
begin;

create table public.booking_qr_access (
  id               uuid primary key default gen_random_uuid(),
  booking_id       uuid not null unique references public.bookings(id) on delete cascade,
  tenant_id        text not null,
  public_id        uuid not null unique default gen_random_uuid(),
  token_version    integer not null default 1,
  active           boolean not null default true,
  expires_at       timestamptz,
  revoked_at       timestamptz,
  last_scanned_at  timestamptz,
  scan_count       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint chk_qr_token_version check (token_version > 0),
  constraint chk_qr_scan_count    check (scan_count >= 0),
  -- Estricto: no se admiten filas ambiguas.
  constraint chk_qr_revoked       check ((active = true  and revoked_at is null)
                                      or (active = false and revoked_at is not null))
);

comment on table public.booking_qr_access is
  'Acceso QR por reserva. public_id es opaco; el token se firma y valida con HMAC (QR_SIGNING_SECRET). Rotar = token_version+1; revocar = active=false + revoked_at.';

create index idx_qr_booking    on public.booking_qr_access (booking_id);
create index idx_qr_tenant     on public.booking_qr_access (tenant_id);
create index idx_qr_public_id  on public.booking_qr_access (public_id);
create index idx_qr_active     on public.booking_qr_access (active);
create index idx_qr_expires_at on public.booking_qr_access (expires_at);

-- reutiliza la funcion creada en la migracion 0001
create trigger trg_booking_qr_access_updated_at
  before update on public.booking_qr_access
  for each row execute function public.set_updated_at();

-- RLS activo y sin politicas: solo el backend (SUPABASE_SECRET_KEY) accede.
alter table public.booking_qr_access enable row level security;
revoke all on table public.booking_qr_access from anon, authenticated;

commit;
