'use strict';

/* =========================================================
   Milu Turismo — resolución de modelo (Haiku-only v1) + costos
   ---------------------------------------------------------
   SERVER-ONLY. En la PRIMERA VERSIÓN, TODA tarea de IA usa
   exclusivamente Haiku. No hay routing, no hay Sonnet, no hay
   Opus, no hay fallback automático ni cambio silencioso.

   El identificador del modelo se toma de la configuración
   (ANTHROPIC_MILU_TOURISM_MODEL) y SIEMPRE se valida contra una
   allowlist server-side. Si no está configurado o no pertenece a
   la allowlist permitida: NO se cambia a otro modelo, se devuelve
   configuration_error. Nunca se resuelve Opus.

   Sonnet 5 queda preparado para el futuro: solo se resuelve si el
   valor es un id/label de Sonnet permitido Y la feature flag
   MILU_TOURISM_SONNET_ENABLED === 'true'. Por defecto: desactivado.
   ========================================================= */

/* Tarifas oficiales por millón de tokens (USD). Ver skill claude-api. */
const PRICES = {
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-sonnet-5':  { input: 3.0, output: 15.0 }
};

/* Allowlist v1: EXCLUSIVAMENTE Haiku. Sonnet reservado (gated por flag). */
const HAIKU_ALLOWLIST = ['claude-haiku-4-5', 'claude-haiku-4-5-20251001'];
const SONNET_ALLOWLIST = ['claude-sonnet-5'];

/* Configuración por defecto (espejo de milu_settings; se sobreescribe con la BD). */
const DEFAULT_MILU_SETTINGS = {
  hotel_target_min_cents: 5000,       // USD 50 pp/noche
  hotel_target_max_cents: 20000,      // USD 200 pp/noche
  llm_max_cost_per_call_usd: 0.50,
  llm_max_cost_per_job_usd: 2.00,
  llm_max_cost_per_booking_usd: 5.00,
  llm_max_cost_daily_usd: 25.00,
  sonnet_enabled: false,
  primary_hotel_provider: 'manual'
};

function isTrue(v) { return String(v == null ? '' : v).trim().toLowerCase() === 'true'; }

/**
 * Resuelve el modelo de Milu desde la configuración, validando contra la
 * allowlist. NUNCA hace fallback ni resuelve Opus.
 * @returns {{ok:true, model:string, label:string}} o
 *          {{ok:false, reason:'configuration_error', detail:string}}
 */
function resolveMiluModel(env) {
  env = env || process.env;
  const raw = String(env.ANTHROPIC_MILU_TOURISM_MODEL == null ? '' : env.ANTHROPIC_MILU_TOURISM_MODEL).trim();
  const sonnetEnabled = isTrue(env.MILU_TOURISM_SONNET_ENABLED);

  if (!raw) return { ok: false, reason: 'configuration_error', detail: 'model_not_configured' };

  const lower = raw.toLowerCase();

  // Haiku: label 'haiku' o id exacto en la allowlist de Haiku.
  if (lower === 'haiku' || HAIKU_ALLOWLIST.indexOf(raw) !== -1) {
    return { ok: true, model: 'claude-haiku-4-5', label: 'Haiku' };
  }

  // Sonnet: solo si está permitido por la allowlist Y el flag está activo.
  if (lower === 'sonnet' || SONNET_ALLOWLIST.indexOf(raw) !== -1) {
    if (!sonnetEnabled) return { ok: false, reason: 'configuration_error', detail: 'sonnet_disabled' };
    return { ok: true, model: 'claude-sonnet-5', label: 'Sonnet' };
  }

  // Opus o cualquier otro valor: jamás se resuelve.
  return { ok: false, reason: 'configuration_error', detail: 'model_not_allowed' };
}

/** Costo estimado en USD para un uso dado. Cache read ~0.1×, cache write ~1.25×. */
function estimateCostUsd(model, usage) {
  const p = PRICES[model];
  if (!p) return 0;
  const u = usage || {};
  const inC = ((u.input_tokens || 0) / 1e6) * p.input;
  const outC = ((u.output_tokens || 0) / 1e6) * p.output;
  const cacheReadC = ((u.cache_read_tokens || 0) / 1e6) * p.input * 0.1;
  const cacheWriteC = ((u.cache_write_tokens || 0) / 1e6) * p.input * 1.25;
  return Math.round((inC + outC + cacheReadC + cacheWriteC) * 1e6) / 1e6;
}

/**
 * Comprueba los límites de gasto configurables antes de una llamada.
 * @param settings milu_settings
 * @param spent    { job, booking, daily } acumulados en USD
 * @param next     costo estimado de la próxima llamada en USD
 * @returns {ok:true} o {ok:false, reason:'llm_budget_exceeded', scope}
 */
function checkBudget(settings, spent, next) {
  const s = Object.assign({}, DEFAULT_MILU_SETTINGS, settings || {});
  const sp = spent || {};
  const n = Number(next) || 0;
  if (n > s.llm_max_cost_per_call_usd) return { ok: false, reason: 'llm_budget_exceeded', scope: 'call' };
  if ((sp.job || 0) + n > s.llm_max_cost_per_job_usd) return { ok: false, reason: 'llm_budget_exceeded', scope: 'job' };
  if ((sp.booking || 0) + n > s.llm_max_cost_per_booking_usd) return { ok: false, reason: 'llm_budget_exceeded', scope: 'booking' };
  if ((sp.daily || 0) + n > s.llm_max_cost_daily_usd) return { ok: false, reason: 'llm_budget_exceeded', scope: 'daily' };
  return { ok: true };
}

module.exports = {
  PRICES, HAIKU_ALLOWLIST, SONNET_ALLOWLIST, DEFAULT_MILU_SETTINGS,
  resolveMiluModel, estimateCostUsd, checkBudget
};
