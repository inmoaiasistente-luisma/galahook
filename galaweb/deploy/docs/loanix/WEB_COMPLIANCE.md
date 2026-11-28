# Registro de cumplimiento web: depósito del 30 %

Registro de trabajo interno, no es asesoría legal.

## 1. Alcance, responsable y fecha

- Alcance: función de depósito del 30 % con saldo posterior (checkout, página /saldo, términos, políticas, correos, cancelación automática y acción administrativa fuera de línea).
- Responsable (owner): Galápagos Hook Adventure.
- Fecha del registro: 2026-11-27.
- Versión de los términos del depósito: DEPOSIT_TERMS_VERSION 2026-11-26.

## 2. Inventario de superficies afectadas

| Superficie | Archivo o componente | Qué cambia |
|---|---|---|
| Opción de depósito y casilla de aceptación en el checkout | `assets/js/deposit-ui.js`, bloque `S.deposit` de `assets/js/content.js` | El cliente elige pagar el 30 % y acepta de forma expresa las condiciones del depósito |
| Página de saldo | `/saldo` (`saldo.html`) | Pago del 70 % restante mediante enlace firmado |
| Términos y condiciones | `terms.html` | Viñetas A1–A7 y fecha de actualización (noviembre de 2026) |
| Viñetas de política de reserva y cancelación | `assets/js/content.js`, sección `policies` | Mismas viñetas A1–A7 |
| Correos | `server/lib/deposit-email-templates.js` | Recordatorios de saldo (7 y 6 días antes) y aviso de cancelación |
| Cancelación automática | Barrido (sweep) del saldo | Día 7 y día 6: recordatorio; a 5 días o menos: cancela la reserva |
| Acción administrativa fuera de línea | Panel de administración | Registrar el saldo pagado por otro medio |

## 3. Matriz de requisitos

| Requisito | Aplica | Estado | Evidencia |
|---|---|---|---|
| Consentimiento a las condiciones del depósito en el checkout | Sí | DONE | Casilla de aceptación sin marcar por defecto; versión `DEPOSIT_TERMS_VERSION='2026-11-26'`; se guarda como `deposit_terms_version` y `deposit_terms_accepted_at` |
| El texto y el comportamiento coinciden (barrido: aviso a 7 y 6 días, cancelación a 5 días o menos; depósito reembolsable con más de 30 días; el saldo sigue la regla de 15 días) | Sí | DONE | `tests/deposit-legal-tests.js`, `tests/deposit-tests.js`, `tests/deposit-web-tests.js` |
| Ningún importe llega desde el navegador | Sí | DONE | Los importes salen de la fila de la reserva y del motor de precios; el navegador solo envía el modo y el token |
| Florida Seller of Travel, Fla. Stat. 559.927 / 559.935 | Por confirmar con abogado | PENDING (counsel) | Ver sección 4 |
| Ecuador, LODC art. 45 (devolución en ventas a distancia) | Por confirmar con abogado | PENDING (counsel) | Ver sección 4 |

## 4. Fuentes y revisión preliminar

Fuentes oficiales por consultar (verificar siempre el texto vigente en la fuente):

- Florida Statutes, capítulo 559, parte XI, en el sitio del Senado de Florida: flsenate.gov/Laws/Statutes (sección 559.927 y sección 559.935).
- Ecuador, Ley Orgánica de Defensa del Consumidor (LODC), publicada en el sitio oficial de la Asamblea Nacional y en el Registro Oficial.

Nota: revisión preliminar del 2026-11-26, no es asesoría legal: no se encontró una exención aplicable en 559.935 para viajes fuera de EE. UU.; pendiente de abogado

Este registro no afirma que una norma aplique o no aplique. No se transcribe texto de ninguna ley.

### Declaración del owner

> no estamos registrados en florida, nuestros viajes son fuera de EE. UU.

Regla: nunca publicar un número de registro de Florida (ni en el sitio, ni en correos, ni en materiales) mientras no exista un registro real confirmado por abogado.

