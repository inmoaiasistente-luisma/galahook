# Panel admin — autenticación

El panel (`admin.html`) usa una sesión de servidor con cookie **HttpOnly** firmada.
El navegador **nunca** accede a Supabase ni ve la contraseña, el hash ni el secreto.

## Variables de entorno (solo servidor)

| Variable | Uso |
|---|---|
| `ADMIN_PASSWORD_HASH` | Hash **scrypt** de la contraseña del admin. |
| `SESSION_SECRET` | Secreto para firmar la cookie de sesión (HMAC-SHA256). |
| `TENANT_ID` | Tenant que filtra todas las reservas (`hook-adventure`). |

Estas variables ya existen en el proyecto para Stripe/Supabase; añade las dos primeras.
**Nunca** las subas a GitHub ni las guardes en el frontend.

## 1. Generar `ADMIN_PASSWORD_HASH`

```bash
node scripts/generate-admin-password-hash.js
```

Pide la contraseña por teclado (oculta) y **no la imprime ni la guarda**. Imprime una línea:

```
ADMIN_PASSWORD_HASH=scrypt$16384$8$1$<saltHex>$<keyHex>
```

Formato del hash: `scrypt$N$r$p$saltHex$keyHex` (parámetros dentro del propio valor).
La verificación usa `crypto.scryptSync` + `crypto.timingSafeEqual`.

## 2. Generar `SESSION_SECRET`

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Usa una cadena aleatoria larga (≥ 32 bytes). Un valor distinto invalida todas las sesiones.

## 3. Agregar variables en Vercel

En **Vercel → Project → Settings → Environment Variables** añade `ADMIN_PASSWORD_HASH` y
`SESSION_SECRET` (además de las de Stripe/Supabase/TENANT_ID).

## 4. Preview vs Production

Usa valores **independientes** para Preview y Production cuando corresponda (por ejemplo,
un `SESSION_SECRET` distinto por entorno). Así una sesión de Preview no vale en Production.

## 5. Nunca subir la contraseña a GitHub

La contraseña en claro **nunca** se guarda: solo se guarda el hash, y solo como variable de
entorno. El `.gitignore` ya excluye `.env*`. No pegues secretos en el código.

## 6. Duración de la sesión

La cookie `gha_admin_session` dura **~8 horas** (`Max-Age`). Propiedades: `HttpOnly`,
`SameSite=Strict`, `Path=/`, `Secure` en producción. Al expirar, el panel vuelve al login.

## 7. Cancelar una reserva NO genera reembolso

Cambiar `booking_status` a `cancelled` desde el panel **no** reembolsa en Stripe ni cambia
`payment_status`. Los reembolsos se gestionan aparte (fase posterior). El panel avisa antes de
cancelar una reserva pagada.

## Notas

- El editor de contenido del panel (textos/imágenes/precios de `content.js`) sigue siendo una
  función **local/legacy**: guarda en `localStorage` del propio navegador y **no** afecta a los
  clientes ni al cobro. Los **precios reales de cobro** viven en `api/_lib/tour-catalog.js`
  (servidor). El editor de precios desde Supabase será una fase posterior (5B).
- `payment_status` solo lo cambia Stripe vía webhook; el panel solo edita `booking_status`.
