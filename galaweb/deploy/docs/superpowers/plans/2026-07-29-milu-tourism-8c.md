# Milu Turismo — 8C (Core y motor de búsquedas) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Estado:** pendiente de aprobación. **No ejecutar hasta aprobación explícita.**
> Este plan describe tareas, archivos, interfaces, pruebas y criterios de
> aceptación. El **código fuente completo se escribe durante la ejecución** de
> cada tarea (TDD), no en este documento. Ver diseño de referencia:
> `docs/superpowers/specs/2026-07-29-milu-tourism-design.md`.

**Goal:** Construir el núcleo de Milu Turismo (esquema 0015, orquestador,
interfaz de adapters, motor de subtareas para el worker, logging/caps de IA
Haiku-only, handlers y UI de solo lectura) sin proveedores vivos, dejando el
pipeline listo para enchufar Duffel (8D) y el proveedor hotelero (8E).

**Architecture:** `admin-router` crea y consulta jobs; un motor de subtareas
cortas (ejecutado por una Supabase Edge Function en 8D+, pero cuya lógica vive
en un lib testeable en node) procesa cada subtarea de forma idempotente y con
resultados parciales; Anthropic **solo Haiku 4.5** razona sobre datos de
adapters (nunca es fuente de datos). Sin novena función Vercel.

**Tech Stack:** Node/CommonJS (Vercel serverless), Supabase Postgres
(server-only, RLS + revoke), Supabase Edge Function (Deno) + cola para el worker
(contrato + core lib en 8C; despliegue en 8D+), Anthropic Haiku 4.5, suites de
prueba node self-contained en el scratchpad con mock de Supabase.

## Global Constraints

- **Haiku-only en v1.** Todas las llamadas de IA usan `claude-haiku-4-5`. Sin
  Sonnet, sin Opus, sin routing, sin fallback automático, sin cambio silencioso.
  Modelo resuelto de `ANTHROPIC_MILU_TOURISM_MODEL` (inicial `Haiku`) + flag
  `MILU_TOURISM_SONNET_ENABLED` (inicial `false`).
- **Anthropic nunca es fuente** de precios, disponibilidad, horarios, impuestos,
  equipaje, habitaciones, enlaces ni confirmaciones. Solo analiza datos
  estructurados de Duffel / proveedor hotelero / enlaces oficiales /
  confirmaciones manuales.
- **Compra y reserva siempre internas.** El cliente nunca recibe enlaces de
  compra, propuestas preliminares, comparaciones, costos, scores ni
  disponibilidad provisional; solo `customer_travel_confirmation` (8F).
- **≤ 8 funciones Vercel.** Toda acción admin entra por `admin-router`. No crear
  una novena función. No convertir `passenger-form` en router.
- **Worker en tareas cortas.** Subtareas con timeout propio, progreso guardado,
  retry limitado, idempotentes, parciales; nada de peticiones HTTP largas.
- **Sin ejecutar 0015, sin desplegar Edge Function, sin crear secretos** durante
  el desarrollo local. La migración y credenciales las aplica el owner.
- Tenant por defecto `hook-adventure`. Producción `www.galapagoshookadventure.com`.
- Toda tabla nueva: RLS activo + `revoke all from anon, authenticated`, sin
  DELETE físico, auditoría append-only, snapshots saneados (sin PII/secretos).
- Rango objetivo hotel configurable USD 50–200 pp/noche. Orden de hoteles
  Holiday Inn / Miconia→Casa Opuntia / preferidos→tradicionales→alternativas→Airbnb.
- Ida = inicio del paquete; regreso = fin del paquete; ajustable con motivo.

---

## File Structure

