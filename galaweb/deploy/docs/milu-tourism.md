# Milu Turismo — 8C (operación)

Motor que, tras el intake de pasajeros, buscará automáticamente vuelos y hoteles
reales y preparará opciones **solo para owner/admin**. El cliente recibe
únicamente el itinerario final confirmado (8F). La compra y la reserva son
**siempre internas**.

## Modelo de IA

- **v1: Haiku-only.** Todas las tareas de IA usan `claude-haiku-4-5`.
- **Futuro: Sonnet 5** opcional, solo por configuración (no rediseño), con
  autorización del owner, presupuesto y QA. **Opus: desactivado.**
- Selección por `ANTHROPIC_MILU_TOURISM_MODEL` (id exacto validado contra una
  allowlist server-side; en v1 solo Haiku) + flag `MILU_TOURISM_SONNET_ENABLED`.
  Sin routing, sin fallback automático, sin cambio silencioso. Si el modelo no
  está configurado/permitido → la subtarea de IA queda `configuration_error`.
- La IA **nunca** es fuente de precios, disponibilidad, horarios ni enlaces:
  solo razona sobre datos estructurados de adapters/fuentes.

## Feature flags (server-only, todas false en 8C)

`MILU_TOURISM_ENABLED`, `MILU_TOURISM_WORKER_ENABLED`, `MILU_TOURISM_DUFFEL_ENABLED`,
`MILU_TOURISM_HOTEL_PROVIDER_ENABLED`, `MILU_TOURISM_SONNET_ENABLED`. Nunca se
confía en flags del navegador.

## Cola y worker

- `admin-router` solo crea/consulta jobs (sin novena función Vercel).
- El **worker** (Supabase Edge Function, 8D+) procesa **subtareas cortas**
  (`flights_duffel`, `hotels_primary_provider`, `hotel_preferred_links`,
  `anthropic_ranking`, `final_summary`) con lease/heartbeat/retry idempotentes
  (`milu_claim_next_subtask` con FOR UPDATE SKIP LOCKED, `milu_reclaim_expired_leases`).
  Un proveedor caído deja la subtarea en `partial` sin afectar a las demás.
- La lógica testeable vive en `server/lib/milu-worker-core.js`; la Edge Function
  es un envoltorio delgado que se despliega en 8D.

## Adapters (8C: stub/manual)

Solo infraestructura de desarrollo / fallback. **No inventan** precios,
disponibilidad ni horarios, y **nunca** marcan `api_quoted`. Estados permitidos:
`provider_not_configured`, `official_link_only`, `manual_confirmation_required`,
`provider_no_content`. Los enlaces (`purchase_url`/`booking_url`) son **internos**
(equipo compra/reserva), validados por allowlist, y **nunca** se envían al
cliente. Duffel (vuelos) entra en 8D tras pasar la matriz sandbox; el proveedor
hotelero y Airbnb en 8E.

## Costos de IA (medidos, no supuestos)

`llm_usage_log` registra por llamada: model, model_version, purpose,
input/output/cache tokens, estimated_cost_usd, latency_ms, status, job_id,
booking_id, subtask_id, created_at. **Sin** prompt, respuesta, PII, documentos,
tokens ni finanzas. Límites configurables en `milu_settings` (por llamada / job /
reserva / día). El costo real se mide en QA con Haiku.

## Rollback seguro (después de aplicar 0015)

**No** usar `DROP TABLE` como rollback operativo una vez aplicada 0015 con datos.
Rollback correcto: desactivar `MILU_TOURISM_ENABLED`, desactivar el worker,
detener la creación de jobs, **conservar** tablas/auditoría/resultados y revertir
el código por Git. `DROP` solo para destrucción explícita de un entorno local
vacío, nunca en Production.

## Pasos manuales del owner (fuera de 8C)

1. Ejecutar `supabase/migrations/0015_milu_tourism_search.sql` en Supabase
   (después de 0012/0013/0014). **No** ejecutada por Claude.
2. En 8D: desplegar la Supabase Edge Function del worker y crear sus secretos
   (`ANTHROPIC_API_KEY`, `DUFFEL_ACCESS_TOKEN`, claves del proveedor hotelero) en
   los Edge Function secrets — **no** en Vercel.
3. Configurar `ANTHROPIC_MILU_TOURISM_MODEL` con el id exacto de Haiku.
4. Activar los flags solo cuando cada proveedor esté validado.
