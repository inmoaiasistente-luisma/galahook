# Panel admin — autenticación multiusuario

## Dónde vive el código (importante)

El plan Hobby de Vercel admite **12 Serverless Functions**. Para no superarlo,
solo `/api` contiene funciones desplegables; el resto del servidor vive fuera:

```
api/                      → 6 funciones desplegadas
  admin-router.js           las 11 acciones del panel
  booking-qr-lookup.js      check-in
  create-payment-intent.js  pago
  quote-request.js          cotización
  stripe-config.js          clave publicable
  stripe-webhook.js         webhook (raw body, aparte a propósito)
server/lib/               → librerías compartidas (NO son funciones)
server/admin-handlers/    → la lógica de los 11 endpoints admin
```

**Las URLs públicas no cambiaron.** `vercel.json` reescribe internamente
`/api/admin-login` → `/api/admin-router?action=login`, etc. Son *rewrites*, no
redirecciones: el navegador sigue llamando a `/api/admin-login` como siempre y
`admin.js` no se modificó.

El router **no autentica**: despacha `req` y `res` intactos al handler, que
conserva su `requireAdmin`, `sameOrigin`, control de método HTTP, cookies y
proyecciones por rol. La tabla de rutas es **estática** (`require()` literales
resueltos al cargar el módulo), así que ninguna cadena del navegador puede
cargar un fichero arbitrario. Una acción desconocida devuelve **404** sin
revelar cuáles existen.

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

> El proyecto **no usa ninguna variable de contraseña compartida**. Si quedara
> alguna del prototipo inicial en Vercel, elimínala: ver `docs/go-live-checklist.md`.

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

## Motor de precios y descuentos configurables (Lote 3)

El importe de una reserva **web** lo calcula un motor único en el servidor
(`server/lib/pricing-engine.js`). El navegador nunca envía ni decide el total:
manda `tour_id` + `guests`, y `/api/pricing-preview` (POST, público) devuelve
solo lo visible — bruto, descuento, total, moneda y etiqueta —, **nunca costos
ni utilidad**. `create-payment-intent` usa el mismo motor y guarda una fotografía
en la reserva: `gross_amount_cents`, `discount_cents`, `discount_rule_id`,
`cost_cents` y `pricing_snapshot`. Cambiar reglas o costos **no** reescribe
reservas ya creadas; reutilizar el mismo `request_id` conserva el snapshot
original (no recalcula con una regla nueva).

**El descuento fijo del 20 % se retiró.** Sin regla activa no hay descuento y
Stripe cobra el bruto. Los descuentos son ahora reglas configurables
(`public.discount_rules`), y el servidor aplica **UNA** por reserva (nunca
acumula), eligiéndola así: tour específico antes que global → mayor `priority`
→ mayor `min_guests` → `created_at` más reciente. Tipos: `percentage` (bps),
`fixed_total`, `fixed_per_pax`. El descuento se clampa para que el total nunca
baje de 1 centavo.

**Costos** (`public.tour_financial_settings`): `fixed_cost_cents +
cost_per_pax_cents × guests`. Si un tour no tiene configuración activa,
`cost_cents = null` — nunca se asume costo 0.

## Módulo Finanzas y permisos (Lote 3)

`admin.html` tiene una sección **Finanzas / Finance** visible para **owner y
admin** (staff no la ve en el DOM y recibe **403** en todos los endpoints
financieros). Muestra ingresos brutos, descuentos, netos, costos conocidos,
utilidad conocida, margen, ventas, pax, métricas por pax, ventas sin costo, y
una **tabla por tour**. Cuando hay ventas sin costo configurado, la utilidad se
marca **parcial** y se informa `missing_cost_sales_count` (no se finge costo 0).

| | Ver Finanzas | Costos | Descuentos |
|---|:--:|:--:|:--:|
| **owner** | sí | crear/editar | crear/editar/activar |
| **admin** | sí | crear/editar | crear/editar/activar |
| **staff** | no (403) | no (403) | no (403) |

Endpoints (vía `admin-router`, sin sumar funciones Vercel): `finance-settings-list`
(GET owner/admin), `finance-settings-save` (POST **owner/admin**), `discount-rules-list`
(GET owner/admin), `discount-rule-save` (POST **owner/admin**), `discount-rule-toggle`
(POST **owner/admin**). staff → **403** en todos. Las reglas **no se borran**: se
activan/desactivan con `active`.
`payment_status` lo sigue moviendo solo Stripe/webhook.

## Resumen financiero

`GET /api/admin-finance-summary` — **solo owner y admin**; staff recibe **403**.

Agrupa por **`sold_at` (fecha de caja: cuándo entró el dinero)**, nunca por
`booking_date` (fecha del tour). `date_from` / `date_to` son fechas de venta y se
convierten a instantes con la zona horaria de Galápagos (UTC−6). Cuenta solo
`request_type='booking'` y `payment_status='paid'`: quedan fuera pending,
processing, failed, refunded y las cotizaciones.

La suma se hace **en el servidor**; al navegador solo viajan los totales.

## Correos automáticos (Resend)

Cada correo se registra en `public.email_notifications` con unicidad
`(booking_id, notification_type, recipient_email)`: **un mismo correo nunca se
envía dos veces**, ni por reintentos de Stripe, ni por doble clic, ni por
ejecución concurrente (el envío se reclama con un *compare-and-swap* sobre
`status`).

