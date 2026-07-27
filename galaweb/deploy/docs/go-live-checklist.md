# Lista de lanzamiento — Galápagos Hook Adventure

Documento operativo para pasar de Preview a Production.
**No contiene ningún valor real de variables.** Los valores se introducen
únicamente en el panel de Vercel y en Supabase.

Orden recomendado: **A → M**. No saltes al despliegue de Production sin
haber completado H (pruebas obligatorias).

---

## A. Variables en **Preview**

| Variable | Valor |
|---|---|
| `STRIPE_SECRET_KEY` | clave **TEST** (`sk_test_…`) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | clave **TEST** (`pk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` del webhook **de prueba** |
| `SUPABASE_URL` | proyecto Supabase |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` — solo servidor |
| `TENANT_ID` | `hook-adventure` |
| `SESSION_SECRET` | aleatorio de 32 bytes |
| `RESEND_API_KEY` | `re_…` |
| `EMAIL_FROM` | remitente verificado en Resend |
| `EMAIL_REPLY_TO` | buzón de respuesta |
| `BOOKING_NOTIFICATION_EMAIL` | buzón interno |
| `PUBLIC_SITE_URL` | **la URL del deployment de Preview** |
| `QR_SIGNING_SECRET` | aleatorio de 32 bytes, **distinto** de `SESSION_SECRET` |

Generar los dos secretos:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

⚠️ **En Preview usa solo correos tuyos.** Un QR emitido desde Preview
apunta a la URL de Preview y dejará de funcionar cuando ese deployment
caduque. Nunca envíes un QR de Preview a un cliente real.

---

## B. Variables en **Production**

Las mismas 14, con estos cambios:

| Variable | Production |
|---|---|
| `STRIPE_SECRET_KEY` | **LIVE** (`sk_live_…`) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | **LIVE** (`pk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` del webhook **LIVE** (es otro, ver D) |
| `PUBLIC_SITE_URL` | `https://www.galapagoshookadventure.com` |

El resto (Supabase, Resend, `TENANT_ID`, los dos secretos) puede repetirse.
Si prefieres aislar por completo, usa secretos distintos en Production —
pero entonces **los QR emitidos en Preview dejarán de validar**, lo cual es
justamente lo deseable.

**Limpieza:** si en Vercel quedara alguna variable del prototipo inicial
(por ejemplo una contraseña compartida de administrador), **elimínala**.
El código actual no lee ninguna variable de contraseña: las contraseñas
viven en Supabase Auth.

---

## C. Diferencias TEST / LIVE en Stripe

| | TEST | LIVE |
|---|---|---|
| Claves | `sk_test_` / `pk_test_` | `sk_live_` / `pk_live_` |
| Tarjetas | `4242 4242 4242 4242` y demás de prueba | tarjetas reales |
| Webhook | endpoint y `whsec_` propios | endpoint y `whsec_` **distintos** |
| Datos | no se mezclan con LIVE | separados |

El webhook ya comprueba `livemode` y rechaza el evento si no coincide con
el tipo de clave configurada: una clave TEST **no** procesará eventos LIVE
ni al revés. Esto evita el error clásico de confirmar pagos falsos en
producción.

**Nunca** pongas una clave LIVE en Preview.

---

## D. Crear el webhook **LIVE**

1. Stripe Dashboard → cambia a **modo Live** (interruptor arriba).
2. Developers → Webhooks → **Add endpoint**.
3. URL: `https://www.galapagoshookadventure.com/api/stripe-webhook`
4. Eventos a escuchar — como mínimo:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `payment_intent.canceled`
5. Copia el **Signing secret** (`whsec_…`) y ponlo en `STRIPE_WEBHOOK_SECRET`
   **de Production**. No reutilices el de TEST.
6. Tras el primer pago real, comprueba en Stripe → Webhooks que la entrega
   devuelve **200**.

---

## E. Verificación de Resend

1. Resend → Domains → añade `galapagoshookadventure.com`.
2. Crea en tu DNS los registros **SPF** y **DKIM** que indique Resend.
3. Espera a que el dominio aparezca como **Verified**.
4. `EMAIL_FROM` debe usar ese dominio verificado.

⚠️ **Sin dominio verificado, todos los correos fallan.** La reserva se
completa igual (paid + confirmed) y la notificación queda en `failed`;
owner/admin pueden reintentarla desde el detalle de la reserva.

Prueba de humo: haz una reserva de prueba con tu propio correo y confirma
que llegan los dos mensajes (cliente con QR adjunto + interno).

---

## F. `PUBLIC_SITE_URL` correcta

- Production: `https://www.galapagoshookadventure.com`
- Preview: la URL del deployment de Preview

Debe ir **sin barra final** y **con el mismo host** que use el cliente
(si el dominio canónico es `www`, ponlo con `www`).

De esta variable salen los enlaces del QR:
`PUBLIC_SITE_URL/checkin.html#t=<token>`. Si está mal, los QR apuntan a
un sitio equivocado y el check-in no funciona.

Verificación: emite un QR desde el panel (detalle de reserva → Rotar QR)
y comprueba que la URL mostrada empieza por el dominio real.

---

## G. Usuarios owner / staff activos

En Supabase → Authentication → Users, y luego `public.admin_profiles`:

```sql
select full_name, role, active, tenant_id, last_login_at
from public.admin_profiles
order by role, full_name;
```

Comprobar antes de lanzar:

- [ ] Los **dos administradores maestros** existen con `role='owner'` y `active=true`.
- [ ] El personal operativo tiene `role='staff'` y `active=true`.
- [ ] `tenant_id` es exactamente el valor de `TENANT_ID` en todos.
- [ ] No queda ningún usuario de prueba activo.
- [ ] Cada usuario tiene **Auto Confirm User** marcado (si no, el login falla
      con "Email not confirmed").

Recuerda: los usuarios nuevos se crean por defecto como `staff` + `active=false`.
Hay que activarlos y darles rol a mano.

---

## H. Pruebas obligatorias antes de Production

Ejecuta la **matriz de QA completa** de `docs/qa-matrix.md` (57 casos) en
Preview con claves TEST. Como mínimo, estos no son negociables:

- [ ] Pago con `4242 4242 4242 4242` → reserva `paid` + `confirmed`.
- [ ] Tarjeta rechazada → mensaje amigable, sin texto técnico.
- [ ] Doble clic en Pagar → **una sola** reserva.
- [ ] El importe lo calcula el servidor (cambiar el precio en el navegador no afecta).
- [ ] Llegan los dos correos; reintentar el webhook **no** duplica ninguno.
- [ ] El QR abre el check-in y el `#t=` desaparece de la barra.
- [ ] Staff ve la agenda **sin importes**; recibe 403 en el resumen financiero.
- [ ] `active=false` corta el acceso en la siguiente petición.

---

## I. Limpieza de datos TEST

Antes de abrir al público, revisa y borra los registros de prueba.
Las consultas de **solo lectura** están en `docs/test-data-report.sql`.

Orden obligatorio al borrar (por las claves foráneas):

1. `email_notifications` (cascada desde `bookings`)
2. `booking_qr_access` (cascada desde `bookings`)
3. `bookings`

Ambas tablas hijas tienen `on delete cascade`, así que borrar la reserva
arrastra sus correos y su QR. **Aun así, revisa primero con los SELECT.**

- [ ] Reservas de prueba identificadas y borradas.
- [ ] Cotizaciones de prueba borradas.
- [ ] `stripe_webhook_events` de prueba revisados (se pueden conservar: son
      solo el registro de idempotencia).
- [ ] Ningún `booking_code` de prueba queda visible en la agenda.

---

## J. Plan de reversión

Si algo sale mal tras promover a Production:

1. **Reversión inmediata (1 min).** Vercel → Deployments → el deployment
   anterior → **Promote to Production**. Vuelve el sitio anterior sin tocar
   código ni base de datos.
2. **Cobros.** Los pagos ya realizados **no** se revierten solos. Los
   reembolsos se hacen **desde el Dashboard de Stripe** (el panel no
   reembolsa, por diseño).
3. **Base de datos.** Las migraciones 0001–0009 son acumulativas y no se
   revierten automáticamente. Ningún cambio de código requiere revertirlas.
4. **Correos.** Un correo ya enviado no se puede retirar. Si hubo un envío
   erróneo, contacta al cliente directamente.
5. **QR.** Si un QR se emitió con la URL equivocada: corrige
   `PUBLIC_SITE_URL`, redespliega y **rota el QR** de las reservas afectadas
   (detalle de la reserva → Rotar QR), luego envía el nuevo PNG al cliente.
   El anterior deja de valer al instante.

Antes de promover, anota el ID del deployment actual de Production para
poder volver a él sin buscarlo.

---

## K. Dominio

- [ ] `galapagoshookadventure.com` y `www.` añadidos en Vercel → Domains.
- [ ] Los registros DNS apuntan a Vercel y aparecen como **Valid**.
- [ ] Definido cuál es el canónico (recomendado: `www`) y el otro redirige.
- [ ] `PUBLIC_SITE_URL` coincide con el canónico.
- [ ] El dominio del webhook de Stripe usa ese mismo host.

## L. SSL

- [ ] Certificado emitido por Vercel y **válido** (candado en el navegador).
- [ ] `https://` fuerza redirección desde `http://`.
- [ ] Sin avisos de contenido mixto en la consola.
- [ ] La cookie de sesión sale con `Secure` (se activa sola cuando
      `NODE_ENV=production`, que es el caso en Vercel).

## M. Legal, contacto y cancelación

- [ ] `legal.html`, `terms.html` y `security-policy.html` cargan y están
      enlazadas desde el pie de página.
- [ ] Los datos de contacto son correctos: correo, teléfono, WhatsApp y
      direcciones de `assets/js/content.js`.
- [ ] La **política de cancelación** que se muestra en la reserva coincide
      con la real (`meta.cancelDays`, actualmente 30 días).
- [ ] Los textos de precios coinciden con lo que cobra el servidor
      (verificado: los 16 tours cuadran).
- [ ] Ningún texto promete algo que el sistema no hace todavía.

---

## Estado técnico congelado en esta fase

| | |
|---|---|
| Funciones desplegadas | **6** (límite Hobby: 12) |
| Migraciones aplicadas | 0001 – 0009 |
| Suites automáticas | 7 · **357 PASS · 0 FAIL** |
| `node --check` | 32 archivos, 0 errores |
| Gate de prelanzamiento | **eliminado** de las 10 páginas públicas |
| Reservas en localStorage | ninguna |
| Secretos en el repositorio | ninguno |
