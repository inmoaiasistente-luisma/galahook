'use strict';

/* =========================================================
   POST /api/admin-booking-document-save (action=booking-document-save)
   ---------------------------------------------------------
   Asocia un documento a la reserva (ticket aéreo, voucher de hotel,
   itinerario, instrucciones…) o lo retira.

   Se guarda la REFERENCIA (enlace https + etiqueta), no el archivo: el
   proyecto no tiene bucket de almacenamiento y no se inventa uno aquí. El
   documento vive donde el owner ya lo tiene y el enlace es lo que viaja al
   pasajero.

   Retirar es BAJA LÓGICA (active=false): no se borra nada.
   Solo owner.

   Body: { booking_id, action:'add'|'remove', document_id?, doc_type?,
           label?, url?, notes? }
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, getTenantId, isUuid, isNonEmptyString } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireWriter, sameOrigin } = require('../lib/admin-auth');
const { recordAudit } = require('../lib/admin-audit');

const ALLOWED_KEYS = ['booking_id', 'action', 'document_id', 'doc_type', 'label', 'url', 'notes'];
const DOC_TYPES = ['air_ticket', 'hotel_voucher', 'itinerary', 'instructions', 'insurance', 'receipt', 'other'];

/* Solo https. Un enlace http:// expondría el documento del pasajero en claro. */
function isHttpsUrl(v) {
  if (typeof v !== 'string' || v.length > 2000) return false;
  return /^https:\/\/[^\s]+$/i.test(v);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireWriter(req, res);        // Fase 9: escritura = SOLO owner
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('booking-document-save', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!isUuid(body.booking_id)) return sendError(res, 400, 'INVALID_BOOKING', 'booking_id must be a UUID');

  const action = body.action === 'remove' ? 'remove' : 'add';

  try {
    const supabase = getSupabase();

    if (action === 'remove') {
      if (!isUuid(body.document_id)) return sendError(res, 400, 'INVALID_DOCUMENT', 'document_id must be a UUID');
      const upd = await supabase.from('booking_documents').update({ active: false })
        .eq('id', body.document_id).eq('booking_id', body.booking_id).eq('tenant_id', tenant).select('id');
      if (upd.error) { logServer('booking-document-save', upd.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
      if (!upd.data || upd.data.length === 0) return sendError(res, 404, 'NOT_FOUND', 'Document not found');

      await recordAudit(session, {
        action: 'document.remove', entity_type: 'booking', entity_id: body.booking_id, always: true,
        before: { document_id: body.document_id, active: true }, after: { active: false }
      });
      return sendJson(res, 200, { removed: true });
    }

    if (DOC_TYPES.indexOf(body.doc_type) === -1) return sendError(res, 400, 'INVALID_DOC_TYPE', 'Invalid doc_type');
    if (!isNonEmptyString(body.label, 2, 160)) return sendError(res, 400, 'INVALID_LABEL', 'label is required');
    if (!isHttpsUrl(body.url)) return sendError(res, 400, 'INVALID_URL', 'url must be an https link');
    if (body.notes != null && (typeof body.notes !== 'string' || body.notes.length > 1000)) {
      return sendError(res, 400, 'INVALID_NOTES', 'notes is too long');
    }

    const bq = await supabase.from('bookings').select('id').eq('id', body.booking_id).eq('tenant_id', tenant).maybeSingle();
    if (bq.error) { logServer('booking-document-save', bq.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    if (!bq.data) return sendError(res, 404, 'BOOKING_NOT_FOUND', 'Booking not found');

    /* source NO se envía a propósito: la columna llega con la migración 0020 y
       su default es 'link'. Así el alta de enlaces sigue funcionando aunque
       0020 aún no esté aplicada. */
    const ins = await supabase.from('booking_documents').insert({
      tenant_id: tenant, booking_id: body.booking_id,
      doc_type: body.doc_type, label: body.label.trim(), url: body.url,
      notes: body.notes || null, created_by_user_id: session.user_id
    }).select('id,doc_type,label,url,notes,created_at').single();
    if (ins.error || !ins.data) {
      logServer('booking-document-save', (ins.error && ins.error.message) || 'insert');
      return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
    }

    await recordAudit(session, {
      action: 'document.add', entity_type: 'booking', entity_id: body.booking_id, always: true,
      before: null, after: { document_id: ins.data.id, doc_type: ins.data.doc_type, label: ins.data.label }
    });

    return sendJson(res, 200, { added: true, document: ins.data });
  } catch (err) {
    logServer('booking-document-save', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
