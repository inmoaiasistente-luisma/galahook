'use strict';

/* =========================================================
   POST /api/admin-review-update  (action=review-update)
   body: { id, action: 'publish'|'reject'|'pending', trip?, reason? }
   ---------------------------------------------------------
   Solo el OWNER modera (requireWriter). El texto del pasajero no se toca:
   'body' no es un campo aceptado aquí. Una nota baja no es motivo de
   rechazo: solo spam, insultos, datos de terceros o quien no fue pasajero.
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, isUuid, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireWriter, sameOrigin } = require('../lib/admin-auth');
const { recordAudit } = require('../lib/admin-audit');
const { TRIPS, REJECT_REASONS } = require('../lib/reviews');

const ALLOWED_KEYS = ['id', 'action', 'trip', 'reason'];
const ACTIONS = ['publish', 'reject', 'pending'];
const SELECT = 'id,status,body,trip,reject_reason,handled_by,handled_at,published_at';

/** @returns {{patch:object}|{status:number,code:string,message:string}} */
function buildPatch(body, row, session) {
  const now = new Date().toISOString();
  const refuse = function (status, code, message) { return { status: status, code: code, message: message }; };

  if (body.action === 'pending') {
    return { patch: { status: 'pending', reject_reason: null, handled_by: null, handled_at: null, published_at: null } };
  }
  if (row.status !== 'pending') return refuse(409, 'NOT_PENDING', 'Review is not pending');

  if (body.action === 'reject') {
    if (REJECT_REASONS.indexOf(body.reason) === -1) return refuse(400, 'INVALID_REASON', 'Invalid reason');
    return { patch: { status: 'rejected', reject_reason: body.reason, handled_by: session.email, handled_at: now } };
  }

  if (!row.body) return refuse(409, 'RATING_ONLY', 'A review without text cannot be published');
  if (body.trip !== undefined && body.trip !== null && body.trip !== '' && TRIPS.indexOf(body.trip) === -1) {
    return refuse(400, 'INVALID_TRIP', 'Invalid trip');
  }

  return { patch: {
    status: 'published', trip: body.trip || null,
    handled_by: session.email, handled_at: now, published_at: now
  } };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireWriter(req, res);
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('review-update', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!isUuid(body.id)) return sendError(res, 400, 'INVALID_ID', 'id must be a UUID');
  if (ACTIONS.indexOf(body.action) === -1) return sendError(res, 400, 'INVALID_ACTION', 'Invalid action');

  try {
    const supabase = getSupabase();
    const cur = await supabase.from('reviews').select(SELECT).eq('tenant_id', tenant).eq('id', body.id).maybeSingle();
    if (cur.error) { logServer('review-update', cur.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    if (!cur.data) return sendError(res, 404, 'NOT_FOUND', 'Review not found');

    const built = buildPatch(body, cur.data, session);
    if (!built.patch) return sendError(res, built.status, built.code, built.message);

    const upd = await supabase.from('reviews').update(built.patch)
      .eq('tenant_id', tenant).eq('id', body.id).eq('status', cur.data.status)
      .select(SELECT).single();
    if (upd.error) {
      if (upd.error.code === 'PGRST116') return sendError(res, 409, 'NOT_PENDING', 'Review changed, reload the list');
      logServer('review-update', upd.error.message);
      return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
    }

    await recordAudit(session, {
      action: 'review_' + body.action, entity_type: 'review', entity_id: body.id,
      before: { status: cur.data.status, reject_reason: cur.data.reject_reason },
      after: { status: upd.data.status, reject_reason: upd.data.reject_reason },
      always: true
    });
    return sendJson(res, 200, { ok: true, row: upd.data });
  } catch (err) {
    logServer('review-update', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
