'use strict';

/* =========================================================
   Milu Turismo — wrapper Anthropic Web Search / Web Fetch (8D)
   ---------------------------------------------------------
   SERVER-ONLY. Envuelve las herramientas oficiales de Anthropic para
   INVESTIGAR precios/disponibilidad en páginas públicas AUTORIZADAS:

     · Modelo Haiku-only (resolveMiluModel; nunca Opus, Sonnet solo con
       flag). Si no está configurado → configuration_error (sin llamar).
     · Herramientas BÁSICAS soportadas por Haiku:
         - web_search_20250305  (max_uses, allowed_domains)
         - web_fetch_20250910   (max_uses, allowed_domains, max_content_tokens, citations)
     · Límites por propuesta desde milu_settings: máx búsquedas, máx
       fetches, tokens por fetch, presupuesto DURO por job ($0.30).
     · Cuenta web_search_requests / web_fetch_requests y estima costo.
     · Registra SOLO metadata en llm_usage_log (nunca prompt/respuesta/PII).
     · El cliente Anthropic real se INYECTA (opts.client); sin él no hay
       llamada externa. Anthropic investiga/extrae/compara: la fuente del
       precio es SIEMPRE la página externa (research_source_url), no Anthropic.
   ========================================================= */

const { getSupabase } = require('./supabase');
const { getTenantId, sanitizeErrorText } = require('./http');
const { resolveMiluModel, estimateResearchCostUsd, checkResearchBudget, DEFAULT_MILU_SETTINGS } = require('./milu-cost');
const { researchAllowedDomains } = require('./milu-allowlist');

function nowMs() { return Date.now(); }

/** Construye los tools con los límites RESTANTES (Haiku → variantes básicas).
 * Si el restante de un tool es 0 se OMITE por completo (nunca se ofrece al modelo):
 * remaining_fetches=0 → sin web_fetch; remaining_searches=0 → sin web_search. */
function buildResearchTools(settings) {
  const s = Object.assign({}, DEFAULT_MILU_SETTINGS, settings || {});
  const domains = researchAllowedDomains();
  const tools = [];
  if ((s.web_research_max_searches || 0) > 0) {
    tools.push({ type: 'web_search_20250305', name: 'web_search',
      max_uses: s.web_research_max_searches, allowed_domains: domains });
  }
  if ((s.web_research_max_fetches || 0) > 0) {
    tools.push({ type: 'web_fetch_20250910', name: 'web_fetch',
      max_uses: s.web_research_max_fetches, allowed_domains: domains,
      max_content_tokens: s.web_research_max_content_tokens_per_fetch,
      citations: { enabled: true } });
  }
  return tools;
}

/** Detecta un error de tool (web_search/web_fetch) en los bloques de contenido.
 * Distingue max_uses_exceeded, url_not_accessible (URL inaccesible),
 * unsupported_content_type (páginas JS / no soportado), url_not_allowed
 * (fuera de la allowlist), etc. — códigos saneados de Anthropic, sin contenido. */
function toolErrorCode(content) {
  const blocks = Array.isArray(content) ? content : [];
  for (var i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b && b.type === 'web_search_tool_result' && b.content && b.content.type === 'web_search_tool_result_error') return b.content.error_code || 'web_search_error';
    if (b && b.type === 'web_fetch_tool_result' && b.content && b.content.type === 'web_fetch_tool_result_error') return b.content.error_code || 'web_fetch_error';
  }
  return null;
}

/** Clasifica una EXCEPCIÓN del cliente (llamada API que lanzó) en un código
 * saneado — nunca el mensaje/secreto/contenido completo. Categoría "error API". */