**Crear:**
- `supabase/migrations/0015_milu_tourism_search.sql` — 10 tablas (§5 del diseño).
- `server/lib/milu-cost.js` — `resolveMiluModel()`, `estimateCostUsd()`, chequeo de caps.
- `server/lib/milu-llm.js` — cliente Anthropic Haiku-only + logging `llm_usage_log` + caps.
- `server/lib/milu-allowlist.js` — validación de hosts de compra/reserva.
- `server/lib/milu-adapters/index.js` — registro + interfaz de adapters.
- `server/lib/milu-adapters/stub.js` — adapter de prueba (pipeline sin proveedor).
- `server/lib/milu-adapters/manual.js` — enlaces oficiales internos + estados.
- `server/lib/milu-tourism.js` — orquestador (gate, requisitos saneados, job+subtareas idempotentes).
- `server/lib/milu-worker-core.js` — motor de subtareas (claim/dispatch/timeout/partial/retry/recompute).
- `server/admin-handlers/milu-search-start.js`
- `server/admin-handlers/milu-search-status.js`
- `server/admin-handlers/milu-search-cancel.js`
- `server/admin-handlers/milu-options-list.js`
- `server/admin-handlers/milu-settings-get.js`
- `server/admin-handlers/milu-settings-save.js`
- `docs/milu-tourism.md` — doc operativo (v1 Haiku-only, futuro Sonnet, Opus off).
- `scratchpad/milu-tests.js` — suite 8C (subconjunto de las 38 pruebas).

**Modificar:**
- `api/admin-router.js` — +6 rutas ROUTES (milu-*).
- `vercel.json` — +6 rewrites internos.
- `assets/js/admin.js` — subsección "Milu Turismo" (solo lectura + Buscar/Actualizar/Cancelar + settings owner) dentro de Pasajeros y logística.
- `.env.example` — `ANTHROPIC_MILU_TOURISM_MODEL=Haiku`, `MILU_TOURISM_SONNET_ENABLED=false` (+ nombres de secretos del worker, sin valores).

**NO tocar:** precios (0012/0013), checkout, intake (0014), QR, finanzas, Stripe,
webhook, migraciones aplicadas.

---

## Task 1: Migración 0015 (archivo, no ejecutar)

**Files:**
- Create: `supabase/migrations/0015_milu_tourism_search.sql`
- Test: `scratchpad/milu-tests.js` (bloque "0015")

**Interfaces:**
- Produces: 10 tablas (§5 diseño) que el resto del código consume por nombre.

- [ ] **Step 1: Escribir prueba que falla** — lee el archivo 0015 y asalta que
  existen las 10 tablas, `enable row level security` + `revoke all ... from anon,
  authenticated` en cada una, el trigger `forbid_mutation` sobre
  `travel_search_audit`, y los CHECK de estados clave (job/subtask/flight/hotel).
  Expected: FAIL (ENOENT / assert count).
- [ ] **Step 2: Correr y ver fallar** — `node scratchpad/milu-tests.js`.
- [ ] **Step 3: Crear el archivo 0015** con las 10 tablas del diseño §5, RLS +
  revoke ×10, triggers `set_updated_at`, `forbid_mutation_travel_search_audit`
  (BEFORE UPDATE OR DELETE → raise), índices y unique parciales indicados.
- [ ] **Step 4: Correr y ver pasar.**
- [ ] **Step 5: Commit** (`feat(milu): add 0015 migration file (not executed)`).

**Aceptación:** el archivo existe, es coherente con el diseño, **no se ejecuta**.

---

## Task 2: `milu-cost.js` (modelo Haiku-only + estimación + caps)

**Files:**
- Create: `server/lib/milu-cost.js`
- Test: `scratchpad/milu-tests.js` (bloque "cost")

**Interfaces:**
- Produces:
  - `resolveMiluModel(env)` → `{ model:'claude-haiku-4-5', label:'Haiku', version }`.
    Con `ANTHROPIC_MILU_TOURISM_MODEL='Haiku'` → Haiku. Con `'Sonnet'` **y**
    `MILU_TOURISM_SONNET_ENABLED='true'` → `claude-sonnet-5`. En cualquier otro
    caso → Haiku. **Nunca** resuelve Opus. **Nunca** hace fallback.
  - `PRICES` (por millón de tokens) y `estimateCostUsd(model, usage)` → number.
  - `checkBudget(settings, spent, next)` → `{ ok, reason }` para call/job/booking/día.

- [ ] **Step 1: Pruebas que fallan:** `resolveMiluModel` devuelve Haiku por
  defecto; sigue Haiku con env=Sonnet pero flag false; devuelve Sonnet solo con
  env=Sonnet + flag true; nunca Opus. `estimateCostUsd('claude-haiku-4-5',
  {input:1_000_000, output:0}) === 1.0`. `checkBudget` bloquea al exceder cap.
