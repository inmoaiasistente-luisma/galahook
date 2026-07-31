# Fase 9 — Panel administrador

Reorganización funcional completa del panel. Rama de trabajo:
`feat/stage-8d-milu-live-travel-research`. **No fusionada. No desplegada a
Production.**

---

## 1. Navegación final

```
Dashboard · Reservas · Calendario · Ventas · Finanzas · Contenido del sitio · Configuración
```

El staff tiene su propia lista: **Agenda · Calendario · Ventas · Pasajeros**.

### Módulos ocultos (dormidos, NO borrados)

| Módulo | Dónde está ahora |
|---|---|
| Milu Turismo / Web Research | `panelMiluTourism` intacto; fuera del menú desde la Fase 8 |
| Hoteles preferidos | `panelHotelPreferences` intacto; fuera del menú |
| Precios de paquetes | dentro de **Contenido del sitio → Paquetes** |
| Notas de paquetes | dentro de **Contenido del sitio → Paquetes** |
| Plantillas de costos | dentro de **Configuración** |
| Reglas de descuento | dentro de **Configuración** |
| Notificaciones (registro) | dentro de **Configuración** |
| Datos de prueba | dentro de **Configuración** (solo owner) |

Reactivar cualquiera = volver a añadir su entrada en `panelsFor()`. No se
eliminó ninguna función, tabla, endpoint, migración ni prueba.

---

## 2. Matriz de permisos

| | owner | admin | staff |
|---|---|---|---|
| Ver todo (finanzas, costos, pasajeros, logística, documentos, comunicaciones) | ✅ | ✅ | ❌ sin dinero |
| Crear / editar / confirmar / cancelar / eliminar | ✅ | ❌ | ❌ |
| Registrar ventas | ✅ | ❌ | ✅ |
| Precios, contenido, configuración | ✅ | ❌ | ❌ |
| Ver precios cobrados, costos, utilidad, margen | ✅ | ✅ | ❌ |

**La compuerta real es el servidor**, no la interfaz:

- `WRITE_ROLES = ['owner']` y `SALE_WRITE_ROLES = ['owner','staff']` en
  `server/lib/admin-auth.js` son la fuente única de verdad.
- `requireWriter()` protege las 22 mutaciones; `requireSaleWriter()` protege
  el registro de ventas.
- Al staff los importes **no le salen del SELECT**: no es que se oculten en
  pantalla, es que la base no se los envía.
- La prueba 6 de `tests/phase9-tests.js` **barre todos los handlers** y falla
  si alguna mutación vuelve a admitir al rol admin.

En la interfaz, `canWrite()` / `canRecordSale()` ocultan los controles y el
admin ve un aviso de solo lectura en lugar de botones que darían 403.

---

## 3. Auditoría automática

`server/lib/admin-audit.js`. Registra usuario, fecha, acción y valores
antes/después **sin pedirle una razón al owner**.

- Guarda **solo el diferencial** (las claves que cambiaron), no la fila entera.
- Enmascara datos sensibles (tokens, documentos, secretos, PI de Stripe).
- **FAIL-OPEN**: si la auditoría falla —incluida la migración 0019 sin
  aplicar— la operación del usuario continúa. Auditar importa; impedir que el
  owner trabaje porque el log falló, no.

Conectada en: cambio de estado de reserva, alta/baja de líneas de costo,
confirmación de costos, rotación y revocación de QR, cambio de precio de
paquete, creación de venta, envío de comunicaciones y barrido de recordatorios.

---

## 4. Recordatorios pre-viaje

Cadencia: **7 → 5 → 3 → 1 → 0 días**.

| Etapa | Texto |
|---|---|
| -7d | Faltan 7 días para tu aventura en Galápagos. |
| -5d | Faltan 5 días para tu aventura en Galápagos. |
| -3d | Faltan 3 días para tu aventura en Galápagos. |
| -1d | Falta 1 día para tu aventura en Galápagos. |
| día 0 | Tu aventura en Galápagos empieza hoy. |

