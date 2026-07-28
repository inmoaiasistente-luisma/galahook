'use strict';

/* =========================================================
   GET /api/admin-finance-summary
   ---------------------------------------------------------
   Resumen de ingresos. SOLO owner y admin — staff recibe 403.

   FECHA CONTABLE: filtra y agrupa por la fecha de caja = coalesce(sold_at,
   paid_at), NUNCA por booking_date (la fecha del tour). Los parámetros
   date_from / date_to son FECHAS DE VENTA y se convierten a instantes con
   la zona horaria de Galápagos (UTC-6).

   POR QUÉ coalesce y no solo sold_at: toda reserva pagada tiene paid_at
   (lo escribe el webhook de Stripe y las ventas de agencia). sold_at se
   deriva de paid_at mediante el trigger de la migración 0006, pero las
   reservas web pagadas ANTES de esa migración tienen sold_at = null.
   Filtrar solo por sold_at descartaba esas filas con gte/lt y el resumen
   salía en $0 pese a existir reservas web pagadas. Usando coalesce esas
   ventas vuelven a contar sin tocar la base de datos ni el webhook.

   Cuenta únicamente request_type='booking' y payment_status='paid':
   quedan fuera pending, processing, failed, refunded y las cotizaciones.

   La suma se hace EN EL SERVIDOR: al navegador solo viajan los totales,
   nunca el conjunto de reservas.
   ========================================================= */

const { sendJson, sendError, logServer, isRealYmd, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireAdmin } = require('../lib/admin-auth');

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

/* Método de pago para el desglose. NO modifica la fila: solo clasifica.
   · Canal web = Stripe SIEMPRE (el histórico puede tener payment_method
     null porque el webhook no lo escribía; sigue siendo un cobro Stripe).
   · Cualquier fila con stripe_payment_intent_id = Stripe.
   · Ventas de agencia: su método declarado si es válido; 'other' solo
     cuando de verdad es 'other' o falta de forma legítima. */
