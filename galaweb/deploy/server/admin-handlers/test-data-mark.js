'use strict';

/* =========================================================
   POST /api/admin-test-data-mark   (action=test-data-mark)
   body: { booking_ids: [...], confirmation: "MARK AS TEST" }
   ---------------------------------------------------------
   SOLO owner. Marca reservas como datos de prueba:
     is_test=true, test_marked_at=now(), test_marked_by_user_id=owner.
   NO archiva. NO marca filas ya archivadas. Todas deben pertenecer
   al TENANT_ID. El navegador no elige tenant, usuario ni fecha.
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, isUuid, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireAdmin, sameOrigin } = require('../lib/admin-auth');

const CONFIRM = 'MARK AS TEST';
const MAX_IDS = 200;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireAdmin(req, res, ['owner']);   // SOLO owner
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('test-data-mark', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ['booking_ids', 'confirmation'])) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (body.confirmation !== CONFIRM) return sendError(res, 400, 'INVALID_CONFIRMATION', 'Confirmation text does not match');

  const ids = body.booking_ids;
  if (!Array.isArray(ids) || ids.length < 1) return sendError(res, 400, 'INVALID_IDS', 'booking_ids is required');
  if (ids.length > MAX_IDS) return sendError(res, 400, 'TOO_MANY_IDS', 'Too many booking_ids in one request');
  if (!ids.every(isUuid)) return sendError(res, 400, 'INVALID_IDS', 'booking_ids must be UUIDs');
  const unique = Array.from(new Set(ids));

  try {
    const supabase = getSupabase();
    /* Verifica que TODAS existan, sean del tenant y NO estén archivadas. */
    const check = await supabase.from('bookings').select('id,deleted_at')
      .eq('tenant_id', tenant).in('id', unique);
    if (check.error) { logServer('test-data-mark', check.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    const rows = check.data || [];
    if (rows.length !== unique.length) return sendError(res, 400, 'INVALID_IDS', 'Some bookings do not belong to this tenant');
    if (rows.some(function (r) { return r.deleted_at; })) return sendError(res, 409, 'ALREADY_ARCHIVED', 'Cannot mark an archived booking');

    const now = new Date().toISOString();
    const upd = await supabase.from('bookings')
      .update({ is_test: true, test_marked_at: now, test_marked_by_user_id: session.user_id })
      .eq('tenant_id', tenant).in('id', unique).is('deleted_at', null).select('id');
    if (upd.error) { logServer('test-data-mark', upd.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

    const marked = (upd.data || []).length;
    logServer('test-data-mark', 'marked=' + marked + ' by=' + session.user_id);   // sin datos sensibles
    return sendJson(res, 200, { marked: marked });
  } catch (err) {
    logServer('test-data-mark', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
