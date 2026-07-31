'use strict';

/* =========================================================
   POST /api/admin-booking-cost-line-delete  (action=booking-cost-line-delete)
   ---------------------------------------------------------
   owner/admin: baja LÓGICA (active=false) de una línea de costo (no borra
   datos). Recalcula el estado: quedan líneas → 'estimated'; ninguna → 'unset'.
   Reconfirmar queda a cargo del owner. staff → 403. Body: { line_id }
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, getTenantId, isUuid } = require('../lib/http');
const { requireAdmin, sameOrigin } = require('../lib/admin-auth');
const { getSupabase } = require('../lib/supabase');

const ALLOWED_KEYS = ['line_id'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); } catch (e) { logServer('booking-cost-line-delete', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!isUuid(body.line_id)) return sendError(res, 400, 'INVALID_LINE', 'line_id must be a UUID');

  try {
    const supabase = getSupabase();
    const q = await supabase.from('booking_cost_lines').select('id,booking_id').eq('id', body.line_id).eq('tenant_id', tenant).eq('active', true).maybeSingle();
    if (q.error) { logServer('booking-cost-line-delete', q.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    if (!q.data) return sendError(res, 404, 'LINE_NOT_FOUND', 'Cost line not found');
    const bookingId = q.data.booking_id;

    const up = await supabase.from('booking_cost_lines').update({ active: false }).eq('id', body.line_id).eq('tenant_id', tenant);
    if (up.error) { logServer('booking-cost-line-delete', up.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

    const rem = await supabase.from('booking_cost_lines').select('id').eq('booking_id', bookingId).eq('tenant_id', tenant).eq('active', true);
    const remaining = (rem.data || []).length;
    const status = remaining > 0 ? 'estimated' : 'unset';
    await supabase.from('bookings').update({ cost_status: status }).eq('id', bookingId).eq('tenant_id', tenant);

    return sendJson(res, 200, { deleted: true, remaining: remaining, cost_status: status });
  } catch (err) { logServer('booking-cost-line-delete', err && err.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
};
