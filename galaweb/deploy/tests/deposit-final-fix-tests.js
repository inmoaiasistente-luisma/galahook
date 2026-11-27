'use strict';

/* =========================================================
   Pruebas — ronda final del depósito 30 % (rama feat/deposit-30).
   I1 correo de reintento con enlace de saldo, I2 reembolsos
   divididos + finanzas, I3 alertas de revisión (handler + panel).
   Las menores (M1, M3, M4, M5/T7, M7) están en
   tests/deposit-final-fix-minor-tests.js.
   Sin red: Supabase en memoria, Stripe y Resend simulados.
   ========================================================= */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BASE = path.resolve(__dirname, '..');
const { createFakeSupabase } = require('./helpers/fake-supabase');
function read(rel) { return fs.readFileSync(path.join(BASE, rel), 'utf8'); }

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }

process.env.TENANT_ID = 'hook-adventure';
process.env.PUBLIC_SITE_URL = 'https://galapagoshookadventure.com';
process.env.QR_SIGNING_SECRET = 'test-secret-final-fix-0123456789';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.EMAIL_FROM = 'Hook <no-reply@example.com>';
process.env.CRON_SECRET = 'cron-secret-final-fix';

const UID = {
  n1: '11111111-1111-4111-8111-111111111111', n2: '22222222-2222-4222-8222-222222222222',
  n3: '33333333-3333-4333-8333-333333333333', b1: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  b2: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
};

let FAKE = createFakeSupabase({});
let ROLE = 'owner';
let AUDIT = [];
let SENT = [];                       // correos que llegan a Resend
let SEQ = [];                        // secuencia de envíos del servicio simulado (reminders-run)
let MAIL = [], OWNER = [];           // webhook
let STRIPE_ON = true, PI_STATUS = 'requires_payment_method', RETRIEVE_THROWS = false, ON_CREATE = null;
let LOG = { creates: [], retrieves: [], cancels: [] };
let USE_MOCK_SERVICE = false;

function mockModule(rel, exp) { const p = require.resolve(BASE + rel); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; }
mockModule('/server/lib/supabase.js', { getSupabase: function () { return FAKE; } });
mockModule('/server/lib/admin-auth.js', {
  requireWriter: async function (req, res) {
    if (ROLE !== 'owner') { res.statusCode = 403; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: { code: 'FORBIDDEN' } })); return null; }
    return { user_id: 'u-owner', role: 'owner', tenant_id: 'hook-adventure', email: 'o@x.z' };
  },
  requireAdmin: async function () { return { user_id: 'u-owner', role: 'owner', tenant_id: 'hook-adventure' }; },
  sameOrigin: function () { return true; }
});
mockModule('/server/lib/admin-audit.js', { recordAudit: async function (s, e) { AUDIT.push({ s: s, e: e }); return true; } });
mockModule('/server/lib/resend.js', {
  getResend: function () { return { emails: { send: async function (p) { SENT.push(p); return { data: { id: 'msg_' + SENT.length } }; } } }; },
  getMailConfig: function () { return { from: 'Hook <no-reply@example.com>', notifyTo: 'Owner@Example.com' }; }
});
const fakeStripe = {
  webhooks: { constructEvent: function (raw) { return JSON.parse(raw); } },
  paymentIntents: {
    create: async function (params, opts) {
      LOG.creates.push({ params: params, opts: opts });
      const pi = { id: 'pi_new_' + LOG.creates.length, client_secret: 'cs_new', status: 'requires_payment_method' };
      if (ON_CREATE) ON_CREATE(pi);
      return pi;
    },
    retrieve: async function (id) {
      LOG.retrieves.push(id);
      if (RETRIEVE_THROWS) throw new Error('stripe down');
      return { id: id, status: PI_STATUS, client_secret: 'cs_old' };
    },
    cancel: async function (id) { LOG.cancels.push(id); return {}; }
  }
};
mockModule('/server/lib/stripe.js', { getStripe: function () { if (!STRIPE_ON) throw new Error('no stripe'); return fakeStripe; } });
mockModule('/server/lib/raw-body.js', { readRawBody: async function (req) { return req.__raw; } });
mockModule('/server/lib/tour-notes.js', {
  getPublicNotesForTour: async function () { return { notes: [], notes_version: null, requires_acknowledgement: false }; },
  resolveNotesForBooking: async function () { return { snapshot: [], acknowledgedAt: null, acknowledgementVersion: null }; }
});
mockModule('/server/lib/passenger-intake.js', { ensurePassengerForm: async function (b) { return { id: 'f1' }; } });
mockModule('/server/lib/passenger-intake-emails.js', { sendInvitation: async function () {} });

const realError = console.error;
console.error = function () {};

