# Depósito del 30 %, inscripciones a promociones y textos legales — diseño

Fecha: 2026-11-26 · Estado: borrador para aprobación del owner · Sitio: galapagoshookadventure.com
(repo `C:/Users/Luisma/Documents/galahook/galaweb/deploy`, Vercel auto-despliega `main`).

Ya hecho aparte (rama `fix/tour-meal-note` @cd26ecb, sin publicar): los tours de día dicen
"Snacks y almuerzo incluidos"; los paquetes conservan "Desayuno y almuerzo" (hotel).

---

## 1. Intención

1. **Depósito.** El owner quiere que el cliente pueda asegurar su viaje pagando solo el 30 %.
   Así se reserva con menos dinero adelantado. El negocio queda protegido: si el cliente no paga el
   70 % a tiempo o cancela tarde, pierde el depósito.
2. **Inscripciones.** Una base de datos propia de personas interesadas (nombre, correo, intereses,
   teléfono, país), con todos los permisos que deben aceptar, para avisarles de promociones.
3. **Legal.** Los términos y la privacidad deben decir exactamente lo que el sistema hace. Se aplica
   el método Loan-IX (`loanix-web-legal`): fuentes oficiales con fecha, matriz de requisitos en
   `docs/loanix/WEB_COMPLIANCE.md`, y el owner aprueba el texto antes de publicarlo.

## 2. Objetivos, no objetivos, anti-objetivos

**Objetivos**
- En el pago, el cliente elige "Pagar todo" o "Reservar con 30 %", con las reglas visibles y aceptadas.
- El recordatorio del saldo y la cancelación por falta de pago son automáticos.
- El panel muestra el depósito, el saldo, la fecha límite y el estado de cada reserva.
- Formulario de inscripción con consentimiento demostrable, doble confirmación y baja en un clic.
- Lista de inscritos en el panel (solo owner) con descarga.

**No objetivos (v1)**
- Enviar campañas desde el panel. El owner descarga la lista y envía por su cuenta; se puede agregar después.
- Guardar la tarjeta del cliente o cobrarle el saldo automáticamente.
- Depósito en la Expedición de pesca (solo cotización) o en reservas por FishingBooker.
- Reembolsos automáticos. El owner reembolsa en Stripe, como hoy.
- Extender el plazo del saldo desde el panel. Se puede agregar después.

**Anti-objetivos (sería un fracaso aunque funcione)**
- Cobrar de más, cobrar dos veces el saldo o cancelar una reserva que sí pagó.
- Que el cliente pague el depósito sin ver y aceptar las reglas de pérdida.
- Casillas de permiso marcadas por defecto, o un solo "acepto todo" que mezcle permisos.
- Que la ventana de inscripción salga encima de otra ventana (Black Friday o la de visitante recurrente).
- Publicar texto legal no aprobado o con marcas `[PENDIENTE]`.
- Que Finanzas cuente como cobrado dinero que no entró, o deje fuera depósitos que sí entraron.

## 3. Decisiones del owner (2026-11-26, textuales cuando importan)

| Tema | Decisión |
|---|---|
| Productos con depósito | Paquetes de varios días, tours de día y charters de pesca (todo lo que se paga en línea con precio). |
| Anticipación mínima | Solo si el viaje es dentro de **más de 30 días**. Más cerca se paga el 100 %. |
| Cancelación con depósito | "si cancela antes de 30 días hay reembolso" → con **más de 30 días** antes del viaje se devuelve el 30 %. Con **30 días o menos** lo pierde. |
| Plazo del saldo | Recordatorio **7 días** antes, último aviso a los **6**; si a los **5 días** no pagó, se cancela sola y "no hay devolución del 30 porciento". |
| Pago completo | Sigue la regla actual: más de 15 días = 100 % de reembolso; 15 o menos = sin reembolso. |
| Descuentos | Los códigos (HOOK20/HOOK10) bajan el total; el 30 % se calcula sobre el total con descuento. |
| Inscritos | "en administrador debe estar la base de datos, puede vivir en visitas pero con los datos de los clientes". |
| Ubicación del formulario | Pie de página de todas las páginas, sección en la portada **y** ventana emergente una vez a visitantes nuevos. |
| Florida | "no estamos registrados en florida, nuestros viajes son fuera de Estados Unidos". |
| Pagar el saldo antes | Sí, **cada parte con su regla**: el 30 % sigue la regla del depósito (se devuelve si cancela con más de 30 días); el 70 % sigue la regla de 15 días (se devuelve si cancela con más de 15 días; con 15 o menos no). El saldo pagado en el plazo normal (días −7/−6) ya no se devuelve. |
| Pruebas | **Entorno de prueba sin dinero**: Vercel Preview con claves TEST de Stripe y tarjetas de prueba antes de publicar. |

