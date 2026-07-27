'use strict';

/* =========================================================
   LOAN-IX Booking Engine — servicio idempotente de correo
   ---------------------------------------------------------
   Un correo por (booking_id, notification_type, recipient_email).
   La unicidad la garantiza la base de datos (migraciones 0007 y 0009)
   y el reclamo del envío se hace con un compare-and-swap sobre
   `status`, de modo que dos ejecuciones concurrentes nunca envían dos
   veces.

   NORMALIZACIÓN: el destinatario se pasa por trim() + toLowerCase()
   ANTES de validarlo, y a partir de ahí se usa EXCLUSIVAMENTE la forma
   normalizada para insertar, buscar, comparar, enviar y aplicar la
   idempotencia. Así "Cliente@Email.com", "cliente@email.com" y
   " cliente@email.com " son el mismo destinatario y generan una única
   notificación.

   NUNCA lanza hacia arriba: quien lo llama (webhook, cotización,
   venta directa) jamás debe fallar por culpa de un correo.
   ========================================================= */

const { getSupabase } = require('./supabase');
const { getResend, getMailConfig } = require('./resend');
const { TEMPLATES } = require('./email-templates');
const { ensureBookingQrAccess, generateBookingQrPng } = require('./booking-qr');
const { logServer, normalizeEmail, isEmail } = require('./http');

const QR_CID = 'booking-qr';

function sanitize(msg) { return String(msg == null ? '' : msg).replace(/\s+/g, ' ').slice(0, 300); }

/**
 * @param {object} o { booking, type, recipient }
 * @returns {Promise<{sent?:boolean, duplicate?:boolean, skipped?:boolean, failed?:boolean, reason?:string}>}
 */
async function sendBookingEmail(o) {
  const booking = o && o.booking;
  const type = o && o.type;
  /* Normalizar PRIMERO; validar DESPUÉS. A partir de aquí solo existe
     `recipient`: la forma sin normalizar no vuelve a usarse. */
  const recipient = normalizeEmail((o && o.recipient) || '');

  try {
    if (!booking || !booking.id) return { skipped: true, reason: 'no_booking' };
    if (!TEMPLATES[type]) return { skipped: true, reason: 'unknown_type' };
    if (!isEmail(recipient)) return { skipped: true, reason: 'no_recipient' };

    const supabase = getSupabase();

    /* 1) Reservar el registro (idempotencia a nivel de base de datos). */
    const ins = await supabase.from('email_notifications').insert({
      booking_id: booking.id, tenant_id: booking.tenant_id,
      notification_type: type, recipient_email: recipient, status: 'pending'
    }).select().maybeSingle();

    let row = ins.error ? null : ins.data;
    if (ins.error && ins.error.code !== '23505') {
      logServer('email-service', 'insert: ' + ins.error.message);
      return { failed: true, reason: 'ledger_insert' };
    }
    if (!row) {
      const found = await supabase.from('email_notifications').select('*')
        .eq('booking_id', booking.id).eq('notification_type', type)
        .eq('recipient_email', recipient).maybeSingle();
      if (found.error || !found.data) return { failed: true, reason: 'ledger_lookup' };
      row = found.data;
    }

    if (row.status === 'sent') return { duplicate: true };
    if (row.status === 'sending') return { skipped: true, reason: 'in_progress' };

    /* 2) Reclamo ATÓMICO: solo gana quien logre pasar de `status` a 'sending'.
          Si otra ejecución concurrente ya lo tomó, aquí salen 0 filas. */
    const claim = await supabase.from('email_notifications')
      .update({ status: 'sending', attempts: (row.attempts || 0) + 1 })
      .eq('id', row.id).eq('status', row.status)
      .select();
    if (claim.error || !claim.data || claim.data.length !== 1) return { skipped: true, reason: 'claimed_elsewhere' };

    /* 3) QR si la plantilla lo requiere (best-effort: si falla, se envía sin él). */
    let ctx = {};
    const attachments = [];
    if (TEMPLATES[type].qr) {
      try {
        const access = await ensureBookingQrAccess(booking);
        if (access) {
          const qr = await generateBookingQrPng(access, booking.booking_code);
          ctx = { qrUrl: qr.qrUrl, cid: QR_CID };
          attachments.push({ filename: qr.filename, content: qr.pngBuffer, contentId: QR_CID });
        }
      } catch (e) { logServer('email-service', 'qr: ' + sanitize(e && e.message)); }
    }

    /* 4) Enviar. */
    const tpl = TEMPLATES[type].build(booking, ctx);
    const cfg = getMailConfig();
    const payload = {
      from: cfg.from, to: [recipient], subject: tpl.subject, html: tpl.html, text: tpl.text
    };
    if (cfg.replyTo) payload.replyTo = cfg.replyTo;
    if (attachments.length) payload.attachments = attachments;

    const sent = await getResend().emails.send(payload);
    if (sent && sent.error) throw new Error(sent.error.message || 'resend error');
    const messageId = (sent && sent.data && sent.data.id) || null;

    await supabase.from('email_notifications').update({
      status: 'sent', provider_message_id: messageId,
      sent_at: new Date().toISOString(), last_error: null
    }).eq('id', row.id);

    return { sent: true, notificationId: row.id };
  } catch (err) {
    const msg = sanitize(err && err.message);
    logServer('email-service', type + ': ' + msg);
    try {
      const supabase = getSupabase();
      const found = await supabase.from('email_notifications').select('id')
        .eq('booking_id', booking && booking.id).eq('notification_type', type)
        .eq('recipient_email', recipient).maybeSingle();
      if (found.data) {
        await supabase.from('email_notifications')
          .update({ status: 'failed', last_error: msg, sent_at: null })
          .eq('id', found.data.id);
      }
    } catch (e) { /* nunca propagar */ }
    return { failed: true, reason: 'send_error' };
  }
}

/** Envía cliente + interno sin que un fallo afecte al llamador. */
async function notifyBooking(booking, customerType, ownerType) {
  const out = { customer: null, owner: null };
  try {
    /* También aquí se normaliza antes de decidir: un email que solo
       contenga espacios no cuenta como destinatario. */
    const customer = normalizeEmail((booking && booking.customer_email) || '');
    out.customer = customer
      ? await sendBookingEmail({ booking: booking, type: customerType, recipient: customer })
      : { skipped: true, reason: 'no_recipient' };
  } catch (e) { out.customer = { failed: true }; }
  try {
    const notify = normalizeEmail(getMailConfig().notifyTo || '');
    out.owner = notify
      ? await sendBookingEmail({ booking: booking, type: ownerType, recipient: notify })
      : { skipped: true, reason: 'no_internal_recipient' };
  } catch (e) { out.owner = { failed: true }; }
  return out;
}

module.exports = { sendBookingEmail, notifyBooking, QR_CID };