function mockRes() { return { statusCode: 200, headers: {}, body: null, setHeader: function (k, v) { this.headers[String(k).toLowerCase()] = v; }, end: function (b) { this.body = b; } }; }
async function callHandler(handler, body, method, extraReq) {
  const res = mockRes();
  await handler(Object.assign({ method: method || 'POST', body: body, headers: {} }, extraReq || {}), res);
  let j = {}; try { j = JSON.parse(res.body); } catch (e) {}
  return { status: res.statusCode, json: j, data: j };
}
async function throws(fn) { try { await fn(); return null; } catch (e) { return e.message; } }
function fresh(tables) { FAKE = createFakeSupabase(tables || {}); AUDIT = []; SENT = []; SEQ = []; MAIL = []; OWNER = []; LOG = { creates: [], retrieves: [], cancels: [] }; PI_STATUS = 'requires_payment_method'; RETRIEVE_THROWS = false; ON_CREATE = null; STRIPE_ON = true; }

const { shiftYmd } = require(BASE + '/server/lib/pretrip-reminders.js');
const { todayInGalapagos } = require(BASE + '/server/lib/http.js');
const P = require(BASE + '/server/lib/deposit-policy.js');
const EV_ISO = new Date(1790000000 * 1000).toISOString();

function depBooking(extra) {
  return Object.assign({
    id: 'b-1', tenant_id: 'hook-adventure', booking_code: 'HK-1', currency: 'usd',
    customer_name: 'Ana', customer_email: 'ana@example.com', tour_name: 'León Dormido', booking_date: '2027-03-10', guests: 2,
    amount_cents: 100000, payment_plan: 'deposit', deposit_cents: 30000, balance_cents: 70000, balance_due_date: '2027-03-04',
    deposit_refundable_until: '2027-02-07', balance_refundable_until: '2027-02-22',
    payment_status: 'deposit_paid', booking_status: 'confirmed',
    stripe_payment_intent_id: 'pi_dep', balance_payment_intent_id: 'pi_bal',
    paid_at: null, deposit_paid_at: null, balance_paid_at: null, balance_payment_method: null,
    needs_review_reason: null, cancel_reason: null, auto_cancelled_at: null
  }, extra || {});
}

