# Milu Turismo — runner de worker controlado (prueba e2e en Preview)

Runner **local**, ejecutado a mano por el owner, para cerrar la prueba
end-to-end de la investigación web (Fase 8D) **sin desplegar infraestructura**.
Reutiliza el core ya probado (`server/lib/milu-worker-core.js`) e inyecta el
cliente Anthropic real (web_search + web_fetch) solo para las subtareas
`web_research_*`.

- **No** despliega nada, **no** activa flags, **no** cambia variables
  persistentes, **no** escribe archivos, **no** toca Production/Stripe.
- **No** imprime secretos (solo presencia booleana) ni PII / `requirements_snapshot`.
- Sin `ANTHROPIC_API_KEY` → las subtareas de research salen
  `llm_client_unavailable` (sin llamada externa). Sin la compuerta doble
  activa → `web_research_disabled`.

## Requisitos previos (los hace el owner)

1. **Migración 0016 aplicada** en la base de Preview (ya está).
2. **Dependencia** instalada:
   ```bash
   npm install
   ```
   (añade `@anthropic-ai/sdk` como dependencia opcional; el bundle de las
   funciones serverless no lo incluye).
3. **Variables de entorno** en el shell donde se corre el runner
   (nunca commiteadas):
   - `SUPABASE_URL`, `SUPABASE_SECRET_KEY` — proyecto **Preview**.
   - `ANTHROPIC_API_KEY` — clave de Anthropic (solo para research real).
   - `ANTHROPIC_MILU_TOURISM_MODEL` — identificador de Haiku (p. ej.
     `claude-haiku-4-5`).
   - `MILU_TOURISM_WEB_RESEARCH_ENABLED=true` — **mitad ENV** de la compuerta doble.
   - `TENANT_ID` — opcional (default `hook-adventure`).
4. **Mitad DB** de la compuerta doble: en el panel Milu → Configuración,
   activar *Web research (DB)*; o
   ```sql
   update public.milu_settings set web_research_enabled = true
   where tenant_id = 'hook-adventure';
   ```
5. **Encolar** una propuesta con subtareas `web_research_*` desde el panel Milu
   (la búsqueda de una reserva). Estas subtareas solo se crean con la compuerta
   doble activa.

## Ejecución

```bash
node scripts/milu-worker-run.js            # drena hasta --max (default 10)
node scripts/milu-worker-run.js --once     # una sola subtarea
node scripts/milu-worker-run.js --max 5
```

El runner imprime, en metadata sanitizada:

- estado de configuración (presencia de key, modelo, SDK, compuerta doble);
- por subtarea: `kind`, id corto, resultado de `runSubtask`, estado final,
  estado del job;
- por job tocado: `status`, búsquedas, fetches, costo acumulado, reruns.

## Verificación posterior (queries de metadata)

```sql
-- Contadores y costo por job
select id, status, web_search_count, web_fetch_count, research_cost_usd, rerun_count
from public.travel_search_jobs order by created_at desc limit 5;

-- Hallazgos nacen 'unverified' con fuente obligatoria (nunca al cliente/Stripe)
select provider, research_review_status, research_source_url, total_price_cents, currency
from public.travel_flight_options where provider = 'web_research' and active = true;

-- Telemetría (solo metadata; nunca prompt/respuesta/PII)
select subtask_kind, web_search_requests, web_fetch_requests, estimated_cost_usd, status
from public.llm_usage_log where purpose like 'web_research%' order by created_at desc limit 10;
```

Luego, en el panel: **Aprobar / Rechazar** cada hallazgo (fija actor + fecha).
Nada se envía al cliente ni entra a Stripe/checkout.

## Límites y presupuesto (ya en `milu_settings`)

Máx **6** búsquedas + **2** fetches + **4000** tokens/fetch por propuesta;
presupuesto **duro $0.30/propuesta** (bloquea antes de gastar); parada temprana
(≥3 opciones activas); dedup por `provider_result_key`; rerun **≤20** contabilizado.