## 4. Enfoques considerados

**Cobro del 70 %** (el owner dejó el cómo a mi criterio; elegí A)
- **A. Enlace de pago por correo (elegido).** Siete días antes, Resend envía un correo con un botón. El
  cliente paga en nuestra página con un segundo PaymentIntent de Stripe. Es lo que pidió el owner, no
  guarda tarjetas y reutiliza el checkout y los correos de marca actuales.
- B. Guardar la tarjeta y cobrar solo. Exige un permiso explícito para cobros sin el cliente presente,
  y los bancos suelen rechazarlos o pedir confirmación (3DS). Contradice el "recordatorio" que pidió.
- C. Factura de Stripe (Invoicing). Stripe envía la factura y los recordatorios, pero los correos salen
  de Stripe y no de la marca, hay una comisión extra y se agregan otros eventos de webhook.

**Base de inscritos**
- **Tabla propia en Supabase + pestaña en Visitas (elegido).** El owner la quiere en su panel. Tiene
  control de permisos, la misma seguridad que el resto del sitio y descarga.
- Audiencias de Resend. Los datos quedarían fuera del panel, y el owner pidió verlos en "Visitas".

## 5. Diseño — Depósito del 30 %

### 5.1 Elegibilidad (la decide siempre el servidor)
- Producto con precio en línea (`tour-catalog`, no `requiresQuote`) del conjunto paquetes, tours de día
  y charters. La lista va en un solo lugar del servidor, con un espejo en `content.js` solo para mostrar.
- `daysUntil(hoy Galápagos, booking_date) > 30`.
- El navegador envía `payment_plan: 'deposit' | 'full'`. Si pide depósito y no es elegible, el servidor
  responde `DEPOSIT_NOT_ELIGIBLE` y no cobra nada. El navegador nunca envía importes.

### 5.2 Importes
- `total = pricing.amountCents`, el mismo motor y el mismo descuento de hoy.
- `deposit = round(total × 0.30)` en centavos.
- `balance = total − deposit`, así la suma da siempre el total exacto.
- `balance_due_date = booking_date − 6 días` = **último día para pagar**, hasta las 23:59 hora de
  Galápagos. El barrido de las 07:00 del día −5 cancela si no está pagado. El recordatorio sale el día −7
  y el último aviso el día −6 ("hoy es el último día"). Así se cumple "si a los 5 días no pagó, se
  cancela" sin cancelar a nadie dentro del día que se le dijo. *(Mi decisión, por la pregunta 2 del revisor.)*
- `deposit_refundable_until = booking_date − 31 días`. Hasta ese día inclusive, cancelar devuelve el 30 %.
- `balance_refundable_until = booking_date − 16 días`. Solo importa si pagó el saldo antes: hasta ese día
  inclusive, cancelar devuelve el 70 %.
- Los importes y las fechas se congelan en la reserva. Si cambia el precio o vence el código después,
  el saldo no cambia.

### 5.3 Checkout (lo que ve el cliente)
```
Forma de pago
 ( ) Pagar todo ahora ................... $1,200
 (•) Reservar con 30 % .................. $360 hoy
     Saldo $840 · se paga hasta el 4 mar 2027 (viaje el 10 mar)
 [ ] Acepto las reglas del depósito: si cancelo con más de 30 días
     de anticipación me devuelven el 30 %; con 30 días o menos lo
     pierdo. Si no pago el saldo hasta el 4 mar, la reserva se
     cancela y pierdo el 30 %. (Ver términos)
 [ Pagar $360 ]
```
- La opción de depósito solo aparece si la fecha elegida es elegible. Si el cliente cambia la fecha a
  una no elegible, se vuelve a "Pagar todo" y se le explica en una línea.