Cada correo lleva el QR e incluye lo que **ya exista** del viaje (vuelos,
hotel, punto de encuentro, horarios, contactos, documentos). Lo que falta no
se inventa: no aparece.

**Idempotencia por base de datos**: cada etapa es su propio
`notification_type` y `email_notifications` ya tiene
`unique(booking_id, notification_type, recipient_email)`. Si el cron corre dos
veces, no sale un correo repetido.

- Cron diario: `vercel.json → crons`, `/api/admin-reminders-run` a las 13:00
  UTC (07:00 en Galápagos), autenticado con `Authorization: Bearer CRON_SECRET`.
- **Los crons de Vercel solo se ejecutan en Production.** En Preview el owner
  lanza el barrido a mano desde *Configuración → Recordatorios*.
- Pausar/reanudar por reserva: en el detalle de la reserva.

---

## 5. Comunicaciones y documentos

Dentro de cada reserva: reenviar QR o confirmación, enviar tickets aéreos,
vouchers, itinerarios, instrucciones y avisos de cambio; adjuntar documentos
y ver el historial.

Cada envío registra **destinatario, fecha/hora, tipo, estado, archivo enviado
y usuario que lo ejecutó**.

Dos decisiones que conviene recordar:

1. **Los envíos manuales NO usan `email_notifications`.** Esa tabla tiene un
   UNIQUE que garantiza que un correo transaccional no se duplique jamás;
   estos envíos se pueden repetir a voluntad. Van en `booking_communications`.
2. **Se guarda la referencia del documento (enlace https + etiqueta), no el
   binario.** El proyecto no tiene bucket de almacenamiento y no se ha
   introducido uno. El archivo vive donde el owner ya lo tiene.

---

## 6. Migración 0019 — PREPARADA, NO APLICADA

`supabase/migrations/0019_phase9_audit_docs_reminders.sql`

- `admin_audit_log`
- `booking_documents`
- `booking_communications`
- `bookings.reminders_paused` / `_at` / `_by_user_id`
- Amplía el CHECK de `email_notifications.notification_type` con las cinco
  etapas (conservando íntegros los diez tipos anteriores)
- Índice `(tenant_id, booking_date)` para el barrido diario

Aditiva: no borra tablas ni columnas. Sigue la convención de la casa (FK
compuesta, `set_updated_at()`, RLS + revoke, baja lógica).

**Mientras no se aplique**, el panel funciona igual: la auditoría se omite en
silencio, la sección de comunicaciones avisa que aún no puede guardar y los
recordatorios no encuentran sus tipos de correo.

---

## 6-bis. Migración 0020 — subida real de documentos (PREPARADA, NO APLICADA)

`supabase/migrations/0020_booking_document_uploads.sql`

- Bucket **privado** `booking-documents` (15 MiB, tipos JPG/PNG/WEBP/PDF/DOC/DOCX).
- Metadatos de subida en `booking_documents`: `source`, `storage_path`,
  `original_filename`, `mime_type`, `file_size`, `uploaded_at`,
  `sent_to_passenger_at`.
- `url` pasa a **nullable** (una subida no tiene enlace externo) + CHECK de
  coherencia (enlace→url, subida→storage_path).

Aditiva: no borra nada. Bucket privado sin políticas anon/authenticated —
solo el backend accede y siempre entrega **URLs firmadas** temporales. El
alta de **enlace externo** sigue funcionando aunque 0020 no esté aplicada.

**Mientras no se aplique**, subir archivos responde `STORAGE_NOT_READY`; los
enlaces externos siguen operativos.

---

## 7. Variables de entorno nuevas

```
CRON_SECRET=          # secreto del cron de recordatorios (32+ bytes aleatorios)
DOCUMENT_MAX_BYTES=15728640   # límite por archivo (debe coincidir con el bucket)
```

