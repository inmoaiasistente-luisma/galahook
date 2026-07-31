'use strict';

/* =========================================================
   POST /api/admin-booking-delete   (action=booking-delete)
   ---------------------------------------------------------
   Elimina (BAJA LÓGICA) una reserva. SOLO owner.

   No hay DELETE físico: se fija deleted_at y la reserva desaparece de todas
   las vistas (todas las consultas filtran deleted_at IS NULL). Se CONSERVAN
   pago, QR y correos ya enviados — no se toca Stripe ni se cancela nada.

   El owner NO escribe una razón: la restricción chk_booking_soft_delete
   (0011) exige deletion_reason (>=5 car.) y deleted_by_user_id, así que el
   SERVIDOR rellena una razón por defecto. Se puede pasar una opcional.

   admin y staff → 403 (aunque llamen al endpoint directamente).

   Body: { booking_id, reason? }
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, getTenantId, isUuid } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireWriter, sameOrigin } = require('../lib/admin-auth');
const { recordAudit } = require('../lib/admin-audit');

const ALLOWED_KEYS = ['booking_id', 'reason'];
const DEFAULT_REASON = 'Eliminada por el propietario';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireWriter(req, res);        // eliminar = SOLO owner
  if (!session) return;                                 // 401/403 ya enviado
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('booking-delete', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!isUuid(body.booking_id)) return sendError(res, 400, 'INVALID_BOOKING', 'booking_id must be a UUID');

  // Razón opcional del owner; si no la escribe, la fija el servidor (>=5 car.).
  let reason = DEFAULT_REASON;
  if (body.reason != null && typeof body.reason === 'string' && body.reason.trim().length >= 5) {
    reason = body.reason.trim().slice(0, 300);
  }

  try {
    const supabase = getSupabase();

    /* Estado anterior para la auditoría; y no re-archivar una ya archivada. */
    const cur = await supabase.from('bookings')
      .select('id,booking_code,deleted_at,is_test')
      .eq('id', body.booking_id).eq('tenant_id', tenant).maybeSingle();
    if (cur.error) { logServer('booking-delete', cur.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    if (!cur.data) return sendError(res, 404, 'NOT_FOUND', 'Booking not found');
    if (cur.data.deleted_at) return sendJson(res, 200, { deleted: true, already: true });

    const upd = await supabase.from('bookings').update({
      deleted_at: new Date().toISOString(),
      deleted_by_user_id: session.user_id,
      deletion_reason: reason
    }).eq('id', body.booking_id).eq('tenant_id', tenant).is('deleted_at', null)
      .select('id,booking_code');
    if (upd.error) { logServer('booking-delete', upd.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Delete failed'); }
    if (!upd.data || upd.data.length === 0) return sendError(res, 404, 'NOT_FOUND', 'Booking not found');

    await recordAudit(session, {
      action: 'booking.delete', entity_type: 'booking', entity_id: cur.data.booking_code || body.booking_id, always: true,
      before: { deleted_at: null }, after: { deleted_at: 'archived', is_test: cur.data.is_test === true }
    });

    // Nota: NO se toca Stripe, ni el pago, ni los correos/QR ya emitidos.
    return sendJson(res, 200, { deleted: true, booking_code: cur.data.booking_code });
  } catch (err) {
    logServer('booking-delete', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Delete failed');
  }
};
