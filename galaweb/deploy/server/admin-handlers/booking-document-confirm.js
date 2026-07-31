'use strict';

/* =========================================================
   POST /api/admin-booking-document-confirm
   (action=booking-document-confirm)
   ---------------------------------------------------------
   Paso 2 de la subida: el navegador ya subió el archivo a la URL firmada.
   Aquí se verifica que el objeto EXISTE en Storage y se marca la fila como
   activa. Si el objeto no está (la subida falló a mitad), se descarta la fila
   pendiente por baja lógica y se responde error. Solo owner.

   Body: { document_id }
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, getTenantId, isUuid } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireWriter, sameOrigin } = require('../lib/admin-auth');
const { recordAudit } = require('../lib/admin-audit');
const docs = require('../lib/booking-documents');

const ALLOWED_KEYS = ['document_id'];

/* Comprueba que el objeto existe listando su carpeta y buscando el nombre. */
async function objectExists(supabase, storagePath) {
  const slash = storagePath.lastIndexOf('/');
  const dir = slash > 0 ? storagePath.slice(0, slash) : '';
  const name = slash > 0 ? storagePath.slice(slash + 1) : storagePath;
  try {
    const { data, error } = await supabase.storage.from(docs.BUCKET).list(dir, { limit: 100, search: name });
    if (error) return false;
    return (data || []).some(function (o) { return o && o.name === name; });
  } catch (e) { return false; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireWriter(req, res);        // SOLO owner
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('doc-confirm', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!isUuid(body.document_id)) return sendError(res, 400, 'INVALID_DOCUMENT', 'document_id must be a UUID');

  try {
    const supabase = getSupabase();
    const dq = await supabase.from('booking_documents')
      .select('id,booking_id,storage_path,label,doc_type,source')
      .eq('id', body.document_id).eq('tenant_id', tenant).maybeSingle();
    if (dq.error) { logServer('doc-confirm', dq.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    if (!dq.data) return sendError(res, 404, 'NOT_FOUND', 'Document not found');
    if (dq.data.source !== 'upload' || !dq.data.storage_path) return sendError(res, 400, 'NOT_AN_UPLOAD', 'This document is not an upload');

    const exists = await objectExists(supabase, dq.data.storage_path);
    if (!exists) {
      // La subida no llegó: se descarta la fila pendiente (baja lógica).
      await supabase.from('booking_documents').update({ active: false }).eq('id', body.document_id).eq('tenant_id', tenant);
      return sendError(res, 409, 'UPLOAD_NOT_FOUND', 'The uploaded file was not found');
    }

    const upd = await supabase.from('booking_documents')
      .update({ active: true, uploaded_at: new Date().toISOString() })
      .eq('id', body.document_id).eq('tenant_id', tenant)
      .select('id,doc_type,label,original_filename,mime_type,file_size,created_at,uploaded_at').single();
    if (upd.error || !upd.data) { logServer('doc-confirm', (upd.error && upd.error.message) || 'update'); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

    await recordAudit(session, {
      action: 'document.upload_confirm', entity_type: 'booking', entity_id: dq.data.booking_id, always: true,
      before: null, after: { document_id: body.document_id, label: dq.data.label, doc_type: dq.data.doc_type }
    });

    return sendJson(res, 200, { confirmed: true, document: upd.data });
  } catch (err) {
    logServer('doc-confirm', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
