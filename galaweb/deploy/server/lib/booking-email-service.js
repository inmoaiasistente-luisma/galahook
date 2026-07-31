'use strict';

/* =========================================================
   LOAN-IX Booking Engine — servicio idempotente de correo
   ---------------------------------------------------------
   Idempotencia por EVENTO LOGICO mediante idempotency_key
   (unico por tenant). Ejemplos de clave:
     invitation:{form_id}:v{token_version}
     submitted:{form_id}:v{submission_version}
     changes_requested:{form_id}:cycle:{review_cycle}
     completed:{form_id}
     <type>:{booking_id}:{recipient}   (por defecto para los correos previos)

   · Un evento con envio exitoso NO se reenvia (retry idempotente).
   · Una ronda nueva usa una idempotency_key distinta -> evento nuevo.
   · Cada INTENTO se registra en email_notification_attempts
     (attempt_number unico por notificacion), con resultado y error
     saneado. El reclamo atomico sobre `status` serializa la concurrencia.

   NORMALIZACION del destinatario: trim() + toLowerCase() ANTES de validar;
   a partir de ahi solo se usa la forma normalizada.

   NUNCA lanza hacia arriba: quien lo llama (webhook, cotizacion, venta
   directa, intake) jamas debe fallar por culpa de un correo.
   ========================================================= */

const { getSupabase } = require('./supabase');
const { getResend, getMailConfig } = require('./resend');
const { TEMPLATES } = require('./email-templates');
const { ensureBookingQrAccess, generateBookingQrPng } = require('./booking-qr');
const { logServer, normalizeEmail, isEmail, maskEmail } = require('./http');

const QR_CID = 'booking-qr';

function sanitize(msg) { return String(msg == null ? '' : msg).replace(/\s+/g, ' ').slice(0, 300); }

function describeResendError(error) {
  if (!error) return '';
  if (typeof error === 'string') return sanitize(error);
  const parts = [];
  if (error.name) parts.push(String(error.name));
  if (error.statusCode != null) parts.push('HTTP ' + error.statusCode);
  if (error.message) parts.push(String(error.message));
  return sanitize(parts.join(' · ')) || 'resend error';
}

function emailDiag(booking, type, status, extra) {
  extra = extra || {};
  const info = {
    booking_code: (booking && booking.booking_code) || '(sin codigo)',
    notification_type: type || '(sin tipo)',
    status: status,
    provider_id: extra.hasId ? 'yes' : 'no'
  };
  if (extra.error) info.error = sanitize(extra.error).slice(0, 180);
  logServer('email-service', 'diag ' + JSON.stringify(info));
}

/* clave de idempotencia por defecto (comportamiento previo). */
function defaultIdempotencyKey(type, bookingId, recipient) {
  return String(type) + ':' + String(bookingId) + ':' + String(recipient);
}

/* Registro de intentos (best-effort: nunca rompe el envio). */
async function insertAttempt(supabase, tenant, notificationId, attemptNumber, recipient) {
  try {
    await supabase.from('email_notification_attempts').insert({
      notification_id: notificationId, tenant_id: tenant,
      attempt_number: attemptNumber, status: 'pending',
      recipient_masked: maskEmail(recipient)
    });
  } catch (e) { /* best-effort */ }
}
async function finishAttempt(supabase, notificationId, attemptNumber, status, extra) {
  extra = extra || {};
  try {
    await supabase.from('email_notification_attempts')
      .update({
        status: status,
        provider_message_id: extra.providerMessageId || null,
        sanitized_error: extra.error || null
      })
      .eq('notification_id', notificationId).eq('attempt_number', attemptNumber);
  } catch (e) { /* best-effort */ }
}

/**
 * @param {object} o { booking, type, recipient, idempotencyKey?, ctx? }
 * @returns {Promise<{sent?:boolean, duplicate?:boolean, skipped?:boolean, failed?:boolean, reason?:string}>}
 */
