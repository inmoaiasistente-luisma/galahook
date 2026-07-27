'use strict';

/* =========================================================
   GET /api/admin-discount-rules   (action=discount-rules-list)
   ---------------------------------------------------------
   Lista las reglas de descuento. owner y admin pueden CONSULTAR;
   crear/editar/activar es solo owner (otros handlers). staff → 403.
   ========================================================= */

const { sendJson, sendError, logServer, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireAdmin } = require('../lib/admin-auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('discount-rules-list', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  try {
    const supabase = getSupabase();
    const rs = await supabase.from('discount_rules').select('*')
      .eq('tenant_id', tenant).order('priority', { ascending: false }).order('created_at', { ascending: false });
    if (rs.error) { logServer('discount-rules-list', rs.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    return sendJson(res, 200, { role: session.role, canEdit: session.role === 'owner', rules: rs.data || [] });
  } catch (err) {
    logServer('discount-rules-list', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
