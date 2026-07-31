'use strict';

/* =========================================================
   Milu Turismo — runner de worker CONTROLADO (prueba e2e en Preview)
   ---------------------------------------------------------
   Ejecuta UNA pasada del bucle del worker reutilizando el core ya probado
   (server/lib/milu-worker-core.js): reclama leases vencidos, luego para cada
   subtarea encolada del tenant hace claim -> runSubtask -> complete/fail ->
   recompute. Para las subtareas web_research_* inyecta el cliente Anthropic
   REAL (web_search + web_fetch) como deps.researchClient.

   Diseñado para que el OWNER lo corra una vez, a mano, contra la base de
   datos de Preview, con su propia ANTHROPIC_API_KEY. NO despliega infra, NO
   activa flags, NO cambia variables persistentes, NO escribe archivos.

   Seguridad de salida:
     · NUNCA imprime secretos (solo presencia booleana).
     · NUNCA imprime PII, requirements_snapshot ni el contenido de opciones;
       solo metadata (kind, id, status, reason, contadores del job).

   Env requeridas (las provee el owner en su shell; nunca commiteadas):
     SUPABASE_URL, SUPABASE_SECRET_KEY   (las lee el core vía getSupabase)
     ANTHROPIC_API_KEY                   (solo si se quiere research real)
     ANTHROPIC_MILU_TOURISM_MODEL        (Haiku; lo valida resolveMiluModel)
     MILU_TOURISM_WEB_RESEARCH_ENABLED   (mitad ENV de la compuerta doble)
     TENANT_ID                           (opcional; default hook-adventure)

   Uso:
     node scripts/milu-worker-run.js            # drena hasta --max (default 10)
     node scripts/milu-worker-run.js --once     # procesa una sola subtarea
     node scripts/milu-worker-run.js --max 5
     node scripts/milu-worker-run.js --tenant hook-adventure --lease 120
   ========================================================= */

const worker = require('../server/lib/milu-worker-core');
const { getSupabase } = require('../server/lib/supabase');
const { sanitizeErrorText } = require('../server/lib/http');
const { DEFAULT_MILU_SETTINGS, resolveMiluModel } = require('../server/lib/milu-cost');
const { getMiluFlags, webResearchEnabled } = require('../server/lib/milu-flags');
const { makeAnthropicResearchClient, sdkAvailable } = require('./milu-anthropic-client');

/* ---------------- args ---------------- */
function parseArgs(argv) {
  const a = { max: 10, once: false, lease: 120, tenant: process.env.TENANT_ID || 'hook-adventure', help: false };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--once') a.once = true;
    else if (t === '--help' || t === '-h') a.help = true;
    else if (t === '--max') a.max = Math.max(1, parseInt(argv[++i], 10) || 10);
    else if (t === '--lease') a.lease = Math.max(30, parseInt(argv[++i], 10) || 120);
    else if (t === '--tenant') a.tenant = String(argv[++i] || a.tenant);
  }
  if (a.once) a.max = 1;
  return a;
}

function log(line) { process.stdout.write(line + '\n'); }
function present(v) { return v ? 'sí' : 'no'; }
function short(id) { return (typeof id === 'string' && id.length > 8) ? id.slice(0, 8) : String(id || '?'); }

/* Mapea el resultado de runSubtask al estado terminal de la subtarea. */
async function persistResult(subtask, res) {
  if (res && res.status === 'failed') {
    const r = await worker.failOrRetrySubtask(subtask, res.error || res.reason || 'failed');
    return r.status;                       // 'failed' o 'queued' (retry)
  }
  const status = (res && res.status) || 'partial';   // 'completed' | 'partial'
  await worker.completeSubtask(subtask.id, status);
  return status;
}

async function loadSettings(supabase, tenant) {
  let row = {};
  try {
    const r = await supabase.from('milu_settings').select('*').eq('tenant_id', tenant).maybeSingle();
    row = (r && r.data) || {};
  } catch (e) { row = {}; }
  return Object.assign({}, DEFAULT_MILU_SETTINGS, row);
}