- La casilla del depósito no viene marcada y es obligatoria solo con depósito. El servidor la exige
  (`deposit_ack: {accepted:true, version}`), como ya hace con `notes_ack`, y guarda la versión y la hora.
- El aviso actual de la política de 15 días se mantiene para "Pagar todo".
- Contraste alto y texto oscuro sobre tarjeta clara (preferencia del owner).

### 5.4 Pago del saldo
- El correo trae un enlace a una página del sitio, `/saldo` (página estática nueva), con el código de
  reserva y un **token de un solo uso por reserva**: aleatorio, guardado como hash, sin datos personales
  en la URL. Vale solo mientras haya saldo pendiente y la reserva no esté cancelada.
- La página muestra el resumen y el Payment Element de Stripe por el importe del saldo. El servidor crea
  el segundo PaymentIntent con `metadata.kind='balance'` y el importe sale siempre de la fila de la reserva.
- El enlace funciona **desde que se paga el depósito** (va también en el correo de confirmación) hasta
  la cancelación, así que se puede pagar antes (decisión del owner, tabla 3).
- Si ya está pagado, dice "Saldo pagado". Si está cancelada, lo dice y da el contacto.
- Sin función nueva de Vercel (11 de 12 en uso): se añade un modo a `api/create-payment-intent.js`.

### 5.5 Datos (migración 0028, solo columnas nuevas y ajuste de restricciones)
- `bookings` agrega: `payment_plan` ('full'|'deposit', default 'full'), `deposit_cents`, `balance_cents`,
  `balance_due_date`, `deposit_refundable_until`, `balance_refundable_until`, `deposit_paid_at`,
  `balance_paid_at`, `balance_payment_intent_id`, `balance_payment_method` ('stripe'|'cash'|'transfer'),
  `balance_token_hash`, `deposit_terms_version`, `deposit_terms_accepted_at`, `auto_cancelled_at`,
  `cancel_reason`.
- `payment_status` admite además `deposit_paid`, y `chk_request_payment` se actualiza.
- `email_notifications.notification_type` admite los tipos nuevos de la sección 5.8.
- Se aplica en el Supabase de Producción **antes** del merge, igual que en entregas anteriores.

### 5.6 Webhook (`api/stripe-webhook.js`)
- `payment_intent.succeeded` según `metadata.kind`:
  - `deposit`: `payment_status='deposit_paid'`, `booking_status='confirmed'`, `deposit_paid_at`. Se envía el
    correo de confirmación con depósito y se invita al formulario de pasajeros, como hoy.
  - `balance`: `payment_status='paid'`, `balance_paid_at`, y se envía el recibo del saldo.
  - Si no trae `kind`, se trata como pago completo, como hoy.
- Si el saldo se paga **después** de una cancelación automática (carrera), se marca para revisión y se
  avisa al owner para que reembolse o reactive. No se reactiva sola.
- `charge.refunded`: un reembolso parcial no debe marcar toda la reserva como reembolsada. Se marca
  `refunded` solo cuando se devolvió todo lo cobrado (depósito + saldo).

### 5.7 Barrido diario (cron existente, 07:00 Galápagos, `reminders-run`)
Solo para reservas con `payment_plan='deposit'`, `payment_status='deposit_paid'` y `booking_status='confirmed'`:
- `days ≤ 7` y `> 5`, sin el correo enviado: recordatorio `balance_reminder_d7`. Si el cron no corrió un día,
  se envía al día siguiente.
- `days = 6`: último aviso `balance_reminder_d6`.
- `days ≤ 5` y saldo sin pagar: **cancelación automática**. `booking_status='cancelled'`,
  `cancel_reason='balance_unpaid'`, `auto_cancelled_at`, y se cancela cualquier PaymentIntent de saldo abierto.
  Correo al cliente (`deposit_cancelled`) y aviso al owner. **No** se cancela si hay un pago de saldo
  `processing` o `succeeded`.
- Cada paso es idempotente: único por reserva y tipo en `email_notifications`, y la cancelación verifica
  el estado antes de cambiarlo.
