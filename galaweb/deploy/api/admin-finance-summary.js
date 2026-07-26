'use strict';

/* =========================================================
   GET /api/admin-finance-summary
   ---------------------------------------------------------
   Resumen de ingresos. SOLO owner y admin — staff recibe 403.

   FECHA CONTABLE: filtra y agrupa por `sold_at` (el momento en que
   entró el dinero), NUNCA por booking_date (la fecha del tour).
   Los parámetros date_from / date_to son FECHAS DE VENTA (caja) y se
   convierten a instantes usando la zona horaria de Galápagos (UTC-6).

   Cuenta únicamente request_type='booking' y payment_status='paid':
   quedan fuera pending, processing, failed, refunded y las cotizaciones.

   La suma se hace EN EL SERVIDOR: al navegador solo viajan los totales,
   nunca el conjunto de reservas.
   ========================================================= */

const { sendJson, sendError, logServer, isRealYmd, getTenantId } = require('./_lib/http');
const { getSupabase } = require('./_lib/supabase');
const { requireAdmin } = require('./_lib/admin-auth');

const METHODS = ['stripe', 'cash', 'card', 'bank_transfer', 'zelle', 'other'];
const CHANNELS = ['web', 'agency'];
const MAX_PAGES = 20;          // hasta 2.000 registros por consulta
const PAGE_SIZE = 100;

/* Galápagos es UTC-6 fijo (sin horario de verano). El día contable
   [date, date] local equivale a [dateT06:00Z, (date+1)T06:00Z). */
const GAL_OFFSET_HOURS = 6;
function startInstant(ymd) { return ymd + 'T0' + GAL_OFFSET_HOURS + ':00:00.000Z'; }
function endInstantExclusive(ymd) {
  const p = String(ymd).split('-');
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10) + 'T0' + GAL_OFFSET_HOURS + ':00:00.000Z';
}
function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try { const u = new URL(req.url, 'http://localhost'); const o = {}; u.searchParams.forEach(function (v, k) { o[k] = v; }); return o; }
  catch (e) { return {}; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }

  // Información financiera: solo owner y admin. staff → 403 FORBIDDEN.
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('finance-summary', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to build the summary'); }

  const q = getQuery(req);
  const date_from = q.date_from, date_to = q.date_to;
  if (date_from && !isRealYmd(date_from)) return sendError(res, 400, 'INVALID_FILTER', 'Invalid date_from');
  if (date_to && !isRealYmd(date_to)) return sendError(res, 400, 'INVALID_FILTER', 'Invalid date_to');
  if (q.channel && CHANNELS.indexOf(q.channel) === -1) return sendError(res, 400, 'INVALID_FILTER', 'Invalid channel');
  if (q.payment_method && METHODS.indexOf(q.payment_method) === -1) return sendError(res, 400, 'INVALID_FILTER', 'Invalid payment_method');
  if (q.created_by && typeof q.created_by !== 'string') return sendError(res, 400, 'INVALID_FILTER', 'Invalid created_by');

  try {
    const supabase = getSupabase();
    const rows = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      let query = supabase.from('bookings')
        .select('amount_cents,sales_channel,payment_method')     // solo lo necesario para sumar
        .eq('tenant_id', tenant)
        .eq('request_type', 'booking')
        .eq('payment_status', 'paid');

      if (date_from) query = query.gte('sold_at', startInstant(date_from));
      if (date_to) query = query.lt('sold_at', endInstantExclusive(date_to));
      if (q.channel) query = query.eq('sales_channel', q.channel);
      if (q.payment_method) query = query.eq('payment_method', q.payment_method);
      if (q.created_by) query = query.eq('created_by_user_id', q.created_by);

      query = query.order('sold_at', { ascending: true }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      const { data, error } = await query;
      if (error) { logServer('finance-summary', error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to build the summary'); }
      const batch = data || [];
      rows.push.apply(rows, batch);
      if (batch.length < PAGE_SIZE) break;
    }

    const revenue = { web: 0, agency: 0, total: 0 };
    const counts = { web: 0, agency: 0, total: 0 };
    const by_method = {};
    METHODS.forEach(function (m) { by_method[m] = { amount_cents: 0, count: 0 }; });

    rows.forEach(function (r) {
      const amt = Number(r.amount_cents) || 0;
      const ch = r.sales_channel === 'agency' ? 'agency' : 'web';
      revenue[ch] += amt; revenue.total += amt;
      counts[ch] += 1; counts.total += 1;
      const m = METHODS.indexOf(r.payment_method) !== -1 ? r.payment_method : 'other';
      by_method[m].amount_cents += amt; by_method[m].count += 1;
    });

    return sendJson(res, 200, {
      basis: 'sold_at',                       // fecha de venta/caja, no del tour
      range: { date_from: date_from || null, date_to: date_to || null },
      currency: 'usd',
      revenue: revenue,
      counts: counts,
      by_method: by_method
    });
  } catch (err) {
    logServer('finance-summary', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to build the summary');
  }
};