**Normalización del destinatario.** El correo se pasa por `trim()` +
`toLowerCase()` **antes** de validarlo, y a partir de ahí solo se usa esa forma
normalizada para insertar, buscar, comparar, enviar y aplicar la idempotencia.
`Cliente@Email.com`, `cliente@email.com` y `" cliente@email.com "` son el mismo
destinatario y generan **una sola** notificación. Si tras normalizar el valor no
es un correo válido, se descarta sin dejar rastro.

La migración **0009** normaliza el historial ya existente y añade el índice único
funcional `uq_email_notification_normalized` sobre
`(booking_id, notification_type, lower(btrim(recipient_email)))`, de modo que la
protección también la impone la base de datos. Conserva el constraint
`uq_email_notification` de 0007 y **se detiene con un error** si encuentra
duplicados: no borra filas ni elige una arbitrariamente.

| Tipo | Cuándo | Destinatario | QR |
|---|---|---|:--:|
| `customer_booking_confirmation` | reserva web pagada (webhook) | cliente | ✅ |
| `owner_booking_notification` | reserva web pagada | `BOOKING_NOTIFICATION_EMAIL` | ❌ |
| `customer_quote_acknowledgement` | cotización creada | cliente | ❌ |
| `owner_quote_notification` | cotización creada | interno | ❌ |
| `customer_agency_confirmation` | venta directa | cliente | ✅ |
| `owner_agency_notification` | venta directa | interno | ❌ |

Los correos al **cliente son bilingües** (inglés primero, español después); los
**internos van en español**. Todo dato introducido por el usuario se escapa.

**Un fallo de correo nunca rompe la operación:** la reserva permanece
`paid + confirmed`, la cotización y la venta directa siguen creadas, y la
notificación queda en `failed`. Owner/admin ven el estado en el detalle de la
reserva y pueden pulsar **Reintentar** (solo para `failed`).

Los destinatarios salen **únicamente** de `booking.customer_email` y de
`BOOKING_NOTIFICATION_EMAIL`. No existe ningún endpoint para enviar correos
arbitrarios.

## Código QR de check-in

Cada reserva pagada y confirmada obtiene una fila en `public.booking_qr_access`.
**El token no se almacena**: se firma con HMAC-SHA256 y `QR_SIGNING_SECRET` a
partir de un identificador público opaco (`public_id`) y una versión.

```
token = base64url("<public_id>.<token_version>") + "." + base64url(HMAC(payload))
url   = PUBLIC_SITE_URL/checkin.html#t=<token>
```

El token viaja en el **fragmento** (`#`), nunca en la query (`?`). El navegador
no envía el fragmento al servidor en la carga inicial, así que el token no
aparece en los registros de acceso ni en la cabecera `Referer` de recursos
externos. **No se genera ninguna URL con `?t=`.**

El QR **no contiene** nombre, correo, teléfono, importe, `booking_code`,
`booking_id` ni identificadores de Stripe. Caduca al final del día del tour
(hora de Galápagos) **+ 7 días**.

**Check-in:** el guía escanea con la cámara nativa del móvil; se abre
`checkin.html`, que exige sesión (owner, admin o staff) y consulta
`POST /api/booking-qr-lookup` con el token **en el cuerpo JSON**
(`{ "token": "…" }`). El endpoint solo acepta **POST** (cualquier otro método
responde **405**), exige **mismo origen**, rechaza cualquier clave que no sea
`token`, valida tipo y longitud (8–512) y **no habilita CORS**.

El token vive solo en memoria: se lee exclusivamente de `location.hash`, se
retira de la barra de direcciones con `history.replaceState` **inmediatamente
después de leerlo**, no se guarda en `localStorage` ni `sessionStorage`, no se
vuelve a escribir en la URL y nunca se registra en logs ni se devuelve en las
respuestas.

Válido para `booking_status` **`confirmed`** y **`completed`**. Rechaza
`new`, `pending_payment`, `cancelled`, `failed`, `refunded`, `processing` y
cualquier cotización.

**Staff ve** código, tour, fecha, cliente, pax, teléfono, email y notas.
**No ve** importe, método de pago, canal ni ningún dato financiero.
Escanear **no cambia** ningún estado.

**Rotar / revocar** (solo owner/admin): rotar incrementa `token_version` y el QR
anterior deja de funcionar **al instante** — hay que descargar el nuevo PNG y
enviárselo al cliente manualmente (en esta versión no hay reenvío automático).
Revocar deja el acceso inservible sin tocar `booking_status`.

## Notas

- Cambiar `booking_status` a `cancelled` **no** reembolsa en Stripe ni altera
  `payment_status`. El panel avisa antes de cancelar una reserva pagada.
- **Preview vs Production:** los QR se generan con `PUBLIC_SITE_URL`. Un QR
  emitido desde Preview apunta a la URL de Preview y dejará de funcionar cuando
  ese deployment caduque. **En Preview usa solo correos propios de prueba.**
- El editor de contenido (textos/imágenes de `content.js`) sigue siendo una función
  **local/legacy**: guarda en el `localStorage` del propio navegador y no afecta a los
  clientes. Los **precios reales de cobro** viven en `api/_lib/tour-catalog.js` (servidor).
- La pantalla "Equipo" para invitar/desactivar usuarios desde la interfaz queda para
  una fase posterior; por ahora se gestiona desde Supabase.
