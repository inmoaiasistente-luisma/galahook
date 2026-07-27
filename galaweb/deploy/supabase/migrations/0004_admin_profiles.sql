-- LOAN-IX Booking Engine — 0004_admin_profiles
-- Usuarios administrativos multiusuario.
-- Las CONTRASEÑAS viven exclusivamente en auth.users (Supabase Auth).
-- Esta tabla solo guarda autorización: tenant, rol y estado activo.

begin;

create table public.admin_profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  tenant_id     text not null,
  full_name     text not null,
  role          text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_login_at timestamptz,

  constraint chk_admin_profiles_role check (role in ('owner','admin','staff'))
);

comment on table public.admin_profiles is
  'Autorizacion del panel admin. Las contrasenas las gestiona Supabase Auth (auth.users); aqui NO se guardan credenciales.';

create index idx_admin_profiles_tenant on public.admin_profiles (tenant_id);
create index idx_admin_profiles_role   on public.admin_profiles (role);
create index idx_admin_profiles_active on public.admin_profiles (active);

-- trigger updated_at (reutiliza la funcion creada en la migracion 0001)
create trigger trg_admin_profiles_updated_at
  before update on public.admin_profiles
  for each row execute function public.set_updated_at();

-- RLS activado y SIN politicas: anon/authenticated no tienen acceso.
-- Solo las funciones serverless (SUPABASE_SECRET_KEY) leen/escriben esta tabla.
alter table public.admin_profiles enable row level security;

revoke all on table public.admin_profiles from anon, authenticated;

commit;
