'use strict';

/* =========================================================
   GET /api/admin-reviews   (action=reviews-list)
   ---------------------------------------------------------
   Panel "Reseñas". Lo ven OWNER y ADMIN; staff → 403. Filtro opcional
   por status. Devuelve conteos para pestañas e insignia, la nota de Google
   y si la traducción automática está disponible. Nunca devuelve client_key.

   Las reseñas sin texto no se pueden publicar ni rechazar por su nota, así
   que van aparte (rating_only) y no cuentan como trabajo pendiente.

   Tolerante: sin la migración 0026 responde ready:false.
   ========================================================= */

const { sendJson, sendError, logServer, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireOwnerOrAdmin } = require('../lib/admin-auth');
const { STATUSES, isMissingTable } = require('../lib/reviews');
const { isConfigured } = require('../lib/review-translate');

const FIELDS = 'id,created_at,rating,body,author_name,lang,opened_google,status,translation,trip,reject_reason,handled_by,handled_at,published_at';
const FILTERS = STATUSES.concat(['rating_only']);
const MAX_ROWS = 100;

function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try { const u = new URL(req.url, 'http://localhost'); const o = {}; u.searchParams.forEach(function (v, k) { o[k] = v; }); return o; }
  catch (e) { return {}; }
}

function notReady(role) {
  return { ready: false, role: role, rows: [], counts: { pending: 0, published: 0, rejected: 0, rating_only: 0, total: 0, opened_google: 0 }, settings: null, translate_ready: false };
}

/* Aplica la pestaña elegida a una consulta de reviews. */
function applyFilter(query, filter) {
  if (filter === 'rating_only') return query.eq('status', 'pending').is('body', null);
  if (filter === 'pending') return query.eq('status', 'pending').not('body', 'is', null);
  return query.eq('status', filter);
}

async function count(query) {
  const r = await query;
  if (r.error) throw r.error;
  return r.count || 0;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }
  const session = await requireOwnerOrAdmin(req, res);
  if (!session) return;

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('reviews-list', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  const q = getQuery(req);
  const filter = q.status;
  if (filter !== undefined && FILTERS.indexOf(filter) === -1) return sendError(res, 400, 'INVALID_FILTER', 'Invalid status');

  try {
    const supabase = getSupabase();
    const heads = function () { return supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant); };
    const nums = await Promise.all(FILTERS.map(function (f) { return count(applyFilter(heads(), f)); })
      .concat(count(heads().eq('opened_google', true))));

    let query = supabase.from('reviews').select(FIELDS).eq('tenant_id', tenant);
    if (filter) query = applyFilter(query, filter);
    let limit = parseInt(q.limit, 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ROWS) limit = MAX_ROWS;
    const list = await query.order('created_at', { ascending: false }).limit(limit);
    if (list.error) throw list.error;

    const st = await supabase.from('review_settings')
      .select('google_rating,google_count,updated_at').eq('tenant_id', tenant).maybeSingle();
    if (st.error) throw st.error;

    return sendJson(res, 200, {
      ready: true,
      role: session.role,
      rows: list.data || [],
      counts: {
        pending: nums[0], published: nums[1], rejected: nums[2], rating_only: nums[3],
        total: nums[0] + nums[1] + nums[2] + nums[3], opened_google: nums[4]
      },
      settings: st.data || null,
      translate_ready: isConfigured()
    });
  } catch (err) {
    if (isMissingTable(err)) return sendJson(res, 200, notReady(session.role));
    logServer('reviews-list', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
