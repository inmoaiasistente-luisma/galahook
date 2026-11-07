'use strict';

/* =========================================================
   POST /api/admin-review-translate  (action=review-translate)
   body: { id }
   ---------------------------------------------------------
   Traduce una reseña pendiente y guarda el resultado como borrador que el
   owner revisa. Solo owner: nunca desde el endpoint público, para que un
   visitante no pueda gastar la API. Cada reseña se traduce una sola vez.
   Sin ANTHROPIC_API_KEY responde configured:false y el owner la escribe a mano.
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, isUuid, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireWriter, sameOrigin } = require('../lib/admin-auth');
const { isConfigured, translateReview } = require('../lib/review-translate');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireWriter(req, res);
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('review-translate', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ['id'])) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!isUuid(body.id)) return sendError(res, 400, 'INVALID_ID', 'id must be a UUID');

  try {
    const supabase = getSupabase();
    const cur = await supabase.from('reviews').select('id,status,body,lang,translation')
      .eq('tenant_id', tenant).eq('id', body.id).maybeSingle();
    if (cur.error) { logServer('review-translate', cur.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    if (!cur.data) return sendError(res, 404, 'NOT_FOUND', 'Review not found');

    const row = cur.data;
    if (row.translation) return sendJson(res, 200, { ok: true, configured: true, translation: row.translation });
    if (row.status !== 'pending' || !row.body) return sendError(res, 409, 'NOT_TRANSLATABLE', 'Only pending reviews with text are translated');
    if (!isConfigured()) return sendJson(res, 200, { ok: true, configured: false, translation: null });

    const out = await translateReview({ text: row.body, lang: row.lang });
    if (!out.ok) return sendError(res, 502, 'TRANSLATE_FAILED', 'Translation failed');

    // Si el owner la publicó mientras tanto, su versión manda.
    const upd = await supabase.from('reviews').update({ translation: out.text })
      .eq('tenant_id', tenant).eq('id', body.id).eq('status', 'pending');
    if (upd.error) { logServer('review-translate', upd.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

    return sendJson(res, 200, { ok: true, configured: true, translation: out.text });
  } catch (err) {
    logServer('review-translate', 'unexpected failure');
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
