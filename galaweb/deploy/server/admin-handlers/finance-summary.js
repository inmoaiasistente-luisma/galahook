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

   Cuenta únicamente request_type='booking' con payment_status 'paid' o
   'deposit_paid' (depósito del 30 %): quedan fuera pending, processing,
   failed, refunded y las cotizaciones.

   DEPÓSITO 30 % (spec 5.9, tarea 9):
   · La VENTA (cantidad, pax, bruto, descuento, costo) cuenta UNA vez, en la
     fecha en que se pagó el depósito (sold_at || paid_at).
   · "Cobrado" y "Por cobrar" van por fecha de caja: el depósito se cobra en
     la fecha de la venta; el saldo, en la fecha balance_paid_at. Si el saldo
     se pagó dentro del rango, suma a cobrado; si no, queda por cobrar.
   · Una reserva cancelada por falta de pago del saldo (plan deposit,
     booking_status cancelled, payment_status deposit_paid) ya NO es venta:
     su depósito es "depósito retenido" (ingreso), sin costo salvo que el
     owner lo haya confirmado.
   · Por método: el depósito es Stripe; el saldo va con su método real.

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
/* Método del saldo del depósito → clave de by_method. */
function mapBalanceMethod(m) {
  if (m === 'cash') return 'cash';
  if (m === 'transfer') return 'bank_transfer';
  if (m === 'stripe') return 'stripe';
  return 'other';
}

/* Filtros comunes de las dos consultas (tenant, tipo, archivadas y filtros
   opcionales del panel). Una sola definición para no duplicarlos. */
