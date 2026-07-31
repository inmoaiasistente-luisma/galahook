'use strict';

/* =========================================================
   GET /api/admin-bookings
   ---------------------------------------------------------
   Requiere sesión válida. El comportamiento DIVERGE según el rol
   real leído de public.admin_profiles (nunca del navegador):

     owner / admin → todas las reservas y cotizaciones, todos los
                     filtros y los campos administrativos completos.

     staff         → SOLO request_type=booking + payment_status=paid
                     + booking_status=confirmed (forzado en servidor,
                     ignorando lo que pida el navegador), proyección
                     reducida a 8 campos operativos y, por defecto,
                     desde hoy (Galápagos) en adelante.

   Siempre filtra por tenant_id del servidor.
   ========================================================= */

const { sendJson, sendError, logServer, isRealYmd, todayInGalapagos, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireAdmin } = require('../lib/admin-auth');

/* Campos administrativos (owner/admin). Nunca incluye stripe_payment_intent_id,
   client_request_id ni metadata. */
const ADMIN_FIELDS = 'id,booking_code,request_type,tour_id,tour_name,unit,booking_date,guests,' +
  'customer_name,customer_email,customer_phone,notes,amount_cents,currency,' +
  'payment_status,booking_status,paid_at,created_at,updated_at,' +
  'sales_channel,payment_method,created_by_name,sold_at,is_test';

/* Campos operativos (staff). Sin datos financieros ni internos.
   La restricción va en el SELECT: esos campos NO salen de la base de datos. */
const STAFF_FIELDS = 'booking_code,tour_name,booking_date,guests,' +
  'customer_name,customer_phone,customer_email,notes';

const REQUEST_TYPES = ['booking', 'quote'];
const PAYMENT_STATUSES = ['not_required', 'pending', 'processing', 'paid', 'failed', 'refunded'];
const BOOKING_STATUSES = ['new', 'pending_payment', 'confirmed', 'cancelled', 'completed', 'failed'];
const SORTS = ['newest', 'oldest', 'booking_date_asc', 'booking_date_desc'];
const SALES_CHANNELS = ['web', 'agency'];
const PAYMENT_METHODS = ['stripe', 'cash', 'card', 'bank_transfer', 'zelle', 'other'];
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
function applySort(query, sort) {
  if (sort === 'oldest') return query.order('created_at', { ascending: true });
  if (sort === 'booking_date_asc') return query.order('booking_date', { ascending: true });
  if (sort === 'booking_date_desc') return query.order('booking_date', { ascending: false });
  return query.order('created_at', { ascending: false }); // newest
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }

  const session = await requireAdmin(req, res, ['owner', 'admin', 'staff']);
  if (!session) return; // 401/403 ya enviado

  const isStaff = session.role === 'staff';

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
  const sort = q.sort || (isStaff ? 'booking_date_asc' : 'newest');
  if (request_type && REQUEST_TYPES.indexOf(request_type) === -1) return sendError(res, 400, 'INVALID_FILTER', 'Invalid request_type');
  if (payment_status && PAYMENT_STATUSES.indexOf(payment_status) === -1) return sendError(res, 400, 'INVALID_FILTER', 'Invalid payment_status');
  if (booking_status && BOOKING_STATUSES.indexOf(booking_status) === -1) return sendError(res, 400, 'INVALID_FILTER', 'Invalid booking_status');
  if (SORTS.indexOf(sort) === -1) return sendError(res, 400, 'INVALID_FILTER', 'Invalid sort');

  /* Filtros administrativos de canal. Se ignoran para staff, que nunca ve
     canal, método de pago ni quién registró la venta. */
  const sales_channel = q.sales_channel, payment_method = q.payment_method, created_by = q.created_by;
  if (sales_channel && SALES_CHANNELS.indexOf(sales_channel) === -1) return sendError(res, 400, 'INVALID_FILTER', 'Invalid sales_channel');
  if (payment_method && PAYMENT_METHODS.indexOf(payment_method) === -1) return sendError(res, 400, 'INVALID_FILTER', 'Invalid payment_method');

  // fechas
  const date_from = q.date_from, date_to = q.date_to;
  if (date_from && !isRealYmd(date_from)) return sendError(res, 400, 'INVALID_FILTER', 'Invalid date_from');
  if (date_to && !isRealYmd(date_to)) return sendError(res, 400, 'INVALID_FILTER', 'Invalid date_to');

  const search = sanitizeSearch(q.search);

  try {
    const supabase = getSupabase();
    const fields = isStaff ? STAFF_FIELDS : ADMIN_FIELDS;
    /* Las reservas archivadas (borrado lógico del owner) NO aparecen en el
       panel operativo para ningún rol. Solo se ven en "Datos de prueba". */
    let query = supabase.from('bookings').select(fields, { count: 'exact' })
      .eq('tenant_id', tenant).is('deleted_at', null);

    if (isStaff) {
      /* Filtros BLOQUEADOS: se fuerzan en el servidor. Cualquier valor enviado
         por el navegador para estos tres campos se ignora por completo. */
      query = query.eq('request_type', 'booking')
                   .eq('payment_status', 'paid')
                   .eq('booking_status', 'confirmed');
      /* Por defecto, agenda de hoy en adelante (staff puede consultar fechas pasadas). */
      query = query.gte('booking_date', date_from || todayInGalapagos());
      if (date_to) query = query.lte('booking_date', date_to);
    } else {
      if (request_type) query = query.eq('request_type', request_type);
      if (payment_status) query = query.eq('payment_status', payment_status);
      if (booking_status) query = query.eq('booking_status', booking_status);
      if (date_from) query = query.gte('booking_date', date_from);
      if (date_to) query = query.lte('booking_date', date_to);
      if (sales_channel) query = query.eq('sales_channel', sales_channel);
      if (payment_method) query = query.eq('payment_method', payment_method);
      if (created_by) query = query.eq('created_by_user_id', created_by);
    }

    if (search) {
      query = query.or(
        'booking_code.ilike.%' + search + '%,customer_name.ilike.%' + search +
        '%,customer_email.ilike.%' + search + '%,tour_name.ilike.%' + search + '%'
      );
    }

    query = applySort(query, sort);

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
