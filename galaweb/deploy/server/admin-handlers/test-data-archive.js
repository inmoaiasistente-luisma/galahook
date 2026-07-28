'use strict';

/* =========================================================
   POST /api/admin-test-data-archive   (action=test-data-archive)
   body: { booking_ids:[...], reason, confirmation:"ARCHIVE TEST DATA" }
   ---------------------------------------------------------
   SOLO owner. Borrado LÓGICO (nunca DELETE) de reservas de prueba:
     deleted_at=now(), deleted_by_user_id=owner, deletion_reason=reason.

   Reglas:
   · confirmation exacta "ARCHIVE TEST DATA".
   · reason >= 5 caracteres.
   · TODAS deben ser is_test=true y NO estar ya archivadas; si alguna
     no cumple, se rechaza TODO el lote (no hay archivado parcial).
   · No modifica payment_status, booking_status, amount_cents, Stripe,
     sold_at ni paid_at.
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, isUuid, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireAdmin, sameOrigin } = require('../lib/admin-auth');

const CONFIRM = 'ARCHIVE TEST DATA';
const MAX_IDS = 200;
const MIN_REASON = 5;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireAdmin(req, res, ['owner']);   // SOLO owner
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('test-data-archive', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ['booking_ids', 'reason', 'confirmation'])) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (body.confirmation !== CONFIRM) return sendError(res, 400, 'INVALID_CONFIRMATION', 'Confirmation text does not match');

  const reason = (typeof body.reason === 'string') ? body.reason.trim() : '';
  if (reason.length < MIN_REASON) return sendError(res, 400, 'INVALID_REASON', 'A reason of at least 5 characters is required');

  const ids = body.booking_ids;
  if (!Array.isArray(ids) || ids.length < 1) return sendError(res, 400, 'INVALID_IDS', 'booking_ids is required');
  if (ids.length > MAX_IDS) return sendError(res, 400, 'TOO_MANY_IDS', 'Too many booking_ids in one request');
  if (!ids.every(isUuid)) return sendError(res, 400, 'INVALID_IDS', 'booking_ids must be UUIDs');
  const unique = Array.from(new Set(ids));

  try {
    const supabase = getSupabase();
    /* Verificación estricta ANTES de tocar nada. */
    const check = await supabase.from('bookings').select('id,is_test,deleted_at')
      .eq('tenant_id', tenant).in('id', unique);
    if (check.error) { logServer('test-data-archive', check.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    const rows = check.data || [];
    if (rows.length !== unique.length) return sendError(res, 400, 'INVALID_IDS', 'Some bookings do not belong to this tenant');
    if (rows.some(function (r) { return r.deleted_at; })) return sendError(res, 409, 'ALREADY_ARCHIVED', 'Some bookings are already archived');
    if (rows.some(function (r) { return r.is_test !== true; })) {
      return sendError(res, 409, 'NOT_TEST', 'All bookings must be marked as test before archiving');
    }

    const now = new Date().toISOString();
    const upd = await supabase.from('bookings')
      .update({ deleted_at: now, deleted_by_user_id: session.user_id, deletion_reason: reason })
      .eq('tenant_id', tenant).in('id', unique).eq('is_test', true).is('deleted_at', null).select('id');
    if (upd.error) { logServer('test-data-archive', upd.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

    const archived = (upd.data || []).length;
    logServer('test-data-archive', 'archived=' + archived + ' by=' + session.user_id);   // sin datos sensibles
    return sendJson(res, 200, { archived: archived });
  } catch (err) {
    logServer('test-data-archive', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