(async function main() {
  /* =====================================================
     I1 · reintento / servicio: el enlace de saldo nunca falta
     ===================================================== */
  const service = require(BASE + '/server/lib/booking-email-service.js');
  const emailRetry = require(BASE + '/server/admin-handlers/email-retry.js');
  const retryBatch = require(BASE + '/server/admin-handlers/notifications-retry-batch.js');
  const LINK_TYPES = ['customer_deposit_confirmation', 'balance_reminder_d7', 'balance_reminder_d6'];

  for (let i = 0; i < LINK_TYPES.length; i++) {
    const t = LINK_TYPES[i];
    fresh({ bookings: [depBooking()], email_notifications: [], email_notification_attempts: [] });
    FAKE.db.unique.email_notifications = 'idempotency_key';
    const r = await service.sendBookingEmail({ booking: depBooking(), type: t, recipient: 'ana@example.com' });
    const p = SENT[0] || {};
    ok('1.' + (i + 1) + ' sin ctx: ' + t + ' se envía con /saldo#t= en html y texto',
      r.sent === true && SENT.length === 1 && /\/saldo#t=/.test(p.html || '') && /\/saldo#t=/.test(p.text || '')
      && (p.html || '').indexOf(P.balanceUrl('b-1').replace(/&/g, '&amp;')) !== -1);
  }

  /* 1.4 sin QR_SIGNING_SECRET: falla tras reclamar la fila, no envía y queda reintentable */
  for (let i = 0; i < LINK_TYPES.length; i++) {
    const t = LINK_TYPES[i];
    fresh({ bookings: [depBooking()], email_notifications: [], email_notification_attempts: [] });
    FAKE.db.unique.email_notifications = 'idempotency_key';
    const secret = process.env.QR_SIGNING_SECRET;
    delete process.env.QR_SIGNING_SECRET;
    const r = await service.sendBookingEmail({ booking: depBooking(), type: t, recipient: 'ana@example.com' });
    process.env.QR_SIGNING_SECRET = secret;
    const row = FAKE.db.tables.email_notifications[0] || {};
    ok('1.4.' + (i + 1) + ' sin secreto: ' + t + ' falla, Resend no se llama y la fila queda failed con last_error',
      r.failed === true && SENT.length === 0 && row.status === 'failed' && /balance_url_unavailable/.test(row.last_error || '') && row.attempts === 1);
  }
  /* 1.5 un ctx explícito con balanceUrl se respeta tal cual */
  fresh({ bookings: [depBooking()], email_notifications: [], email_notification_attempts: [] });
  FAKE.db.unique.email_notifications = 'idempotency_key';
  await service.sendBookingEmail({ booking: depBooking(), type: 'balance_reminder_d7', recipient: 'ana@example.com', ctx: { balanceUrl: 'https://x.test/saldo#t=EXPL' } });
  ok('1.5 ctx.balanceUrl explícito se conserva', /saldo#t=EXPL/.test((SENT[0] || {}).html || ''));

  /* 1.6 owner_payment_review: sin ctx usa needs_review_reason del booking; ctx explícito gana */
  fresh({ bookings: [], email_notifications: [], email_notification_attempts: [] });
  FAKE.db.unique.email_notifications = 'idempotency_key';
  await service.sendBookingEmail({ booking: depBooking({ needs_review_reason: 'balance_paid_twice' }), type: 'owner_payment_review', recipient: 'owner@example.com' });
  ok('1.6 owner_payment_review sin ctx usa el motivo de la reserva', /reembolsa el cobro duplicado en Stripe/.test((SENT[0] || {}).text || ''));
  fresh({ bookings: [], email_notifications: [], email_notification_attempts: [] });
  FAKE.db.unique.email_notifications = 'idempotency_key';
  await service.sendBookingEmail({ booking: depBooking({ needs_review_reason: 'balance_paid_twice' }), type: 'owner_payment_review', recipient: 'owner@example.com', ctx: { reason: 'balance_paid_after_cancel' } });
  ok('1.7 owner_payment_review con ctx.reason: gana el ctx', /ya estaba cancelada/.test((SENT[0] || {}).text || ''));

  /* 1.8-1.10 reintento desde el panel (handler real) */
  function failedRow(id, type, extra) {
    return Object.assign({ id: id, booking_id: 'b-1', tenant_id: 'hook-adventure', notification_type: type, recipient_email: 'ana@example.com',
      status: 'failed', attempts: 1, idempotency_key: type + ':b-1:ana@example.com', last_error: 'x' }, extra || {});
  }
  fresh({ bookings: [depBooking()], email_notifications: [failedRow(UID.n1, 'balance_reminder_d6')], email_notification_attempts: [] });
  FAKE.db.unique.email_notifications = 'idempotency_key';
  let r = await callHandler(emailRetry, { notification_id: UID.n1 });
  ok('1.8 email-retry de balance_reminder_d6 sale con el enlace de saldo', r.status === 200 && r.json.status === 'sent' && /\/saldo#t=/.test((SENT[0] || {}).html || ''));

  fresh({ bookings: [depBooking()], email_notifications: [failedRow(UID.n1, 'customer_deposit_confirmation'), failedRow(UID.n2, 'balance_reminder_d7')], email_notification_attempts: [] });
  FAKE.db.unique.email_notifications = 'idempotency_key';
  r = await callHandler(retryBatch, { notification_ids: [UID.n1, UID.n2], confirmation: 'RETRY FAILED EMAILS' });
  ok('1.9 reintento por lote: ambos correos llevan /saldo#t=',
    r.status === 200 && r.json.summary && r.json.summary.sent === 2 && SENT.length === 2 && SENT.every(function (p) { return /\/saldo#t=/.test(p.html); }));

  fresh({ bookings: [depBooking({ needs_review_reason: 'balance_paid_after_cancel' })],
    email_notifications: [failedRow(UID.n1, 'owner_payment_review', { recipient_email: 'owner@example.com', idempotency_key: 'owner_payment_review:b-1:owner@example.com' })], email_notification_attempts: [] });
  FAKE.db.unique.email_notifications = 'idempotency_key';
  r = await callHandler(emailRetry, { notification_id: UID.n1 });
  ok('1.10 email-retry de owner_payment_review conserva el motivo de la reserva', r.json.status === 'sent' && /ya estaba cancelada/.test((SENT[0] || {}).text || ''));

  /* 1.11 si falla por falta de secreto y luego se reintenta con el secreto, sale con enlace */
  fresh({ bookings: [depBooking()], email_notifications: [], email_notification_attempts: [] });
  FAKE.db.unique.email_notifications = 'idempotency_key';
  const sec0 = process.env.QR_SIGNING_SECRET; delete process.env.QR_SIGNING_SECRET;
  await service.sendBookingEmail({ booking: depBooking(), type: 'customer_deposit_confirmation', recipient: 'ana@example.com' });
  process.env.QR_SIGNING_SECRET = sec0;
  const failedId = FAKE.db.tables.email_notifications[0].id;
  FAKE.db.tables.bookings = [depBooking()];
  r = await callHandler(emailRetry, { notification_id: failedId });
  ok('1.11 fallo sin secreto es reintentable y la 2ª vez sale con enlace', r.json.status === 'sent' && /\/saldo#t=/.test((SENT[0] || {}).html || '') && FAKE.db.tables.email_notifications[0].status === 'sent');

  /* =====================================================
     Cambia a servicio simulado para el webhook y el barrido
     ===================================================== */
  mockModule('/server/lib/booking-email-service.js', {
    notifyBooking: async function (b, c, o, ctx) { MAIL.push({ booking: b, customerType: c, ownerType: o, ctx: ctx }); SEQ.push('notify:' + c); return { customer: { sent: true }, owner: { sent: true } }; },
    sendBookingEmail: async function (o) { OWNER.push(o); SEQ.push('send:' + o.type); return { sent: true }; }, QR_CID: 'qr'
  });
  const webhook = require(BASE + '/api/stripe-webhook.js');
  const processEvent = webhook._test.processEvent;

  function row(id) { return FAKE.db.tables.bookings.filter(function (x) { return x.id === (id || 'b-1'); })[0]; }
  function piEvent(type, obj, id) { return { id: id || 'evt_1', type: type, created: 1790000000, livemode: false, data: { object: obj } }; }
  function pi(id, amount, kind) { return { id: id, amount: amount, amount_received: amount, currency: 'usd', created: 1790000000, metadata: { tenant_id: 'hook-adventure', booking_id: 'b-1', booking_code: 'HK-1', kind: kind } }; }
  function charge(piId, amount, full) { return { id: 'ch_1', payment_intent: piId, amount: amount, amount_refunded: full ? amount : 100, refunded: !!full }; }
  function ledgerNote(note) { return FAKE.db.writes.some(function (w) { return w.table === 'stripe_webhook_events' && w.payload && w.payload.payload && w.payload.payload.note === note; }); }
  function reset(rows) { fresh({ bookings: rows, stripe_webhook_events: [] }); }
  const refundDep = function () { return processEvent(FAKE, piEvent('charge.refunded', charge('pi_dep', 30000, true), 'evt_rd')); };
  const refundBal = function () { return processEvent(FAKE, piEvent('charge.refunded', charge('pi_bal', 70000, true), 'evt_rb')); };
  const PAID_STRIPE = { payment_status: 'paid', booking_status: 'confirmed', balance_paid_at: '2027-01-05T10:00:00.000Z', balance_payment_method: 'stripe' };

  /* ---------- I2 · reembolsos divididos ---------- */
  reset([depBooking(PAID_STRIPE)]);
  await refundBal();
  let b = row();
  ok('2.1 reembolso del saldo solo: cancelada + deposit_paid + balance_refunded_at, sin revisión',
    b.booking_status === 'cancelled' && b.payment_status === 'deposit_paid' && b.balance_refunded_at === EV_ISO && !b.deposit_refunded_at && b.needs_review_reason === null);

  reset([depBooking(PAID_STRIPE)]);
  await refundDep();
  b = row();
  ok('2.2 reembolso del depósito con saldo Stripe vigente: revisión, deposit_refunded_at, sin cambio de estado',
    b.needs_review_reason === 'refund_review' && b.deposit_refunded_at === EV_ISO && b.payment_status === 'paid' && b.booking_status === 'confirmed');
  await refundBal();
  b = row();
  ok('2.3 luego el saldo: refunded + cancelled + sin revisión (orden depósito → saldo)',
    b.payment_status === 'refunded' && b.booking_status === 'cancelled' && b.needs_review_reason === null && b.deposit_refunded_at === EV_ISO && b.balance_refunded_at === EV_ISO);

  reset([depBooking(PAID_STRIPE)]);
  await refundBal();
  await refundDep();
  b = row();
  ok('2.4 orden saldo → depósito: refunded + cancelled + sin revisión',
    b.payment_status === 'refunded' && b.booking_status === 'cancelled' && b.needs_review_reason === null && b.deposit_refunded_at === EV_ISO && b.balance_refunded_at === EV_ISO);

  reset([depBooking({ payment_status: 'paid', booking_status: 'confirmed', balance_paid_at: '2027-01-05T10:00:00.000Z', balance_payment_method: 'cash' })]);
  await refundDep();
  b = row();
  ok('2.5 depósito reembolsado con saldo en efectivo: refund_review, estado intacto, deposit_refunded_at',
    b.needs_review_reason === 'refund_review' && b.deposit_refunded_at === EV_ISO && b.payment_status === 'paid' && b.booking_status === 'confirmed');
  ok('2.5b ...y deja nota en el ledger', ledgerNote('refund_review_manual'));

  reset([depBooking({ payment_status: 'paid', booking_status: 'confirmed', balance_paid_at: '2027-01-05T10:00:00.000Z', balance_payment_method: 'cash', needs_review_reason: 'balance_paid_twice' })]);
  await refundBal();
  b = row();
  ok('2.6 cobro Stripe duplicado reembolsado tras saldo en efectivo: sin cambio de estado ni de saldo, revisión limpia',
    b.needs_review_reason === null && b.payment_status === 'paid' && b.booking_status === 'confirmed' && b.balance_payment_method === 'cash'
    && b.balance_paid_at === '2027-01-05T10:00:00.000Z' && !b.balance_refunded_at && ledgerNote('duplicate_balance_refunded'));

  reset([depBooking({ payment_status: 'paid', booking_status: 'confirmed', balance_payment_method: 'transfer', balance_paid_at: 'x', needs_review_reason: 'refund_review' })]);
  await refundBal();
  ok('2.6b duplicado con saldo por transferencia: otro motivo de revisión no se borra', row().needs_review_reason === 'refund_review' && !row().balance_refunded_at);

  reset([depBooking()]);
  await refundDep();
  b = row();
  ok('2.7 depósito reembolsado con saldo sin pagar: refunded + cancelled + deposit_refunded_at',
    b.payment_status === 'refunded' && b.booking_status === 'cancelled' && b.deposit_refunded_at === EV_ISO && b.needs_review_reason === null);

  reset([depBooking(PAID_STRIPE)]);
  await processEvent(FAKE, piEvent('charge.refunded', charge('pi_bal', 70000, false), 'evt_p'));
  b = row();
  ok('2.8 reembolso parcial: sin cambio y sin columnas de reembolso', b.payment_status === 'paid' && b.booking_status === 'confirmed' && !b.balance_refunded_at && !b.deposit_refunded_at && ledgerNote('partial_or_no_pi_manual_review'));

  reset([depBooking({ payment_plan: 'full', payment_status: 'paid', booking_status: 'confirmed', stripe_payment_intent_id: 'pi_full', balance_payment_intent_id: null, deposit_cents: null, balance_cents: null })]);
  await processEvent(FAKE, piEvent('charge.refunded', charge('pi_full', 100000, true), 'evt_f'));
  ok('2.9 pago completo reembolsado: refunded + cancelled como antes', row().payment_status === 'refunded' && row().booking_status === 'cancelled');

  reset([depBooking({ payment_status: 'refunded', booking_status: 'cancelled', deposit_refunded_at: EV_ISO, balance_paid_at: '2027-02-01T00:00:00.000Z', balance_payment_method: 'stripe', needs_review_reason: 'balance_paid_after_cancel' })]);
  await refundBal();
  b = row();
  ok('2.10 saldo pagado tras cancelar y luego reembolsado: refunded/cancelled, revisión limpia',
    b.payment_status === 'refunded' && b.booking_status === 'cancelled' && b.needs_review_reason === null && b.balance_refunded_at === EV_ISO);

  reset([depBooking({ payment_status: 'deposit_paid', booking_status: 'cancelled', balance_paid_at: '2027-02-01T00:00:00.000Z', balance_payment_method: 'stripe', needs_review_reason: 'balance_paid_after_cancel' })]);
  await refundBal();
  b = row();
  ok('2.11 saldo pagado tras autocancelación y reembolsado: cancelada + deposit_paid (solo se retiene el depósito)',
    b.payment_status === 'deposit_paid' && b.booking_status === 'cancelled' && b.needs_review_reason === null && b.balance_refunded_at === EV_ISO);

  reset([depBooking(PAID_STRIPE), depBooking({ id: 'b-2', booking_code: 'HK-2', stripe_payment_intent_id: 'pi_x', balance_payment_intent_id: 'pi_y' })]);
  const mm = await throws(function () { return processEvent(FAKE, piEvent('charge.refunded', charge('pi_zzz', 70000, true), 'evt_z')); });
  ok('2.12 reembolso ajeno sigue devolviendo sin error y sin tocar reservas', mm === null && row().payment_status === 'paid' && ledgerNote('no_booking_ignored'));

  /* ---------- I2 · finanzas ---------- */
  const finance = require(BASE + '/server/admin-handlers/finance-summary.js');
  async function fin(query, rows) {
    fresh({ bookings: rows });
    const qs = Object.keys(query || {}).map(function (k) { return k + '=' + query[k]; }).join('&');
    const res = mockRes();
    await finance({ method: 'GET', url: '/api/admin-finance-summary' + (qs ? '?' + qs : ''), headers: {} }, res);
    return JSON.parse(res.body);
  }
  let SQ = 0;
  function frow(extra) {
    SQ += 1;
    return Object.assign({ id: 'f' + SQ, tenant_id: 'hook-adventure', request_type: 'booking', deleted_at: null, sales_channel: 'web', tour_id: 'p4', tour_name: 'P4',
      payment_plan: 'deposit', payment_status: 'paid', booking_status: 'confirmed', amount_cents: 120000, deposit_cents: 36000, balance_cents: 84000,
      cost_cents: null, cost_status: 'unset', guests: 2, paid_at: '2026-11-10T15:00:00.000Z', sold_at: null, balance_paid_at: null, balance_payment_method: null }, extra || {});
  }
  let f = await fin({}, [frow({ payment_status: 'deposit_paid', booking_status: 'cancelled', balance_paid_at: '2026-11-12T10:00:00.000Z', balance_payment_method: 'stripe', balance_refunded_at: '2026-11-13T10:00:00.000Z' })]);
  ok('3.1 saldo reembolsado (cancelada + deposit_paid): retenido = depósito, cobrado = depósito',
    f.retained_deposits_cents === 36000 && f.retained_deposits_count === 1 && f.collected_cents === 36000 && f.by_method.stripe.amount_cents === 36000 && f.counts.total === 0);
  f = await fin({}, [frow({ payment_status: 'refunded', booking_status: 'cancelled', deposit_refunded_at: 'x', balance_refunded_at: 'y' })]);
  ok('3.2 ambos reembolsados (refunded): fuera de finanzas', f.collected_cents === 0 && f.counts.total === 0 && f.retained_deposits_count === 0 && f.pending_cents === 0);
  f = await fin({}, [frow({ amount_cents: 50000, deposit_cents: 15000, balance_cents: 35000, balance_paid_at: '2026-11-12T10:00:00.000Z', balance_payment_method: 'cash', deposit_refunded_at: '2026-11-20T10:00:00.000Z' })]);
  ok('3.3 depósito reembolsado con saldo en efectivo: cobrado = saldo; la venta sigue contando',
    f.collected_cents === 35000 && f.by_method.cash.amount_cents === 35000 && f.by_method.stripe.amount_cents === 0 && f.by_method.stripe.count === 0
    && f.counts.total === 1 && f.revenue.total === 50000 && f.pending_cents === 0 && f.retained_deposits_cents === 0);
  f = await fin({}, [frow({ balance_paid_at: '2026-11-12T10:00:00.000Z', balance_payment_method: 'stripe', balance_refunded_at: '2026-11-13T10:00:00.000Z' })]);
  ok('3.4 saldo reembolsado en reserva reactivada: ni cobrado ni por cobrar',
    f.collected_cents === 36000 && f.pending_cents === 0 && f.by_method.stripe.amount_cents === 36000 && f.by_method.stripe.count === 1 && f.counts.total === 1);
  f = await fin({ date_from: '2026-11-01', date_to: '2026-11-30' }, [frow({ paid_at: '2026-10-10T15:00:00.000Z', balance_paid_at: '2026-11-12T10:00:00.000Z', balance_payment_method: 'cash', balance_refunded_at: '2026-11-14T10:00:00.000Z' })]);
  ok('3.5 saldo tardío reembolsado: no entra en el cobrado del rango', f.collected_cents === 0 && f.by_method.cash.amount_cents === 0);
  f = await fin({ date_from: '2026-11-01', date_to: '2026-11-30' }, [frow({ paid_at: '2026-10-10T15:00:00.000Z', balance_paid_at: '2026-11-12T10:00:00.000Z', balance_payment_method: 'cash' })]);
  ok('3.5b control: el saldo tardío sin reembolso sí cuenta', f.collected_cents === 84000 && f.by_method.cash.amount_cents === 84000);
  f = await fin({}, [frow({ payment_status: 'deposit_paid', booking_status: 'cancelled', deposit_refunded_at: '2026-11-20T10:00:00.000Z' })]);
  ok('3.6 cancelada con depósito reembolsado: no es depósito retenido', f.retained_deposits_cents === 0 && f.retained_deposits_count === 0 && f.collected_cents === 0 && f.by_method.stripe.count === 0);
  f = await fin({}, [frow({ payment_status: 'deposit_paid', booking_status: 'confirmed' })]);
  ok('3.7 control: depósito vigente sin reembolsos cuenta como siempre', f.collected_cents === 36000 && f.pending_cents === 84000 && f.counts.total === 1);

  /* ---------- I3 · saldo pagado tras cancelar ---------- */
  reset([depBooking({ payment_status: 'deposit_paid', booking_status: 'cancelled', cancel_reason: 'balance_unpaid', auto_cancelled_at: 'x' })]);
  await processEvent(FAKE, piEvent('payment_intent.succeeded', pi('pi_bal', 70000, 'balance')));
  b = row();
  ok('4.1 tras autocancelación: balance_paid_at + stripe + paid; sigue cancelada con revisión',
    b.payment_status === 'paid' && b.balance_paid_at === EV_ISO && b.balance_payment_method === 'stripe' && b.booking_status === 'cancelled' && b.needs_review_reason === 'balance_paid_after_cancel');
  ok('4.2 ...y avisa al dueño (owner_payment_review) sin correo al cliente', OWNER.length === 1 && OWNER[0].type === 'owner_payment_review' && OWNER[0].ctx.reason === 'balance_paid_after_cancel' && MAIL.length === 0);
  row().booking_status = 'confirmed';   // el dueño reactiva desde el panel
  b = row();
  ok('4.3 reactivada: queda como una reserva con depósito totalmente pagada', b.payment_status === 'paid' && b.booking_status === 'confirmed' && b.balance_paid_at === EV_ISO && b.balance_payment_method === 'stripe');

  reset([depBooking({ payment_status: 'refunded', booking_status: 'cancelled', deposit_refunded_at: EV_ISO })]);
  await processEvent(FAKE, piEvent('payment_intent.succeeded', pi('pi_bal', 70000, 'balance')));
  b = row();
  ok('4.4 tras reembolso del depósito: refunded se queda, pero el saldo queda registrado',
    b.payment_status === 'refunded' && b.booking_status === 'cancelled' && b.balance_paid_at === EV_ISO && b.balance_payment_method === 'stripe' && b.needs_review_reason === 'balance_paid_after_cancel');

  /* ---------- I3 · acción booking-review-clear ---------- */
  const clearH = require(BASE + '/server/admin-handlers/booking-review-clear.js');
  const REV = { id: UID.b1, tenant_id: 'hook-adventure', needs_review_reason: 'balance_paid_after_cancel' };
  fresh({ bookings: [Object.assign({}, REV)] });
  let c = await callHandler(clearH, { booking_id: UID.b1 }, 'GET');
  ok('5.1 GET → 405', c.status === 405);
  ROLE = 'admin';
  c = await callHandler(clearH, { booking_id: UID.b1 });
  ok('5.2 no owner → 403 y no limpia', c.status === 403 && FAKE.db.tables.bookings[0].needs_review_reason === 'balance_paid_after_cancel');
  ROLE = 'owner';
  c = await callHandler(clearH, { booking_id: 'no-uuid' });
  ok('5.3 booking_id inválido → 400', c.status === 400);
  c = await callHandler(clearH, { booking_id: UID.b1, extra: 1 });
  ok('5.4 clave desconocida → 400', c.status === 400);
  c = await callHandler(clearH, { booking_id: UID.b1, note: 'x'.repeat(501) });
  ok('5.5 nota de 501 caracteres → 400 y no limpia', c.status === 400 && FAKE.db.tables.bookings[0].needs_review_reason === 'balance_paid_after_cancel');
  c = await callHandler(clearH, { booking_id: UID.b1, note: 7 });
  ok('5.5b nota que no es texto → 400', c.status === 400);
  c = await callHandler(clearH, { booking_id: UID.b1, note: '  Reembolsado en Stripe  ' });
  ok('5.6 owner limpia la revisión: 200 y needs_review_reason null', c.status === 200 && c.json.ok === true && FAKE.db.tables.bookings[0].needs_review_reason === null);
  const au = AUDIT[0] || { e: {} };
  ok('5.7 auditoría booking.review_cleared con antes/después y nota recortada',
    AUDIT.length === 1 && au.e.action === 'booking.review_cleared' && au.e.entity_type === 'booking' && au.e.entity_id === UID.b1
    && au.e.before.needs_review_reason === 'balance_paid_after_cancel' && au.e.after.needs_review_reason === null && au.e.after.note === 'Reembolsado en Stripe');
  c = await callHandler(clearH, { booking_id: UID.b1 });
  ok('5.8 sin nada que revisar → 409 NOTHING_TO_REVIEW', c.status === 409 && c.json.error === 'NOTHING_TO_REVIEW' && AUDIT.length === 1);
  fresh({ bookings: [Object.assign({}, REV, { tenant_id: 'otro' })] });
  c = await callHandler(clearH, { booking_id: UID.b1 });
  ok('5.9 reserva de otro tenant → 409 y sin cambios', c.status === 409 && FAKE.db.tables.bookings[0].needs_review_reason === 'balance_paid_after_cancel');
  fresh({ bookings: [Object.assign({}, REV)] });
  c = await callHandler(clearH, { booking_id: UID.b1 });
  ok('5.10 sin nota: after.note null', c.status === 200 && AUDIT[0].e.after.note === null);

  const vj = JSON.parse(read('vercel.json'));
  ok('5.11 rewrite admin-booking-review-clear', vj.rewrites.some(function (x) { return x.source === '/api/admin-booking-review-clear' && x.destination === '/api/admin-router?action=booking-review-clear'; }));
  ok('5.12 router registra booking-review-clear', /ROUTES\['booking-review-clear'\] = require\('\.\.\/server\/admin-handlers\/booking-review-clear'\)/.test(read('api/admin-router.js')));
  ok('5.13 api/ mantiene 11 funciones', fs.readdirSync(path.join(BASE, 'api')).filter(function (x) { return /\.js$/.test(x); }).length === 11);

  /* ---------- Admin UI (vm) ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function loadUi(over) {
    const sandbox = { window: {}, console: console, Promise: Promise };
    vm.createContext(sandbox);
    vm.runInContext(read('assets/js/admin-deposit.js'), sandbox);
    const calls = [], toasts = [];
    const deps = Object.assign({
      ES: true, escapeHtml: esc, money: function (x) { return x == null ? '—' : '$' + (x / 100).toFixed(0); },
      fmtDate: function (s) { return s ? 'D(' + s + ')' : '—'; }, fmtDT: function (s) { return s ? 'T(' + s + ')' : '—'; },
      canWrite: function () { return true; }, adminToast: function (m) { toasts.push(m); },
      confirm: function () { return true; },
      apiPost: function (url, body) { calls.push({ url: url, body: body }); return Promise.resolve({ ok: true, status: 200, data: { ok: true } }); }
    }, over || {});
    return { api: sandbox.window.ghaAdminDeposit(deps), calls: calls, toasts: toasts };
  }
  const UIB = depBooking({ id: 'ui-1' });
  const ui = loadUi().api, uiEn = loadUi({ ES: false }).api;
  const dRef = ui.detailHtml(depBooking({ deposit_refunded_at: '2027-01-02T00:00:00Z', balance_refunded_at: '2027-01-03T00:00:00Z' }));
  ok('6.1 detalle muestra "Depósito reembolsado · fecha" y "Saldo reembolsado · fecha"', /Depósito reembolsado · T\(2027-01-02T00:00:00Z\)/.test(dRef) && /Saldo reembolsado · T\(2027-01-03T00:00:00Z\)/.test(dRef));
  const dRefEn = uiEn.detailHtml(depBooking({ deposit_refunded_at: '2027-01-02T00:00:00Z', balance_refunded_at: '2027-01-03T00:00:00Z' }));
  ok('6.2 EN: "Deposit refunded" / "Balance refunded"', /Deposit refunded · T\(/.test(dRefEn) && /Balance refunded · T\(/.test(dRefEn));
  ok('6.3 sin columnas: no hay líneas de reembolso', !/reembolsado ·/.test(ui.detailHtml(UIB)));
  const alertOn = ui.alertHtml(depBooking({ needs_review_reason: 'refund_review' }));
  ok('6.4 alerta con motivo y owner: botón "Marcar como revisado"', /data-dep-review-clear/.test(alertOn) && /Marcar como revisado/.test(alertOn));
  ok('6.5 EN: "Mark as reviewed"', /Mark as reviewed/.test(uiEn.alertHtml(depBooking({ needs_review_reason: 'refund_review' }))));
  ok('6.6 sin motivo: ni alerta ni botón', ui.alertHtml(UIB) === '');
  const noOwner = loadUi({ canWrite: function () { return false; } }).api.alertHtml(depBooking({ needs_review_reason: 'refund_review' }));
  ok('6.7 no owner: alerta sin botón', /dep-alert/.test(noOwner) && !/data-dep-review-clear/.test(noOwner));
  ['balance_paid_after_cancel', 'balance_paid_twice', 'refund_review'].forEach(function (rs) {
    ok('6.8 botón en la alerta ' + rs, /data-dep-review-clear/.test(ui.alertHtml(depBooking({ needs_review_reason: rs }))));
  });
  const afterTxt = ui.reasonText('balance_paid_after_cancel');
  ok('6.9 balance_paid_after_cancel explica las dos opciones', /reembolsar el saldo en Stripe/.test(afterTxt) && /reactivar la reserva/.test(afterTxt) && /Confirmada/.test(afterTxt) && /revisad/.test(afterTxt));
  ok('6.9b EN: dos opciones', /refund the balance in Stripe/.test(uiEn.reasonText('balance_paid_after_cancel')) && /Confirmed/.test(uiEn.reasonText('balance_paid_after_cancel')));
  /* 6.10 acción: confirm + POST + toast + recarga */
  let host = { _h: null, querySelector: function (sel) { return sel === '[data-dep-review-clear]' ? btn : null; } };
  let btn = { disabled: false, _cb: null, addEventListener: function (ev, cb) { this._cb = cb; } };
  let uiX = loadUi();
  let done = null;
  uiX.api.bindReviewClear(host, depBooking({ id: 'ui-9', needs_review_reason: 'refund_review' }), function (res) { done = res; });
  await btn._cb();
  ok('6.10 clic: POST a admin-booking-review-clear con el id, toast y recarga',
    uiX.calls.length === 1 && uiX.calls[0].url === '/api/admin-booking-review-clear' && uiX.calls[0].body.booking_id === 'ui-9' && uiX.toasts.length === 1 && done && done.kind === 'ok');
  uiX = loadUi({ confirm: function () { return false; } }); btn = { disabled: false, _cb: null, addEventListener: function (ev, cb) { this._cb = cb; } }; host = { querySelector: function () { return btn; } };
  done = null;
  uiX.api.bindReviewClear(host, depBooking({ id: 'ui-9', needs_review_reason: 'refund_review' }), function (res) { done = res; });
  await btn._cb();
  ok('6.11 si el owner no confirma, no hay POST', uiX.calls.length === 0 && done === null);
  uiX = loadUi({ apiPost: function () { return Promise.resolve({ ok: false, status: 409, data: { error: 'NOTHING_TO_REVIEW' } }); } }); btn = { disabled: false, _cb: null, addEventListener: function (ev, cb) { this._cb = cb; } }; host = { querySelector: function () { return btn; } };
  done = null;
  uiX.api.bindReviewClear(host, depBooking({ id: 'ui-9', needs_review_reason: 'refund_review' }), function (res) { done = res; });
  await btn._cb();
  ok('6.12 409 NOTHING_TO_REVIEW: avisa y recarga', done && done.kind === 'nothing' && uiX.toasts.length === 1);
  ok('6.13 admin.js conecta el botón y pasa confirm; admin.html con ?v=dep31',
    /DEPOSIT\.bindReviewClear\(/.test(read('assets/js/admin.js')) && /confirm:/.test(read('assets/js/admin.js').split('window.ghaAdminDeposit(')[1].split(')')[0])
    && /admin-deposit\.js\?v=dep31/.test(read('admin.html')) && /admin\.js\?v=dep31/.test(read('admin.html')));
  ok('6.14 migración 0028 agrega deposit_refunded_at y balance_refunded_at', /add column if not exists deposit_refunded_at timestamptz/.test(read('supabase/migrations/0028_booking_deposits.sql')) && /add column if not exists balance_refunded_at timestamptz/.test(read('supabase/migrations/0028_booking_deposits.sql')));
  ok('6.15 ADMIN_FIELDS incluye las columnas de reembolso', /deposit_refunded_at/.test(read('server/admin-handlers/bookings.js')) && /balance_refunded_at/.test(read('server/admin-handlers/bookings.js')));


  console.error = realError;
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error = realError; console.log('FAIL  excepción: ' + (e && e.stack || e)); process.exit(1); });
