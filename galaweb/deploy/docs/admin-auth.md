# Panel admin — autenticación multiusuario

Cada persona entra con **su propio email y contraseña**. Las contraseñas las
gestiona **Supabase Auth** (`auth.users`); el proyecto **no** guarda contraseñas
ni hashes propios, ni en la base de datos ni en variables de entorno.

La **autorización** (a qué tenant pertenece, qué rol tiene y si sigue activo)
vive en `public.admin_profiles` y se **revalida en cada petición**.

## Roles

| Rol | Etiqueta ES | Etiqueta EN | Acceso |
|---|---|---|---|
| `owner` | Administrador maestro | Master administrator | Reservas, cotizaciones, estados, cambio de `booking_status`, editor de contenido. |
| `admin` | Administrador | Administrator | Igual que `owner` en esta versión. |
| `staff` | Personal operativo | Staff | **Solo lectura.** Agenda de reservas `booking` + `paid` + `confirmed`. |

**`staff` nunca ve:** cotizaciones, reservas pending/processing/failed/cancelled/refunded,
importes, estados de pago, `paid_at`, ni el editor de contenido. Sus controles de
modificación **no se generan en el DOM**, y el servidor rechaza cualquier intento
de actualización con **403**.

**Ningún rol** puede cambiar `payment_status` manualmente: eso solo lo mueve Stripe
a través del webhook.

## Variables de entorno (solo servidor)

| Variable | Uso |
|---|---|
| `SUPABASE_URL` | Proyecto Supabase. |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` — la usa el servidor para `signInWithPassword`. |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` — **solo servidor**, lee `admin_profiles` y `bookings`. |
| `TENANT_ID` | `hook-adventure`. Debe coincidir con `admin_profiles.tenant_id`. |
| `SESSION_SECRET` | Firma HMAC-SHA256 de la cookie de sesión. |

Genera `SESSION_SECRET` con:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> `ADMIN_PASSWORD_HASH` **ya no se usa** (era el login de contraseña compartida).
> Puede eliminarse de Vercel una vez validado el nuevo login.

## Crear usuarios

### Paso 1 — Supabase → Authentication → Users → **Add user**

Email + contraseña. ⚠️ **Marca "Auto Confirm User".** Sin confirmar el correo,
`signInWithPassword` falla con *"Email not confirmed"* y el login no funcionará.
(Con SMTP configurado puedes usar *Invite* para que cada persona elija su contraseña.)

### Paso 2 — Copia el **UUID** del usuario (columna `UID`).

### Paso 3 — SQL Editor: crea su perfil de autorización

```sql
-- Dos administradores maestros
insert into public.admin_profiles (user_id, tenant_id, full_name, role, active)
values
  ('00000000-0000-0000-0000-000000000000', 'hook-adventure', 'Nombre Uno', 'owner', true),
  ('11111111-1111-1111-1111-111111111111', 'hook-adventure', 'Nombre Dos', 'owner', true);

-- Personal operativo (solo lectura)
insert into public.admin_profiles (user_id, tenant_id, full_name, role, active)
values ('22222222-2222-2222-2222-222222222222', 'hook-adventure', 'Guía Ejemplo', 'staff', true);
```

`tenant_id` debe ser exactamente el valor de `TENANT_ID`, o el login rechazará al usuario.

Comprobar:

```sql
select full_name, role, active, tenant_id, last_login_at from public.admin_profiles;
```

## Operaciones cotidianas

```sql
-- Quitar el acceso de inmediato (surte efecto en la siguiente petición)
update public.admin_profiles set active = false where user_id = '...';

-- Cambiar de rol
update public.admin_profiles set role = 'staff' where user_id = '...';
```

No hace falta cerrar sesiones a mano: `active` y `role` se releen de la base de datos
en **cada** petición, así que una desactivación o un cambio de rol se aplican al
instante aunque la cookie siga vigente.

## Sesión

Cookie `gha_admin_session`: **HttpOnly**, **SameSite=Strict**, **Path=/**,
**Secure** en producción, **~8 horas** de duración, firmada con HMAC-SHA256.

Contiene únicamente `user_id`, `email`, `full_name`, `role`, `tenant_id`, marcas de
tiempo y un nonce. **No** contiene contraseñas, hashes, `access_token` ni `refresh_token`.
El navegador **nunca** habla directamente con Supabase.

## Ventas directas (agencia / teléfono / presencial)

Los **tres roles** pueden registrar una venta que no pasó por Stripe, con
**Añadir venta directa** (`POST /api/admin-agency-booking-create`).

El usuario introduce: cliente, teléfono, email (opcional), tour o destino,
fecha del tour, viajeros, importe cobrado, método de pago y notas.
El **servidor** fija, sin que el navegador pueda alterarlos:

`sales_channel='agency'` · `request_type='booking'` · `payment_status='paid'` ·
`booking_status='confirmed'` · `currency='usd'` · `tenant_id` ·
`created_by_user_id` y `created_by_name` (de la sesión) · `sold_at` y `paid_at`
(reloj del servidor) · `booking_code`. Nunca hay `stripe_payment_intent_id`.

Enviar cualquiera de esos campos desde el navegador devuelve **400**. La operación
es idempotente por `request_id`: un doble clic no crea dos ventas.

Límites: viajeros 1–50 · importe 1–100 000 000 centavos ($1 000 000) ·
`booking_date` entre 365 días atrás y 730 adelante.

**Qué ve staff después:** la reserva aparece en su agenda (queda paid + confirmed)
con fecha, código, destino, cliente, teléfono, viajeros y notas. **No** ve importe,
método de pago, canal ni quién registró la venta.

### Correcciones (limitación conocida de esta versión)

Una venta directa **no se puede editar** después de crearla. Si hay un error,
owner/admin cancelan la reserva (`booking_status='cancelled'`) y registran una nueva.

Mejora pendiente para una fase posterior: endpoint de corrección exclusivo de
owner/admin con historial de auditoría (motivo del cambio, valores anteriores y
nuevos, autor y fecha).

## Resumen financiero

`GET /api/admin-finance-summary` — **solo owner y admin**; staff recibe **403**.

Agrupa por **`sold_at` (fecha de caja: cuándo entró el dinero)**, nunca por
`booking_date` (fecha del tour). `date_from` / `date_to` son fechas de venta y se
convierten a instantes con la zona horaria de Galápagos (UTC−6). Cuenta solo
`request_type='booking'` y `payment_status='paid'`: quedan fuera pending,
processing, failed, refunded y las cotizaciones.

La suma se hace **en el servidor**; al navegador solo viajan los totales.

## Notas

- Cambiar `booking_status` a `cancelled` **no** reembolsa en Stripe ni altera
  `payment_status`. El panel avisa antes de cancelar una reserva pagada.
- El editor de contenido (textos/imágenes de `content.js`) sigue siendo una función
  **local/legacy**: guarda en el `localStorage` del propio navegador y no afecta a los
  clientes. Los **precios reales de cobro** viven en `api/_lib/tour-catalog.js` (servidor).
- La pantalla "Equipo" para invitar/desactivar usuarios desde la interfaz queda para
  una fase posterior; por ahora se gestiona desde Supabase.
