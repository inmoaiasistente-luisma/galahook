'use strict';

/* =========================================================
   POST /api/admin-email-retry   body: { notification_id }
   ---------------------------------------------------------
   Solo owner y admin (staff → 403). Reintenta ÚNICAMENTE una
   notificación en estado 'failed'.

   El navegador no elige destinatario, tipo ni reserva: todo se lee
   de la fila almacenada. Así no existe forma de enviar un correo
   arbitrario a una dirección arbitraria.
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireAdmin, sameOrigin } = require('../lib/admin-auth');
const { sendBookingEmail } = require('../lib/booking-email-service');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('email-retry', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ['notification_id'])) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (typeof body.notification_id !== 'string' || !body.notification_id) return sendError(res, 400, 'INVALID_ID', 'notification_id is required');

  try {
    const supabase = getSupabase();
    const found = await supabase.from('email_notifications').select('*')
      .eq('id', body.notification_id).eq('tenant_id', tenant).maybeSingle();
    if (found.error) { logServer('email-retry', found.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    const notif = found.data;
    if (!notif) return sendError(res, 404, 'NOT_FOUND', 'Notification not found');
    if (notif.status !== 'failed') return sendError(res, 409, 'NOT_RETRYABLE', 'Only failed notifications can be retried');

    const bk = await supabase.from('bookings').select('*')
      .eq('id', notif.booking_id).eq('tenant_id', tenant).maybeSingle();
    if (bk.error || !bk.data) return sendError(res, 404, 'NOT_FOUND', 'Booking not found');
    // No se reintentan correos de reservas archivadas (borrado lógico).
    if (bk.data.deleted_at) return sendError(res, 409, 'BOOKING_ARCHIVED', 'This booking was archived');

    // Tipo y destinatario salen de la fila, nunca de la petición.
    const result = await sendBookingEmail({
      booking: bk.data, type: notif.notification_type, recipient: notif.recipient_email
    });
    if (result && result.sent) return sendJson(res, 200, { retried: true, status: 'sent' });
    if (result && result.duplicate) return sendJson(res, 200, { retried: false, status: 'sent' });
    return sendJson(res, 200, { retried: false, status: 'failed' });
  } catch (err) {
    logServer('email-retry', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to retry');
  }
};
