'use strict';

/* =========================================================
   POST /api/admin-booking-communication-send
   (action=booking-communication-send)
   ---------------------------------------------------------
   Envía un mensaje al pasajero DESDE la reserva: reenviar el QR o la
   confirmación, mandar tickets aéreos, vouchers de hotel, itinerarios,
   instrucciones o avisar de un cambio.

   Cada envío queda registrado en booking_communications con destinatario,
   fecha/hora, tipo, estado (enviado/fallido), archivo enviado y el usuario
   que ejecutó la acción — que es exactamente lo que pidió el owner.

   Por qué NO pasa por email_notifications: ese registro existe para que un
   correo transaccional no se duplique jamás (unique booking+tipo+destino).
   Estos envíos son manuales y SE PUEDEN repetir a voluntad; mezclarlos
   rompería la garantía anti-duplicado de los correos automáticos.

   Solo owner. El admin es de solo lectura y el staff no envía correos.

   Body: { booking_id, message_type, recipient?, note?, document_id? }
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, getTenantId, isUuid, isEmail, normalizeEmail } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireWriter, sameOrigin } = require('../lib/admin-auth');
const { recordAudit } = require('../lib/admin-audit');
const { getResend, getMailConfig } = require('../lib/resend');
const { bookingMessage } = require('../lib/email-templates');
const { ensureBookingQrAccess, generateBookingQrPng } = require('../lib/booking-qr');

const ALLOWED_KEYS = ['booking_id', 'message_type', 'recipient', 'note', 'document_id'];
const MESSAGE_TYPES = ['qr_resend', 'confirmation_resend', 'air_ticket', 'hotel_voucher',
  'itinerary', 'instructions', 'change_notice', 'reminder_manual', 'other'];
/* Tipos que llevan el QR adjunto. */
const QR_TYPES = ['qr_resend', 'confirmation_resend'];
const QR_CID = 'booking-qr';

function sanitize(msg) { return String(msg == null ? '' : msg).replace(/\s+/g, ' ').slice(0, 300); }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireWriter(req, res);        // Fase 9: escritura = SOLO owner
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('comm-send', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!isUuid(body.booking_id)) return sendError(res, 400, 'INVALID_BOOKING', 'booking_id must be a UUID');
  if (MESSAGE_TYPES.indexOf(body.message_type) === -1) return sendError(res, 400, 'INVALID_MESSAGE_TYPE', 'Invalid message_type');
  if (body.note != null && (typeof body.note !== 'string' || body.note.length > 2000)) {
    return sendError(res, 400, 'INVALID_NOTE', 'note is too long');
  }
  if (body.document_id != null && body.document_id !== '' && !isUuid(body.document_id)) {
    return sendError(res, 400, 'INVALID_DOCUMENT', 'document_id must be a UUID');
  }

  try {
    const supabase = getSupabase();

    const bq = await supabase.from('bookings').select('*')
      .eq('id', body.booking_id).eq('tenant_id', tenant).maybeSingle();
    if (bq.error) { logServer('comm-send', bq.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    if (!bq.data) return sendError(res, 404, 'BOOKING_NOT_FOUND', 'Booking not found');
    const booking = bq.data;

    const recipient = normalizeEmail(body.recipient || booking.customer_email || '');
    if (!isEmail(recipient)) return sendError(res, 400, 'INVALID_RECIPIENT', 'A valid recipient email is required');

    /* Documento opcional: debe pertenecer a ESTA reserva y estar activo. */
    let doc = null;
    if (body.document_id) {
      try {
        const dq = await supabase.from('booking_documents').select('id,label,url,doc_type')
          .eq('id', body.document_id).eq('booking_id', body.booking_id)
          .eq('tenant_id', tenant).eq('active', true).maybeSingle();
        if (dq.error) throw new Error(dq.error.message);
        doc = dq.data || null;
      } catch (e) { doc = null; }
      if (!doc) return sendError(res, 404, 'DOCUMENT_NOT_FOUND', 'Document not found for this booking');
    }

    /* QR cuando el tipo lo requiere (best-effort: si falla, el correo sale igual). */
    const ctx = { messageType: body.message_type, note: body.note || '', };
    const attachments = [];
    if (QR_TYPES.indexOf(body.message_type) !== -1) {
      try {
        const access = await ensureBookingQrAccess(booking);
        if (access) {
          const qr = await generateBookingQrPng(access, booking.booking_code);
          ctx.qrUrl = qr.qrUrl; ctx.cid = QR_CID;
          attachments.push({ filename: qr.filename, content: qr.pngBuffer, contentId: QR_CID });
        }
      } catch (e) { logServer('comm-send', 'qr: ' + sanitize(e && e.message)); }
    }
    if (doc) { ctx.documentUrl = doc.url; ctx.documentLabel = doc.label; }

    const tpl = bookingMessage(booking, ctx);

    let status = 'sent', providerId = null, errMsg = null;
    try {
      const cfg = getMailConfig();
      const payload = { from: cfg.from, to: [recipient], subject: tpl.subject, html: tpl.html, text: tpl.text };
      if (cfg.replyTo) payload.replyTo = cfg.replyTo;
      if (attachments.length) payload.attachments = attachments;

      const resp = await getResend().emails.send(payload);
      if (!resp || resp.error || !resp.data || !resp.data.id) throw new Error('resend error');
      providerId = resp.data.id;
    } catch (e) {
      status = 'failed';
      errMsg = sanitize(e && e.message);
    }

    /* La bitácora es parte del requisito, pero si 0019 aún no está aplicada
       el correo YA salió: se informa logged:false en vez de mentir. */
    let logged = true;
    try {
      const ins = await supabase.from('booking_communications').insert({
        tenant_id: tenant, booking_id: booking.id, channel: 'email',
        message_type: body.message_type, recipient: recipient,
        subject: tpl.subject, body_preview: (body.note || '').slice(0, 300) || null,
        document_id: doc ? doc.id : null, document_label: doc ? doc.label : null,
        status: status, provider_message_id: providerId, error_message: errMsg,
        sent_by_user_id: session.user_id, sent_by_name: session.full_name
      });
      if (ins.error) throw new Error(ins.error.message);
    } catch (e) { logged = false; logServer('comm-send', 'log: ' + sanitize(e && e.message)); }

    await recordAudit(session, {
      action: 'communication.send', entity_type: 'booking', entity_id: booking.booking_code || booking.id, always: true,
      before: null,
      after: { message_type: body.message_type, recipient: recipient, status: status, document_label: doc ? doc.label : null }
    });

    if (status === 'failed') return sendError(res, 502, 'SEND_FAILED', 'The message could not be sent');
    return sendJson(res, 200, { sent: true, logged: logged, recipient: recipient, message_type: body.message_type });
  } catch (err) {
    logServer('comm-send', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
