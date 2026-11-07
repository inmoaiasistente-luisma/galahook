'use strict';

/* =========================================================
   POST /api/admin-review-settings-save  (action=review-settings-save)
   body: { google_rating, google_count }
   ---------------------------------------------------------
   El owner actualiza la nota de Google que muestra el sitio. Se escribe a
   mano porque leerla de Google exige su API de pago.
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireWriter, sameOrigin } = require('../lib/admin-auth');

function validRating(v) {
  return typeof v === 'number' && v >= 1 && v <= 5 && Math.abs(v * 10 - Math.round(v * 10)) < 1e-9;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireWriter(req, res);
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('review-settings-save', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ['google_rating', 'google_count'])) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!validRating(body.google_rating)) return sendError(res, 400, 'INVALID_RATING', 'Rating must be 1.0 to 5.0');
  if (!Number.isInteger(body.google_count) || body.google_count < 0) return sendError(res, 400, 'INVALID_COUNT', 'Invalid count');

  try {
    const up = await getSupabase().from('review_settings').upsert({
      tenant_id: tenant, google_rating: body.google_rating, google_count: body.google_count,
      updated_by: session.email, updated_at: new Date().toISOString()
    }, { onConflict: 'tenant_id' });
    if (up.error) { logServer('review-settings-save', up.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    return sendJson(res, 200, { ok: true });
  } catch (err) {
    logServer('review-settings-save', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
