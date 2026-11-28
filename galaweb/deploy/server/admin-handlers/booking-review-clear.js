'use strict';

/* =========================================================
   POST /api/admin-booking-review-clear  (action=booking-review-clear)
   ---------------------------------------------------------
   owner: marca como REVISADA la alerta de pago de una reserva
   (needs_review_reason → null) una vez que ya decidió qué hacer
   (reembolsar en Stripe, reactivar la reserva, etc.).
   Escritura = SOLO owner + sameOrigin.
   Body: { booking_id, note? }  (note opcional, recortada, máx. 500)
   Única vía de escritura: UPDATE condicional por id + tenant y solo si la
   alerta sigue activa. 0 filas → 409 NOTHING_TO_REVIEW (ya revisada,
   de otro tenant o inexistente: respuesta uniforme).
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, getTenantId, isUuid } = require('../lib/http');
const { requireWriter, sameOrigin } = require('../lib/admin-auth');
const { recordAudit } = require('../lib/admin-audit');
const { getSupabase } = require('../lib/supabase');

const ALLOWED_KEYS = ['booking_id', 'note'];
const NOTE_MAX = 500;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireWriter(req, res);   // escritura = SOLO owner
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); } catch (e) { logServer('booking-review-clear', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!isUuid(body.booking_id)) return sendError(res, 400, 'INVALID_BOOKING', 'booking_id must be a UUID');
  if (body.note != null && typeof body.note !== 'string') return sendError(res, 400, 'INVALID_NOTE', 'note must be text');
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length > NOTE_MAX) return sendError(res, 400, 'INVALID_NOTE', 'note must be at most 500 characters');

  try {
    const supabase = getSupabase();
    // Lee el motivo vigente solo para la auditoría; la escritura es condicional por sí misma.
    const cur = await supabase.from('bookings').select('needs_review_reason')
      .eq('id', body.booking_id).eq('tenant_id', tenant).maybeSingle();
    if (cur.error) { logServer('booking-review-clear', cur.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    const before = cur.data && cur.data.needs_review_reason;

    const upd = await supabase.from('bookings')
      .update({ needs_review_reason: null })
      .eq('id', body.booking_id).eq('tenant_id', tenant)
      .not('needs_review_reason', 'is', null)
      .select();
    if (upd.error) { logServer('booking-review-clear', upd.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    if (!upd.data || upd.data.length !== 1) return sendError(res, 409, 'NOTHING_TO_REVIEW', 'There is no pending review');

    await recordAudit(session, {
      action: 'booking.review_cleared', entity_type: 'booking', entity_id: body.booking_id, always: true,
      before: { needs_review_reason: before || null },
      after: { needs_review_reason: null, note: note || null }
    });
    return sendJson(res, 200, { ok: true });
  } catch (err) { logServer('booking-review-clear', err && err.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
};
