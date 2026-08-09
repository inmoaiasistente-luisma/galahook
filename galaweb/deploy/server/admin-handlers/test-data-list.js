'use strict';

/* =========================================================
   GET /api/admin-test-data-list   (action=test-data-list)
   ---------------------------------------------------------
   SOLO owner. Lista reservas candidatas a marcar/archivar como
   datos de prueba. admin y staff → 403.

   Por defecto EXCLUYE archivadas (deleted_at IS NULL). Con
   include_archived=only muestra solo archivadas; =true, todas.
   Nunca devuelve secretos, metadata, client_request_id ni QR.
   ========================================================= */

const { sendJson, sendError, logServer, isRealYmd, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireAdmin } = require('../lib/admin-auth');

const FIELDS = 'id,booking_code,customer_name,customer_email,tour_name,request_type,booking_date,' +
  'created_at,sales_channel,payment_status,booking_status,amount_cents,is_test,deleted_at,deletion_reason';

const REQUEST_TYPES = ['booking', 'quote'];
const PAYMENT_STATUSES = ['not_required', 'pending', 'processing', 'paid', 'failed', 'refunded'];
const SALES_CHANNELS = ['web', 'agency'];
const MAX_LIMIT = 100;
const MAX_SEARCH = 100;

function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try { const u = new URL(req.url, 'http://localhost'); const o = {}; u.searchParams.forEach(function (v, k) { o[k] = v; }); return o; }
  catch (e) { return {}; }
}
function sanitizeSearch(s) {
  // Allowlist (más robusta que un denylist de metacaracteres): solo alfanuméricos,
  // acentos y @._- ; el resto se descarta. Imposibilita el breakout de un filtro .or().
  return String(s || '').replace(/[^0-9A-Za-zÀ-ÿ @._-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }
  const session = await requireAdmin(req, res, ['owner']);   // SOLO owner
  if (!session) return;

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('test-data-list', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  const q = getQuery(req);

  let page = parseInt(q.page, 10); if (!Number.isInteger(page) || page < 1) page = 1;
  let limit = parseInt(q.limit, 10); if (!Number.isInteger(limit) || limit < 1) limit = 25; if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  const request_type = q.request_type, payment_status = q.payment_status, sales_channel = q.sales_channel;
  if (request_type && REQUEST_TYPES.indexOf(request_type) === -1) return sendError(res, 400, 'INVALID_FILTER', 'Invalid request_type');
  if (payment_status && PAYMENT_STATUSES.indexOf(payment_status) === -1) return sendError(res, 400, 'INVALID_FILTER', 'Invalid payment_status');
  if (sales_channel && SALES_CHANNELS.indexOf(sales_channel) === -1) return sendError(res, 400, 'INVALID_FILTER', 'Invalid sales_channel');

  const date_from = q.date_from, date_to = q.date_to;
  if (date_from && !isRealYmd(date_from)) return sendError(res, 400, 'INVALID_FILTER', 'Invalid date_from');
  if (date_to && !isRealYmd(date_to)) return sendError(res, 400, 'INVALID_FILTER', 'Invalid date_to');

  const is_test = q.is_test;   // 'true' | 'false' | undefined
  if (is_test !== undefined && is_test !== 'true' && is_test !== 'false') return sendError(res, 400, 'INVALID_FILTER', 'Invalid is_test');
  const include_archived = q.include_archived;   // undefined(=exclude) | 'true'(=all) | 'only'
  if (include_archived !== undefined && include_archived !== 'true' && include_archived !== 'only' && include_archived !== 'false') {
    return sendError(res, 400, 'INVALID_FILTER', 'Invalid include_archived');
  }

  const search = sanitizeSearch(q.search);

  try {
    const supabase = getSupabase();
    let query = supabase.from('bookings').select(FIELDS, { count: 'exact' }).eq('tenant_id', tenant);

    if (include_archived === 'only') query = query.not('deleted_at', 'is', null);
    else if (include_archived === 'true') { /* sin filtro: activas + archivadas */ }
    else query = query.is('deleted_at', null);

    if (request_type) query = query.eq('request_type', request_type);
    if (payment_status) query = query.eq('payment_status', payment_status);
    if (sales_channel) query = query.eq('sales_channel', sales_channel);
    if (is_test === 'true') query = query.eq('is_test', true);
    if (is_test === 'false') query = query.eq('is_test', false);
    if (date_from) query = query.gte('booking_date', date_from);
    if (date_to) query = query.lte('booking_date', date_to);
    if (search) {
      query = query.or(
        'booking_code.ilike.%' + search + '%,customer_name.ilike.%' + search +
        '%,customer_email.ilike.%' + search + '%,tour_name.ilike.%' + search + '%'
      );
    }
    query = query.order('created_at', { ascending: false });
    const fromIdx = (page - 1) * limit;
    query = query.range(fromIdx, fromIdx + limit - 1);

    const { data, error, count } = await query;
    if (error) { logServer('test-data-list', error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

    const total = count || 0;
    return sendJson(res, 200, {
      role: session.role,
      rows: data || [],
      pagination: { page: page, limit: limit, total: total, totalPages: Math.max(1, Math.ceil(total / limit)) }
    });
  } catch (err) {
    logServer('test-data-list', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
