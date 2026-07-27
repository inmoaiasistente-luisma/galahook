-- =====================================================================
-- LOAN-IX Booking Engine — 0005_auto_create_admin_profiles
-- ---------------------------------------------------------------------
-- Crea automaticamente una fila en public.admin_profiles cada vez que
-- se registra un usuario en auth.users.
--
-- PRINCIPIO DE MINIMO PRIVILEGIO: el alta automatica SIEMPRE es
--   role = 'staff'  y  active = false
-- Un usuario recien creado NO puede entrar al panel hasta que un owner
-- lo active manualmente. El rol y la activacion nunca se derivan de
-- metadata, correo ni de ningun dato controlable por el usuario.
--
-- Migracion incremental. Ejecutar UNA sola vez. No modifica 0004.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1) Funcion trigger
--    security definer  → puede escribir en admin_profiles pese al RLS.
--    search_path = ''   → evita secuestro de nombres; todo va calificado.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_admin_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full_name text;
begin
  -- full_name: metadata → parte local del correo → 'New User'.
  -- La metadata SOLO se usa para el nombre visible, nunca para permisos.
  v_full_name := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');

  if v_full_name is null then
    v_full_name := nullif(split_part(coalesce(new.email, ''), '@', 1), '');
  end if;

  if v_full_name is null then
    v_full_name := 'New User';
  end if;

  -- Alta con el minimo privilegio. tenant_id, role y active son
  -- literales fijos: no provienen de la peticion del usuario.
  insert into public.admin_profiles (user_id, tenant_id, full_name, role, active)
  values (new.id, 'hook-adventure', v_full_name, 'staff', false)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_admin_user() is
  'Crea el admin_profile de un usuario nuevo de auth.users como staff/inactivo. La activacion y el rol son decisiones manuales de un owner.';

-- ---------------------------------------------------------------------
-- 2) Trigger sobre auth.users (se recrea de forma idempotente).
--    Solo se elimina ESTE trigger; los demas triggers de Auth quedan intactos.
-- ---------------------------------------------------------------------
drop trigger if exists on_auth_user_created_admin_profile on auth.users;

create trigger on_auth_user_created_admin_profile
  after insert on auth.users
  for each row
  execute function public.handle_new_admin_user();

-- ---------------------------------------------------------------------
-- 3) Permisos de la funcion: solo la usa el trigger.
--    Se revoca DESPUES de crear el trigger, y se concede explicitamente
--    al rol de Auth si existe, para no romper el alta de usuarios.
-- ---------------------------------------------------------------------
revoke all on function public.handle_new_admin_user() from public;
revoke all on function public.handle_new_admin_user() from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant execute on function public.handle_new_admin_user() to supabase_auth_admin';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4) Backfill de usuarios ya existentes en auth.users sin perfil.
--    ON CONFLICT DO NOTHING: los perfiles que YA existen (incluidos los
--    owner ya creados manualmente) NO se tocan ni se degradan.
-- ---------------------------------------------------------------------
insert into public.admin_profiles (user_id, tenant_id, full_name, role, active)
select
  u.id,
  'hook-adventure',
  coalesce(
    nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'New User'
  ),
  'staff',
  false
from auth.users u
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------
-- 5) RLS sigue activo y sin politicas publicas (heredado de 0004).
--    Solo el backend (SUPABASE_SECRET_KEY) y esta funcion acceden.
-- ---------------------------------------------------------------------
alter table public.admin_profiles enable row level security;
revoke all on table public.admin_profiles from anon, authenticated;

commit;
