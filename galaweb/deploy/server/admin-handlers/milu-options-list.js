'use strict';

/* =========================================================
   GET /api/admin-milu-options-list  (action=milu-options-list)
   ---------------------------------------------------------
   owner/admin listan las opciones (vuelo + hotel) de un job, con
   enlaces INTERNOS. staff → 403 (nunca ve opciones/enlaces/costos).
   ========================================================= */

const { sendJson, sendError, logServer, getTenantId } = require('../lib/http');
const { requireAdmin } = require('../lib/admin-auth');
const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;

  let tenant;
  try { tenant = getTenantId(); } catch (e) { logServer('milu-options-list', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  const q = req.query || {};
  if (!q.job_id) return sendError(res, 400, 'INVALID_JOB', 'job_id is required');

  try {
    const supabase = getSupabase();
    const fR = await supabase.from('travel_flight_options').select('*').eq('tenant_id', tenant).eq('search_job_id', q.job_id).eq('active', true);
    const hR = await supabase.from('travel_hotel_options').select('*').eq('tenant_id', tenant).eq('search_job_id', q.job_id).eq('active', true);
    return sendJson(res, 200, {
      role: session.role,
      flights: fR.data || [],
      hotels: hR.data || []
    });
  } catch (err) {
    logServer('milu-options-list', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