## 5. Versiones de texto aprobadas

Aprobado por el owner el 2026-11-27 («Sí, apruebo»). DEPOSIT_TERMS_VERSION 2026-11-26.

### A. Terms page — "Reservas, pagos y cancelaciones" + content.js policy bullets

Replace bullet "Se requiere el pago completo para reservar tu lugar." with A1.
Prefix the two 15-day bullets with "Pago completo:" (A2, A3). Insert A4–A7 right after A3.
"Última actualización: octubre de 2026" → "noviembre de 2026" / "Last updated: November 2026".

A1
- ES: Para reservar pagas el total, o un depósito del 30 % si faltan más de 30 días para tu viaje (paquetes, tours de día y charters de pesca con precio en línea).
- EN: To book, you pay the full price, or a 30% deposit if your trip is more than 30 days away (packages, day tours and fishing charters priced online).

A2
- ES: Pago completo: cancelación con más de 15 días de anticipación, reembolso del 100 %.
- EN: Full payment: cancellation more than 15 days before the activity, 100% refund.

A3
- ES: Pago completo: cancelación con 15 días o menos de anticipación, sin reembolso.
- EN: Full payment: cancellation 15 days or less before the activity, no refund.

A4
- ES: Depósito del 30 %: se reembolsa si cancelas con más de 30 días de anticipación; con 30 días o menos no se reembolsa.
- EN: 30% deposit: refunded if you cancel more than 30 days before the trip; not refunded at 30 days or less.

A5
- ES: Saldo (70 %): vence 6 días antes del viaje, hasta las 23:59 hora de Galápagos. Te enviamos el enlace de pago por correo, con un recordatorio 7 días antes y un último aviso 6 días antes. Puedes pagarlo antes.
- EN: Balance (70%): due 6 days before the trip, by 11:59 p.m. Galápagos time. We email you the payment link, with a reminder 7 days before and a last notice 6 days before. You can pay it early.

A6
- ES: Si el saldo no se paga a tiempo, la reserva se cancela automáticamente 5 días antes del viaje y el depósito no se reembolsa.
- EN: If the balance is not paid on time, the booking is cancelled automatically 5 days before the trip and the deposit is not refunded.

A7
- ES: Una vez pagado, el saldo sigue la regla de 15 días: se reembolsa si cancelas con más de 15 días de anticipación.
- EN: Once paid, the balance follows the 15-day rule: it is refunded if you cancel more than 15 days before the trip.

Unchanged: "Una reserva hecha y confirmada con 15 días o menos de anticipación no es reembolsable." and all other bullets.

### B. Checkout copy already built in Task 10 (S.deposit) — shown for approval, no change proposed

- El depósito se reembolsa si cancelas con más de 30 días de anticipación al viaje (hasta el {fecha}). Después de esa fecha no es reembolsable.
- El saldo vence el {fecha} (23:59, hora de Galápagos). Te enviamos un recordatorio 7 días antes del viaje y un último aviso 6 días antes. Puedes pagarlo antes.
- Si el saldo no se paga, la reserva se cancela automáticamente 5 días antes del viaje y el depósito no se reembolsa. Una vez pagado el saldo, este sigue la regla normal de cancelación de 15 días.
- Casilla: Entiendo que hoy pago {depósito} (30 %) y que el saldo de {saldo} vence el {fecha}. Si no lo pago a tiempo, la reserva se cancela y el depósito no se reembolsa.
- Línea bajo el botón: Depósito: reembolsable si cancelas con más de 30 días de anticipación (hasta el {fecha}). Saldo: una vez pagado, sigue la regla de 15 días.

## 6. Puntos abiertos

1. Abogado de Florida: revisar la aplicabilidad de Fla. Stat. 559.927 / 559.935 (PENDING).
2. Abogado de Ecuador: revisar la LODC art. 45, devolución en ventas a distancia (PENDING).
3. Revisión de GDPR y privacidad de la futura inscripción a promociones (proyecto aparte).