- Los recordatorios previos al viaje de 7 y 5 días se omiten mientras el saldo esté pendiente (los avisos
  del saldo los reemplazan). Al pagar, siguen normales.
- La pausa de recordatorios del panel **no** detiene los avisos ni la cancelación del saldo, porque son
  una regla de pago. Para frenar una cancelación, el owner usa "Saldo pagado por otro medio" (5.9).

### 5.8 Correos (Resend, bilingües, plantillas actuales)
- Cliente: confirmación con depósito (pagado, saldo, fecha límite, enlace, reglas), recordatorio −7,
  último aviso −6, cancelación por falta de pago y recibo del saldo.
- Owner: depósito recibido, saldo recibido, cancelación automática y pago después de cancelar (revisión).

### 5.9 Panel
- La lista y el detalle de la reserva muestran: plan, depósito pagado, saldo, fecha límite, "reembolsable
  hasta" y el estado. Por ejemplo: "Depósito pagado · saldo $840 vence 5 mar".
- Acción solo del owner: **"Saldo pagado por otro medio"** (efectivo o transferencia). Pasa la reserva a
  `paid`, exige una nota y queda en la auditoría. Así se evita la cancelación automática.
- **Finanzas** *(mi decisión, por la pregunta 4 del revisor)*:
  - La **venta** (cantidad, pasajeros, bruto, descuento y costo) se cuenta una sola vez, en la fecha en
    que se pagó el depósito, porque ahí se cerró la venta.
  - Junto a cada venta se muestran **"Cobrado"** y **"Por cobrar"**. El saldo pasa a "Cobrado" en la fecha
    en que se paga. Así un mes con depósitos no aparece con pérdida falsa.
  - Una cancelación por falta de pago deja de contar como venta. Su depósito aparece como **"depósito
    retenido"** (ingreso) y no lleva costo, salvo que el owner haya confirmado costos.
  - Por método: el depósito es Stripe; el saldo va con su método real (Stripe, efectivo o transferencia).
  - Las reservas `deposit_paid` ya no quedan fuera de los totales.

### 5.10 Cancelación pedida por el cliente
Sigue igual que hoy: el cliente escribe y el owner decide en el panel o en Stripe. El panel muestra
"30 % reembolsable hasta {fecha}" y, si pagó el saldo antes, "70 % reembolsable hasta {fecha}", para que
el owner aplique la regla sin calcularla.

## 6. Diseño — Inscripciones a promociones

### 6.1 Formulario
- Nombre (obligatorio), correo (obligatorio) y país (obligatorio, lista ES/EN).
- Teléfono (opcional, con código de país).
- Intereses (al menos uno): Paquetes · Tours de día · Pesca deportiva · Expedición de pesca · Buceo · Otro.
- El idioma se toma del sitio.
- Campo trampa (honeypot), límite de envíos por IP con hash y verificación de mismo origen, como en el
  formulario de contacto.

### 6.2 Permisos (todos sin marcar, separados)
1. **Obligatorio:** "Quiero recibir por correo promociones y novedades de Galápagos Hook Adventure. Puedo
   darme de baja cuando quiera." con enlace a la Política de privacidad (LOPDP art. 8: libre, específico,
   informado e inequívoco).
2. **Obligatorio:** "Tengo 18 años o más."
3. **Opcional, solo si escribió un teléfono:** "También acepto recibir promociones por WhatsApp/SMS en este
   número, incluso enviadas con sistemas automáticos. No es condición para comprar." Esta casilla sigue lo
   que pide Florida para el consentimiento escrito previo (Fla. Stat. 501.059(1)(g)–(h)): marcar la casilla
   cuenta como firma.
- El texto exacto de cada casilla se guarda con una versión. El owner lo aprueba antes de publicar.

### 6.3 Doble confirmación y baja
- Al enviar llega "Confirma tu inscripción". Hasta confirmar, el inscrito queda **pendiente** y no entra
  en la descarga. Si no confirma, se borra a los 30 días.
- Todo correo de confirmación o promoción lleva un enlace de baja de un clic (`/baja?t=…`) y el domicilio
  físico (12515 Lake Square Cir, Orlando, FL 32821) exigido por CAN-SPAM.
