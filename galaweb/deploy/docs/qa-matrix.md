# Matriz de QA manual — 57 casos

Ejecutar en **Preview** con claves **TEST** de Stripe y correos propios.
Marca cada casilla. Cualquier fallo bloquea el lanzamiento salvo que se
documente como aceptado.

Entorno probado: `______________________`  ·  Fecha: `__________`  ·  Persona: `__________`

---

## PÚBLICO (1–10)

| # | Caso | Cómo comprobarlo | OK |
|---|---|---|:--:|
| 1 | Todas las páginas cargan | index, tours, packages, sport-fishing, about, conservation, contact, legal, terms, security-policy — sin 404 y **sin redirigir a lock.html** | ☐ |
| 2 | Inglés y español | Cambiar idioma: textos, precios y botones cambian; no queda texto sin traducir | ☐ |
| 3 | Desktop | 1280 px o más: rejilla correcta, sin scroll horizontal | ☐ |
| 4 | Tablet | ~768 px: menú y tarjetas se reordenan bien | ☐ |
| 5 | Móvil | ~375 px: nada se sale, botones pulsables | ☐ |
| 6 | Menú y enlaces | Todos los enlaces del menú y del pie funcionan | ☐ |
| 7 | Formulario de reserva | Abre desde cualquier tarjeta y muestra el tour correcto | ☐ |
| 8 | Campos requeridos | Sin nombre/correo/fecha no deja continuar | ☐ |
| 9 | Error delante del modal | Provocar un error: el aviso se ve **por encima** del modal, no detrás | ☐ |
| 10 | Sin mensajes técnicos | Ningún código de error, stack trace ni texto en inglés técnico | ☐ |

## PAGO TEST (11–17)

| # | Caso | Cómo comprobarlo | OK |
|---|---|---|:--:|
| 11 | Tarjeta 4242 | `4242 4242 4242 4242`, fecha futura, CVC cualquiera → pantalla de éxito | ☐ |
| 12 | Tarjeta rechazada | `4000 0000 0000 0002` → mensaje amigable, se puede reintentar | ☐ |
| 13 | 3D Secure | `4000 0025 0000 3155` → aparece el desafío y al aceptarlo el pago se completa | ☐ |
| 14 | Doble clic no duplica | Pulsar Pagar dos veces rápido → **una sola** reserva en Supabase | ☐ |
| 15 | Precio del servidor | Cambiar el total en las DevTools antes de pagar → Stripe cobra el importe correcto | ☐ |
| 16 | Webhook | Tras pagar: `payment_status='paid'` y `booking_status='confirmed'` | ☐ |
| 17 | Fechas contables | `paid_at` con la hora del pago y `sold_at` **igual** (lo pone el trigger) | ☐ |

```sql
-- casos 16 y 17
select booking_code, payment_status, booking_status, amount_cents, paid_at, sold_at
from public.bookings order by created_at desc limit 5;
```

## COTIZACIÓN (18–21)

| # | Caso | Cómo comprobarlo | OK |
|---|---|---|:--:|
| 18 | Private Charter | Solicitar → crea fila con `request_type='quote'` | ☐ |
| 19 | Multi-Day Expedition | Igual que el anterior | ☐ |
| 20 | Sin PaymentIntent | En Stripe **no** aparece ningún PaymentIntent por esa solicitud | ☐ |
| 21 | Correo sin QR | Llegan los dos correos y **ninguno** lleva QR ni enlace de check-in | ☐ |

## VENTA DIRECTA (22–28)

| # | Caso | Cómo comprobarlo | OK |
|---|---|---|:--:|
| 22 | Owner crea venta | Panel → Añadir venta directa → se crea | ☐ |
| 23 | Staff crea venta | Con sesión staff, también puede | ☐ |
| 24 | Sin PaymentIntent | No aparece nada en Stripe | ☐ |
| 25 | `sold_at` del servidor | Se rellena solo; enviarlo desde el navegador da 400 | ☐ |
| 26 | Aparece en agenda | La reserva se ve en el calendario y en la tabla | ☐ |
| 27 | Staff no ve el importe | Al reabrirla como staff: sin importe, sin método de pago, sin canal | ☐ |
| 28 | Owner ve finanzas | Resumen financiero incluye esa venta agrupada por `sold_at` | ☐ |

