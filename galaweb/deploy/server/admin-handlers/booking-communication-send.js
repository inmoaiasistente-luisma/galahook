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
const { BUCKET } = require('../lib/booking-documents');

const ALLOWED_KEYS = ['booking_id', 'message_type', 'recipient', 'note', 'document_id'];
const MESSAGE_TYPES = ['qr_resend', 'confirmation_resend', 'air_ticket', 'hotel_voucher',
  'itinerary', 'instructions', 'change_notice', 'reminder_manual', 'other'];
/* Tipos que llevan el QR adjunto. */
const QR_TYPES = ['qr_resend', 'confirmation_resend'];
const QR_CID = 'booking-qr';
/* Por encima de este tamaño se envía un enlace firmado en vez de adjuntar. */
const ATTACH_MAX_BYTES = 8 * 1024 * 1024;

function sanitize(msg) { return String(msg == null ? '' : msg).replace(/\s+/g, ' ').slice(0, 300); }

/* Normaliza lo que devuelve storage.download() a un Buffer, sea Blob (fetch),
   ArrayBuffer, Uint8Array o Buffer, según el entorno de ejecución. */
async function toBuffer(data) {
  if (!data) return null;
  if (Buffer.isBuffer(data)) return data;
  if (typeof data.arrayBuffer === 'function') return Buffer.from(await data.arrayBuffer());
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (data instanceof Uint8Array) return Buffer.from(data);
  try { return Buffer.from(data); } catch (e) { return null; }
}

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
        const dq = await supabase.from('booking_documents').select('id,label,url,doc_type,source,storage_path,original_filename,mime_type,file_size')
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
    /* Adjuntar el documento:
       · enlace externo (source='link') → va como enlace en el correo;
       · archivo subido (source='upload') → se descarga de Storage y se ADJUNTA
         al correo (nunca se expone la ruta interna). Si es grande o falla la
         descarga, se manda una URL FIRMADA temporal como respaldo. */
    if (doc) {
      ctx.documentLabel = doc.label;
      if (doc.storage_path) {
        const big = Number(doc.file_size || 0) > ATTACH_MAX_BYTES;
        let attached = false;
        if (!big) {
          try {
            const dl = await supabase.storage.from(BUCKET).download(doc.storage_path);
            const buf = await toBuffer(dl && dl.data);
            if (buf) {
              attachments.push({ filename: doc.original_filename || doc.label, content: buf });
              attached = true;
            }
          } catch (e) { logServer('comm-send', 'attach: ' + sanitize(e && e.message)); }
        }
        if (!attached) {
          try {
            const s = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 3600);
            if (s && s.data && s.data.signedUrl) ctx.documentUrl = s.data.signedUrl;
          } catch (e) { logServer('comm-send', 'sign: ' + sanitize(e && e.message)); }
        }
      } else {
        ctx.documentUrl = doc.url;   // enlace externo
      }
    }

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
    const baseRow = {
      tenant_id: tenant, booking_id: booking.id, channel: 'email',
      message_type: body.message_type, recipient: recipient,
      subject: tpl.subject, body_preview: (body.note || '').slice(0, 300) || null,
      document_id: doc ? doc.id : null, document_label: doc ? doc.label : null,
      status: status, provider_message_id: providerId, error_message: errMsg,
      sent_by_user_id: session.user_id, sent_by_name: session.full_name
    };
    try {
      /* Se guarda el CUERPO completo (0021) para poder abrir el mensaje luego.
         Si 0021 aún no está aplicada, el insert con body falla y se reintenta
         sin esas columnas: el envío no se pierde, solo el cuerpo. */
      const withBody = Object.assign({}, baseRow, { body_html: tpl.html, body_text: tpl.text });
      let ins = await supabase.from('booking_communications').insert(withBody);
      if (ins.error) {
        ins = await supabase.from('booking_communications').insert(baseRow);
        if (ins.error) throw new Error(ins.error.message);
      }
    } catch (e) { logged = false; logServer('comm-send', 'log: ' + sanitize(e && e.message)); }

    /* Si se envió un documento con éxito, se marca cuándo se le mandó al
       pasajero (best-effort: no afecta al resultado del envío). */
    if (status === 'sent' && doc) {
      try { await supabase.from('booking_documents').update({ sent_to_passenger_at: new Date().toISOString() }).eq('id', doc.id).eq('tenant_id', tenant); }
      catch (e) { /* no crítico */ }
    }

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
