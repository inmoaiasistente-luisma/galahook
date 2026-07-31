'use strict';

/* =========================================================
   GET|POST /api/admin-reminders-run   (action=reminders-run)
   ---------------------------------------------------------
   Barrido diario de recordatorios pre-viaje: 7, 5, 3, 1 y 0 días antes
   de la fecha de inicio del viaje.

   DOS formas de autorizarse, nunca una tercera:
     · CRON  → cabecera Authorization: Bearer <CRON_SECRET>. Es como entra
       el cron de Vercel. Sin CRON_SECRET configurado, esta vía NO existe.
     · OWNER → sesión de owner (ejecutar el barrido a mano desde el panel).
   El admin es solo lectura y el staff no envía correos: ambos reciben 403.

   Idempotencia: cada etapa es un notification_type propio y
   email_notifications tiene unique(booking_id, tipo, destinatario). Si el
   cron corre dos veces el mismo día, el segundo envío se detecta como
   duplicado y no sale ningún correo repetido.

   Nunca toca Stripe, importes ni estados de la reserva.
   ========================================================= */

const crypto = require('crypto');
const { sendJson, sendError, logServer, readJsonBody, getTenantId, todayInGalapagos } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireWriter, sameOrigin } = require('../lib/admin-auth');
const { recordAudit } = require('../lib/admin-audit');
const { sendBookingEmail } = require('../lib/booking-email-service');
const rem = require('../lib/pretrip-reminders');

/* Tope por ejecución: protege el tiempo de la función serverless. Lo que no
   entre hoy entra en la siguiente corrida (la cadencia tiene margen). */
const MAX_PER_RUN = 200;

/** Comparación en tiempo constante del secreto del cron. */
function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = String((req.headers && req.headers.authorization) || '');
  const expected = 'Bearer ' + secret;
  const a = Buffer.from(given), b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET or POST is allowed');
  }

  const viaCron = cronAuthorized(req);
  let session = null;
  if (!viaCron) {
    session = await requireWriter(req, res);            // owner; admin/staff → 403
    if (!session) return;                               // 401/403 ya enviado
    if (req.method === 'POST' && !sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');
  }

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('reminders-run', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  /* Ejecución acotada a una reserva (botón "enviar ahora" del panel). */
  let onlyBookingId = null;
  if (req.method === 'POST' && !viaCron) {
    let body = {};
    try { body = await readJsonBody(req); } catch (e) { body = {}; }
    if (body && typeof body.booking_id === 'string' && body.booking_id) onlyBookingId = body.booking_id;
  }

  const today = todayInGalapagos();
  const bounds = rem.windowBounds(today);

  try {
    const supabase = getSupabase();

    /* select('*') a propósito: la columna reminders_paused llega con la
       migración 0019. Pidiendo columnas concretas, el barrido se caería
       mientras 0019 no esté aplicada; así simplemente no viene el campo
       y la reserva se considera NO pausada. */
    let q = supabase.from('bookings').select('*')
      .eq('tenant_id', tenant)
      .gte('booking_date', bounds[0])
      .lte('booking_date', bounds[1])
      .limit(MAX_PER_RUN);
    if (onlyBookingId) q = q.eq('id', onlyBookingId);

    const { data, error } = await q;
    if (error) { logServer('reminders-run', error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Scan failed'); }

    const rows = data || [];
    const due = rem.dueList(rows, today);

    const summary = { date: today, scanned: rows.length, due: due.length, sent: 0, duplicate: 0, failed: 0, skipped: 0, stages: {} };

    for (let i = 0; i < due.length; i++) {
      const item = due[i];
      summary.stages[item.type] = (summary.stages[item.type] || 0) + 1;
      let r;
      try {
        r = await sendBookingEmail({
          booking: item.booking,
          type: item.type,
          recipient: item.booking.customer_email
        });
      } catch (e) { r = { failed: true }; }
      if (r && r.sent) summary.sent++;
      else if (r && r.duplicate) summary.duplicate++;
      else if (r && r.failed) summary.failed++;
      else summary.skipped++;
    }

    /* La corrida queda auditada aunque no haya salido ningún correo. */
    await recordAudit(session || { user_id: null, email: 'cron', role: null, tenant_id: tenant }, {
      action: 'reminders.run', entity_type: 'reminders', entity_id: today, always: true,
      before: null, after: { via: viaCron ? 'cron' : 'owner', sent: summary.sent, due: summary.due, failed: summary.failed }
    });

    return sendJson(res, 200, summary);
  } catch (err) {
    logServer('reminders-run', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Reminder run failed');
  }
};
