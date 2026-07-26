'use strict';

/* =========================================================
   POST /api/admin-booking-qr-revoke   body: { booking_id }
   ---------------------------------------------------------
   Solo owner y admin (staff → 403). Marca active=false y
   revoked_at=now(). No toca booking_status ni payment_status.
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, getTenantId } = require('./_lib/http');
const { getSupabase } = require('./_lib/supabase');
const { requireAdmin, sameOrigin } = require('./_lib/admin-auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('qr-revoke', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ['booking_id'])) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (typeof body.booking_id !== 'string' || !body.booking_id) return sendError(res, 400, 'INVALID_BOOKING_ID', 'booking_id is required');

  try {
    const supabase = getSupabase();
    const upd = await supabase.from('booking_qr_access')
      .update({ active: false, revoked_at: new Date().toISOString() })
      .eq('booking_id', body.booking_id).eq('tenant_id', tenant)
      .select();
    if (upd.error) { logServer('qr-revoke', upd.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to revoke the code'); }
    if (!upd.data || upd.data.length === 0) return sendError(res, 404, 'NOT_FOUND', 'QR access not found');
    return sendJson(res, 200, { revoked: true, revokedAt: upd.data[0].revoked_at });
  } catch (err) {
    logServer('qr-revoke', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to revoke the code');
  }
};
