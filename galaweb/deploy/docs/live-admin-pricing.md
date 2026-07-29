# Precios de paquetes administrables en vivo

Permite al **owner** cambiar el precio de los paquetes desde el panel Admin y que
el cambio se refleje realmente en vivo (sitio público EN/ES, desktop/móvil,
`pricing-preview`, checkout, Stripe, reservas, emails y finanzas) **sin editar
código, sin redeploy y sin tocar Stripe manualmente**.

> Rama: `feat/live-admin-pricing`. Migración: `supabase/migrations/0012_live_admin_pricing.sql`
> (NO ejecutada aún). NO afecta la Etapa 8 (`feat/stage-8-passenger-intake`, `807f367`),
> ni Stripe LIVE, ni las reservas históricas.

## 1. Fuente de verdad

| Capa | Antes | Ahora |
|---|---|---|
| Precio de PAQUETES | `server/lib/tour-catalog.js` (código) | **`public.package_prices`** (Supabase, editable) |
| Tours de día / pesca | catálogo (sin cambios) | catálogo (sin cambios) |

`public.package_prices` guarda **una sola fila `published` por `tenant_id + package_id`**.
El servidor cobra SIEMPRE esa fila. `content.js` conserva textos e itinerarios pero
**ya no es autoridad del precio**; `reconcilePrices()` sigue impidiendo que
`localStorage` altere el precio mostrado.

Tablas:

- **`package_prices`** — `base_price_cents` (entero, centavos), `currency='USD'`,
  `status` (`draft`|`published`|`archived`), `pricing_version` (monótona), `published_at`,
  `published_by_user_id`, timestamps. Índices únicos parciales: 1 `published` y 1 `draft`
  por paquete; versión única por paquete.
- **`package_price_history`** — bitácora **append-only** (`publish`|`rollback`|`deactivate`|`reactivate`),
  con precio/versión anterior y nuevo, usuario y motivo. Un trigger `BEFORE UPDATE OR DELETE`
  (`forbid_mutation_package_price_history`) impide **modificar y borrar** eventos
  (incluso para el `service_role`); solo se pueden **agregar** filas.

## 2. Roles

| Acción | owner | admin | staff |
|---|:--:|:--:|:--:|
| Ver precios / historial | ✅ | ✅ | ❌ (403) |
| Crear / editar borrador (`draft`) | ✅ | ✅ | ❌ |
| Publicar | ✅ | ❌ | ❌ |
| Rollback | ✅ | ❌ | ❌ |
| Desactivar / Reactivar | ✅ | ❌ | ❌ |

El rol se relee de `admin_profiles` en **cada** petición (`requireAdmin`); nunca se
confía en el rol que envía el navegador. La sección no se genera para staff y sus
endpoints responden 403.

## 3. Flujo draft → publish

1. owner/admin edita el precio y **Guardar borrador** (`draft`; no afecta Production).
2. owner pulsa **Publicar** → confirmación obligatoria **“PUBLICAR NUEVOS PRECIOS”**
   + **motivo** (≥5 caracteres). El backend ejecuta **una sola operación atómica**
   (RPC `publish_package_price_atomic`, ver §Atomicidad): archiva el `published`
   anterior, inserta la nueva versión `published` (`pricing_version` +1), archiva el
   draft consumido y registra el historial — todo en **una transacción**. Se devuelve
   la fila persistida (no se reporta éxito antes de confirmar la escritura real).

## 4. Rollback / desactivar / reactivar

- **Rollback**: publica el precio de la versión anterior como una **nueva** versión
  (`action='rollback'`). No borra ni sobrescribe.
- **Desactivar**: archiva el `published` → el paquete queda **sin** precio publicado →
  su checkout se **bloquea** (`PACKAGE_PRICE_UNAVAILABLE`) y la tarjeta muestra
  “Precio temporalmente no disponible”.
- **Reactivar**: vuelve a publicar el último precio conocido como nueva versión.

## Atomicidad, locking y concurrencia (RPC)

`publish`, `rollback`, `deactivate` y `reactivate` **no** se hacen en varios pasos
independientes desde JavaScript. Cada una es **una sola llamada RPC** a una función
transaccional de Postgres:

| Operación | Función RPC |
|---|---|
| Publicar | `publish_package_price_atomic(tenant, package, price_cents, user, reason)` |
| Rollback | `rollback_package_price_atomic(tenant, package, user, reason)` |
| Desactivar/Reactivar | `set_package_price_active_atomic(tenant, package, action, user, reason)` |

Propiedades:

- **`LANGUAGE plpgsql` · `SECURITY DEFINER` · `SET search_path = public, pg_temp`** (fijo y seguro).
- **Serialización por paquete:** `pg_advisory_xact_lock(hashtext(tenant||'|'||package))`
  + `SELECT … FOR UPDATE` sobre el `published` actual. Dos operaciones simultáneas sobre
  el mismo paquete se ordenan; **nunca** hay dos `published` ni dos filas con la misma
  `pricing_version`.
- **Todo o nada:** si cualquier paso falla, la transacción hace **rollback** completo →
  el precio anterior sigue `published`, no queda historial parcial y jamás queda el
  paquete sin precio por un fallo. El índice único parcial `where status='published'`
  garantiza a nivel de esquema que no puedan coexistir dos precios vigentes.
- **Validación en el RPC** (además del backend): tenant, package, actor, precio > 0 y
  motivo ≥5 (`RAISE EXCEPTION` con códigos: `REASON_REQUIRED`, `INVALID_PRICE`,
  `NO_PREVIOUS`, `NOT_PUBLISHED`, `ALREADY_PUBLISHED`, `NO_PRICE_TO_REACTIVATE`, …).
  El backend traduce el error a un código saneado (nunca SQL ni stack traces al cliente).
