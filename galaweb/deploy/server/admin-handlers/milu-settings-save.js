'use strict';

/* =========================================================
   POST /api/admin-milu-settings-save  (action=milu-settings-save)
   ---------------------------------------------------------
   SOLO owner: edita el rango objetivo, los límites de costo de IA y
   el proveedor hotelero. admin/staff → 403 (límites globales solo
   owner). El modelo (Haiku) NO se cambia aquí: vive en el env del
   worker (ANTHROPIC_MILU_TOURISM_MODEL + flag), no en el navegador.
   ========================================================= */

const { sendJson, sendError, logServer, methodNotAllowed, readJsonBody, rejectUnknownKeys, isPositiveInt, getTenantId } = require('../lib/http');
const { requireAdmin, sameOrigin } = require('../lib/admin-auth');
const { getSupabase } = require('../lib/supabase');

const ALLOWED = ['hotel_target_min_cents', 'hotel_target_max_cents', 'llm_max_cost_per_call_usd',
  'llm_max_cost_per_job_usd', 'llm_max_cost_per_booking_usd', 'llm_max_cost_daily_usd', 'primary_hotel_provider'];
const PROVIDERS = ['manual', 'duffel_stays', 'hotelbeds', 'expedia_rapid'];

function isPosNum(v) { return typeof v === 'number' && isFinite(v) && v > 0; }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);
  const session = await requireAdmin(req, res, ['owner']);   // límites globales: SOLO owner
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');

  const patch = {};
  if (body.hotel_target_min_cents !== undefined) { if (!isPositiveInt(body.hotel_target_min_cents)) return sendError(res, 400, 'INVALID_RANGE', 'Invalid min'); patch.hotel_target_min_cents = body.hotel_target_min_cents; }
  if (body.hotel_target_max_cents !== undefined) { if (!isPositiveInt(body.hotel_target_max_cents)) return sendError(res, 400, 'INVALID_RANGE', 'Invalid max'); patch.hotel_target_max_cents = body.hotel_target_max_cents; }
  if (patch.hotel_target_min_cents != null && patch.hotel_target_max_cents != null && patch.hotel_target_max_cents < patch.hotel_target_min_cents) {
    return sendError(res, 400, 'INVALID_RANGE', 'max must be >= min');
  }
  ['llm_max_cost_per_call_usd', 'llm_max_cost_per_job_usd', 'llm_max_cost_per_booking_usd', 'llm_max_cost_daily_usd'].forEach(function (k) {
    if (body[k] !== undefined) patch[k] = body[k];
  });
  for (var k in patch) { if (/_usd$/.test(k) && !isPosNum(patch[k])) return sendError(res, 400, 'INVALID_CAP', 'Invalid cap: ' + k); }
  if (body.primary_hotel_provider !== undefined) {
    if (PROVIDERS.indexOf(body.primary_hotel_provider) === -1) return sendError(res, 400, 'INVALID_PROVIDER', 'Invalid provider');
    patch.primary_hotel_provider = body.primary_hotel_provider;
  }
  if (!Object.keys(patch).length) return sendError(res, 400, 'NO_CHANGES', 'Nothing to update');
  patch.updated_by_user_id = session.user_id;

  let tenant;
  try { tenant = getTenantId(); } catch (e) { logServer('milu-settings-save', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  try {
    const supabase = getSupabase();
    const ex = await supabase.from('milu_settings').select('id').eq('tenant_id', tenant).maybeSingle();
    if (ex.data) {
      await supabase.from('milu_settings').update(patch).eq('tenant_id', tenant);
    } else {
      await supabase.from('milu_settings').insert(Object.assign({ tenant_id: tenant }, patch));
    }
    const r = await supabase.from('milu_settings').select('*').eq('tenant_id', tenant).maybeSingle();
    return sendJson(res, 200, { saved: true, settings: r.data || null });
  } catch (err) {
    logServer('milu-settings-save', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
