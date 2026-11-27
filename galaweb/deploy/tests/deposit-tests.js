'use strict';

/* =========================================================
   Pruebas — Depósito del 30 % en reservas.
   Cada tarea agrega su sección numerada antes del resumen final.
   ========================================================= */

process.env.QR_SIGNING_SECRET = 't';
process.env.PUBLIC_SITE_URL = 'https://example.test';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }

/* ---------------- 1 · política ---------------- */
console.log('\n--- 1 · política ---');
{
  const P = require('../server/lib/deposit-policy');
  const { shiftYmd } = require('../server/lib/pretrip-reminders');
  const { getTour } = require('../server/lib/tour-catalog');
  const { signQrToken } = require('../server/lib/booking-qr');
  const T = '2026-11-26';
  const kicker = getTour('kicker'), expedition = getTour('expedition');

  ok('1.1 constantes', P.DEPOSIT_PCT === 30 && P.MIN_DAYS_AHEAD === 30 && P.DEPOSIT_TERMS_VERSION === '2026-11-26');
  // boundary 30/31
  const e31 = P.isDepositEligible(kicker, shiftYmd(T, 31), T);
  ok('1.2 boundary 31 días elegible', e31.eligible === true && e31.reason === null);
  const e30 = P.isDepositEligible(kicker, shiftYmd(T, 30), T);
  ok('1.3 boundary 30 días too_close', e30.eligible === false && e30.reason === 'too_close');
  const eq = P.isDepositEligible(expedition, shiftYmd(T, 60), T);
  ok('1.4 expedición quote_only', eq.eligible === false && eq.reason === 'quote_only');
  ok('1.5 sin precio no_price', P.isDepositEligible({ requiresQuote: false, priceCents: null }, shiftYmd(T, 60), T).reason === 'no_price');
  ok('1.6 fecha mala bad_date', P.isDepositEligible(kicker, 'nope', T).reason === 'bad_date');
  ok('1.7 sin tour no elegible', P.isDepositEligible(null, shiftYmd(T, 60), T).eligible === false);

  // rounding
  const a = P.splitAmounts(19500);
  ok('1.8 split 19500', a.depositCents === 5850 && a.balanceCents === 13650);
  const b = P.splitAmounts(33333);
  ok('1.9 split 33333', b.depositCents === 10000 && b.balanceCents === 23333);
  let sumOk = true;
  for (let i = 0; i < 5000; i++) {
    const t = 1 + Math.floor(Math.random() * 5000);
    const s = P.splitAmounts(t);
    if (s.depositCents + s.balanceCents !== t || s.depositCents !== Math.round(t * 30 / 100)) sumOk = false;
  }
  ok('1.10 suma = total (5000 aleatorios)', sumOk);

  // dates
  const d = P.depositDates('2027-03-10');
  ok('1.11 fechas congeladas', d.balanceDueDate === '2027-03-04' && d.depositRefundableUntil === '2027-02-07' && d.balanceRefundableUntil === '2027-02-22');

  // sweep
  const base = { payment_plan: 'deposit', payment_status: 'deposit_paid', booking_status: 'confirmed' };
  const bk = (days, extra) => Object.assign({}, base, { booking_date: shiftYmd(T, days) }, extra || {});
  const act = (days, extra, opts) => P.sweepAction(bk(days, extra), T, opts || {}).action;
  ok('1.12 día 8 null', act(8) === null);
  ok('1.13 día 7 remind_d7', act(7) === 'remind_d7');
  ok('1.14 día 6 remind_d6', act(6) === 'remind_d6');
  ok('1.15 días 5,2,0 cancel', act(5) === 'cancel' && act(2) === 'cancel' && act(0) === 'cancel');
  ok('1.16 catch-up negativo cancel', act(-3) === 'cancel');
  ok('1.17 days devuelto', P.sweepAction(bk(7), T, {}).days === 7);
  ok('1.18 pagado null', act(6, { payment_status: 'paid' }) === null);
  ok('1.19 deleted_at null', act(6, { deleted_at: '2026-11-01T00:00:00Z' }) === null);
  ok('1.20 reminders_paused ignorado', act(6, { reminders_paused: true }) === 'remind_d6');
  ok('1.21 is_test null sin includeTest', act(6, { is_test: true }) === null);
  ok('1.22 is_test con includeTest', act(6, { is_test: true }, { includeTest: true }) === 'remind_d6');
  ok('1.23 plan full null', act(6, { payment_plan: 'full' }) === null);
  ok('1.24 no confirmada null', act(6, { booking_status: 'cancelled' }) === null);
  ok('1.25 solicitud (request_type) null', act(6, { request_type: 'quote' }) === null);
  ok('1.26 fecha inválida null', P.sweepAction(Object.assign({}, base, { booking_date: 'x' }), T, {}).action === null);

  // token
  const id = '8c1f0a52-3d7e-4b1a-9a56-0f2c9d4e7b11';
  const tok = P.signBalanceToken(id);
  ok('1.27 token ida y vuelta', P.verifyBalanceToken(tok) === id);
  const flipped = tok.slice(0, -1) + (tok.slice(-1) === 'A' ? 'B' : 'A');
  ok('1.28b último char cambiado en todas las variantes', ['A','B','C','D','E','Q','g','w'].every(function (c) { return c === tok.slice(-1) || P.verifyBalanceToken(tok.slice(0, -1) + c) === null; }));
  ok('1.28 token manipulado null', P.verifyBalanceToken(flipped) === null);
  ok('1.29 token QR null', P.verifyBalanceToken(signQrToken(id, 1)) === null);
  ok('1.30 token sin id en claro', tok.indexOf(id) === -1);
  ok('1.31 balanceUrl', /\/saldo#t=/.test(P.balanceUrl(id)) && P.balanceUrl(id).indexOf('https://example.test/saldo#t=') === 0);
  ok('1.32 basura null', P.verifyBalanceToken('') === null && P.verifyBalanceToken(null) === null && P.verifyBalanceToken('a.b.c') === null);
}

/* ---------------- 2 · migración ---------------- */
console.log('\n--- 2 · migración ---');
{
  const fs = require('fs'), path = require('path');
  const dir = path.join(__dirname, '..', 'supabase', 'migrations');
  const sql = fs.readFileSync(path.join(dir, '0028_booking_deposits.sql'), 'utf8');
  const low = sql.toLowerCase();
  const old19 = fs.readFileSync(path.join(dir, '0019_phase9_audit_docs_reminders.sql'), 'utf8');
  // texto de un constraint recreado: desde "add constraint <name>" hasta el siguiente ";"
  function block(name) {
    const i = low.indexOf('add constraint ' + name);
    return i < 0 ? '' : low.slice(i, low.indexOf(';', i));
  }

  const cols = ['payment_plan', 'deposit_cents', 'balance_cents', 'balance_due_date', 'deposit_refundable_until',
    'balance_refundable_until', 'deposit_paid_at', 'balance_paid_at', 'balance_payment_intent_id',
    'balance_payment_method', 'balance_offline_note', 'deposit_terms_version', 'deposit_terms_accepted_at',
    'auto_cancelled_at', 'cancel_reason', 'needs_review_reason'];
  ok('2.1 todas las columnas con add column if not exists',
    cols.every(function (c) { return new RegExp('add column if not exists\\s+' + c + '\\b').test(low); }));
  ok('2.2 payment_plan not null default full + check',
    /add column if not exists\s+payment_plan\s+text\s+not null\s+default\s+'full'/.test(low) &&
    /in\s*\(\s*'full'\s*,\s*'deposit'\s*\)/.test(block('chk_payment_plan')));
  ok('2.3 tipos de columnas',
    /deposit_cents\s+int/.test(low) && /balance_cents\s+int/.test(low) &&
    /balance_due_date\s+date/.test(low) && /deposit_refundable_until\s+date/.test(low) &&
    /balance_refundable_until\s+date/.test(low) && /deposit_paid_at\s+timestamptz/.test(low) &&
    /balance_paid_at\s+timestamptz/.test(low) && /balance_payment_intent_id\s+text\s+unique/.test(low));
  ok('2.4 chk_balance_payment_method',
    /chk_balance_payment_method[\s\S]{0,120}'stripe'\s*,\s*'cash'\s*,\s*'transfer'/.test(low));
  const da = block('chk_deposit_amounts');
  ok('2.5 chk_deposit_amounts: solo exige cuando plan=deposit', /check\s*\(\s*payment_plan\s*<>\s*'deposit'\s+or/.test(da));
  ok('2.6 chk_deposit_amounts: montos > 0, suma = total, fecha de saldo',
    /deposit_cents\s+is not null/.test(da) && /balance_cents\s+is not null/.test(da) &&
    /deposit_cents\s*>\s*0/.test(da) && /balance_cents\s*>\s*0/.test(da) &&
    /deposit_cents\s*\+\s*balance_cents\s*=\s*amount_cents/.test(da) && /balance_due_date\s+is not null/.test(da));
  ok('2.7 chk_payment_status incluye deposit_paid y los valores previos',
    /'deposit_paid'/.test(block('chk_payment_status')) &&
    ['pending', 'processing', 'paid', 'failed', 'refunded', 'not_required'].every(function (v) { return block('chk_payment_status').indexOf("'" + v + "'") >= 0; }));
  const rp = block('chk_request_payment');
  ok('2.8 chk_request_payment incluye deposit_paid y conserva ramas',
    /'deposit_paid'/.test(rp) && /request_type\s*=\s*'quote'/.test(rp) && /request_type\s*=\s*'booking'/.test(rp) &&
    /amount_cents\s+is null/.test(rp) && /amount_cents\s*>\s*0/.test(rp));
  const types9 = ['customer_deposit_confirmation', 'owner_deposit_notification', 'balance_reminder_d7', 'balance_reminder_d6',
    'customer_deposit_cancelled', 'owner_deposit_cancelled', 'customer_balance_receipt', 'owner_balance_received', 'owner_payment_review'];
  const nt = block('chk_email_notification_type');
  ok('2.9 los 9 tipos nuevos de notificación', types9.every(function (t) { return nt.indexOf("'" + t + "'") >= 0; }));
  const m19 = old19.slice(old19.indexOf('add constraint chk_email_notification_type'));
  const oldTypes = (m19.slice(0, m19.indexOf(';')).match(/'[a-z0-9_]+'/g) || []).map(function (s) { return s.slice(1, -1); });
  ok('2.10 los tipos previos (0019) siguen incluidos', oldTypes.length === 15 && oldTypes.every(function (t) { return nt.indexOf("'" + t + "'") >= 0; }));
  ok('2.11 constraints recreados con drop constraint if exists',
    ['chk_payment_status', 'chk_request_payment', 'chk_email_notification_type'].every(function (n) { return low.indexOf('drop constraint if exists ' + n) >= 0; }));
  ok('2.12 índice (tenant_id, payment_plan, payment_status, booking_date)',
    /create index if not exists\s+\w+\s+on public\.bookings\s*\(\s*tenant_id\s*,\s*payment_plan\s*,\s*payment_status\s*,\s*booking_date\s*\)/.test(low));
  ok('2.13 sin drop table ni delete from', !/drop table/.test(low) && !/delete\s+from/.test(low));
  ok('2.14 cabecera: aplicar en Preview, luego en Producción ANTES del merge', /aplicar en preview, luego en producci[oó]n antes del merge/.test(low));
}

/* ---------------- 3 · correos ---------------- */
console.log('\n--- 3 · correos ---');
{
  process.env.EMAIL_REPLY_TO = 'hola@example.test';
  process.env.PUBLIC_SITE_URL = 'https://example.test';
  const ET = require('../server/lib/email-templates');
  const T = ET.TEMPLATES;
  const names9 = ['customer_deposit_confirmation', 'balance_reminder_d7', 'balance_reminder_d6', 'customer_deposit_cancelled',
    'customer_balance_receipt', 'owner_deposit_notification', 'owner_balance_received', 'owner_deposit_cancelled', 'owner_payment_review'];
  const b = { booking_code: 'HA-2027-ABCDEF', amount_cents: 120000, deposit_cents: 36000, balance_cents: 84000, balance_due_date: '2027-03-04',
    booking_date: '2027-03-10', deposit_refundable_until: '2027-02-07', currency: 'usd', customer_name: 'Ana', customer_email: 'a@x.test',
    tour_name: 'Tour', guests: 2, balance_payment_method: 'cash' };
  const ctx = { balanceUrl: 'https://example.test/saldo#t=abc', qrUrl: 'https://example.test/qr/1', cid: 'qr1' };

  ok('3.1 los 9 tipos existen con build()', names9.every(function (n) { return T[n] && typeof T[n].build === 'function'; }));
  ok('3.2 cada uno devuelve subject, html y text no vacíos', names9.every(function (n) {
    const r = T[n].build(b, ctx); return r.subject && r.html && r.text;
  }));
  ok('3.3 solo customer_deposit_confirmation lleva QR', names9.every(function (n) { return T[n].qr === (n === 'customer_deposit_confirmation'); }));
  const c = T.customer_deposit_confirmation.build(b, ctx);
  ok('3.4 confirmación: montos, fecha límite y enlace de saldo',
    ['$360.00', '$840.00', '2027-03-04', ctx.balanceUrl].every(function (s) { return c.html.indexOf(s) >= 0; }));
  ok('3.5 confirmación: reglas ES/EN (30 días o menos, cancelación automática)',
    c.html.indexOf('con 30 días o menos') >= 0 && /30 days or less/.test(c.html) && /cancelada automáticamente/.test(c.html) && /Pagar saldo/.test(c.html) && /Pay balance/.test(c.html));
  ok('3.6 confirmación: QR solo si hay qrUrl', c.html.indexOf('cid:qr1') >= 0 && T.customer_deposit_confirmation.build(b, {}).html.indexOf('cid:') < 0);
  ok('3.7 d7 y d6 llevan el enlace de saldo y la fecha',
    ['balance_reminder_d7', 'balance_reminder_d6'].every(function (n) { const r = T[n].build(b, ctx); return r.html.indexOf(ctx.balanceUrl) >= 0 && r.text.indexOf('2027-03-04') >= 0; }));
  const d6 = T.balance_reminder_d6.build(b, ctx);
  ok('3.8 d6: último día ES/EN', d6.text.indexOf('hoy es el último día') >= 0 && d6.text.indexOf('today is the last day') >= 0);
  const can = T.customer_deposit_cancelled.build(b, ctx);
  ok('3.9 cancelación: depósito no reembolsable y contacto',
    can.text.indexOf('no es reembolsable') >= 0 && can.text.indexOf('non-refundable') >= 0 && can.text.indexOf('hola@example.test') >= 0 && can.html.indexOf('hola@example.test') >= 0);
  ok('3.10 recibo de saldo: pagado por completo',
    /fully paid/.test(T.customer_balance_receipt.build(b, ctx).text) && /pagada por completo/.test(T.customer_balance_receipt.build(b, ctx).text));
  const on = T.owner_deposit_notification.build(b, ctx);
  ok('3.11 owner depósito: código, montos, vencimiento y panel',
    ['HA-2027-ABCDEF', '$360.00', '$840.00', '2027-03-04', '/admin.html'].every(function (s) { return on.html.indexOf(s) >= 0; }) && on.text.indexOf('2027-03-04') >= 0);
  ok('3.12 owner saldo recibido: método solo si existe',
    T.owner_balance_received.build(b, ctx).html.indexOf('Efectivo') >= 0 && T.owner_balance_received.build(Object.assign({}, b, { balance_payment_method: null }), ctx).html.indexOf('Método') < 0);
  ok('3.13 owner cancelado: depósito retenido', /retenido/.test(T.owner_deposit_cancelled.build(b, ctx).text));
  const pr = T.owner_payment_review.build(b, ctx);
  ok('3.14 owner revisión: pago posterior a la cancelación, sin reactivar',
    /DESPUÉS/.test(pr.text) && /reembolsar o reactivar/.test(pr.text) && /no se reactiv/i.test(pr.text));
  const evil = Object.assign({}, b, { customer_name: '<script>x</script>' });
  ok('3.15 html escapa customer_name en los 9', names9.every(function (n) { return T[n].build(evil, ctx).html.indexOf('<script>x') < 0; }));
  const old = ['customer_booking_confirmation', 'owner_booking_notification', 'customer_quote_acknowledgement', 'owner_quote_notification',
    'customer_agency_confirmation', 'owner_agency_notification', 'customer_passenger_form_invitation', 'owner_passenger_form_submitted',
    'customer_passenger_form_changes_requested', 'customer_passenger_form_completed', 'pretrip_reminder_d7', 'pretrip_reminder_d5',
    'pretrip_reminder_d3', 'pretrip_reminder_d1', 'pretrip_reminder_d0'];
  ok('3.16 TEMPLATES conserva las claves previas con su build', old.every(function (n) { return T[n] && typeof T[n].build === 'function'; })
    && T.customer_booking_confirmation.build({ booking_code: 'X' }, {}).subject.indexOf('confirmed') >= 0 && Object.keys(T).length === 24);
}

/* ---------------- 4 · checkout ---------------- */
(async function checkoutSection() {
  console.log('\n--- 4 · checkout ---');
  const path = require('path');
  const BASE = path.resolve(__dirname, '..');
  const { createFakeSupabase } = require('./helpers/fake-supabase');
  const P = require('../server/lib/deposit-policy');
  const { shiftYmd } = require('../server/lib/pretrip-reminders');
  const { todayInGalapagos } = require('../server/lib/http');

  /* dobles solo para esta sección: se registran justo antes de cargar los handlers */
  let FAKE = createFakeSupabase({});
  const STRIPE = { creates: [], retrieves: [], cancels: [], status: 'requires_payment_method' };
  const fakeStripe = { paymentIntents: {
    create: async function (params, opts) { STRIPE.creates.push({ params: params, opts: opts }); return { id: 'pi_' + STRIPE.creates.length, client_secret: 'cs_' + STRIPE.creates.length, status: 'requires_payment_method' }; },
    retrieve: async function (id) { STRIPE.retrieves.push(id); return { id: id, client_secret: 'cs_old', status: STRIPE.status }; },
    cancel: async function (id) { STRIPE.cancels.push(id); return {}; }
  } };
  function mockModule(rel, exp) { const f = require.resolve(BASE + rel); require.cache[f] = { id: f, filename: f, loaded: true, exports: exp }; }
  mockModule('/server/lib/supabase.js', { getSupabase: function () { return FAKE; } });
  mockModule('/server/lib/stripe.js', { getStripe: function () { return fakeStripe; } });
  mockModule('/server/lib/tour-notes.js', {
    getPublicNotesForTour: async function () { return { notes: [], notes_version: null, requires_acknowledgement: false }; },
    resolveNotesForBooking: async function () { return { snapshot: [], acknowledgedAt: null, acknowledgementVersion: null }; }
  });
  process.env.TENANT_ID = 'hook-adventure';
  const createHandler = require(BASE + '/api/create-payment-intent.js');
  const previewHandler = require(BASE + '/api/pricing-preview.js');

  function mockRes() { return { statusCode: 200, headers: {}, body: null, setHeader: function (k, v) { this.headers[String(k).toLowerCase()] = v; }, end: function (b) { this.body = b; } }; }
  async function call(handler, body) {
    const res = mockRes();
    await handler({ method: 'POST', headers: {}, body: body }, res);
    let data = {}; try { data = JSON.parse(res.body); } catch (e) {}
    return { status: res.statusCode, data: data };
  }
  function fresh(rules) {
    FAKE = createFakeSupabase({ bookings: [], discount_rules: rules || [] });
    STRIPE.creates = []; STRIPE.retrieves = []; STRIPE.cancels = []; STRIPE.status = 'requires_payment_method';
  }
  let n = 0;
  function uuid() { n++; return '00000000-0000-4000-8000-' + String(200000000000 + n); }
  const today = todayInGalapagos();
  const ACK = { accepted: true, version: P.DEPOSIT_TERMS_VERSION };
  function body(extra) {
    return Object.assign({ request_id: uuid(), tour_id: 'kicker', booking_date: shiftYmd(today, 40), guests: 2,
      customer_name: 'Ana Pérez', customer_email: 'ana@example.com' }, extra || {});
  }
  const rows = function () { return FAKE.db.tables.bookings; };

  // 4.1-4.4 camino feliz del depósito
  fresh();
  let b = body({ payment_plan: 'deposit', deposit_ack: ACK });
  let r = await call(createHandler, b);
  let row = rows()[0] || {};
  const split = P.splitAmounts(row.amount_cents), dd = P.depositDates(b.booking_date);
  ok('4.1 depósito T+40: fila con plan, importes y 3 fechas congeladas',
    r.status === 200 && rows().length === 1 && row.payment_plan === 'deposit' && row.deposit_cents === split.depositCents && row.balance_cents === split.balanceCents
    && row.deposit_cents + row.balance_cents === row.amount_cents && row.amount_cents === 39000
    && row.balance_due_date === dd.balanceDueDate && row.deposit_refundable_until === dd.depositRefundableUntil && row.balance_refundable_until === dd.balanceRefundableUntil);
  ok('4.2 depósito: versión de términos y fecha de aceptación guardadas',
    row.deposit_terms_version === P.DEPOSIT_TERMS_VERSION && typeof row.deposit_terms_accepted_at === 'string' && !isNaN(Date.parse(row.deposit_terms_accepted_at)));
  const c = STRIPE.creates[0] || { params: { metadata: {} }, opts: {} };
  ok('4.3 Stripe cobra solo el depósito, kind=deposit e idempotencyKey por fila',
    STRIPE.creates.length === 1 && c.params.amount === row.deposit_cents && c.params.metadata.kind === 'deposit'
    && c.params.metadata.booking_id === row.id && c.opts.idempotencyKey === 'create-pi:' + row.id);
  ok('4.4 respuesta: chargeCents = depósito, amountCents = total, paymentPlan',
    r.data.chargeCents === row.deposit_cents && r.data.amountCents === row.amount_cents && r.data.paymentPlan === 'deposit' && r.data.clientSecret === 'cs_1');

  // 4.5 demasiado cerca (T+30): sin fila y sin Stripe
  fresh();
  r = await call(createHandler, body({ booking_date: shiftYmd(today, 30), payment_plan: 'deposit', deposit_ack: ACK }));
  ok('4.5 depósito T+30 → 400 DEPOSIT_NOT_ELIGIBLE, sin insert ni Stripe',
    r.status === 400 && r.data.error === 'DEPOSIT_NOT_ELIGIBLE' && rows().length === 0 && STRIPE.creates.length === 0);

  // 4.6 términos
  fresh();
  r = await call(createHandler, body({ payment_plan: 'deposit' }));
  let r2 = await call(createHandler, body({ payment_plan: 'deposit', deposit_ack: { accepted: true, version: 'vieja' } }));
  let r3 = await call(createHandler, body({ payment_plan: 'deposit', deposit_ack: { accepted: false, version: P.DEPOSIT_TERMS_VERSION } }));
  ok('4.6 depósito sin ack, con versión errónea o sin aceptar → 400 DEPOSIT_TERMS_REQUIRED',
    [r, r2, r3].every(function (x) { return x.status === 400 && x.data.error === 'DEPOSIT_TERMS_REQUIRED'; }) && rows().length === 0 && STRIPE.creates.length === 0);

  // 4.7 plan desconocido
  r = await call(createHandler, body({ payment_plan: 'cuotas' }));
  ok('4.7 plan desconocido → 400 INVALID_PAYMENT_PLAN', r.status === 400 && r.data.error === 'INVALID_PAYMENT_PLAN' && rows().length === 0);

  // 4.8 mismo request_id con otro plan
  fresh();
  b = body();
  r = await call(createHandler, b);
  r2 = await call(createHandler, Object.assign({}, b, { payment_plan: 'deposit', deposit_ack: ACK }));
  ok('4.8 mismo request_id: full y luego deposit → 409 REQUEST_ID_CONFLICT',
    r.status === 200 && r2.status === 409 && r2.data.error === 'REQUEST_ID_CONFLICT' && STRIPE.creates.length === 1);

  // 4.9-4.10 pago completo sin cambios
  fresh();
  r = await call(createHandler, body());
  row = rows()[0] || {};
  ok('4.9 sin payment_plan: fila full sin columnas de depósito, PI = total, kind=full',
    r.status === 200 && row.payment_plan === 'full' && row.deposit_cents === undefined && row.balance_cents === undefined && row.balance_due_date === undefined
    && row.deposit_terms_version === undefined && STRIPE.creates[0].params.amount === row.amount_cents && STRIPE.creates[0].params.metadata.kind === 'full'
    && r.data.chargeCents === row.amount_cents && r.data.amountCents === row.amount_cents && r.data.paymentPlan === 'full');
  fresh();
  r = await call(createHandler, body({ payment_plan: 'full', deposit_ack: ACK }));
  ok('4.10 plan full con deposit_ack: se ignora', r.status === 200 && rows()[0].payment_plan === 'full' && rows()[0].deposit_cents === undefined);

  // 4.11 depósito + HOOK20
  fresh([{ id: 'r-h20', tenant_id: 'hook-adventure', active: true, tour_id: 'kicker', code: 'HOOK20', discount_type: 'percentage', percentage_bps: 2000,
    amount_cents: null, min_guests: 1, max_guests: null, starts_at: null, ends_at: null, priority: 0, created_at: '2026-11-26' }]);
  r = await call(createHandler, body({ payment_plan: 'deposit', deposit_ack: ACK, discount_code: 'hook20' }));
  row = rows()[0] || {};
  ok('4.11 depósito + HOOK20: 30 % del total ya descontado',
    r.status === 200 && row.amount_cents === 31200 && row.deposit_cents === 9360 && row.balance_cents === 21840 && STRIPE.creates[0].params.amount === 9360);

  // 4.12-4.13 reanudar respeta la fila congelada, sin re-evaluar elegibilidad
  fresh();
  b = body({ payment_plan: 'deposit', deposit_ack: ACK });
  await call(createHandler, b);
  rows()[0].booking_date = shiftYmd(today, 10); // simula que el reintento llega con la fecha ya "cerca"
  b = Object.assign({}, b, { booking_date: shiftYmd(today, 10) });
  r = await call(createHandler, b);
  ok('4.12 reanudar con PI reutilizable: chargeCents del depósito congelado, sin crear otro PI',
    r.status === 200 && r.data.clientSecret === 'cs_old' && r.data.chargeCents === rows()[0].deposit_cents && r.data.paymentPlan === 'deposit'
    && r.data.amountCents === rows()[0].amount_cents && STRIPE.creates.length === 1);
  STRIPE.status = 'succeeded';
  r = await call(createHandler, b);
  ok('4.13 alreadyPaid incluye paymentPlan', r.status === 200 && r.data.alreadyPaid === true && r.data.paymentPlan === 'deposit');

  // 4.14-4.17 pricing-preview
  fresh();
  r = await call(previewHandler, { tour_id: 'kicker', guests: 2, booking_date: shiftYmd(today, 40) });
  const dp = r.data.deposit || {};
  ok('4.14 preview T+40: bloque deposit completo',
    r.status === 200 && dp.eligible === true && dp.reason === null && dp.pct === 30 && dp.depositCents === 11700 && dp.balanceCents === 27300
    && dp.balanceDueDate === shiftYmd(today, 34) && dp.depositRefundableUntil === shiftYmd(today, 9) && dp.termsVersion === P.DEPOSIT_TERMS_VERSION);
  r = await call(previewHandler, { tour_id: 'kicker', guests: 2, booking_date: shiftYmd(today, 10) });
  ok('4.15 preview T+10: eligible=false, reason=too_close', r.status === 200 && r.data.deposit && r.data.deposit.eligible === false && r.data.deposit.reason === 'too_close');
  r = await call(previewHandler, { tour_id: 'kicker', guests: 2 });
  ok('4.16 preview sin booking_date: sin clave deposit', r.status === 200 && !('deposit' in r.data) && r.data.amountCents === 39000);
  r = await call(previewHandler, { tour_id: 'kicker', guests: 2, booking_date: 'mañana' });
  r3 = await call(previewHandler, { tour_id: 'kicker', guests: 2, booking_date: shiftYmd(today, -3) });
  ok('4.17 preview con fecha mala o pasada: sin deposit y sin error',
    r.status === 200 && !('deposit' in r.data) && r3.status === 200 && !('deposit' in r3.data));
})().then(function () {
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
}, function (e) { console.log('FAIL  sección 4 lanzó: ' + (e && e.stack || e)); process.exit(1); });