function classifyMethod(r) {
  if (r.sales_channel === 'web') return 'stripe';
  if (r.stripe_payment_intent_id) return 'stripe';
  return METHODS.indexOf(r.payment_method) !== -1 ? r.payment_method : 'other';
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
  if (q.tour_id && typeof q.tour_id !== 'string') return sendError(res, 400, 'INVALID_FILTER', 'Invalid tour_id');

  try {
    const supabase = getSupabase();
    const rows = [];

    /* Cota del rango sobre paid_at, que SIEMPRE está presente en las
       reservas pagadas (lo escribe el webhook y las ventas de agencia).
       Acota la consulta e incluye las filas con sold_at nulo. El filtro
       fino se aplica en el servidor con coalesce(sold_at, paid_at). */
    const startFrom = date_from ? startInstant(date_from) : null;
    const endTo = date_to ? endInstantExclusive(date_to) : null;

    for (let page = 0; page < MAX_PAGES; page++) {
      let query = supabase.from('bookings')
        .select('amount_cents,gross_amount_cents,discount_cents,cost_cents,guests,tour_id,tour_name,sales_channel,payment_method,sold_at,paid_at,stripe_payment_intent_id')
        .eq('tenant_id', tenant)
        .eq('request_type', 'booking')
        .eq('payment_status', 'paid')
        .is('deleted_at', null);   // las reservas archivadas no cuentan en finanzas

      if (startFrom) query = query.gte('paid_at', startFrom);
      if (endTo) query = query.lt('paid_at', endTo);
      if (q.channel) query = query.eq('sales_channel', q.channel);
      if (q.payment_method) query = query.eq('payment_method', q.payment_method);
      if (q.created_by) query = query.eq('created_by_user_id', q.created_by);
      if (q.tour_id) query = query.eq('tour_id', q.tour_id);

      query = query.order('paid_at', { ascending: true }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      const { data, error } = await query;
      if (error) { logServer('finance-summary', error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to build the summary'); }
      const batch = data || [];
      rows.push.apply(rows, batch);
      if (batch.length < PAGE_SIZE) break;
      if (page === MAX_PAGES - 1) logServer('finance-summary', 'cap alcanzado (' + (MAX_PAGES * PAGE_SIZE) + ' filas); el total podría estar recortado');
    }

    const revenue = { web: 0, agency: 0, total: 0 };
    const counts = { web: 0, agency: 0, total: 0 };
    const by_method = {};
    METHODS.forEach(function (m) { by_method[m] = { amount_cents: 0, count: 0 }; });

    /* Acumuladores financieros. gross/discount/net a nivel global y por tour;
       el costo solo se suma cuando cost_cents NO es null (no se finge 0). */
    const agg = { gross: 0, discount: 0, net: 0, knownCost: 0, pax: 0, missingCost: 0 };
    const tours = {};   // tour_id → acumulador

    rows.forEach(function (r) {
      /* Fecha contable robusta: sold_at si existe, si no paid_at. */
      const acct = r.sold_at || r.paid_at;
      if (!acct) return;                                    // sin fecha de caja → no computa
      if (startFrom && acct < startFrom) return;
      if (endTo && acct >= endTo) return;

      const net = Number(r.amount_cents) || 0;                          // lo cobrado
      const gross = r.gross_amount_cents != null ? Number(r.gross_amount_cents) : net;
      const disc = Number(r.discount_cents) || 0;
      const pax = Number(r.guests) || 0;
      const hasCost = r.cost_cents != null;
      const cost = hasCost ? Number(r.cost_cents) : 0;
      const ch = r.sales_channel === 'agency' ? 'agency' : 'web';

      revenue[ch] += net; revenue.total += net;
      counts[ch] += 1; counts.total += 1;
      const m = classifyMethod(r);
      by_method[m].amount_cents += net; by_method[m].count += 1;

      agg.gross += gross; agg.discount += disc; agg.net += net; agg.pax += pax;
      if (hasCost) agg.knownCost += cost; else agg.missingCost += 1;

      const tid = r.tour_id || 'unknown';
      const t = tours[tid] || (tours[tid] = { tour_id: tid, tour_name: r.tour_name || tid,
        sales: 0, pax: 0, gross: 0, discount: 0, net: 0, knownCost: 0, missingCost: 0 });
      t.sales += 1; t.pax += pax; t.gross += gross; t.discount += disc; t.net += net;
      if (hasCost) t.knownCost += cost; else t.missingCost += 1;
    });

    function perPax(total, pax) { return pax > 0 ? Math.round(total / pax) : 0; }
    const grossProfit = agg.net - agg.knownCost;          // parcial si hay missingCost
    const marginPercent = agg.net > 0 ? Math.round((grossProfit / agg.net) * 1000) / 10 : 0;

    const by_tour = Object.keys(tours).map(function (id) {
      const t = tours[id];
      const profit = t.net - t.knownCost;
      return {
        tour_id: t.tour_id, tour_name: t.tour_name, sales: t.sales, pax: t.pax,
        gross_revenue_cents: t.gross, discounts_cents: t.discount, net_revenue_cents: t.net,
        known_costs_cents: t.knownCost, known_profit_cents: profit, missing_cost_sales_count: t.missingCost,
        revenue_per_pax_cents: perPax(t.net, t.pax),
        cost_per_pax_cents: perPax(t.knownCost, t.pax),
        profit_per_pax_cents: perPax(profit, t.pax)
      };
    }).sort(function (a, b) { return b.net_revenue_cents - a.net_revenue_cents; });

    return sendJson(res, 200, {
      basis: 'sold_at|paid_at',               // fecha de caja (coalesce), no del tour
      range: { date_from: date_from || null, date_to: date_to || null },
      currency: 'usd',
      revenue: revenue,                       // compat: web/agency/total (neto)
      counts: counts,
      by_method: by_method,
      gross_revenue_cents: agg.gross,
      discounts_cents: agg.discount,
      net_revenue_cents: agg.net,
      known_costs_cents: agg.knownCost,
      gross_profit_cents: grossProfit,
      margin_percent: marginPercent,
      total_sales: counts.total,
      total_pax: agg.pax,
      revenue_per_pax_cents: perPax(agg.net, agg.pax),
      known_cost_per_pax_cents: perPax(agg.knownCost, agg.pax),
      known_profit_per_pax_cents: perPax(grossProfit, agg.pax),
      missing_cost_sales_count: agg.missingCost,
      profit_is_partial: agg.missingCost > 0,
      by_tour: by_tour
    });
  } catch (err) {
    logServer('finance-summary', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to build the summary');
  }
};