- [ ] **Step 2: Ver fallar.**
- [ ] **Step 3: Implementar** el lib (mapa de modelos, tarifas Haiku $1/$5,
  Sonnet $3/$15 reservado, cálculo con cache tokens, guardas de cap).
- [ ] **Step 4: Ver pasar.**
- [ ] **Step 5: Commit** (`feat(milu): haiku-only model resolver + cost estimator + caps`).

**Aceptación:** imposible resolver Opus; Sonnet solo tras flag; math de costo correcta.

---

## Task 3: `milu-llm.js` (cliente Anthropic Haiku-only + logging + caps)

**Files:**
- Create: `server/lib/milu-llm.js`
- Test: `scratchpad/milu-tests.js` (bloque "llm")

**Interfaces:**
- Consumes: `milu-cost.js`, `getSupabase()`.
- Produces: `runLlm({ jobId, bookingId, purpose, system, input, settings, client })`
  → `{ ok, output, usageRow }`. SIEMPRE usa `resolveMiluModel`. Registra en
  `llm_usage_log` (model, model_version, purpose, tokens, estimated_cost_usd,
  job_id, booking_id, created_at). Si `checkBudget` falla → `{ ok:false,
  reason:'llm_budget_exceeded' }` sin llamar al modelo. Cliente inyectable (mock).

- [ ] **Step 1: Pruebas que fallan (mock client):** una llamada registra una
  fila en `llm_usage_log` con `model='claude-haiku-4-5'` y costo; al exceder cap
  no llama al modelo y devuelve `llm_budget_exceeded`; el system prompt prohíbe
  al modelo producir precios/enlaces (contrato de "solo razona sobre datos").
- [ ] **Step 2: Ver fallar.**
- [ ] **Step 3: Implementar** el wrapper (build request Haiku, contabilizar
  usage, insertar log, aplicar caps, saneo de salida).
- [ ] **Step 4: Ver pasar.**
- [ ] **Step 5: Commit** (`feat(milu): haiku-only llm wrapper with usage logging and budget caps`).

**Aceptación:** todo camino usa Haiku; se registra uso; caps se respetan.

---

## Task 4: `milu-allowlist.js` (hosts permitidos)

**Files:**
- Create: `server/lib/milu-allowlist.js`
- Test: `scratchpad/milu-tests.js` (bloque "allowlist")

**Interfaces:**
- Produces: `isAllowedPurchaseUrl(url)` → boolean. Permite latamairlines.com,
  avianca.com, sitios oficiales de hoteles/IHG configurados, dominio del
  proveedor hotelero, airbnb.com; rechaza todo lo demás y URLs mal formadas.

- [ ] **Step 1: Pruebas que fallan:** hosts permitidos pasan; host arbitrario y
  URL inválida se rechazan; subdominios no permitidos se rechazan.
- [ ] **Step 2: Ver fallar.**
- [ ] **Step 3: Implementar** parseo de host + allowlist exacta.
- [ ] **Step 4: Ver pasar.**
- [ ] **Step 5: Commit** (`feat(milu): purchase/booking url allowlist`).

**Aceptación:** enlace fuera de lista se rechaza siempre.

---

## Task 5: Interfaz de adapters + `stub` + `manual`

**Files:**
- Create: `server/lib/milu-adapters/index.js`, `stub.js`, `manual.js`
- Test: `scratchpad/milu-tests.js` (bloque "adapters")

**Interfaces:**
- Produces:
  - `getFlightAdapter(name)` / `getHotelAdapter(name)` (registro).
  - `searchFlights(req)` / `searchHotels(lodging, prefs, settings)` con la forma
    normalizada del diseño §6.
  - `stub`: devuelve opciones normalizadas deterministas para pruebas.
  - `manual.preferredLinks(dest, prefs)`: arma enlaces oficiales **internos**
    (validados por allowlist), estado `official_link_only`/
    `manual_confirmation_required`; `provider_no_content` si no hay ruta/props.

