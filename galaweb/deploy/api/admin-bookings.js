'use strict';

/* =========================================================
   GET /api/admin-bookings
   ---------------------------------------------------------
   Lista reservas/cotizaciones del tenant, con filtros, búsqueda,
   orden y paginación. Requiere sesión de administrador válida.
   Filtra SIEMPRE por tenant_id del servidor (el navegador nunca
   elige el tenant). Devuelve solo campos necesarios (sin secretos,
   sin client_request_id, sin stripe_payment_intent_id, sin metadata).
   ========================================================= */

const { sendJson, sendError, logServer, isRealYmd, getTenantId } = require('./_lib/http');
const { getSupabase } = require('./_lib/supabase');
const { requireAdmin } = require('./_lib/admin-auth');

const FIELDS = 'id,booking_code,request_type,tour_id,tour_name,unit,booking_date,guests,' +
  'customer_name,customer_email,customer_phone,notes,amount_cents,currency,' +
  'payment_status,booking_status,paid_at,created_at,updated_at';

const REQUEST_TYPES = ['booking', 'quote'];
const PAYMENT_STATUSES = ['not_required', 'pending', 'processing', 'paid', 'failed', 'refunded'];
const BOOKING_STATUSES = ['new', 'pending_payment', 'confirmed', 'cancelled', 'completed', 'failed'];
const SORTS = ['newest', 'oldest', 'booking_date_asc', 'booking_date_desc'];
const MAX_LIMIT = 100;
const MAX_SEARCH = 100;

function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try { const u = new URL(req.url, 'http://localhost'); const o = {}; u.searchParams.forEach(function (v, k) { o[k] = v; }); return o; }
  catch (e) { return {}; }
}
/* Sanitiza el término de búsqueda: quita caracteres que romperían el filtro PostgREST. */
function sanitizeSearch(s) {
  return String(s || '').replace(/[,()%*\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }
  if (!requireAdmin(req, res)) return; // 401 ya enviado

  let tenant;
  try { tenant = getTenantId(); } catch (e) { logServer('admin-bookings', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to load bookings'); }

  const q = getQuery(req);

  // page / limit
  let page = parseInt(q.page, 10); if (!Number.isInteger(page) || page < 1) page = 1;
  let limit = parseInt(q.limit, 10); if (!Number.isInteger(limit) || limit < 1) limit = 25; if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  // filtros enum (valor inválido → 400)
  const request_type = q.request_type;
  const payment_status = q.payment_status;
  const booking_status = q.booking_status;
  const sort = q.sort || 'newest';
  if (request_type && REQUEST_TYPES.indexOf(request_type) === -1) return sendError(res, 400, 'INVALID_FILTER', 'Invalid request_type');
  if (payment_status && PAYMENT_STATUSES.indexOf(payment_status) === -1) return sendError(res, 400, 'INVALID_FILTER', 'Invalid payment_status');
  if (booking_status && BOOKING_STATUSES.indexOf(booking_status) === -1) return sendError(res, 400, 'INVALID_FILTER', 'Invalid booking_status');
  if (SORTS.indexOf(sort) === -1) return sendError(res, 400, 'INVALID_FILTER', 'Invalid sort');

  // fechas
  const date_from = q.date_from, date_to = q.date_to;
  if (date_from && !isRealYmd(date_from)) return sendError(res, 400, 'INVALID_FILTER', 'Invalid date_from');
  if (date_to && !isRealYmd(date_to)) return sendError(res, 400, 'INVALID_FILTER', 'Invalid date_to');

  const search = sanitizeSearch(q.search);

  try {
    const supabase = getSupabase();
    let query = supabase.from('bookings').select(FIELDS, { count: 'exact' }).eq('tenant_id', tenant);

    if (request_type) query = query.eq('request_type', request_type);
    if (payment_status) query = query.eq('payment_status', payment_status);
    if (booking_status) query = query.eq('booking_status', booking_status);
    if (date_from) query = query.gte('booking_date', date_from);
    if (date_to) query = query.lte('booking_date', date_to);
    if (search) {
      query = query.or(
        'booking_code.ilike.%' + search + '%,customer_name.ilike.%' + search +
        '%,customer_email.ilike.%' + search + '%,tour_name.ilike.%' + search + '%'
      );
    }

    if (sort === 'newest') query = query.order('created_at', { ascending: false });
    else if (sort === 'oldest') query = query.order('created_at', { ascending: true });
    else if (sort === 'booking_date_asc') query = query.order('booking_date', { ascending: true });
    else if (sort === 'booking_date_desc') query = query.order('booking_date', { ascending: false });

    const fromIdx = (page - 1) * limit;
    query = query.range(fromIdx, fromIdx + limit - 1);

    const { data, error, count } = await query;
    if (error) { logServer('admin-bookings', error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to load bookings'); }

    const total = count || 0;
    return sendJson(res, 200, {
      bookings: data || [],
      pagination: { page: page, limit: limit, total: total, totalPages: Math.max(1, Math.ceil(total / limit)) }
    });
  } catch (err) {
    logServer('admin-bookings', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to load bookings');
  }
};