- *(Mi decisión, por la pregunta 1 del revisor.)* El owner envía las promociones con su propio correo o
  WhatsApp, así que el enlace de baja debe poder rehacerse para cada persona. El token es un HMAC del id del
  inscrito con un secreto del servidor (variable nueva `SUBSCRIBER_TOKEN_SECRET` en Vercel), no un valor
  aleatorio. La descarga trae una columna **"Enlace de baja"** por persona para combinar correspondencia.
  Junto al botón de descarga, el panel recuerda: "Incluye el enlace de baja de cada persona en cada promoción;
  si alguien te pide la baja por otro medio, márcala aquí".
- La baja se aplica al instante (CAN-SPAM pide hacerlo en menos de 10 días hábiles). Se guarda
  `unsubscribed_at` y los datos dejan de exportarse.
- Si alguien se vuelve a inscribir con el mismo correo, se actualizan sus intereses y se pide confirmar
  de nuevo.

### 6.4 Evidencia del permiso
Se guarda la hora de cada permiso, la versión del texto, la página de origen, el idioma, la IP con hash y
la hora de confirmación. No se guarda la IP en claro.

### 6.5 Dónde aparece
- Un bloque compacto en el pie de página de todas las páginas públicas y una sección en la portada. Ambos
  abren o contienen el mismo formulario.
- **Ventana emergente una vez a visitantes nuevos:**
  - aparece a los 30 s o al llegar a la mitad de la página;
  - nunca en el panel, pasajeros, check-in, candado ni tarjeta;
  - nunca en la misma visita en que salió la de Black Friday o la de visitante recurrente;
  - si la cierra, no vuelve en 30 días; si ya se inscribió, no vuelve nunca (marca local).