- [ ] **Step 1: Pruebas que fallan:** `stub.searchFlights` devuelve la forma
  normalizada exacta; `manual.preferredLinks` marca `not_in_provider_inventory`
  para boutique y adjunta enlace permitido; un enlace no permitido se descarta;
  ruta vacía → `provider_no_content`.
- [ ] **Step 2: Ver fallar.**
- [ ] **Step 3: Implementar** interfaz + registro + stub + manual (usando allowlist).
- [ ] **Step 4: Ver pasar.**
- [ ] **Step 5: Commit** (`feat(milu): adapter interface + stub + manual link adapter`).

**Aceptación:** ningún adapter inventa datos; salida normalizada; allowlist aplicada.

---

## Task 6: `milu-tourism.js` (orquestador: gate + requisitos + job/subtareas)

**Files:**
- Create: `server/lib/milu-tourism.js`
- Test: `scratchpad/milu-tests.js` (bloque "orchestrator")

**Interfaces:**
- Consumes: `buildTravelRequirements` (intake), `milu-adapters`, `getSupabase()`.
- Produces:
  - `assertSearchEligible(booking, form, lodging)` → lanza si el formulario no
    está `submitted/reviewed/complete`, si hay `connection_tbd` sin resolver, o
    si faltan fechas por destino.
  - `buildMiluRequirements(bookingId)` → snapshot **saneado** (sin documentos,
    tokens, secretos ni finanzas) con fechas de vuelo default (inicio/fin del
    paquete).
  - `startSearch(bookingId, userId, searchType)` → crea `travel_search_jobs`
    (idempotente por `idempotency_key`) + `travel_search_subtasks`
    (`flights_duffel`, `hotels_primary_provider`, `hotel_preferred_links`,
    `anthropic_ranking`, `final_summary`). Doble clic → mismo job.

- [ ] **Step 1: Pruebas que fallan (mock Supabase):** gate bloquea formulario
  incompleto y `connection_tbd`; `startSearch` doble no duplica (unique parcial);
  el snapshot excluye número de documento; fechas de vuelo default = inicio/fin
  del paquete.
- [ ] **Step 2: Ver fallar.**
- [ ] **Step 3: Implementar** orquestador con gate, saneo y creación idempotente.
- [ ] **Step 4: Ver pasar.**
- [ ] **Step 5: Commit** (`feat(milu): orchestrator gate + sanitized requirements + idempotent jobs`).

**Aceptación:** sin datos completos no se busca; job idempotente; snapshot sin PII.

---

## Task 7: `milu-worker-core.js` (motor de subtareas)

**Files:**
- Create: `server/lib/milu-worker-core.js`
- Test: `scratchpad/milu-tests.js` (bloque "worker")

**Interfaces:**
- Consumes: `milu-adapters`, `milu-llm`, `getSupabase()`.
- Produces:
  - `claimNextSubtask(tenant, workerId)` → subtarea `queued|partial` con lease.
  - `runSubtask(subtask, deps)` → despacha por `kind`, respeta `timeout_ms`,
    hace upsert idempotente de opciones, marca `completed|partial|failed`.
  - `recomputeJobStatus(jobId)` → `completed|partial|failed`.
  - Aislamiento de proveedor (una subtarea caída no borra otras).

  > La **Supabase Edge Function** (Deno) que invoca este core y su despliegue son
  > de **8D** (contrato documentado en el diseño §7); en 8C solo se construye y
  > prueba el core en node.

- [ ] **Step 1: Pruebas que fallan (mock):** `claimNextSubtask` toma una y solo
  una; timeout → `partial` con progreso, sin borrar lo hecho; `attempts >=
  max_attempts` → `failed`; `recomputeJobStatus` = `partial` si una subtarea
  falló pero hay resultados; reejecutar no duplica opciones.
- [ ] **Step 2: Ver fallar.**
- [ ] **Step 3: Implementar** el core (claim con SKIP LOCKED simulado en mock,
  dispatch, timeouts, upsert idempotente, recompute).
- [ ] **Step 4: Ver pasar.**
- [ ] **Step 5: Commit** (`feat(milu): short-subtask worker core (partial/retry/idempotent)`).

**Aceptación:** subtareas cortas, parciales, reintentables, idempotentes, aisladas.

---

## Task 8: Handlers admin (6) por rol

