'use strict';

/* =========================================================
   /api/reviews — reseñas del sitio público
     GET   últimas reseñas publicadas + nota de Google
     POST  { client_key, rating, name, text?, lang, opened_google?, company? }
   ---------------------------------------------------------
   Endpoint PÚBLICO. Toda reseña entra como 'pending': nada se muestra hasta
   que el owner la publica en el panel. El GET devuelve solo campos públicos.

   client_key lo genera el navegador. Repetir el POST con la misma clave no
   crea otra fila ni cambia el texto; solo puede marcar opened_google.

   Defensa: sameOrigin + honeypot 'company' + rate-limit por IP hasheada
   (fail-open) + claves desconocidas rechazadas. No guarda IP.
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, getTenantId, clientIp } = require('../server/lib/http');
const { getSupabase } = require('../server/lib/supabase');
const { sameOrigin } = require('../server/lib/admin-auth');
const { checkRateLimit } = require('../server/lib/rate-limit');
const { PUBLIC_FIELDS, PUBLIC_LIMIT, validateSubmission, toPublicReview, rateBucket, isMissingTable } = require('../server/lib/reviews');

const ALLOWED_KEYS = ['client_key', 'rating', 'name', 'text', 'lang', 'opened_google', 'company'];
const CACHE = 'public, s-maxage=60, stale-while-revalidate=300';

async function listPublished(res) {
  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('reviews', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  try {
    const supabase = getSupabase();
    const list = await supabase.from('reviews')
      .select(PUBLIC_FIELDS)
      .eq('tenant_id', tenant).eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(PUBLIC_LIMIT);
    if (list.error) {
      if (isMissingTable(list.error)) return sendJson(res, 200, { ready: false, reviews: [], google: null });
      logServer('reviews', list.error.message);
      return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
    }

    const st = await supabase.from('review_settings')
      .select('google_rating,google_count').eq('tenant_id', tenant).maybeSingle();
    if (st.error) logServer('reviews', st.error.message);   // la nota es secundaria: las reseñas salen igual
    const s = st.data;
    const google = s && s.google_rating != null && s.google_count != null
      ? { rating: Number(s.google_rating), count: s.google_count } : null;

    res.setHeader('Cache-Control', CACHE);
    return sendJson(res, 200, { ready: true, reviews: (list.data || []).map(toPublicReview), google: google });
  } catch (err) {
    logServer('reviews', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
}

async function submit(req, res) {
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON body'); }
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected field');

  // Honeypot: fingimos éxito para no enseñarle nada al bot.
  if (typeof body.company === 'string' && body.company.trim() !== '') return sendJson(res, 200, { ok: true });

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('reviews', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  // Holgado: en una lancha o un hotel varios pasajeros comparten la misma IP.
  try {
    const rl = await checkRateLimit({ tenant: tenant, bucketKey: rateBucket(clientIp(req.headers || {})), limit: 12, windowSeconds: 600 });
    if (rl && rl.allowed === false) {
      if (rl.retryAfter) res.setHeader('Retry-After', String(rl.retryAfter));
      return sendError(res, 429, 'RATE_LIMITED', 'Too many reviews, please try again later');
    }
  } catch (e) { /* fail-open */ }

  const v = validateSubmission(body);
  if (!v.ok) return sendError(res, 400, v.code, v.message);

  try {
    const supabase = getSupabase();
    const ins = await supabase.from('reviews').insert(Object.assign({ tenant_id: tenant }, v.row));
    if (!ins.error) return sendJson(res, 201, { ok: true });
    if (ins.error.code !== '23505') {
      logServer('reviews', ins.error.message);
      return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
    }

    // Misma clave: es un reintento. Solo puede encender opened_google.
    if (v.row.opened_google) {
      const upd = await supabase.from('reviews').update({ opened_google: true })
        .eq('tenant_id', tenant).eq('client_key', v.row.client_key);
      if (upd.error) logServer('reviews', upd.error.message);
    }
    return sendJson(res, 200, { ok: true });
  } catch (err) {
    logServer('reviews', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') return listPublished(res);
  if (req.method === 'POST') return submit(req, res);
  res.setHeader('Allow', 'GET, POST');
  return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET and POST are allowed');
};