function applyCommonFilters(query, tenant, q) {
  query = query.eq('tenant_id', tenant)
    .eq('request_type', 'booking')
    .is('deleted_at', null);   // las reservas archivadas no cuentan en finanzas
  if (q.channel) query = query.eq('sales_channel', q.channel);
  if (q.payment_method) query = query.eq('payment_method', q.payment_method);
  if (q.created_by) query = query.eq('created_by_user_id', q.created_by);
  if (q.tour_id) query = query.eq('tour_id', q.tour_id);
  return query;
}

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
      // Tarea 9 (depósito 30 %): también 'deposit_paid', no solo 'paid'.
      let query = applyCommonFilters(supabase.from('bookings')
        .select('id,amount_cents,gross_amount_cents,discount_cents,cost_cents,cost_status,guests,tour_id,tour_name,sales_channel,payment_method,sold_at,paid_at,stripe_payment_intent_id,payment_plan,deposit_cents,balance_cents,balance_paid_at,balance_payment_method,booking_status,payment_status')
        .in('payment_status', ['paid', 'deposit_paid']), tenant, q);

      if (startFrom) query = query.gte('paid_at', startFrom);
      if (endTo) query = query.lt('paid_at', endTo);

      query = query.order('paid_at', { ascending: true }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      const { data, error } = await query;
      if (error) { logServer('finance-summary', error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to build the summary'); }
      const batch = data || [];
      rows.push.apply(rows, batch);
      if (batch.length < PAGE_SIZE) break;
      if (page === MAX_PAGES - 1) logServer('finance-summary', 'cap alcanzado (' + (MAX_PAGES * PAGE_SIZE) + ' filas); el total podría estar recortado');
    }

    /* Saldos de depósitos cuya VENTA es anterior al rango pero cuyo saldo se
       pagó dentro de él: suman a cobrado, no son venta ni por cobrar. Solo
       aplica con date_from (sin rango, la primera consulta ya los trae). */
    const lateBalances = [];
    if (startFrom) {
      for (let page = 0; page < MAX_PAGES; page++) {
        let q2 = applyCommonFilters(supabase.from('bookings')
          .select('id,balance_cents,balance_paid_at,balance_payment_method')
          .eq('payment_plan', 'deposit')
          .eq('payment_status', 'paid'), tenant, q)
          .gte('balance_paid_at', startFrom);
        if (endTo) q2 = q2.lt('balance_paid_at', endTo);
        q2 = q2.order('balance_paid_at', { ascending: true }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
        const r2 = await q2;
        if (r2.error) { logServer('finance-summary', r2.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to build the summary'); }
        const b2 = r2.data || [];
        lateBalances.push.apply(lateBalances, b2);
        if (b2.length < PAGE_SIZE) break;
        if (page === MAX_PAGES - 1) logServer('finance-summary', 'cap alcanzado en saldos (' + (MAX_PAGES * PAGE_SIZE) + ' filas); el total podría estar recortado');
      }
    }

    const revenue = { web: 0, agency: 0, total: 0 };
    const counts = { web: 0, agency: 0, total: 0 };
    const by_method = {};
    METHODS.forEach(function (m) { by_method[m] = { amount_cents: 0, count: 0 }; });

    /* Acumuladores financieros. gross/discount/net a nivel global y por tour;
       el costo solo se suma cuando cost_cents NO es null (no se finge 0). */
    const agg = { gross: 0, discount: 0, net: 0, knownCost: 0, pax: 0, missingCost: 0,
      collected: 0, pending: 0, retained: 0, retainedCount: 0 };
    const processed = {};   // ids ya contados en la primera pasada
    const tours = {};   // tour_id → acumulador

    rows.forEach(function (r) {
      /* Fecha contable robusta: sold_at si existe, si no paid_at. */
      const acct = r.sold_at || r.paid_at;
      if (!acct) return;                                    // sin fecha de caja → no computa
      if (startFrom && acct < startFrom) return;
      if (endTo && acct >= endTo) return;

      if (r.id != null) processed[r.id] = true;

      /* Depósito retenido: plan deposit cancelado por falta de pago del saldo
         (el depósito sigue pagado). NO es venta: ingreso retenido, sin
         cantidad/pax/bruto/neto; su costo solo cuenta si el owner lo confirmó. */
      if (r.payment_plan === 'deposit' && r.booking_status === 'cancelled' && r.payment_status === 'deposit_paid') {
        const dep = Number(r.deposit_cents) || 0;
        agg.retained += dep; agg.retainedCount += 1; agg.collected += dep;
        by_method.stripe.amount_cents += dep; by_method.stripe.count += 1;
        if (r.cost_cents != null && r.cost_status === 'confirmed') agg.knownCost += Number(r.cost_cents) || 0;
        return;
      }

      const net = Number(r.amount_cents) || 0;                          // lo cobrado
      const gross = r.gross_amount_cents != null ? Number(r.gross_amount_cents) : net;
      const disc = Number(r.discount_cents) || 0;
      const pax = Number(r.guests) || 0;
      // Utilidad OFICIAL = SOLO costos CONFIRMADOS (decisión del owner, Fase 9-3):
      // un snapshot de plantilla ('estimated') o sin costo ('unset') NO cuenta como
      // costo conocido; esas reservas se listan como "sin costos confirmados".
      const hasCost = r.cost_cents != null && r.cost_status === 'confirmed';
      const cost = hasCost ? Number(r.cost_cents) : 0;
      const ch = r.sales_channel === 'agency' ? 'agency' : 'web';

      revenue[ch] += net; revenue.total += net;
      counts[ch] += 1; counts.total += 1;
      if (r.payment_plan === 'deposit') {
        /* Depósito: Stripe. Saldo: método real, en la fecha en que se pagó. */
        const dep = Number(r.deposit_cents) || 0, bal = Number(r.balance_cents) || 0;
        agg.collected += dep;
        by_method.stripe.amount_cents += dep; by_method.stripe.count += 1;
        const paidInRange = r.balance_paid_at && (!startFrom || r.balance_paid_at >= startFrom) && (!endTo || r.balance_paid_at < endTo);
        if (paidInRange) {
          agg.collected += bal;
          const bm = mapBalanceMethod(r.balance_payment_method);
          by_method[bm].amount_cents += bal; by_method[bm].count += 1;
        } else {
          agg.pending += bal;
        }
      } else {
        agg.collected += net;
        const m = classifyMethod(r);
        by_method[m].amount_cents += net; by_method[m].count += 1;
      }

      agg.gross += gross; agg.discount += disc; agg.net += net; agg.pax += pax;
      if (hasCost) agg.knownCost += cost; else agg.missingCost += 1;

      const tid = r.tour_id || 'unknown';
      const t = tours[tid] || (tours[tid] = { tour_id: tid, tour_name: r.tour_name || tid,
        sales: 0, pax: 0, gross: 0, discount: 0, net: 0, knownCost: 0, missingCost: 0 });
      t.sales += 1; t.pax += pax; t.gross += gross; t.discount += disc; t.net += net;
      if (hasCost) t.knownCost += cost; else t.missingCost += 1;
    });

    lateBalances.forEach(function (r) {
      if (r.id != null && processed[r.id]) return;
      const bal = Number(r.balance_cents) || 0;
      agg.collected += bal;
      const bm = mapBalanceMethod(r.balance_payment_method);
      by_method[bm].amount_cents += bal; by_method[bm].count += 1;
    });

    function perPax(total, pax) { return pax > 0 ? Math.round(total / pax) : 0; }
    const incomeBase = agg.net + agg.retained;            // ventas + depósitos retenidos
    const grossProfit = incomeBase - agg.knownCost;       // parcial si hay missingCost
    const marginPercent = incomeBase > 0 ? Math.round((grossProfit / incomeBase) * 1000) / 10 : 0;

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
      collected_cents: agg.collected,         // cobrado en el rango (fecha de caja)
      pending_cents: agg.pending,             // saldos de depósito por cobrar
      retained_deposits_cents: agg.retained,  // depósitos retenidos (cancelación por falta de pago)
      retained_deposits_count: agg.retainedCount,
      gross_revenue_cents: agg.gross,
      discounts_cents: agg.discount,
      net_revenue_cents: agg.net,
      known_costs_cents: agg.knownCost,       // = costos CONFIRMADOS
      confirmed_costs_cents: agg.knownCost,   // alias explícito
      gross_profit_cents: grossProfit,        // utilidad OFICIAL (solo confirmados)
      margin_percent: marginPercent,
      total_sales: counts.total,
      total_pax: agg.pax,
      revenue_per_pax_cents: perPax(agg.net, agg.pax),
      known_cost_per_pax_cents: perPax(agg.knownCost, agg.pax),
      known_profit_per_pax_cents: perPax(grossProfit, agg.pax),
      missing_cost_sales_count: agg.missingCost,             // = ventas sin costo confirmado
      bookings_without_confirmed_costs: agg.missingCost,     // alias explícito (alertas)
      profit_is_partial: agg.missingCost > 0,
      web_sales: counts.web,
      manual_sales: counts.agency,
      by_tour: by_tour
    });
  } catch (err) {
    logServer('finance-summary', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to build the summary');
  }
};
