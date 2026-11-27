'use strict';

/* =========================================================
   Pruebas — Depósito 30 %, tarea 9: finanzas (spec 5.9).
   Cuenta las reservas con depósito en el resumen del admin:
   venta una vez (fecha del depósito), cobrado/por cobrar con
   fecha de caja, depósito retenido y método real del saldo.
   Sin red: Supabase en memoria.
   ========================================================= */

const path = require('path');
const BASE = path.resolve(__dirname, '..');
const { createFakeSupabase } = require('./helpers/fake-supabase');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }

let FAKE = createFakeSupabase({});
function mockModule(rel, exp) { const p = require.resolve(BASE + rel); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; }
mockModule('/server/lib/supabase.js', { getSupabase: function () { return FAKE; } });
mockModule('/server/lib/admin-auth.js', {
  requireAdmin: async function () { return { user_id: 'u-owner', role: 'owner', tenant_id: 'hook-adventure' }; }
});
process.env.TENANT_ID = 'hook-adventure';

const handler = require(BASE + '/server/admin-handlers/finance-summary.js');

async function call(query, rows) {
  FAKE = createFakeSupabase({ bookings: rows });
  const qs = Object.keys(query || {}).map(function (k) { return k + '=' + query[k]; }).join('&');
  const req = { method: 'GET', url: '/api/admin-finance-summary' + (qs ? '?' + qs : ''), headers: {} };
  const res = { statusCode: 200, headers: {}, body: '', setHeader: function (k, v) { this.headers[k] = v; }, end: function (b) { this.body = b || ''; } };
  await handler(req, res);
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
}

let SEQ = 0;
function row(extra) {
  SEQ += 1;
  return Object.assign({
    id: 'b' + SEQ, tenant_id: 'hook-adventure', request_type: 'booking', deleted_at: null,
    payment_status: 'paid', booking_status: 'confirmed', payment_plan: 'full',
    sales_channel: 'web', tour_id: 'p4', tour_name: 'Paquete 4',
    amount_cents: 0, cost_cents: null, cost_status: 'unset', guests: 2,
    paid_at: '2026-11-10T15:00:00.000Z', sold_at: null
  }, extra || {});
}
const FULL = function (x) { return row(Object.assign({ amount_cents: 100000 }, x)); };
const DEP_UNPAID = function (x) { return row(Object.assign({ payment_plan: 'deposit', payment_status: 'deposit_paid', amount_cents: 120000, deposit_cents: 36000, balance_cents: 84000 }, x)); };
const DEP_CASH = function (x) { return row(Object.assign({ payment_plan: 'deposit', payment_status: 'paid', amount_cents: 50000, deposit_cents: 15000, balance_cents: 35000,
  balance_paid_at: '2026-11-12T15:00:00.000Z', balance_payment_method: 'cash' }, x)); };
const DEP_CANCELLED = function (x) { return row(Object.assign({ payment_plan: 'deposit', payment_status: 'deposit_paid', booking_status: 'cancelled', cancel_reason: 'balance_unpaid',
  amount_cents: 30000, deposit_cents: 9000, balance_cents: 21000 }, x)); };

