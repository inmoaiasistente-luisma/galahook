'use strict';

/* =========================================================
   POST /api/admin-reminders-toggle   (action=reminders-toggle)
   ---------------------------------------------------------
   Pausa o reanuda los recordatorios pre-viaje de UNA reserva.
   Solo owner (el admin es de lectura; el staff no gestiona envíos).

   Pausar NO borra nada ni cancela lo ya enviado: solo impide que el
   barrido diario genere las etapas siguientes. Al reanudar, la reserva
   vuelve a entrar en el barrido y recibe las etapas que aún queden por
   delante (las que ya pasaron no se recuperan: su fecha ya no aplica).

   Body: { booking_id, paused }
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, getTenantId, isUuid } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireWriter, sameOrigin } = require('../lib/admin-auth');
const { recordAudit } = require('../lib/admin-audit');

const ALLOWED_KEYS = ['booking_id', 'paused'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireWriter(req, res);        // Fase 9: escritura = SOLO owner
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('reminders-toggle', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!isUuid(body.booking_id)) return sendError(res, 400, 'INVALID_BOOKING', 'booking_id must be a UUID');
  if (typeof body.paused !== 'boolean') return sendError(res, 400, 'INVALID_PAUSED', 'paused must be a boolean');

  try {
    const supabase = getSupabase();
    const patch = body.paused
      ? { reminders_paused: true, reminders_paused_at: new Date().toISOString(), reminders_paused_by_user_id: session.user_id }
      : { reminders_paused: false, reminders_paused_at: null, reminders_paused_by_user_id: null };

    const upd = await supabase.from('bookings').update(patch)
      .eq('id', body.booking_id).eq('tenant_id', tenant).select('id,reminders_paused');
    if (upd.error) { logServer('reminders-toggle', upd.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Update failed'); }
    if (!upd.data || upd.data.length === 0) return sendError(res, 404, 'NOT_FOUND', 'Booking not found');

    await recordAudit(session, {
      action: 'reminders.toggle', entity_type: 'booking', entity_id: body.booking_id,
      before: { reminders_paused: !body.paused }, after: { reminders_paused: body.paused }
    });

    return sendJson(res, 200, { updated: true, reminders_paused: body.paused });
  } catch (err) {
    logServer('reminders-toggle', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Update failed');
  }
};