## EMAIL (29–34)

| # | Caso | Cómo comprobarlo | OK |
|---|---|---|:--:|
| 29 | Bilingüe al cliente | Inglés arriba, español debajo; nombre y código correctos | ☐ |
| 30 | Correo interno | Llega a `BOOKING_NOTIFICATION_EMAIL` | ☐ |
| 31 | Idempotencia | Reenviar el evento desde Stripe → **no** llega un segundo correo | ☐ |
| 32 | Reintento | Con una notificación en `failed`, pulsar Reintentar → pasa a `sent` | ☐ |
| 33 | Cotización sin QR | Confirmado en el caso 21 | ☐ |
| 34 | Booking y agencia con QR | Ambos correos llevan el PNG adjunto y el enlace de respaldo | ☐ |

```sql
-- casos 31 y 32
select notification_type, recipient_email, status, attempts, sent_at
from public.email_notifications order by created_at desc limit 10;
```

## QR (35–44)

| # | Caso | Cómo comprobarlo | OK |
|---|---|---|:--:|
| 35 | QR válido | Escanear con la cámara del móvil → abre `checkin.html` | ☐ |
| 36 | Fragmento desaparece | Tras cargar, la barra de direcciones ya no muestra `#t=` | ☐ |
| 37 | Staff inicia sesión | Si no había sesión, pide correo y contraseña y luego muestra la reserva | ☐ |
| 38 | Staff ve lo operativo | Código, tour, fecha, cliente, pax, teléfono, email, notas | ☐ |
| 39 | Staff no ve finanzas | Sin importe, sin método de pago, sin canal | ☐ |
| 40 | Token alterado | Cambiar un carácter del token → "Código no válido" | ☐ |
| 41 | QR revocado | Revocar desde el panel → "Código revocado" | ☐ |
| 42 | QR rotado | Rotar → el QR anterior falla y el nuevo funciona | ☐ |
| 43 | Cancelada / reembolsada | Cambiar el estado → "Reserva no válida" (409) | ☐ |
| 44 | Completada sigue válida | Con `booking_status='completed'` → muestra "Tour completado" | ☐ |

## ADMIN (45–57)

| # | Caso | Cómo comprobarlo | OK |
|---|---|---|:--:|
| 45 | Owner 1 entra | Login correcto, ve el panel completo | ☐ |
| 46 | Owner 2 entra | Igual | ☐ |
| 47 | Staff entra | Ve solo la agenda | ☐ |
| 48 | `active=false` | Poner `active=false` en Supabase → la siguiente acción del usuario falla, sin esperar a que caduque la sesión | ☐ |
| 49 | Panel completo | Owner: calendario, tabla, detalle, venta directa, finanzas, QR, notificaciones | ☐ |
| 50 | Staff solo agenda | Sin finanzas, sin venta directa en el menú, sin QR ni notificaciones | ☐ |
| 51 | Staff no modifica | En su detalle no hay ningún botón ni selector de estado | ☐ |
| 52 | Staff 403 financiero | Llamar `/api/admin-finance-summary` con sesión staff → **403** | ☐ |
| 53 | Calendario mensual | Navegación mes anterior / hoy / siguiente; el día seleccionado filtra la tabla | ☐ |
| 54 | Tabla compacta | Encabezado fijo al hacer scroll, una fila por reserva | ☐ |
| 55 | Búsqueda y filtros | Buscar por código/cliente y filtrar por fechas y estados | ☐ |
| 56 | Logout | Cierra sesión y vuelve al login; el botón atrás no devuelve el panel | ☐ |
| 57 | Sesión expirada | Con la cookie caducada, cualquier acción devuelve al login sin errores raros | ☐ |

---

## Resultado

Casos superados: `____ / 57`  ·  Bloqueantes abiertos: `____`

Firma: `__________________`