(async function () {
  /* ---------- 1 · fixture del brief (sin rango) ---------- */
  const a = await call({}, [FULL(), DEP_UNPAID(), DEP_CASH(), DEP_CANCELLED()]);
  const j = a.json;
  ok('1 fixture: 200', a.status === 200 && j);
  ok('2 fixture: counts.total 3 y revenue.total 270000', j.counts.total === 3 && j.revenue.total === 270000);
  ok('3 fixture: collected_cents 195000', j.collected_cents === 100000 + 36000 + 50000 + 9000);
  ok('4 fixture: pending_cents 84000', j.pending_cents === 84000);
  ok('5 fixture: retained 9000 y count 1', j.retained_deposits_cents === 9000 && j.retained_deposits_count === 1);
  ok('6 fixture: by_method.cash 35000', j.by_method.cash.amount_cents === 35000 && j.by_method.cash.count === 1);
  ok('7 fixture: by_method.stripe 160000', j.by_method.stripe.amount_cents === 160000);
  ok('8 fixture: el cancelado no es venta (pax y net)', j.total_pax === 6 && j.net_revenue_cents === 270000);

  /* ---------- 2 · rango de fechas ---------- */
  const late = DEP_CASH({ amount_cents: 120000, deposit_cents: 36000, balance_cents: 84000,
    paid_at: '2026-11-10T15:00:00.000Z', balance_paid_at: '2026-12-05T15:00:00.000Z', balance_payment_method: 'cash' });
  const nov = (await call({ date_from: '2026-11-01', date_to: '2026-11-30' }, [late])).json;
  ok('9 rango nov: venta 1 / 120000', nov.counts.total === 1 && nov.revenue.total === 120000);
  ok('10 rango nov: cobrado 36000, por cobrar 84000', nov.collected_cents === 36000 && nov.pending_cents === 84000);
  const dec = (await call({ date_from: '2026-12-01', date_to: '2026-12-31' }, [late])).json;
  ok('11 rango dic: sin venta', dec.counts.total === 0 && dec.revenue.total === 0);
  ok('12 rango dic: cobrado 84000, por cobrar 0, efectivo 84000', dec.collected_cents === 84000 && dec.pending_cents === 0 && dec.by_method.cash.amount_cents === 84000);
  ok('13 rango dic: sin ventas ni utilidad inventada', dec.net_revenue_cents === 0 && dec.total_pax === 0 && dec.missing_cost_sales_count === 0);

  /* ---------- 3 · depósito retenido con costos confirmados ---------- */
  const ret = (await call({}, [DEP_CANCELLED({ cost_cents: 4000, cost_status: 'confirmed' })])).json;
  ok('14 retenido con costo confirmado suma al costo conocido', ret.known_costs_cents === 4000 && ret.confirmed_costs_cents === 4000);
  ok('15 retenido no cuenta como venta sin costo', ret.missing_cost_sales_count === 0 && ret.counts.total === 0 && ret.by_tour.length === 0);
  ok('16 utilidad = retenido - costo', ret.gross_profit_cents === 9000 - 4000);
  ok('17 margen sobre net + retenido', ret.margin_percent === Math.round(((9000 - 4000) / 9000) * 1000) / 10);
  const ret2 = (await call({}, [DEP_CANCELLED({ cost_cents: 4000, cost_status: 'estimated' })])).json;
  ok('18 retenido con costo no confirmado no suma costo', ret2.known_costs_cents === 0);

  /* ---------- 4 · reembolsado excluido ---------- */
  const ref = (await call({}, [DEP_UNPAID({ payment_status: 'refunded' })])).json;
  ok('19 depósito reembolsado queda fuera', ref.counts.total === 0 && ref.collected_cents === 0 && ref.pending_cents === 0 && ref.retained_deposits_count === 0);

  /* ---------- 5 · regresión solo-full ---------- */
  const fo = (await call({}, [FULL({ cost_cents: 20000, cost_status: 'confirmed' }), FULL({ amount_cents: 50000, sales_channel: 'agency', payment_method: 'cash' })])).json;
  ok('20 full: cobrado = neto y por cobrar 0', fo.collected_cents === fo.net_revenue_cents && fo.net_revenue_cents === 150000 && fo.pending_cents === 0);
  ok('21 full: utilidad y margen como antes', fo.gross_profit_cents === 130000 && fo.margin_percent === Math.round((130000 / 150000) * 1000) / 10);
  ok('22 full: sin retenidos y by_method intacto', fo.retained_deposits_cents === 0 && fo.retained_deposits_count === 0 && fo.by_method.stripe.amount_cents === 100000 && fo.by_method.cash.amount_cents === 50000);

  /* ---------- 6 · método del saldo ---------- */
  const tr = (await call({}, [DEP_CASH({ balance_payment_method: 'transfer' })])).json;
  ok('23 saldo por transferencia → bank_transfer', tr.by_method.bank_transfer.amount_cents === 35000 && tr.by_method.bank_transfer.count === 1 && tr.by_method.cash.amount_cents === 0);
  const st = (await call({}, [DEP_CASH({ balance_payment_method: 'stripe' })])).json;
  ok('24 saldo Stripe → stripe (depósito + saldo)', st.by_method.stripe.amount_cents === 50000 && st.by_method.stripe.count === 2);
  const ot = (await call({}, [DEP_CASH({ balance_payment_method: 'raro' })])).json;
  ok('25 método desconocido → other', ot.by_method.other.amount_cents === 35000);

  /* ---------- 7 · el saldo pagado en rango no se cuenta dos veces ---------- */
  const both = (await call({ date_from: '2026-11-01', date_to: '2026-12-31' }, [late])).json;
  ok('26 venta y saldo en el mismo rango: una sola vez', both.counts.total === 1 && both.collected_cents === 120000 && both.pending_cents === 0);

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('FAIL  excepción: ' + (e && e.stack || e)); process.exit(1); });