**Files:**
- Create: `server/admin-handlers/milu-search-start.js`, `-status.js`,
  `-cancel.js`, `milu-options-list.js`, `milu-settings-get.js`, `-save.js`
- Test: `scratchpad/milu-tests.js` (bloque "handlers")

**Interfaces:**
- Consumes: `requireAdmin`, `sameOrigin`, `milu-tourism`, `milu-worker-core` (encolar), `getSupabase()`.
- Produces: 6 handlers con `requireAdmin` por rol:
  - start/cancel/settings-save/options-list → `['owner','admin']` (settings-save solo `owner`).
  - status → `['owner','admin','staff']` con **proyección reducida** para staff
    (sin presupuesto, sin enlaces internos, solo logística aprobada).

- [ ] **Step 1: Pruebas que fallan:** staff recibe 403 en start/cancel/settings;
  staff en status ve proyección reducida (sin `purchase_url`/`booking_url`/costos);
  owner puede settings-save; admin puede start; `sameOrigin` obligatorio.
- [ ] **Step 2: Ver fallar.**
- [ ] **Step 3: Implementar** los 6 handlers (método HTTP estricto, roles, saneo).
- [ ] **Step 4: Ver pasar.**
- [ ] **Step 5: Commit** (`feat(milu): admin handlers with role projections`).

**Aceptación:** staff sin búsquedas ni presupuesto/enlaces; owner-only en settings.

---

## Task 9: Router + vercel.json (sin 9ª función)

**Files:**
- Modify: `api/admin-router.js`, `vercel.json`
- Test: `scratchpad/milu-tests.js` + `scratchpad/router-tests.js`

**Interfaces:**
- Produces: 6 rutas ROUTES nuevas (`milu-search-start`, `milu-search-status`,
  `milu-search-cancel`, `milu-options-list`, `milu-settings-get`,
  `milu-settings-save`) + 6 rewrites `/api/admin-milu-*`.

- [ ] **Step 1: Pruebas que fallan:** cada nueva ruta resuelve su handler; 0
  rewrites duplicados; `ls api/*.js` sigue = 8; cada rewrite→action existe.
- [ ] **Step 2: Ver fallar.**
- [ ] **Step 3: Implementar** entradas ROUTES + rewrites (patrón existente).
- [ ] **Step 4: Ver pasar** (router-tests + conteo de funciones).
- [ ] **Step 5: Commit** (`feat(milu): wire milu handlers via admin-router (still 8 functions)`).

**Aceptación:** router carga completo; **8/8 funciones**; sin rewrites huérfanos/duplicados.

---

## Task 10: UI — subsección "Milu Turismo" (solo lectura + control de búsqueda)

**Files:**
- Modify: `assets/js/admin.js`
- Test: `scratchpad/milu-tests.js` + `scratchpad/admin-ui-tests.js`

**Interfaces:**
- Consumes: handlers milu-*.
- Produces: `panelMiluTourism(role)` dentro de Pasajeros y logística: requisitos,
  estado de job/subtareas, fuentes, última actualización, opciones (solo
  lectura), alertas/errores saneados, botones Buscar/Actualizar/Cancelar, y
  configuración (rango objetivo, caps, proveedor, modelo=Haiku) para owner.
  Staff: vista reducida (sin presupuesto/enlaces internos).

- [ ] **Step 1: Pruebas que fallan:** el panel existe y se muestra a
  owner/admin; staff ve versión reducida; botones de búsqueda presentes;
  settings solo para owner; muestra "modelo: Haiku (v1)".
- [ ] **Step 2: Ver fallar.**
- [ ] **Step 3: Implementar** `panelMiluTourism` + integración en tabs.
- [ ] **Step 4: Ver pasar** (admin-ui-tests).
- [ ] **Step 5: Commit** (`feat(milu): admin Milu Tourism read-only panel + search controls`).

**Aceptación:** panel por rol correcto; sin acciones de compra/selección (esas en 8F).

---

## Task 11: Suite 8C + QA completo

**Files:**
- Create: `scratchpad/milu-tests.js` (consolidada)
- Test: todas las suites previas + node --check + vercel.json + conteo funciones

