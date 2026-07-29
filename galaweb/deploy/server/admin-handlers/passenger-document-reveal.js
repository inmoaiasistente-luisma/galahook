'use strict';

/* =========================================================
   POST /api/admin-passenger-document-reveal
        (action=passenger-document-reveal)
   ---------------------------------------------------------
   Revela el número de documento en claro. owner/admin (staff → 403).
   Exige: sameOrigin, motivo obligatorio y escritura EXITOSA de auditoría.
   Si no se puede auditar, NO se revela. El AAD liga el ciphertext al
   pasajero: descifrar falla si el dato fue movido a otro pasajero/tenant.
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, isUuid, isNonEmptyString, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireAdmin, sameOrigin } = require('../lib/admin-auth');
const { decryptDocumentNumber } = require('../lib/passenger-crypto');
const { writeDocumentAudit, clientIpMasked } = require('../lib/passenger-audit');

const ALLOWED_KEYS = ['passenger_id', 'reason'];
const MAX_REASON = 500;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('doc-reveal', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!isUuid(body.passenger_id)) return sendError(res, 400, 'INVALID_PASSENGER_ID', 'passenger_id must be a UUID');
  if (!isNonEmptyString(body.reason, 3, MAX_REASON)) return sendError(res, 400, 'REASON_REQUIRED', 'A reason is required to reveal a document');

  const ip = clientIpMasked(req);
  const userAgent = (req.headers && req.headers['user-agent']) || '';

  try {
    const supabase = getSupabase();

    const pq = await supabase.from('booking_passengers').select('*')
      .eq('id', body.passenger_id).eq('tenant_id', tenant).maybeSingle();
    if (pq.error) { logServer('doc-reveal', pq.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    if (!pq.data) return sendError(res, 404, 'NOT_FOUND', 'Passenger not found');
    const p = pq.data;

    if (!p.document_number_ciphertext) return sendJson(res, 200, { has_document: false, document_number: null });

    // booking_id para la auditoría (via el formulario padre).
    let bookingId = null;
    try {
      const fq = await supabase.from('booking_passenger_forms').select('booking_id')
        .eq('id', p.passenger_form_id).eq('tenant_id', tenant).maybeSingle();
      bookingId = fq.data ? fq.data.booking_id : null;
    } catch (e) { /* no bloquea */ }

    const aad = {
      tenant_id: p.tenant_id, passenger_form_id: p.passenger_form_id,
      passenger_number: p.passenger_number, document_type: p.document_type
    };

    let plain;
    try {
      plain = decryptDocumentNumber(p, aad);
    } catch (e) {
      logServer('doc-reveal', 'decrypt failed');
      try {
        await writeDocumentAudit({
          tenant: tenant, passengerId: p.id, formId: p.passenger_form_id, bookingId: bookingId,
          userId: session.user_id, role: session.role, action: 'decrypt_failed',
          reason: body.reason, result: 'failure', ip: ip, userAgent: userAgent
        });
      } catch (e2) { /* best-effort */ }
      return sendError(res, 500, 'DECRYPT_FAILED', 'Unable to decrypt the document');
    }

    // Auditoría OBLIGATORIA antes de revelar: si falla, no se revela.
    try {
      await writeDocumentAudit({
        tenant: tenant, passengerId: p.id, formId: p.passenger_form_id, bookingId: bookingId,
        userId: session.user_id, role: session.role, action: 'reveal',
        reason: body.reason, result: 'success', ip: ip, userAgent: userAgent
      });
    } catch (e) {
      logServer('doc-reveal', 'audit write failed — reveal aborted');
      return sendError(res, 500, 'AUDIT_FAILED', 'Unable to record access audit; reveal aborted');
    }

    return sendJson(res, 200, { has_document: true, document_number: plain, document_type: p.document_type });
  } catch (err) {
    logServer('doc-reveal', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