async function sendBookingEmail(o) {
  const booking = o && o.booking;
  const type = o && o.type;
  const recipient = normalizeEmail((o && o.recipient) || '');
  const extraCtx = (o && o.ctx) || {};

  let notifId = null;
  let attemptNumber = null;
  let supabaseRef = null;

  try {
    if (!booking || !booking.id) return { skipped: true, reason: 'no_booking' };
    if (!TEMPLATES[type]) return { skipped: true, reason: 'unknown_type' };
    if (!isEmail(recipient)) return { skipped: true, reason: 'no_recipient' };

    const supabase = getSupabase();
    supabaseRef = supabase;
    const idem = (o && o.idempotencyKey) || defaultIdempotencyKey(type, booking.id, recipient);

    /* 1) Reservar el registro (idempotencia por idempotency_key). */
    const ins = await supabase.from('email_notifications').insert({
      booking_id: booking.id, tenant_id: booking.tenant_id,
      notification_type: type, recipient_email: recipient, status: 'pending',
      idempotency_key: idem
    }).select().maybeSingle();

    let row = ins.error ? null : ins.data;
    if (ins.error && ins.error.code !== '23505') {
      logServer('email-service', 'insert: ' + ins.error.message);
      return { failed: true, reason: 'ledger_insert' };
    }
    if (!row) {
      const found = await supabase.from('email_notifications').select('*')
        .eq('tenant_id', booking.tenant_id).eq('idempotency_key', idem).maybeSingle();
      if (!found.error && found.data) row = found.data;
      if (!row) {
        /* Compatibilidad: filas anteriores a idempotency_key (o durante la
           transición del backfill) se localizan por (booking_id, tipo, recipient). */
        const alt = await supabase.from('email_notifications').select('*')
          .eq('booking_id', booking.id).eq('notification_type', type).eq('recipient_email', recipient).maybeSingle();
        if (!alt.error && alt.data) row = alt.data;
      }
      if (!row) return { failed: true, reason: 'ledger_lookup' };
    }

    if (row.status === 'sent') return { duplicate: true };
    if (row.status === 'sending') return { skipped: true, reason: 'in_progress' };

    /* 2) Reclamo ATOMICO: solo gana quien logre pasar de `status` a 'sending'. */
    attemptNumber = (row.attempts || 0) + 1;
    const claim = await supabase.from('email_notifications')
      .update({ status: 'sending', attempts: attemptNumber })
      .eq('id', row.id).eq('status', row.status)
      .select();
    if (claim.error || !claim.data || claim.data.length !== 1) return { skipped: true, reason: 'claimed_elsewhere' };

    notifId = row.id;
    await insertAttempt(supabase, booking.tenant_id, notifId, attemptNumber, recipient);

    /* 3) QR si la plantilla lo requiere (best-effort). */
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
    const tpl = TEMPLATES[type].build(booking, Object.assign({}, ctx, extraCtx));
    const cfg = getMailConfig();
    const payload = {
      from: cfg.from, to: [recipient], subject: tpl.subject, html: tpl.html, text: tpl.text
    };
    if (cfg.replyTo) payload.replyTo = cfg.replyTo;
    if (attachments.length) payload.attachments = attachments;

    const resp = await getResend().emails.send(payload);
    if (!resp || resp.error) throw new Error(describeResendError(resp && resp.error) || 'resend error');
    if (!resp.data || !resp.data.id) throw new Error('resend: respuesta sin id de mensaje');
    const messageId = resp.data.id;

    await supabase.from('email_notifications').update({
      status: 'sent', provider_message_id: messageId,
      sent_at: new Date().toISOString(), last_error: null
    }).eq('id', row.id);

    /* Guarda el asunto y el cuerpo para poder abrir el correo desde la reserva
       (0021). Best-effort: si las columnas no existen todavía, se ignora. */
    try {
      const bodyUpd = await supabase.from('email_notifications')
        .update({ subject: tpl.subject, body_html: tpl.html, body_text: tpl.text })
        .eq('id', row.id);
      if (bodyUpd.error) logServer('email-service', 'body: ' + sanitize(bodyUpd.error.message));
    } catch (e) { /* 0021 sin aplicar: no es crítico */ }
    await finishAttempt(supabase, notifId, attemptNumber, 'sent', { providerMessageId: messageId });

    emailDiag(booking, type, 'sent', { hasId: true });
    return { sent: true, notificationId: row.id, providerMessageId: messageId };
  } catch (err) {
    const msg = sanitize(err && err.message);
    emailDiag(booking, type, 'failed', { error: msg });
    try {
      const supabase = supabaseRef || getSupabase();
      if (notifId) {
        await supabase.from('email_notifications')
          .update({ status: 'failed', last_error: msg, sent_at: null })
          .eq('id', notifId);
        if (attemptNumber) await finishAttempt(supabase, notifId, attemptNumber, 'failed', { error: msg });
      }
    } catch (e) { /* nunca propagar */ }
    return { failed: true, reason: 'send_error' };
  }
}

/** Envia cliente + interno sin que un fallo afecte al llamador. */
async function notifyBooking(booking, customerType, ownerType) {
  const out = { customer: null, owner: null };
  try {
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