**Cobertura 8C (subconjunto de las 38 del diseño):** fechas de vuelo derivadas
(inicio/fin); ajuste con motivo (estructura); formulario incompleto bloquea;
`connection_tbd` bloquea; job idempotente; doble clic no duplica; precio total
usa todos los pasajeros (stub); equipaje se guarda (stub); hotel preferido
primero (orden manual); Holiday Inn primero en GYE; Miconia antes que Casa
Opuntia; hotel tradicional antes que Airbnb; rango objetivo marcado;
`not_in_provider_inventory`; no afirmar sold_out sin evidencia; proveedor caído →
parcial; retry limitado; owner/admin ejecutan; **staff 403**; URL no permitida
rechazada; **no documentos/tokens/secretos** en snapshot/logs; `checked_at`
presente; costo IE registrado (Haiku) + caps; **funciones Vercel ≤ 8**; **todas
las suites previas verdes**.

- [ ] **Step 1:** Consolidar los bloques de Tasks 1–10 en `milu-tests.js`.
- [ ] **Step 2:** Correr `milu-tests.js` → 0 FAIL.
- [ ] **Step 3:** Correr las 14 suites previas → 0 FAIL (sin regresiones).
- [ ] **Step 4:** `node --check` en todos los .js nuevos/modificados; validar
  `vercel.json` (rewrites, duplicados); confirmar 8 funciones; cargar admin-router.
- [ ] **Step 5: Commit** (`test(milu): 8C suite + full QA green`).

**Aceptación obligatoria:** **0 FAIL**, ≤ 8 funciones, suites previas verdes.

---

## Task 12: Docs + `.env.example` + entrega

**Files:**
- Create: `docs/milu-tourism.md`
- Modify: `.env.example`

- [ ] **Step 1:** `docs/milu-tourism.md` — v1 Haiku-only, futuro Sonnet por
  config, Opus off, contrato de subtareas, allowlist, límites de costo, pasos
  manuales del owner (ejecutar 0015, crear Edge Function + secretos en 8D).
- [ ] **Step 2:** `.env.example` — `ANTHROPIC_MILU_TOURISM_MODEL=Haiku`,
  `MILU_TOURISM_SONNET_ENABLED=false`, y nombres (sin valores) de los secretos
  del worker para 8D (`DUFFEL_*`, proveedor hotelero, `ANTHROPIC_API_KEY`).
- [ ] **Step 3: Commit** (`docs(milu): 8C operational docs + env template`).
- [ ] **Step 4: Entrega** — resumen de QA, funciones, archivos, y qué queda
  manual para el owner. **No** merge a main sin aprobación; **no** ejecutar 0015.

**Aceptación:** documentación clara del modo Haiku-only y del handoff manual.

---

## Self-Review (cobertura del spec)

- Reglas 1–5 y "reglas ya aprobadas" → Tasks 1–12 (compra interna: sin acciones
  de compra en 8C, confirmación en 8F; Duffel candidato: adapter real en 8D;
  worker corto: Task 7; costo medido Haiku-only: Tasks 2/3/11; costos internos:
  campos en 0015 Task 1, uso en 8F).
- Haiku-only: Global Constraints + Tasks 2/3 (imposible Opus; Sonnet solo por flag).
- ≤ 8 funciones: Task 9.
- 38 pruebas: subconjunto 8C en Task 11; el resto (Duffel sandbox, selección,
  compra, confirmación, email) en 8D–8F.
- Sin placeholders funcionales: cada Task define archivos, interfaces con firmas,
  intención de prueba y criterio de aceptación; el código exacto se produce en
  ejecución TDD (por decisión del owner: "no escribir código todavía").

## Execution Handoff

**Plan de 8C listo y guardado en**
`docs/superpowers/plans/2026-07-29-milu-tourism-8c.md`.
Al aprobarse la ejecución, dos opciones:
1. **Subagent-Driven (recomendado):** un subagente fresco por tarea con revisión entre tareas.
2. **Inline Execution:** ejecución por lotes con checkpoints.

Antes de ejecutar: crear la rama `feat/stage-8c-milu-tourism`. **No** ejecutar
0015, **no** desplegar Edge Function, **no** crear secretos, **no** merge a main
sin QA verde y aprobación del owner.
