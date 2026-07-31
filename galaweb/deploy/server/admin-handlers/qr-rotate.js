'use strict';

/* =========================================================
   POST /api/admin-booking-qr-rotate   body: { booking_id }
   ---------------------------------------------------------
   Solo owner y admin (staff → 403). Incrementa token_version:
   el QR anterior deja de validar INMEDIATAMENTE. Devuelve la nueva
   URL y el PNG en base64 para descargarlo y enviarlo manualmente.
   No reenvía correos automáticamente.
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireWriter, sameOrigin } = require('../lib/admin-auth');
const { recordAudit } = require('../lib/admin-audit');
const { ensureBookingQrAccess, generateBookingQrPng, computeExpiresAt, isQrEligible } = require('../lib/booking-qr');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireWriter(req, res);   // Fase 9: escritura = SOLO owner
  if (!session) return;                                   // 401/403 ya enviado
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('qr-rotate', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ['booking_id'])) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (typeof body.booking_id !== 'string' || !body.booking_id) return sendError(res, 400, 'INVALID_BOOKING_ID', 'booking_id is required');

  try {
    const supabase = getSupabase();
    const bk = await supabase.from('bookings').select('*')
      .eq('id', body.booking_id).eq('tenant_id', tenant).maybeSingle();
    if (bk.error) { logServer('qr-rotate', bk.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    if (!bk.data) return sendError(res, 404, 'NOT_FOUND', 'Booking not found');
    if (!isQrEligible(bk.data)) return sendError(res, 409, 'BOOKING_NOT_CONFIRMED', 'This booking cannot have a QR code');

    const access = await ensureBookingQrAccess(bk.data);
    if (!access) return sendError(res, 409, 'BOOKING_NOT_CONFIRMED', 'This booking cannot have a QR code');

    const upd = await supabase.from('booking_qr_access').update({
      token_version: (Number(access.token_version) || 1) + 1,
      active: true, revoked_at: null,
      expires_at: computeExpiresAt(bk.data.booking_date)
    }).eq('id', access.id).eq('tenant_id', tenant).select();
    if (upd.error || !upd.data || upd.data.length !== 1) {
      logServer('qr-rotate', (upd.error && upd.error.message) || 'unexpected rows');
      return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to rotate the code');
    }

    const qr = await generateBookingQrPng(upd.data[0], bk.data.booking_code);
    await recordAudit(session, {
      action: 'qr.rotate', entity_type: 'booking', entity_id: bk.data.booking_code || body.booking_id, always: true,
      before: { token_version: Number(access.token_version) || 1 },
      after: { token_version: upd.data[0].token_version, previous_invalidated: true }
    });
    return sendJson(res, 200, {
      rotated: true,
      previousInvalidated: true,          // el QR ya enviado al cliente dejó de servir
      qrUrl: qr.qrUrl,
      filename: qr.filename,
      pngBase64: qr.pngBuffer.toString('base64'),
      expiresAt: upd.data[0].expires_at
    });
  } catch (err) {
    logServer('qr-rotate', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to rotate the code');
  }
};
