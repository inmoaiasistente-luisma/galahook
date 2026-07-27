'use strict';

/* =========================================================
   POST /api/admin-discount-rule-toggle (action=discount-rule-toggle)
   ---------------------------------------------------------
   Activa o desactiva una regla. owner y admin (staff → 403).
   NO borra: una regla usada históricamente se conserva; solo cambia
   `active`. Body estricto: { id, active }.
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, isUuid, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireAdmin, sameOrigin } = require('../lib/admin-auth');

const ALLOWED_KEYS = ['id', 'active'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin']);   // owner y admin
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('discount-rule-toggle', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let b;
  try { b = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(b, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!isUuid(b.id)) return sendError(res, 400, 'INVALID_ID', 'id must be a valid UUID');
  if (typeof b.active !== 'boolean') return sendError(res, 400, 'INVALID_ACTIVE', 'active must be boolean');

  try {
    const supabase = getSupabase();
    const up = await supabase.from('discount_rules')
      .update({ active: b.active, updated_by_user_id: session.user_id, updated_at: new Date().toISOString() })
      .eq('id', b.id).eq('tenant_id', tenant).select();
    if (up.error) { logServer('discount-rule-toggle', up.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    if (!up.data || up.data.length !== 1) return sendError(res, 404, 'NOT_FOUND', 'Rule not found');
    return sendJson(res, 200, { toggled: true, id: b.id, active: b.active });
  } catch (err) {
    logServer('discount-rule-toggle', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
