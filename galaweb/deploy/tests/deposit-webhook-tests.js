'use strict';

/* =========================================================
   Pruebas — Tarea 6: webhook de Stripe con depósito 30 %
   (depósito, saldo, eventos ajenos y reembolsos).
   Sin red: Supabase en memoria, correos y intake simulados.
   ========================================================= */

const path = require('path');
const BASE = path.resolve(__dirname, '..');
const { createFakeSupabase } = require('./helpers/fake-supabase');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }

process.env.TENANT_ID = 'hook-adventure';
process.env.PUBLIC_SITE_URL = 'https://galapagoshookadventure.com';
process.env.QR_SIGNING_SECRET = 'test-secret-deposit-webhook-0123456789';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_SECRET_KEY = 'sk_test_x';

let FAKE = createFakeSupabase({});
let MAIL = [];      // notifyBooking
let OWNER = [];     // sendBookingEmail (solo dueño)
let INTAKE = [];
function mockModule(rel, exp) { const p = require.resolve(BASE + rel); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; }
mockModule('/server/lib/supabase.js', { getSupabase: function () { return FAKE; } });
mockModule('/server/lib/booking-email-service.js', {
  notifyBooking: async function (b, c, o, ctx) { MAIL.push({ booking: b, customerType: c, ownerType: o, ctx: ctx }); return {}; },
  sendBookingEmail: async function (o) { OWNER.push(o); return {}; }, QR_CID: 'qr'
});
mockModule('/server/lib/resend.js', { getMailConfig: function () { return { notifyTo: 'Owner@Example.com' }; }, getResend: function () { return null; } });
mockModule('/server/lib/passenger-intake.js', { ensurePassengerForm: async function (b) { INTAKE.push('form:' + b.id); return { id: 'f1' }; } });
mockModule('/server/lib/passenger-intake-emails.js', { sendInvitation: async function (b) { INTAKE.push('invite:' + b.id); } });
mockModule('/server/lib/stripe.js', { getStripe: function () { return { webhooks: { constructEvent: function (raw) { return JSON.parse(raw); } } }; } });
mockModule('/server/lib/raw-body.js', { readRawBody: async function (req) { return req.__raw; } });

/* El webhook registra avisos con console.error; se silencian para una salida limpia. */
const realError = console.error;
console.error = function () {};

const webhook = require(BASE + '/api/stripe-webhook.js');
const processEvent = webhook._test.processEvent;
const { balanceUrl } = require(BASE + '/server/lib/deposit-policy.js');

function booking(extra) {
  return Object.assign({
    id: 'b-1', tenant_id: 'hook-adventure', booking_code: 'HK-1', currency: 'usd',
    amount_cents: 100000, payment_plan: 'deposit', deposit_cents: 30000, balance_cents: 70000,
    payment_status: 'pending', booking_status: 'pending_payment',
    stripe_payment_intent_id: 'pi_dep', balance_payment_intent_id: 'pi_bal',
    customer_email: 'c@example.com', paid_at: null, deposit_paid_at: null, balance_paid_at: null,
    balance_payment_method: null, needs_review_reason: null
  }, extra || {});
}
function fullBooking(extra) {
  return booking(Object.assign({ payment_plan: 'full', deposit_cents: null, balance_cents: null,
    balance_payment_intent_id: null, stripe_payment_intent_id: 'pi_full' }, extra || {}));
}
function reset(rows) { FAKE = createFakeSupabase({ bookings: rows || [], stripe_webhook_events: [] }); MAIL = []; OWNER = []; INTAKE = []; }
function row(id) { return FAKE.db.tables.bookings.filter(function (r) { return r.id === (id || 'b-1'); })[0]; }
function bookingWrites() { return FAKE.db.writes.filter(function (w) { return w.table === 'bookings'; }); }
function ledgerNote(note) {
  return FAKE.db.writes.some(function (w) { return w.table === 'stripe_webhook_events' && w.payload && w.payload.payload && w.payload.payload.note === note; });
}
function piEvent(type, obj, id) {
  return { id: id || 'evt_1', type: type, created: 1790000000, livemode: false, data: { object: obj } };
}
function pi(id, amount, kind, extra) {
  return Object.assign({ id: id, amount: amount, amount_received: amount, currency: 'usd', created: 1790000000,
    metadata: { tenant_id: 'hook-adventure', booking_id: 'b-1', booking_code: 'HK-1', kind: kind } }, extra || {});
}
async function throws(fn) { try { await fn(); return null; } catch (e) { return e.message; } }
const EV_ISO = new Date(1790000000 * 1000).toISOString();