- **Permisos:** `REVOKE EXECUTE … FROM public, anon, authenticated` y `GRANT EXECUTE …
  TO service_role`. Solo el backend (service role) puede invocarlos; el navegador nunca.
  El backend mantiene `requireAdmin`/owner/`sameOrigin` y pasa el `user_id` real de la sesión.

`server/lib/package-pricing.js` hace **una** llamada `supabase.rpc(...)` por operación;
no ejecuta “archivar → insertar → historial” como pasos sueltos.

## 5. `pricing_version`

Entero monótono creciente por paquete. Sube en cada publicación, rollback y
reactivación. `pricing-preview` (POST) y la lista pública (GET) exponen la versión
vigente; el historial conserva versión anterior → nueva.

## 6. Cadena de precio (coherencia)

```
package_prices (published)
  = pricing-preview (GET lista / POST total)
  = precio visible en la tarjeta
  = computeWebPricing (motor)
  = Stripe PaymentIntent.amount
  = bookings.amount_cents
  = email de confirmación
  = finanzas
```

El navegador puede enviar `package_id`, **nunca** `amount` (fuera de `ALLOWED_KEYS`).
Si un paquete no tiene precio `published`, `create-payment-intent` responde
`PACKAGE_PRICE_UNAVAILABLE` **antes** de crear la reserva o el PaymentIntent (no se
cobra nada).

## 7. Fallback temporal (durante la transición)

Mientras la migración 0012 **no** esté aplicada:

- Si la tabla `package_prices` **no existe** → el servidor usa el **catálogo**
  (`tour-catalog.js`) como respaldo y registra un warning saneado.
- Si la tabla existe pero **no hay `published`** para el paquete → se **bloquea**
  (no se inventa precio).
- Cualquier **otro** error de Supabase → se **bloquea** (sin fallback silencioso).
- **Nunca** se usa `localStorage` ni un precio del navegador como respaldo, ni
  números distintos por idioma/viewport.

**Cómo retirar el fallback (después de aplicar 0012 y verificar Production):** en
`server/lib/package-pricing.js`, en `resolvePackageBasePriceCents` y
`publicPackagePriceList`, sustituir la rama `table_missing` por un bloqueo
(`throw 'PACKAGE_PRICE_UNAVAILABLE'` / `ok:false`). Hacerlo SOLO cuando la tabla
exista en Production, para no quedar sin precios.

## 8. Actualización en vivo (sin websockets)

`pricing-preview` responde con `Cache-Control: no-store`. El precio nuevo aparece al
**recargar** la página, al **cambiar de idioma**, al **abrir el modal**, en **otro
navegador** y en **móvil** — sin redeploy. El panel ofrece **“Actualizar precios en
página”** (vuelve a consultar el endpoint).

## 9. Endpoints (sin nuevas funciones Vercel)

Todos entran por `api/admin-router.js` (una sola función; rewrites en `vercel.json`):

| Ruta pública | action | Método | Rol |
|---|---|---|---|
| `/api/admin-package-prices-list` | `package-prices-list` | GET | owner, admin |
| `/api/admin-package-price-draft-save` | `package-price-draft-save` | POST | owner, admin |
| `/api/admin-package-price-publish` | `package-price-publish` | POST | owner |
| `/api/admin-package-price-history` | `package-price-history` | GET | owner, admin |
| `/api/admin-package-price-rollback` | `package-price-rollback` | POST | owner |
| `/api/admin-package-price-toggle` | `package-price-toggle` | POST | owner |

Público: `GET /api/pricing-preview` (lista de tarjetas), `POST /api/pricing-preview`
(total del modal), ambos `no-store`.

## 10. Pasos manuales de migración (owner)

> **Claude NO ejecuta migraciones.** Estos pasos los hace el owner tras revisar el SQL.

1. Revisar `supabase/migrations/0012_live_admin_pricing.sql`.
2. En el **SQL Editor** de Supabase, ejecutar el archivo **una sola vez**.
3. Verificar (solo lectura):
   ```sql
   select package_id, base_price_cents, status, pricing_version
   from public.package_prices where status='published' order by package_id;
   ```
   Debe devolver 5 filas: `p3=349900, p4=399900, p7=479900, p8sc=531900, p8is=531900`.
4. Confirmar variables: `TENANT_ID=hook-adventure` (coincide con la semilla).
5. Recargar el sitio: las tarjetas ahora leen el precio de Supabase.

> La semilla es **idempotente** (`ON CONFLICT DO NOTHING`): aplicarla no cambia el
> precio actual. La renumeración de la migración de la Etapa 8 (0012 → 0013) se hará
> por separado, al integrar esa etapa.

## 11. QA

Suite `scratchpad/live-admin-pricing-tests.js` (33 casos): semilla, roles (owner/admin/staff),
draft/publish, versión, historial, motivo obligatorio, rollback, bloqueo por
archivado/inexistente, coherencia preview↔checkout↔Stripe↔bookings, fallback controlado,
error real que bloquea, tenant incorrecto, sin fallback monetario en frontend, historial
no borrable. `scratchpad/pricing-consistency-tests.js` verifica que la semilla coincide con
catálogo y `content.js`.

## 12. Verificar Stripe sin pago real

- Usar `pricing-preview` (GET/POST) para confirmar el precio: **no** crea PaymentIntent.
- Enviar a `create-payment-intent` un paquete con **fecha inválida** → falla en la
  validación **antes** de tocar Stripe/BD (no crea reserva ni PI). Prueba de que el guard
  y el precio están activos sin mover dinero.
- **Nunca** introducir tarjeta ni confirmar una transacción LIVE en pruebas.