async function jobCounters(supabase, jobId) {
  try {
    const r = await supabase.from('travel_search_jobs')
      .select('status,web_search_count,web_fetch_count,research_cost_usd,rerun_count').eq('id', jobId).maybeSingle();
    return (r && r.data) || {};
  } catch (e) { return {}; }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    log('Uso: node scripts/milu-worker-run.js [--once] [--max N] [--tenant T] [--lease S]');
    return 0;
  }

  // Config de entorno (solo presencia; jamás valores).
  const hasSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  const modelRes = resolveMiluModel(process.env);
  const flags = getMiluFlags(process.env);

  log('── Milu worker runner (pasada controlada) ─────────────');
  log('tenant                : ' + args.tenant);
  log('SUPABASE configurada  : ' + present(hasSupabase));
  log('ANTHROPIC_API_KEY     : ' + present(hasKey) + '  (solo se comprueba presencia; el valor nunca se imprime)');
  log('modelo Milu           : ' + (modelRes.ok ? (modelRes.label + ' (' + modelRes.model + ')') : ('NO configurado → ' + modelRes.detail)));
  log('SDK @anthropic-ai     : ' + present(sdkAvailable()));

  if (!hasSupabase) {
    log('ERROR: faltan SUPABASE_URL / SUPABASE_SECRET_KEY en el entorno. Abortando (no se tocó nada).');
    return 1;
  }

  const supabase = getSupabase();
  const settings = await loadSettings(supabase, args.tenant);

  // Compuerta doble (env + DB) — informativa; el core la vuelve a exigir.
  const envHalf = !!flags.web_research_enabled;
  const dbHalf = !!settings.web_research_enabled;
  const gate = webResearchEnabled(process.env, settings);
  log('compuerta ENV         : ' + present(envHalf));
  log('compuerta DB          : ' + present(dbHalf));
  log('web research efectiva : ' + present(gate) + (gate ? '' : '  → las subtareas web_research_* saldrán "web_research_disabled"'));
  log('límites (búsq/fetch/tok/$job): ' + settings.web_research_max_searches + ' / ' + settings.web_research_max_fetches +
      ' / ' + settings.web_research_max_content_tokens_per_fetch + ' / $' + settings.web_research_max_cost_per_job_usd);

  // Cliente Anthropic real (solo si hay key y SDK). Sin él, las subtareas de
  // research salen "llm_client_unavailable" — sin llamada externa.
  let researchClient = null;
  if (hasKey && sdkAvailable()) {
    try { researchClient = makeAnthropicResearchClient({ apiKey: process.env.ANTHROPIC_API_KEY }); }
    catch (e) { log('AVISO: no se pudo crear el cliente Anthropic: ' + sanitizeErrorText(e && e.message)); }
  } else if (!hasKey) {
    log('AVISO: sin ANTHROPIC_API_KEY → research saldrá "llm_client_unavailable" (sin red).');
  } else if (!sdkAvailable()) {
    log('AVISO: falta @anthropic-ai/sdk → corre "npm install" antes de la prueba real.');
  }

  const workerId = 'milu-runner-' + process.pid;

  // 1) Reclamar leases vencidos (recuperación).
  try {
    const rec = await worker.reclaimExpiredLeases(args.tenant);
    if (rec.ok) log('reclaim leases        : requeued=' + (rec.requeued || 0) + ' failed=' + (rec.failed || 0));
    else log('reclaim leases        : error=' + sanitizeErrorText(rec.error && rec.error.message));
  } catch (e) { log('reclaim leases        : excepción=' + sanitizeErrorText(e && e.message)); }

  log('── procesando subtareas (máx ' + args.max + ') ─────────────');

  const touchedJobs = {};
  let processed = 0;
  for (let n = 0; n < args.max; n++) {
    let claim;
    try { claim = await worker.claimNextSubtask(args.tenant, workerId, args.lease); }
    catch (e) { log('claim excepción       : ' + sanitizeErrorText(e && e.message)); break; }
    if (!claim.ok) { log('claim error           : ' + sanitizeErrorText(claim.error && claim.error.message)); break; }
    const st = claim.subtask;
    if (!st) { log('(sin más subtareas encoladas)'); break; }

    processed++;
    await worker.heartbeatSubtask(st.id, workerId, args.lease);

    const deps = { settings: settings, env: process.env, researchClient: researchClient, refresh: false };
    let res;
    try { res = await worker.runSubtask(st, deps); }
    catch (e) { res = { status: 'failed', reason: 'runner_exception', error: e }; }

    let finalStatus;
    try { finalStatus = await persistResult(st, res); }
    catch (e) { finalStatus = 'error_persist'; log('  persist excepción   : ' + sanitizeErrorText(e && e.message)); }

    let jobStatus = '';
    try { jobStatus = await worker.recomputeJobStatus(st.job_id); } catch (e) { /* no crítico */ }
    if (st.job_id) touchedJobs[st.job_id] = true;

    log('subtarea ' + short(st.id) + ' [' + st.kind + '] → run=' + (res && res.status) +
        (res && res.reason ? ' (' + res.reason + ')' : '') +
        (res && typeof res.count === 'number' ? ' count=' + res.count : '') +
        ' | subtask=' + finalStatus + ' | job=' + (jobStatus || '?'));
  }

  // 2) Resumen sanitizado de contadores por job tocado.
  const jobIds = Object.keys(touchedJobs);
  if (jobIds.length) {
    log('── contadores por job (metadata) ─────────────');
    for (let i = 0; i < jobIds.length; i++) {
      const c = await jobCounters(supabase, jobIds[i]);
      log('job ' + short(jobIds[i]) + ' : status=' + (c.status || '?') +
          ' búsq=' + (c.web_search_count || 0) + ' fetch=' + (c.web_fetch_count || 0) +
          ' costo=$' + (Number(c.research_cost_usd) || 0).toFixed(6) + ' reruns=' + (c.rerun_count || 0));
    }
  }

  log('── fin: ' + processed + ' subtarea(s) procesada(s) ─────────────');
  return 0;
}

main().then(function (code) { process.exit(code || 0); })
  .catch(function (e) { process.stdout.write('ERROR fatal: ' + sanitizeErrorText(e && e.message ? e.message : e) + '\n'); process.exit(1); });