Flujo de subida real (owner): `Reservas → abrir reserva → Comunicaciones y
documentos → Subir archivo`. El navegador pide una URL firmada, sube el
archivo directamente a Storage y lo confirma. Ver/Descargar usan una URL
firmada de corta duración; Enviar adjunta el archivo al correo (o un enlace
firmado si es grande).

---

## 8. Cómo probar en Preview

1. Aplicar `0019` (ya hecho) y **`0020`** en Supabase Preview.
2. Configurar `CRON_SECRET` y `DOCUMENT_MAX_BYTES` en Vercel (Preview).
3. Entrar como **owner** → comprobar las 7 entradas del menú.
4. **Reservas** → debe mostrar **todas** las reservas al entrar (fechas
   vacías). Verificar sin scroll horizontal en 1366/1440/1920. "Ver todo"
   limpia; "Hoy"/"Este mes" filtran; búsqueda por código/cliente/tour.
5. **Calendario** → mes actual, navegar con ‹ ›, clic en un día lista sus
   reservas y cada una abre el detalle unificado.
6. Abrir una reserva → *Comunicaciones y documentos* → **Subir archivo**
   (PDF/imagen): ver la barra de progreso, que aparezca en la lista con
   tamaño y quién lo subió, **Ver** (abre con URL firmada) y **Enviar**
   (llega adjunto al correo). Probar también un tipo no permitido (rechazo).
6. Pausar y reanudar los recordatorios de esa reserva.
7. **Configuración → Recordatorios** → "Ejecutar barrido ahora" y leer el
   resumen (revisadas / corresponden / enviados / ya enviados).
8. **Calendario** → pulsar un día → abrir una reserva desde ahí.
9. **Ventas** → registrar una venta con canal (`sale_source`) → añadirle
   costos desde su detalle → confirmarlos → verlo reflejado en Finanzas.
10. Entrar como **admin** → se ve todo, no hay botones de modificar y aparece
    el aviso de solo lectura. Probar `POST /api/admin-booking-update` a mano:
    debe responder **403**.
11. Entrar como **staff** → agenda, calendario, ventas y pasajeros; sin
    importes ni costos por ninguna parte.

---

## 8-bis. Ronda de correcciones finales (Preview)

- **Calendario (bloqueante) reparado.** Causa raíz: `loadFinance()` accedía a
  `chanF.select` (null en modo calendario) y lanzaba, abortando la
  construcción del panel — solo quedaba el título. La guarda
  `finance.parentNode` no cortaba porque `el()` devuelve un nodo cuyo
  `parentNode` es un `<div>` envoltorio (siempre truthy). Arreglo:
  `finance.isConnected` + null-check en `chanF/methF`, y `renderCal()`
  síncrono al arrancar.
- **Reservas:** encabezados completos (sin `GUE…`/`CHAN…`), columnas clave sin
  recorte, tooltips en texto secundario, sin scroll horizontal en desktop.
- **Eliminar reserva (owner):** baja lógica desde la fila y el detalle; el
  servidor rellena la razón. Insignia **TEST** en la tabla. `booking-delete`.
- **Configuración** simplificada: fuera Notificaciones y Datos de prueba
  (dormidos). Quedan Recordatorios, Descuentos y plantillas avanzadas.
- **Detalle** más ancho (~92vw, tope 1180px) con scroll interno.
- **Pasajeros:** botón "Ver formulario completo" con todas las respuestas.
- **Comunicaciones:** historial unificado (manual + automáticos +
  recordatorios) **clickeable**; cada mensaje abre su cuerpo completo.

**Migración 0021 (PREPARADA, NO APLICADA)** —
`0021_communication_bodies.sql`: `body_html`/`body_text` en
`booking_communications` y `email_notifications` (+`subject`). Aditiva. Sin
0021 el envío funciona y el visor avisa "cuerpo no disponible".

---

## 9. QA

| | |
|---|---|
| Suites | 18 |
| Pruebas | **1121 PASS · 0 FAIL** |
| `node --check` | **118 / 118** |
| `vercel.json` | válido (63 rewrites, 1 cron, 0 duplicadas) |