function classifyToolException(e) {
  const status = e && (e.status || e.statusCode);
  const name = (e && e.name) ? String(e.name).toLowerCase() : '';
  const msg = String((e && e.message) || '');
  if (status === 429 || name.indexOf('ratelimit') !== -1) return 'api_rate_limited';
  if (status === 529 || name.indexOf('overload') !== -1) return 'api_overloaded';
  if (status === 408 || name.indexOf('timeout') !== -1 || /timed?\s?out/i.test(msg)) return 'api_timeout';
  if (typeof status === 'number' && status >= 500) return 'api_server_error';
  if (typeof status === 'number' && status >= 400) return 'api_client_error';
  return 'api_error';
}

/**
 * Ejecuta UNA investigación web (Haiku + web_search/web_fetch).
 * @param opts {
 *   jobId, bookingId, subtaskId, subtaskKind, purpose,
 *   system, input,          // NO se registran; solo se envían al cliente
 *   settings,               // milu_settings (límites/presupuesto)
 *   spentJobUsd,            // costo de investigación ya acumulado en el job
 *   env, client, now        // inyectables (tests)
 * }
 * @returns {ok:true, status:'completed', model, output, findings, usage,
 *           web_search_requests, web_fetch_requests, cost, error}
 *        | {ok:false, status:'configuration_error', reason, detail}
 *        | {ok:false, status:'partial', reason, ...}
 */
async function runResearch(opts) {
  opts = opts || {};
  const env = opts.env || process.env;
  const settings = Object.assign({}, DEFAULT_MILU_SETTINGS, opts.settings || {});

  // 1) Modelo Haiku-only. Si no resuelve → configuration_error (sin llamar).
  const resolved = resolveMiluModel(env);
  if (!resolved.ok) return { ok: false, status: 'configuration_error', reason: resolved.reason, detail: resolved.detail };

  // 2) Presupuesto DURO por propuesta (antes de gastar). Guarda mínima.
  const pre = checkResearchBudget(settings, opts.spentJobUsd || 0, 0.000001);
  if (!pre.ok) return { ok: false, status: 'partial', reason: 'research_budget_exceeded', cap: pre.cap, spent: pre.spent };

  // 3) Sin cliente inyectado → no hay llamada externa.
  if (!opts.client || typeof opts.client.messages !== 'function') {
    return { ok: false, status: 'partial', reason: 'llm_client_unavailable' };
  }

  const tools = buildResearchTools(settings);
  const t0 = (opts.now ? opts.now() : nowMs());
  let resp;
  try {
    resp = await opts.client.messages({ model: resolved.model, system: opts.system, input: opts.input, tools: tools });
  } catch (e) {
    // Excepción de la llamada API → código saneado (sin mensaje/secreto/contenido).
    return { ok: false, status: 'partial', reason: 'web_tool_exception', error: classifyToolException(e) };
  }
  const t1 = (opts.now ? opts.now() : nowMs());

  const usage = (resp && resp.usage) || {};
  const stu = usage.server_tool_use || {};
  const wsr = Number(stu.web_search_requests) || 0;
  const wfr = Number(stu.web_fetch_requests) || 0;
  const cost = estimateResearchCostUsd(resolved.model, usage, wsr);
  const errCode = toolErrorCode(resp && resp.content);
  const findings = (resp && resp.output && Array.isArray(resp.output.findings)) ? resp.output.findings : [];

  // 4) Registrar SOLO metadata (nunca prompt/respuesta/PII).
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
      purpose: opts.purpose || 'web_research',
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      cache_read_tokens: usage.cache_read_tokens || 0,
      cache_write_tokens: usage.cache_write_tokens || 0,
      estimated_cost_usd: cost,
      web_search_requests: wsr,
      web_fetch_requests: wfr,
      latency_ms: t1 - t0,
      status: 'completed'
    });
  } catch (e) { /* el logging nunca rompe la investigación */ }

  return {
    ok: true, status: 'completed', model: resolved.model,
    output: (resp && resp.output) || null, findings: findings,
    usage: usage, web_search_requests: wsr, web_fetch_requests: wfr,
    cost: cost, error: errCode
  };
}

module.exports = { buildResearchTools, toolErrorCode, classifyToolException, runResearch };
