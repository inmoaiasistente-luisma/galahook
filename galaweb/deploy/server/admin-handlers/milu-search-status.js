'use strict';

/* =========================================================
   GET /api/admin-milu-search-status  (action=milu-search-status)
   ---------------------------------------------------------
   owner/admin: estado del job + subtareas + opciones + logística +
   uso/costo de IA + estado de proveedores. staff: proyección
   OPERATIVA reducida (sin presupuesto, sin enlaces internos, sin
   costos; solo logística aprobada). El rol se relee de la BD.
   ========================================================= */

const { sendJson, sendError, logServer, getTenantId } = require('../lib/http');
const { requireAdmin } = require('../lib/admin-auth');
const { getSupabase } = require('../lib/supabase');
const { resolveMiluModel } = require('../lib/milu-cost');
const { providerState } = require('../lib/milu-flags');

async function latestJob(supabase, tenant, bookingId) {
  const r = await supabase.from('travel_search_jobs').select('*')
    .eq('tenant_id', tenant).eq('booking_id', bookingId).eq('active', true)
    .order('created_at', { ascending: false }).limit(1);
  return (r.data && r.data[0]) || null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin', 'staff']);
  if (!session) return;
  const isStaff = session.role === 'staff';

  let tenant;
  try { tenant = getTenantId(); } catch (e) { logServer('milu-search-status', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  const q = req.query || {};
  const bookingId = q.booking_id;
  if (!bookingId) return sendError(res, 400, 'INVALID_BOOKING', 'booking_id is required');

  try {
    const supabase = getSupabase();
    const job = await latestJob(supabase, tenant, bookingId);
    const lg = await supabase.from('travel_logistics').select('*').eq('tenant_id', tenant).eq('booking_id', bookingId).maybeSingle();
    const logistics = lg.data || null;

    // Estado del módulo (siempre visible): modelo y proveedores.
    const model = resolveMiluModel(process.env);
    const moduleState = {
      model_label: model.ok ? model.label : 'Haiku',
      model_configured: model.ok,
      flights_provider: providerState(process.env, 'flights'),
      hotels_provider: providerState(process.env, 'hotels')
    };

    /* staff: solo logística APROBADA, sin opciones/costos/enlaces. */
    if (isStaff) {
      const approved = logistics && ['approved', 'purchasing', 'partially_confirmed', 'fully_confirmed', 'customer_notified'].indexOf(logistics.status) !== -1;
      return sendJson(res, 200, {
        role: 'staff', module: moduleState,
        logistics: approved ? {
          status: logistics.status,
          departure_date: logistics.approved_departure_date || logistics.default_departure_date,
          return_date: logistics.approved_return_date || logistics.default_return_date
        } : null
      });
    }

    if (!job) {
      return sendJson(res, 200, { role: session.role, module: moduleState, job: null, subtasks: [], logistics: logistics, ai_usage: { calls: 0, cost_usd: 0 } });
    }

    const subsR = await supabase.from('travel_search_subtasks').select('*').eq('job_id', job.id);
    const subtasks = (subsR.data || []).map(function (s) {
      return { kind: s.kind, status: s.status, attempt_count: s.attempt_count, max_attempts: s.max_attempts, last_error: s.last_sanitized_error || null, updated_at: s.updated_at };
    });

    const llmR = await supabase.from('llm_usage_log').select('estimated_cost_usd').eq('job_id', job.id);
    const rows = llmR.data || [];
    let cost = 0; rows.forEach(function (r) { cost += Number(r.estimated_cost_usd) || 0; });

    return sendJson(res, 200, {
      role: session.role,
      module: moduleState,
      job: { id: job.id, status: job.status, search_type: job.search_type, created_at: job.created_at, updated_at: job.updated_at },
      requirements: job.requirements_snapshot || {},
      subtasks: subtasks,
      logistics: logistics,
      ai_usage: { calls: rows.length, cost_usd: Math.round(cost * 1e6) / 1e6 }
    });
  } catch (err) {
    logServer('milu-search-status', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
