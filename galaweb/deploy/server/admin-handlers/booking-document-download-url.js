'use strict';

/* =========================================================
   GET /api/admin-booking-document-download-url?document_id=…
   (action=booking-document-download-url)
   ---------------------------------------------------------
   Devuelve una URL FIRMADA de corta duración para ver o descargar un
   documento subido (o el enlace externo, si el documento es de tipo enlace).
   Nunca expone la ruta interna de Storage: el cliente solo recibe una URL
   firmada temporal.

   Roles: owner y admin ven todo; el staff NO puede ver documentos con dinero
   (recibos). La restricción se aplica en el servidor.

   Query: { document_id }
   ========================================================= */

const { sendJson, sendError, logServer, getTenantId, isUuid } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireAdmin } = require('../lib/admin-auth');
const docs = require('../lib/booking-documents');

const SIGN_TTL = 120;   // segundos de validez de la URL firmada

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin', 'staff']);
  if (!session) return;

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('doc-download-url', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  const q = req.query || {};
  if (!isUuid(q.document_id)) return sendError(res, 400, 'INVALID_DOCUMENT', 'document_id must be a UUID');

  try {
    const supabase = getSupabase();
    const dq = await supabase.from('booking_documents')
      .select('id,doc_type,label,url,source,storage_path,original_filename,active')
      .eq('id', q.document_id).eq('tenant_id', tenant).maybeSingle();
    if (dq.error) { logServer('doc-download-url', dq.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    if (!dq.data || dq.data.active !== true) return sendError(res, 404, 'NOT_FOUND', 'Document not found');

    // El staff nunca ve documentos financieros.
    if (session.role === 'staff' && docs.STAFF_HIDDEN_DOCS.indexOf(dq.data.doc_type) !== -1) {
      return sendError(res, 403, 'FORBIDDEN', 'Forbidden');
    }

    if (dq.data.source === 'link') {
      return sendJson(res, 200, { url: dq.data.url, filename: dq.data.label, kind: 'link' });
    }

    if (!dq.data.storage_path) return sendError(res, 404, 'NOT_FOUND', 'Document not found');
    let signed;
    try { signed = await supabase.storage.from(docs.BUCKET).createSignedUrl(dq.data.storage_path, SIGN_TTL); }
    catch (e) { signed = { error: e }; }
    if (!signed || signed.error || !signed.data || !signed.data.signedUrl) {
      logServer('doc-download-url', 'sign: ' + ((signed && signed.error && signed.error.message) || 'no url'));
      return sendError(res, 503, 'STORAGE_NOT_READY', 'Document storage is not available');
    }

    return sendJson(res, 200, { url: signed.data.signedUrl, filename: dq.data.original_filename || dq.data.label, kind: 'upload', expires_in: SIGN_TTL });
  } catch (err) {
    logServer('doc-download-url', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
