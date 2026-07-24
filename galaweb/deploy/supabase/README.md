# Supabase — base de datos del motor de reservas (LOAN-IX)

Historial de migraciones de la base de datos de reservas. Las migraciones se
aplican **una sola vez y en orden** sobre el proyecto real de Supabase.

## Migraciones

| Archivo | Estado | Descripción |
|---|---|---|
| `migrations/0001_init_bookings.sql` | ✅ Aplicada | Crea `bookings` y `stripe_webhook_events`, constraints, índices, trigger `updated_at` y RLS. |
| `migrations/0002_harden_bookings.sql` | ✅ Aplicada | `amount` → `amount_cents`, añade `paid_at`, `tour_name`/`booking_date` NOT NULL (con validación previa), estado de procesamiento en `stripe_webhook_events`, índices extra, `revoke` a anon/authenticated. |

> **Importante:** ambos archivos son el **historial** de lo ya aplicado. No los
> vuelvas a ejecutar sobre el proyecto actual. Para cualquier cambio futuro de
> esquema, crea una nueva migración incremental `0003_*.sql` con `ALTER TABLE`.

## Cómo aplicar una migración nueva (a futuro)

1. Abre Supabase → **SQL Editor** → *New query*.
2. Pega **solo el SQL** de la migración (no pegues archivos `.js`).
3. Pulsa **Run**. Debe indicar *Success*.

También puede aplicarse con la Supabase CLI (`supabase db push`) si el proyecto
está enlazado.

## Variables de entorno (backend serverless)

El backend accede a la base de datos **exclusivamente** desde funciones
serverless (`/api`) mediante:

| Variable | Uso |
|---|---|
| `SUPABASE_URL` | URL del proyecto (`https://xxxxx.supabase.co`). |
| `SUPABASE_SECRET_KEY` | Clave secreta `sb_secret_…`. **Solo servidor.** |

### Seguridad

- `SUPABASE_SECRET_KEY` (`sb_secret_…`) **nunca** debe aparecer en HTML,
  `assets/js`, código público, GitHub, variables `NEXT_PUBLIC_*` ni en el
  navegador. Solo vive como variable de entorno en Vercel y en `.env.local`.
- RLS está **activado** en ambas tablas y **no hay políticas públicas**; los
  roles `anon` y `authenticated` no tienen acceso. Solo el backend, que usa la
  secret key (bypass de RLS), puede leer/escribir.
- Consulta `.env.example` para la lista completa de variables del proyecto.