(async function main() {
  /* 6.1-6.5 depósito succeeded */
  reset([booking()]);
  await processEvent(FAKE, piEvent('payment_intent.succeeded', pi('pi_dep', 30000, 'deposit')));
  let r = row();
  ok('6.1 depósito: deposit_paid + confirmed + paid_at + deposit_paid_at',
    r.payment_status === 'deposit_paid' && r.booking_status === 'confirmed' && r.paid_at === EV_ISO && r.deposit_paid_at === EV_ISO);
  ok('6.2 depósito: notifyBooking con plantillas de depósito y balanceUrl',
    MAIL.length === 1 && MAIL[0].customerType === 'customer_deposit_confirmation' && MAIL[0].ownerType === 'owner_deposit_notification'
    && MAIL[0].ctx && MAIL[0].ctx.balanceUrl === balanceUrl('b-1'));
  ok('6.3 depósito: se invita el formulario de pasajeros', INTAKE.join(',') === 'form:b-1,invite:b-1');

  reset([booking()]);
  let m = await throws(function () { return processEvent(FAKE, piEvent('payment_intent.succeeded', pi('pi_dep', 100000, 'deposit'))); });
  ok('6.4 depósito con importe = total lanza amount mismatch y no cambia la fila', m === 'amount mismatch' && row().payment_status === 'pending');
  reset([booking()]);
  m = await throws(function () { return processEvent(FAKE, piEvent('payment_intent.succeeded', pi('pi_dep', 30000, 'deposit', { amount_received: 100 }))); });
  ok('6.5 depósito con amount_received distinto lanza', m === 'amount_received mismatch');

  /* 6.6 reordenado: depósito tras paid */
  reset([booking({ payment_status: 'paid', booking_status: 'confirmed', balance_payment_method: 'stripe' })]);
  await processEvent(FAKE, piEvent('payment_intent.succeeded', pi('pi_dep', 30000, 'deposit')));
  ok('6.6 depósito reordenado tras paid: no baja a deposit_paid ni envía correos',
    row().payment_status === 'paid' && MAIL.length === 0 && bookingWrites().length === 0);
  /* 6.7 duplicado */
  reset([booking({ payment_status: 'deposit_paid', booking_status: 'confirmed', paid_at: 'x' })]);
  await processEvent(FAKE, piEvent('payment_intent.succeeded', pi('pi_dep', 30000, 'deposit')));
  ok('6.7 depósito duplicado: sin cambios ni correos', row().paid_at === 'x' && MAIL.length === 0 && bookingWrites().length === 0);
  /* 6.8 depósito en reserva cancelada */
  reset([booking({ booking_status: 'cancelled' })]);
  await processEvent(FAKE, piEvent('payment_intent.succeeded', pi('pi_dep', 30000, 'deposit')));
  ok('6.8 depósito sobre reserva cancelada: guarda terminal', row().payment_status === 'pending' && row().booking_status === 'cancelled' && MAIL.length === 0);

  /* 6.9-6.10 pago completo igual que antes */
  reset([fullBooking()]);
  await processEvent(FAKE, piEvent('payment_intent.succeeded', pi('pi_full', 100000, 'full')));
  ok('6.9 pago completo: paid/confirmed y confirmación clásica',
    row().payment_status === 'paid' && row().booking_status === 'confirmed' && row().paid_at === EV_ISO
    && MAIL[0].customerType === 'customer_booking_confirmation' && MAIL[0].ownerType === 'owner_booking_notification' && INTAKE.length === 2);
  reset([fullBooking()]);
  m = await throws(function () { return processEvent(FAKE, piEvent('payment_intent.succeeded', pi('pi_full', 30000, 'full'))); });
  ok('6.10 pago completo con importe distinto lanza amount mismatch', m === 'amount mismatch');

  /* 6.11 kind en metadata contradice la fila */
  reset([booking()]);
  m = await throws(function () { return processEvent(FAKE, piEvent('payment_intent.succeeded', pi('pi_dep', 30000, 'full'))); });
  ok('6.11 metadata.kind en desacuerdo con la fila lanza', !!m && /kind mismatch/.test(m));

  /* 6.12-6.14 saldo succeeded */
  reset([booking({ payment_status: 'deposit_paid', booking_status: 'confirmed' })]);
  await processEvent(FAKE, piEvent('payment_intent.succeeded', pi('pi_bal', 70000, 'balance')));
  r = row();
  ok('6.12 saldo: paid + balance_paid_at + método stripe; estado de reserva intacto',
    r.payment_status === 'paid' && r.balance_paid_at === EV_ISO && r.balance_payment_method === 'stripe' && r.booking_status === 'confirmed');
  ok('6.13 saldo: recibo al cliente y aviso al dueño',
    MAIL.length === 1 && MAIL[0].customerType === 'customer_balance_receipt' && MAIL[0].ownerType === 'owner_balance_received');
  reset([booking({ payment_status: 'deposit_paid', booking_status: 'confirmed' })]);
  m = await throws(function () { return processEvent(FAKE, piEvent('payment_intent.succeeded', pi('pi_bal', 30000, 'balance'))); });
  ok('6.14 saldo con importe incorrecto lanza amount mismatch', m === 'amount mismatch');

  /* 6.15-6.16 saldo en reserva cancelada */
  reset([booking({ payment_status: 'refunded', booking_status: 'cancelled' })]);
  await processEvent(FAKE, piEvent('payment_intent.succeeded', pi('pi_bal', 70000, 'balance')));
  r = row();
  ok('6.15 saldo tras cancelar: needs_review_reason y estado sin cambios',
    r.needs_review_reason === 'balance_paid_after_cancel' && r.booking_status === 'cancelled' && r.payment_status === 'refunded' && !r.balance_paid_at);
  ok('6.16 saldo tras cancelar: owner_payment_review solo al dueño',
    MAIL.length === 0 && OWNER.length === 1 && OWNER[0].type === 'owner_payment_review' && OWNER[0].recipient === 'owner@example.com');

  /* 6.17 saldo tras pago offline */
  reset([booking({ payment_status: 'paid', booking_status: 'confirmed', balance_payment_method: 'cash' })]);
  await processEvent(FAKE, piEvent('payment_intent.succeeded', pi('pi_bal', 70000, 'balance')));
  r = row();
  ok('6.17 saldo tras pago en efectivo: balance_paid_twice, método cash intacto, aviso al dueño',
    r.needs_review_reason === 'balance_paid_twice' && r.balance_payment_method === 'cash' && r.payment_status === 'paid'
    && OWNER.length === 1 && OWNER[0].type === 'owner_payment_review' && MAIL.length === 0);
  /* 6.18 saldo duplicado */
  reset([booking({ payment_status: 'paid', booking_status: 'confirmed', balance_payment_method: 'stripe', balance_paid_at: 'prev' })]);
  await processEvent(FAKE, piEvent('payment_intent.succeeded', pi('pi_bal', 70000, 'balance')));
  ok('6.18 saldo duplicado: no-op', row().balance_paid_at === 'prev' && !row().needs_review_reason && MAIL.length === 0 && OWNER.length === 0 && bookingWrites().length === 0);

  /* 6.19 saldo: processing / failed / canceled no tocan la fila */
  for (const t of ['payment_intent.processing', 'payment_intent.payment_failed', 'payment_intent.canceled']) {
    reset([booking({ payment_status: 'deposit_paid', booking_status: 'confirmed' })]);
    await processEvent(FAKE, piEvent(t, pi('pi_bal', 70000, 'balance')));
    ok('6.19 ' + t + ' del saldo no modifica la reserva',
      row().payment_status === 'deposit_paid' && row().booking_status === 'confirmed' && bookingWrites().length === 0);
  }
  /* 6.20 depósito failed igual que full */
  reset([booking()]);
  await processEvent(FAKE, piEvent('payment_intent.payment_failed', pi('pi_dep', 30000, 'deposit')));
  ok('6.20 depósito payment_failed marca failed (igual que pago completo)', row().payment_status === 'failed' && row().booking_status === 'failed');

  /* 6.21-6.23 eventos ajenos */
  reset([booking()]);
  let res = await processEvent(FAKE, piEvent('payment_intent.succeeded', { id: 'pi_other', amount: 500, currency: 'usd', metadata: { tenant_id: 'other' } }));
  ok('6.21 evento ajeno (tenant other, sin fila) devuelve ignored sin lanzar', res && res.ignored === true);
  res = await processEvent(FAKE, piEvent('payment_intent.succeeded', { id: 'pi_other2', amount: 500, currency: 'usd', metadata: {} }));
  ok('6.22 evento sin metadata.tenant_id ni fila es ajeno', res && res.ignored === true);
  m = await throws(function () { return processEvent(FAKE, piEvent('payment_intent.succeeded', pi('pi_missing', 500, 'full'))); });
  ok('6.23 sin fila pero con NUESTRO tenant sigue lanzando', !!m && /expected exactly one booking/.test(m));

  /* 6.24-6.26 handler completo */
  function fakeRes() { const o = { statusCode: 0, body: '' }; o.setHeader = function () {}; o.end = function (b) { o.body = b; }; return o; }
  async function call(evt) {
    const req = { method: 'POST', headers: { 'stripe-signature': 'sig' }, __raw: JSON.stringify(evt) };
    const rs = fakeRes(); await webhook(req, rs); return rs;
  }
  reset([booking()]);
  let rs = await call(piEvent('payment_intent.succeeded', { id: 'pi_other', amount: 500, currency: 'usd', metadata: { tenant_id: 'other' } }, 'evt_foreign'));
  ok('6.24 handler: ajeno responde 200 {received, ignored} y el ledger queda processed',
    rs.statusCode === 200 && JSON.parse(rs.body).ignored === true && JSON.parse(rs.body).received === true
    && FAKE.db.tables.stripe_webhook_events[0].processing_status === 'processed');
  reset([booking()]);
  rs = await call(piEvent('payment_intent.succeeded', pi('pi_dep', 30000, 'deposit'), 'evt_ok'));
  ok('6.25 handler: evento normal responde 200 {received:true} sin ignored', rs.statusCode === 200 && rs.body === JSON.stringify({ received: true }));
  reset([booking()]);
  rs = await call(piEvent('payment_intent.succeeded', pi('pi_missing', 500, 'full'), 'evt_bad'));
  ok('6.26 handler: fila propia inexistente responde 500 y ledger failed', rs.statusCode === 500 && FAKE.db.tables.stripe_webhook_events[0].processing_status === 'failed');

  /* 6.27+ reembolsos */
  function charge(piId, full, extra) {
    return Object.assign({ id: 'ch_1', payment_intent: piId, amount: 30000, amount_refunded: full ? 30000 : 100, refunded: !!full }, extra || {});
  }
  reset([booking({ payment_status: 'deposit_paid', booking_status: 'confirmed' })]);
  await processEvent(FAKE, piEvent('charge.refunded', charge('pi_dep', true)));
  ok('6.27 reembolso total del depósito con saldo impago: refunded/cancelled', row().payment_status === 'refunded' && row().booking_status === 'cancelled');

  reset([booking({ payment_status: 'paid', booking_status: 'confirmed', balance_payment_method: 'stripe' })]);
  await processEvent(FAKE, piEvent('charge.refunded', charge('pi_dep', true)));
  ok('6.28 reembolso total del depósito con saldo pagado: sin cambio de estado + refund_review',
    row().payment_status === 'paid' && row().booking_status === 'confirmed' && row().needs_review_reason === 'refund_review');
  ok('6.28b ...y escribe la nota de revisión manual en el ledger', ledgerNote('refund_review_manual'));

  reset([booking({ payment_status: 'paid', booking_status: 'confirmed', balance_payment_method: 'stripe' })]);
  await processEvent(FAKE, piEvent('charge.refunded', charge('pi_bal', true, { amount: 70000, amount_refunded: 70000 })));
  ok('6.29 reembolso total del cargo del saldo: sin cambio de estado + refund_review',
    row().payment_status === 'paid' && row().booking_status === 'confirmed' && row().needs_review_reason === 'refund_review');

  reset([fullBooking({ payment_status: 'paid', booking_status: 'confirmed' })]);
  await processEvent(FAKE, piEvent('charge.refunded', charge('pi_full', true, { amount: 100000, amount_refunded: 100000 })));
  ok('6.30 reembolso total de pago completo: refunded/cancelled como antes', row().payment_status === 'refunded' && row().booking_status === 'cancelled');

  reset([booking({ payment_status: 'deposit_paid', booking_status: 'confirmed' })]);
  await processEvent(FAKE, piEvent('charge.refunded', charge('pi_dep', false)));
  ok('6.31 reembolso parcial: sin cambios', row().payment_status === 'deposit_paid' && row().booking_status === 'confirmed' && !row().needs_review_reason && ledgerNote('partial_or_no_pi_manual_review'));

  reset([booking()]);
  m = await throws(function () { return processEvent(FAKE, piEvent('charge.refunded', charge('pi_foreign', true))); });
  ok('6.32 reembolso ajeno (sin fila): se ignora sin lanzar, deja nota y no toca reservas',
    m === null && row().payment_status === 'pending' && ledgerNote('no_booking_ignored'));

  reset([booking(), booking({ id: 'b-2', booking_code: 'HK-2', stripe_payment_intent_id: 'pi_x', balance_payment_intent_id: 'pi_dep' })]);
  m = await throws(function () { return processEvent(FAKE, piEvent('charge.refunded', charge('pi_dep', true))); });
  ok('6.33 reembolso con más de una fila lanza', !!m && /expected exactly one booking/.test(m));

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
