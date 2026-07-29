'use strict';

/* =========================================================
   GET /api/admin-tour-notes (action=tour-notes-list)
   ---------------------------------------------------------
   Lista las notas importantes de paquetes. owner/admin (staff → 403).
   Opcional ?tour_id= para filtrar. Devuelve activas e inactivas para
   su gestión, ordenadas por tour y display_order.
   ========================================================= */

const { sendJson, sendError, logServer, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireAdmin } = require('../lib/admin-auth');

const FIELDS = 'id,tour_id,title_en,title_es,content_en,content_es,active,' +
  'requires_acknowledgement,display_order,created_at,updated_at';

function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try { const u = new URL(req.url, 'http://localhost'); const o = {}; u.searchParams.forEach(function (v, k) { o[k] = v; }); return o; }
  catch (e) { return {}; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('tour-notes-list', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  const q = getQuery(req);
  try {
    const supabase = getSupabase();
    let query = supabase.from('tour_important_notes').select(FIELDS).eq('tenant_id', tenant);
    if (q.tour_id) query = query.eq('tour_id', String(q.tour_id));
    query = query.order('tour_id', { ascending: true })
                 .order('display_order', { ascending: true })
                 .order('created_at', { ascending: true });
    const { data, error } = await query;
    if (error) { logServer('tour-notes-list', error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    return sendJson(res, 200, { notes: data || [] });
  } catch (err) {
    logServer('tour-notes-list', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
