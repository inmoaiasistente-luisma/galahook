'use strict';

/* =========================================================
   Milu Turismo — cliente Anthropic (Haiku-only v1)
   ---------------------------------------------------------
   SERVER-ONLY. Envuelve las llamadas de IA con:
     · resolución de modelo Haiku-only (NUNCA Opus, Sonnet solo con
       flag; sin fallback ni cambio silencioso);
     · si el modelo no está configurado/permitido → configuration_error
       (NO se llama a ningún modelo);
     · límites de gasto configurables (por llamada/job/reserva/día);
     · registro en llm_usage_log SOLO de metadata de uso (nunca el
       prompt, la respuesta, PII, documentos, tokens ni finanzas).

   El LLM SOLO razona sobre datos estructurados de adapters/fuentes;
   nunca es fuente de precios, disponibilidad, horarios ni enlaces.
   El cliente Anthropic real se inyecta (opts.client) y no se crea en
   8C (no hay ANTHROPIC_API_KEY todavía).
   ========================================================= */

const { getSupabase } = require('./supabase');
const { getTenantId } = require('./http');
const { resolveMiluModel, estimateCostUsd, checkBudget, DEFAULT_MILU_SETTINGS } = require('./milu-cost');

function nowMs() { return Date.now(); }

/**
 * Ejecuta una tarea de IA Haiku-only con logging y caps.
 * @param opts {
 *   jobId, bookingId, subtaskId, subtaskKind, purpose,
 *   system, input,            // NO se registran (solo se envían al cliente)
 *   settings,                 // milu_settings (caps + flags)
 *   spent,                    // { job, booking, daily } USD acumulados
 *   env, client, now          // inyectables (tests)
 * }
 * @returns {ok:true, model, output, cost, usage}
 *        | {ok:false, status:'configuration_error', reason, detail}
 *        | {ok:false, status:'partial', reason:'llm_budget_exceeded', scope}
 */
async function runLlm(opts) {
  opts = opts || {};
  const env = opts.env || process.env;
  const settings = Object.assign({}, DEFAULT_MILU_SETTINGS, opts.settings || {});

  // 1) Resolver modelo. Si falla → configuration_error, sin llamar a nadie.
  const resolved = resolveMiluModel(env);
  if (!resolved.ok) {
    return { ok: false, status: 'configuration_error', reason: resolved.reason, detail: resolved.detail };
  }

  // 2) Límite antes de llamar (por job/reserva/día ya acumulado + guarda mínima).
  const pre = checkBudget(settings, opts.spent || {}, 0.000001);
  if (!pre.ok) {
    return { ok: false, status: 'partial', reason: 'llm_budget_exceeded', scope: pre.scope };
  }

  if (!opts.client || typeof opts.client.messages !== 'function') {
    // En 8C sin cliente inyectado no se llama a ningún modelo real.
    return { ok: false, status: 'partial', reason: 'llm_client_unavailable' };
  }

  // 3) Llamada (el cliente devuelve solo uso + salida; nunca guardamos prompt/respuesta).
  const t0 = (opts.now ? opts.now() : nowMs());
  const resp = await opts.client.messages({ model: resolved.model, system: opts.system, input: opts.input });
  const t1 = (opts.now ? opts.now() : nowMs());
  const usage = (resp && resp.usage) || {};
  const cost = estimateCostUsd(resolved.model, usage);

  // 4) Registrar SOLO metadata de uso (sin prompt/respuesta/PII/documentos/tokens).
  try {
    const supabase = getSupabase();
    let tenant; try { tenant = getTenantId(); } catch (e) { tenant = 'hook-adventure'; }
    await supabase.from('llm_usage_log').insert({
      tenant_id: tenant,
      job_id: opts.jobId || null,
      booking_id: opts.bookingId || null,
      subtask_id: opts.subtaskId || null,
      subtask_kind: opts.subtaskKind || null,
      model: resolved.model,
      model_version: (resp && resp.model_version) || null,
      purpose: opts.purpose || 'reasoning',
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      cache_read_tokens: usage.cache_read_tokens || 0,
      cache_write_tokens: usage.cache_write_tokens || 0,
      estimated_cost_usd: cost,
      latency_ms: t1 - t0,
      status: 'completed'
    });
  } catch (e) { /* el logging nunca rompe la tarea */ }

  return { ok: true, status: 'completed', model: resolved.model, output: (resp && resp.output) || null, cost: cost, usage: usage };
}

module.exports = { runLlm };
