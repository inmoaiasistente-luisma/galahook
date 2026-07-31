'use strict';

/* =========================================================
   POST /api/admin-booking-document-upload-url
   (action=booking-document-upload-url)
   ---------------------------------------------------------
   Paso 1 de la subida real de un documento. Valida la subida propuesta,
   reserva la fila de metadatos (active=false, pendiente) y devuelve una URL
   FIRMADA de subida de Supabase Storage para que el navegador suba el archivo
   DIRECTAMENTE (sin pasar los bytes por la función serverless, que tiene
   límite de cuerpo). Solo owner.

   El archivo se confirma después con booking-document-confirm.

   Body: { booking_id, doc_type, label, filename, mime_type, file_size }
   ========================================================= */

const crypto = require('crypto');
const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, getTenantId, isUuid, isNonEmptyString } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireWriter, sameOrigin } = require('../lib/admin-auth');
const { recordAudit } = require('../lib/admin-audit');
const docs = require('../lib/booking-documents');

const ALLOWED_KEYS = ['booking_id', 'doc_type', 'label', 'filename', 'mime_type', 'file_size'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireWriter(req, res);        // subir = SOLO owner
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('doc-upload-url', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!isUuid(body.booking_id)) return sendError(res, 400, 'INVALID_BOOKING', 'booking_id must be a UUID');
  if (docs.DOC_TYPES.indexOf(body.doc_type) === -1) return sendError(res, 400, 'INVALID_DOC_TYPE', 'Invalid doc_type');
  if (!isNonEmptyString(body.label, 2, 160)) return sendError(res, 400, 'INVALID_LABEL', 'label is required');

  const v = docs.validateUpload({ filename: body.filename, mime_type: body.mime_type, file_size: body.file_size });
  if (!v.ok) return sendError(res, 400, v.code, 'The file is not allowed');

  try {
    const supabase = getSupabase();

    const bq = await supabase.from('bookings').select('id').eq('id', body.booking_id).eq('tenant_id', tenant).maybeSingle();
    if (bq.error) { logServer('doc-upload-url', bq.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    if (!bq.data) return sendError(res, 404, 'BOOKING_NOT_FOUND', 'Booking not found');

    const documentId = crypto.randomUUID();
    const storagePath = docs.buildStoragePath(tenant, body.booking_id, documentId, v.meta.filename);

    /* URL firmada de subida. Si el bucket no existe (0020 sin aplicar), esto
       falla y se responde STORAGE_NOT_READY sin dejar filas huérfanas. */
    let signed;
    try {
      signed = await supabase.storage.from(docs.BUCKET).createSignedUploadUrl(storagePath);
    } catch (e) { signed = { error: e }; }
    if (!signed || signed.error || !signed.data || !signed.data.signedUrl) {
      logServer('doc-upload-url', 'signed url: ' + ((signed && signed.error && signed.error.message) || 'no url'));
      return sendError(res, 503, 'STORAGE_NOT_READY', 'Document storage is not available yet');
    }

    const ins = await supabase.from('booking_documents').insert({
      id: documentId, tenant_id: tenant, booking_id: body.booking_id,
      source: 'upload', doc_type: body.doc_type, label: body.label.trim(),
      storage_path: storagePath, original_filename: v.meta.filename,
      mime_type: v.meta.mime_type, file_size: v.meta.file_size,
      url: null, active: false, created_by_user_id: session.user_id
    }).select('id').single();
    if (ins.error || !ins.data) {
      logServer('doc-upload-url', 'insert: ' + ((ins.error && ins.error.message) || 'no row'));
      // La fila no se creó → intentar limpiar el slot de Storage no es posible
      // aún (nada se subió). Se informa STORAGE_NOT_READY (típico: 0020 sin aplicar).
      return sendError(res, 503, 'STORAGE_NOT_READY', 'Document storage is not available yet');
    }

    await recordAudit(session, {
      action: 'document.upload_start', entity_type: 'booking', entity_id: body.booking_id, always: true,
      before: null, after: { document_id: documentId, doc_type: body.doc_type, label: body.label.trim(), file_size: v.meta.file_size }
    });

    return sendJson(res, 200, {
      document_id: documentId,
      signed_url: signed.data.signedUrl,
      token: signed.data.token || null,
      path: storagePath,
      filename: v.meta.filename,
      mime_type: v.meta.mime_type
    });
  } catch (err) {
    logServer('doc-upload-url', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
