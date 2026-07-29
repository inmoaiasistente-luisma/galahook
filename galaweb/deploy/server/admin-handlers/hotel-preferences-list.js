'use strict';

/* =========================================================
   GET /api/admin-hotel-preferences (action=hotel-preferences-list)
   ---------------------------------------------------------
   Lista los hoteles preferidos configurables. owner/admin (staff → 403).
   Ordenados por destino y prioridad.
   ========================================================= */

const { sendJson, sendError, logServer, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireAdmin } = require('../lib/admin-auth');

const FIELDS = 'id,destination,hotel_name,priority,active,preference_notes,search_aliases,provider_reference,created_at,updated_at';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('hotel-preferences-list', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('hotel_search_preferences').select(FIELDS)
      .eq('tenant_id', tenant)
      .order('destination', { ascending: true })
      .order('priority', { ascending: true });
    if (error) { logServer('hotel-preferences-list', error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    return sendJson(res, 200, { preferences: data || [] });
  } catch (err) {
    logServer('hotel-preferences-list', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