- **Casilla en el pago** *(mi decisión, por la pregunta 6 del revisor; el owner pidió "los datos de los
  clientes")*: una casilla opcional, sin marcar, "Quiero recibir promociones por correo". Si se marca, la
  persona entra como inscrita confirmada con `source='checkout'` (su correo ya se usa para la reserva) y se
  guarda la versión del texto. Sin la casilla, los clientes **no** entran en la lista.

### 6.6 Panel ("Visitas", solo owner)
- Pestaña nueva **"Inscritos"** con totales (confirmados, pendientes, de baja) y una tabla ordenable
  (fecha, nombre, correo, teléfono, país, intereses, WhatsApp sí/no, estado) con filtros por estado,
  interés y país.
- **"Descargar Excel (CSV)"**: incluye solo los confirmados que no se dieron de baja y queda registrado
  en la auditoría.
- Acciones del owner: dar de baja y borrar (derecho de eliminación). El admin y el staff no ven esta
  pestaña, porque son datos personales con fin comercial.

### 6.7 Backend
- La tabla `marketing_subscribers` se crea en la migración 0028 o en una propia. Solo la usa el rol de
  servicio (RLS sin acceso público). El correo es único por tenant.
- Los endpoints se agregan a una función existente (`api/contact-message.js` con `action`, más rewrites
  `/api/subscribe`, `/api/subscribe-confirm` y `/api/unsubscribe`), sin pasar de 11 funciones.
- Retención (mi propuesta, el owner puede cambiarla): los pendientes se borran a los 30 días. Al darse de
  baja se borran nombre, teléfono, país e intereses y queda solo el correo como "no enviar". Los activos se
  conservan hasta que se den de baja.

## 7. Legal (método Loan-IX)

- Se crea `docs/loanix/WEB_COMPLIANCE.md` con el inventario, la matriz de requisitos (estado
  VERIFIED/PENDING/NOT APPLICABLE), las fuentes con fecha de consulta y las versiones de texto aprobadas.
- **Términos (`terms.html`).** Pagos: la opción de depósito y quién puede usarla. Las reglas de
  cancelación del depósito. El plazo del saldo y la cancelación automática. Se mantiene la regla de 15
  días para quien paga todo. El saldo pagado no es reembolsable.
- **Privacidad (`security-policy.html`).** Se quita "No enviamos correos promocionales". Se agregan:
  - la lista de promociones: datos, finalidad y base (consentimiento);
  - los proveedores (Supabase, Resend, Vercel, Stripe) y la transferencia a servidores de EE. UU.;
  - la retención;
  - los derechos: baja, acceso, corrección y eliminación;
  - WhatsApp/SMS.
- **Pendiente para abogado.** Esto no bloquea construir, pero queda registrado:
  - **Registro de vendedor de viajes en Florida** (Fla. Stat. 559.927–559.928). En las exenciones de
    559.935 no encontré una para viajes fuera de EE. UU. No se publica ningún número.
  - Si el depósito no reembolsable choca con el derecho de retracto de Ecuador (LODC art. 45).
  - Si aplica el GDPR para visitantes de la UE. Las casillas ya cumplen el estándar de consentimiento.
- El owner aprueba el texto exacto, en ES y EN, antes de publicarlo.

Fuentes consultadas el 2026-11-26:
- Fla. Stat. 559.933 y 559.935 (leg.state.fl.us).
- Fla. Stat. 501.059 (leg.state.fl.us).
- FTC, *CAN-SPAM Act: A Compliance Guide for Business* (ftc.gov).
- SPDP Ecuador, "Consentimiento" (spdp.gob.ec), LOPDP arts. 4, 7 y 8.

## 8. Restricciones

- Vercel Hobby permite 12 funciones y hay 11 en uso: no se crea ninguna función nueva.
- Stripe está en LIVE y la cuenta es compartida con otros proyectos. El webhook LIVE nunca ha entregado un
  evento.
- **Pruebas sin dinero (decisión del owner):**
  - Pruebas locales con simulaciones.
  - Después, una corrida completa en **Vercel Preview** con claves TEST de Stripe, un webhook TEST apuntando
    a la URL de Preview y tarjetas de prueba: depósito, saldo anticipado, saldo con recordatorio y
    cancelación automática (barrido lanzado a mano por el owner, porque los crons de Vercel solo corren en
    Producción).
  - El constructor revisa qué variables tiene Preview (Stripe TEST, Supabase de Preview, Resend, CRON_SECRET)
    y guía al owner si falta alguna.
  - Ese webhook TEST recibirá también eventos TEST de otros proyectos de la cuenta: debe responder 200 e
    ignorar los que no son de una reserva.
- Las migraciones se aplican en Producción antes del merge, y el merge a `main` es solo con OK del owner.
- Archivos con CRLF; pruebas con scripts de node en `tests/`; 1024 PASS al 2026-11-26.
- No se tocan FishingBooker, la Expedición (solo cotización) ni el catálogo de precios.

## 9. Lo que queda al constructor

- El mecanismo exacto del token (generación, hash, caducidad), siguiendo el patrón del QR de reservas.
- Los nombres finales de estados y columnas, siempre que se respete el comportamiento de 5.5–5.7.
- El diseño visual exacto del selector, del formulario y de la ventana, siguiendo el sitio y la preferencia
  de contraste.
- El texto de los correos (el owner aprueba las partes legales) y el plan de pruebas.
- El orden de entrega. Mi sugerencia: (1) depósito + legal de pagos, (2) inscripciones + legal de
  privacidad. Cada parte va en su propia rama y se publica por separado.

## 10. Decisiones mías (para que el owner las revise)

1. Elegí el **enlace de pago por correo** para el 70 %, y una **tabla propia** para la lista de inscritos.
2. El último día para pagar el saldo es el **día −6 hasta las 23:59**; la cancelación sale la mañana del día −5.
3. La pausa de recordatorios del panel **no** frena el cobro ni la cancelación del saldo. Para frenarlos, se
   usa "Saldo pagado por otro medio".
4. **Finanzas** cuenta la venta al pagar el depósito, y muestra "Cobrado" y "Por cobrar".
5. Inscripciones:
   - Hay **doble confirmación** por correo.
   - La descarga trae un **enlace de baja** por persona.
   - Los pendientes se borran a los 30 días.
   - Al darse de baja se borra todo salvo el correo, que queda como "no enviar".
6. Hay una **casilla opcional en el pago** para que los clientes también se inscriban.
7. La ventana de inscripción aparece a los 30 s o a mitad de página. Si se cierra, no vuelve en 30 días, y
   nunca sale junto a las otras dos ventanas.
