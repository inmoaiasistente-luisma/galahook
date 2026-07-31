'use strict';

/* =========================================================
   POST /api/admin-notifications-retry-batch
   (action=notifications-retry-batch)
   body: { notification_ids:[...], confirmation:"RETRY FAILED EMAILS" }
   ---------------------------------------------------------
   owner y admin (staff → 403). Reintenta en lote SOLO
   notificaciones en estado 'failed'. Nunca reenvía una ya 'sent'
   (idempotencia por unique(booking_id,type,recipient)). Omite las
   de reservas archivadas. Un fallo individual NO detiene el lote.
   El navegador no elige destinatario, tipo ni reserva.
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, isUuid, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireWriter, sameOrigin } = require('../lib/admin-auth');
const { sendBookingEmail } = require('../lib/booking-email-service');

const CONFIRM = 'RETRY FAILED EMAILS';
const MAX_IDS = 50;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireWriter(req, res);   // Fase 9: escritura = SOLO owner
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('notifications-retry-batch', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ['notification_ids', 'confirmation'])) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (body.confirmation !== CONFIRM) return sendError(res, 400, 'INVALID_CONFIRMATION', 'Confirmation text does not match');

  const ids = body.notification_ids;
  if (!Array.isArray(ids) || ids.length < 1) return sendError(res, 400, 'INVALID_IDS', 'notification_ids is required');
  if (ids.length > MAX_IDS) return sendError(res, 400, 'TOO_MANY_IDS', 'Too many notification_ids in one request');
  if (!ids.every(isUuid)) return sendError(res, 400, 'INVALID_IDS', 'notification_ids must be UUIDs');
  const unique = Array.from(new Set(ids));

  try {
    const supabase = getSupabase();
    const nq = await supabase.from('email_notifications').select('*').eq('tenant_id', tenant).in('id', unique);
    if (nq.error) { logServer('notifications-retry-batch', nq.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    const byId = {};
    (nq.data || []).forEach(function (n) { byId[n.id] = n; });

    const results = [];
    let sent = 0, failed = 0, skipped = 0;

    for (let i = 0; i < unique.length; i++) {
      const id = unique[i];
      const notif = byId[id];
      if (!notif) { skipped++; results.push({ id: id, status: 'skipped', reason: 'not_found' }); continue; }
      if (notif.status !== 'failed') { skipped++; results.push({ id: id, status: 'skipped', reason: 'not_failed' }); continue; }

      const bk = await supabase.from('bookings').select('*').eq('id', notif.booking_id).eq('tenant_id', tenant).maybeSingle();
      if (bk.error || !bk.data) { skipped++; results.push({ id: id, status: 'skipped', reason: 'booking_missing' }); continue; }
      if (bk.data.deleted_at) { skipped++; results.push({ id: id, status: 'skipped', reason: 'archived' }); continue; }

      try {
        // Tipo y destinatario salen de la fila, nunca de la petición.
        const r = await sendBookingEmail({ booking: bk.data, type: notif.notification_type, recipient: notif.recipient_email });
        if (r && r.sent) { sent++; results.push({ id: id, status: 'sent' }); }
        else if (r && r.duplicate) { skipped++; results.push({ id: id, status: 'skipped', reason: 'already_sent' }); }
        else { failed++; results.push({ id: id, status: 'failed' }); }
      } catch (e) {
        failed++; results.push({ id: id, status: 'failed' });   // un fallo NO detiene el lote
      }
    }

    logServer('notifications-retry-batch', 'sent=' + sent + ' failed=' + failed + ' skipped=' + skipped + ' by=' + session.user_id);
    return sendJson(res, 200, { summary: { sent: sent, failed: failed, skipped: skipped }, results: results });
  } catch (err) {
    logServer('notifications-retry-batch', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
