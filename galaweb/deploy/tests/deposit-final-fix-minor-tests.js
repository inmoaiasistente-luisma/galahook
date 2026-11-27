'use strict';

/* =========================================================
   Pruebas — ronda final del depósito 30 % (menores).
   Menores: M1 check-in, M3 guardado del PI del saldo, M4 saldo por
   otro medio, M5/T7 barrido, M7 alreadyPaid.
   (I1-I3 están en tests/deposit-final-fix-tests.js.)
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
  mockModule('/server/lib/booking-email-service.js', {
    notifyBooking: async function (b, c, o, ctx) { SEQ.push('notify:' + c); return { customer: { sent: true }, owner: { sent: true } }; },
    sendBookingEmail: async function (o) { SEQ.push('send:' + o.type); return { sent: true }; }, QR_CID: 'qr'
  });

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

  /* ---------- M1 · check-in ---------- */
  mockModule('/server/lib/booking-qr.js', {
    verifyQrToken: function () { return { publicId: 'pub', tokenVersion: 1 }; }, QR_BOOKING_STATUSES: ['confirmed', 'completed'],
    ensureBookingQrAccess: async function () { return null; }, generateBookingQrPng: async function () { return null; }
  });
  const lookup = require(BASE + '/api/booking-qr-lookup.js');
  function lookupSeed(bk) {
    fresh({ booking_qr_access: [{ id: 'a1', public_id: 'pub', tenant_id: 'hook-adventure', active: true, token_version: 1, booking_id: 'q-1', scan_count: 0 }],
      bookings: [Object.assign({ id: 'q-1', tenant_id: 'hook-adventure', request_type: 'booking', booking_status: 'confirmed', booking_code: 'HK-9' }, bk)] });
  }
  lookupSeed({ payment_status: 'deposit_paid' });
  let lk = await callHandler(lookup, { token: 'abcdefghij' });
  ok('7.1 depósito pagado: paid=false y balance_due=true', lk.status === 200 && lk.json.booking.paid === false && lk.json.booking.balance_due === true);
  lookupSeed({ payment_status: 'paid' });
  lk = await callHandler(lookup, { token: 'abcdefghij' });
  ok('7.2 pagado: paid=true y balance_due=false', lk.status === 200 && lk.json.booking.paid === true && lk.json.booking.balance_due === false);
  const ck = read('assets/js/checkin.js');
  ok('7.3 checkin.js avisa del saldo pendiente (ES/EN) sin bloquear',
    /balance_due/.test(ck) && /Saldo pendiente — cobrar antes del tour/.test(ck) && /Balance due — collect before the tour/.test(ck));
  ok('7.4 checkin.html con ?v=dep30', /checkin\.js\?v=dep30/.test(read('checkin.html')));

  /* ---------- M3 · guardado del PI del saldo ---------- */
  const { handleBalanceRequest } = require(BASE + '/server/lib/balance-payment.js');
  async function payBalance(rowId) {
    const res = mockRes();
    await handleBalanceRequest({ mode: 'balance', token: P.signBalanceToken(rowId) }, res, { supabase: FAKE, stripe: fakeStripe, tenant: 'hook-adventure' });
    let j = {}; try { j = JSON.parse(res.body); } catch (e) {}
    return { status: res.statusCode, data: j };
  }
  fresh({ bookings: [depBooking({ id: UID.b1, balance_payment_intent_id: null })] });
  let pb = await payBalance(UID.b1);
  ok('8.1 camino normal: crea y guarda el PI', pb.status === 200 && pb.data.clientSecret === 'cs_new' && FAKE.db.tables.bookings[0].balance_payment_intent_id === 'pi_new_1' && LOG.cancels.length === 0);
  fresh({ bookings: [depBooking({ id: UID.b1, balance_payment_intent_id: null })] });
  ON_CREATE = function () { FAKE.db.tables.bookings[0].booking_status = 'cancelled'; };
  pb = await payBalance(UID.b1);
  ok('8.2 cancelada mientras se creaba el PI: 409 BOOKING_CANCELLED, PI anulado y sin guardarlo',
    pb.status === 409 && pb.data.error === 'BOOKING_CANCELLED' && LOG.cancels[0] === 'pi_new_1' && !FAKE.db.tables.bookings[0].balance_payment_intent_id);
  fresh({ bookings: [depBooking({ id: UID.b1, balance_payment_intent_id: null })] });
  ON_CREATE = function () { FAKE.db.tables.bookings[0].payment_status = 'paid'; };
  pb = await payBalance(UID.b1);
  ok('8.3 pagada mientras se creaba el PI: alreadyPaid, PI anulado y sin guardarlo',
    pb.status === 200 && pb.data.alreadyPaid === true && LOG.cancels[0] === 'pi_new_1' && !FAKE.db.tables.bookings[0].balance_payment_intent_id);
  fresh({ bookings: [depBooking({ id: UID.b1, balance_payment_intent_id: null })] });
  ON_CREATE = function () { FAKE.db.tables.bookings[0].payment_status = 'refunded'; FAKE.db.tables.bookings[0].booking_status = 'cancelled'; };
  pb = await payBalance(UID.b1);
  ok('8.4 reembolsada mientras se creaba el PI: 409 y PI anulado', pb.status === 409 && pb.data.error === 'BOOKING_CANCELLED' && LOG.cancels.length === 1);
  fresh({ bookings: [depBooking({ id: UID.b1, balance_payment_intent_id: null })] });
  ON_CREATE = function () { FAKE.db.tables.bookings[0].balance_payment_intent_id = 'pi_rival'; };
  pb = await payBalance(UID.b1);
  ok('8.5 PI rival guardado por otra llamada: se reutiliza el guardado (sin anular el vigente)',
    pb.status === 200 && pb.data.clientSecret === 'cs_old' && LOG.retrieves[0] === 'pi_rival' && FAKE.db.tables.bookings[0].balance_payment_intent_id === 'pi_rival' && LOG.cancels.indexOf('pi_rival') === -1);
  fresh({ bookings: [depBooking({ id: UID.b1, balance_payment_intent_id: null })] });
  ON_CREATE = function () { FAKE.db.tables.bookings[0].booking_status = 'cancelled'; };
  fakeStripe.paymentIntents.cancel = async function () { throw new Error('cancel fail'); };
  pb = await payBalance(UID.b1);
  fakeStripe.paymentIntents.cancel = async function (id) { LOG.cancels.push(id); return {}; };
  ok('8.6 si anular el PI falla, el error al cliente es el mismo (best-effort)', pb.status === 409 && pb.data.error === 'BOOKING_CANCELLED');

  /* ---------- M4 · saldo por otro medio vs pago con tarjeta en curso ---------- */
  const offline = require(BASE + '/server/admin-handlers/booking-balance-offline.js');
  function offBody() { return { booking_id: UID.b1, method: 'cash', note: 'Recibido en oficina' }; }
  for (const st of ['processing', 'succeeded']) {
    fresh({ bookings: [depBooking({ id: UID.b1 })] });
    PI_STATUS = st;
    const o = await callHandler(offline, offBody());
    ok('9.' + st + ' PI ' + st + ' → 409 BALANCE_PAYMENT_IN_PROGRESS, sin actualizar ni auditar',
      o.status === 409 && o.json.error === 'BALANCE_PAYMENT_IN_PROGRESS' && FAKE.db.tables.bookings[0].payment_status === 'deposit_paid'
      && !FAKE.db.tables.bookings[0].balance_paid_at && AUDIT.length === 0 && LOG.cancels.length === 0);
  }
  fresh({ bookings: [depBooking({ id: UID.b1 })] });
  PI_STATUS = 'requires_payment_method';
  let o = await callHandler(offline, offBody());
  ok('9.3 PI abierto: se registra el saldo y se anula el PI después', o.status === 200 && FAKE.db.tables.bookings[0].payment_status === 'paid' && LOG.cancels[0] === 'pi_bal');
  fresh({ bookings: [depBooking({ id: UID.b1 })] });
  RETRIEVE_THROWS = true;
  o = await callHandler(offline, offBody());
  ok('9.4 si Stripe falla al consultar, sigue como antes', o.status === 200 && FAKE.db.tables.bookings[0].payment_status === 'paid');
  fresh({ bookings: [depBooking({ id: UID.b1 })] });
  STRIPE_ON = false; PI_STATUS = 'succeeded';
  o = await callHandler(offline, offBody());
  ok('9.5 sin Stripe configurado: sigue como antes', o.status === 200 && FAKE.db.tables.bookings[0].payment_status === 'paid');
  fresh({ bookings: [depBooking({ id: UID.b1, balance_payment_intent_id: null })] });
  PI_STATUS = 'succeeded';
  o = await callHandler(offline, offBody());
  ok('9.6 sin PI del saldo: no se consulta Stripe y se registra', o.status === 200 && LOG.retrieves.length === 0);
  const offUi = read('assets/js/admin-deposit.js');
  ok('9.7 el panel traduce BALANCE_PAYMENT_IN_PROGRESS (ES/EN)', /BALANCE_PAYMENT_IN_PROGRESS/.test(offUi) && /El cliente ya está pagando o pagó el saldo con tarjeta\. Revisa Stripe antes de registrarlo\./.test(offUi) && /The customer is already paying or has paid the balance by card\. Check Stripe before recording it\./.test(offUi));
  const uiOff = loadUi({ apiPost: function () { return Promise.resolve({ ok: false, status: 409, data: { error: 'BALANCE_PAYMENT_IN_PROGRESS' } }); } }).api;
  const offRes = await uiOff.submitOffline(UIB, 'cash', 'nota ok');
  ok('9.8 submitOffline devuelve el mensaje de pago en curso', offRes.kind === 'in_progress' && /Revisa Stripe/.test(offRes.message));

  /* ---------- M5 · el barrido ignora reservas ya autocanceladas ---------- */
  const today = todayInGalapagos();
  ok('10.1 sweepAction: auto_cancelled_at fijado → sin acción', P.sweepAction({ payment_plan: 'deposit', payment_status: 'deposit_paid', booking_status: 'confirmed', booking_date: shiftYmd(today, 3), auto_cancelled_at: '2026-11-20T00:00:00Z' }, today).action === null);
  ok('10.2 sweepAction: control sin auto_cancelled_at cancela', P.sweepAction({ payment_plan: 'deposit', payment_status: 'deposit_paid', booking_status: 'confirmed', booking_date: shiftYmd(today, 3), auto_cancelled_at: null }, today).action === 'cancel');
  const { runDepositSweep } = require(BASE + '/server/lib/deposit-sweep.js');
  fresh({ bookings: [depBooking({ id: UID.b1, booking_date: shiftYmd(today, 3), balance_payment_intent_id: null, auto_cancelled_at: '2026-11-20T00:00:00.000Z' })] });
  const stale = depBooking({ id: UID.b1, booking_date: shiftYmd(today, 3), balance_payment_intent_id: null, auto_cancelled_at: null });   // lectura anterior a la autocancelación
  const sw = await runDepositSweep({ supabase: FAKE, stripe: null, rows: [stale], today: today, includeTest: true,
    sendBookingEmail: async function () { return { sent: true }; }, notifyBooking: async function () { SEQ.push('notify'); return { customer: { sent: true }, owner: { sent: true } }; }, audit: async function () { return true; } });
  ok('10.3 el UPDATE de cancelación exige auto_cancelled_at nulo: 0 filas, sin correo ni conteo',
    sw.cancelled === 0 && SEQ.length === 0 && FAKE.db.tables.bookings[0].booking_status === 'confirmed' && FAKE.db.tables.bookings[0].auto_cancelled_at === '2026-11-20T00:00:00.000Z');

  /* ---------- reminders-run: M5 en la consulta + T7 orden ---------- */
  const remindersRun = require(BASE + '/server/admin-handlers/reminders-run.js');
  async function runReminders(rows) {
    fresh({ bookings: rows });
    const res = mockRes();
    await remindersRun({ method: 'GET', headers: { authorization: 'Bearer ' + process.env.CRON_SECRET } }, res);
    return { status: res.statusCode, json: JSON.parse(res.body) };
  }
  function sweepRow(id, days, extra) {
    return depBooking(Object.assign({ id: id, booking_date: shiftYmd(today, days), balance_payment_intent_id: null, request_type: 'booking', is_test: false }, extra || {}));
  }
  let rr = await runReminders([sweepRow("r1", 3, { auto_cancelled_at: '2026-11-20T00:00:00.000Z' })]);
  ok('11.1 reminders-run: una reserva con auto_cancelled_at no se barre', rr.status === 200 && rr.json.deposit.cancelled === 0 && FAKE.db.tables.bookings[0].booking_status === 'confirmed' && SEQ.indexOf('notify:customer_deposit_cancelled') === -1);
  rr = await runReminders([sweepRow('r1', 3)]);
  ok('11.2 control: sin auto_cancelled_at se cancela', rr.json.deposit.cancelled === 1 && FAKE.db.tables.bookings[0].booking_status === 'cancelled');
  ok('11.3 T7: tras cancelar, el aviso pre-viaje de 3 días NO sale (el barrido va primero)', SEQ.indexOf('send:pretrip_reminder_d3') === -1 && SEQ.indexOf('notify:customer_deposit_cancelled') !== -1);
  rr = await runReminders([
    depBooking({ id: 'full-3', payment_plan: 'full', payment_status: 'paid', booking_status: 'confirmed', booking_date: shiftYmd(today, 3), balance_payment_intent_id: null, stripe_payment_intent_id: 'pi_f', request_type: 'booking', is_test: false }),
    sweepRow('r7', 7, { stripe_payment_intent_id: 'pi_r7' })
  ]);
  const iBal = SEQ.indexOf('send:balance_reminder_d7'), iPre = SEQ.indexOf('send:pretrip_reminder_d3');
  ok('11.4 T7: el barrido del saldo corre antes del escaneo pre-viaje', iBal !== -1 && iPre !== -1 && iBal < iPre);
  rr = await runReminders([sweepRow('r7', 7, { stripe_payment_intent_id: 'pi_a' }), sweepRow('r6', 6, { stripe_payment_intent_id: 'pi_b' })]);
  ok('11.5 T7: el barrido procesa por booking_date ascendente', SEQ.indexOf('send:balance_reminder_d6') !== -1 && SEQ.indexOf('send:balance_reminder_d6') < SEQ.indexOf('send:balance_reminder_d7'));
  const rrSrc = read('server/admin-handlers/reminders-run.js');
  ok('11.6 la consulta del barrido ordena por booking_date y excluye auto_cancelled_at', /\.order\('booking_date', \{ ascending: true \}\)/.test(rrSrc) && /\.is\('auto_cancelled_at', null\)/.test(rrSrc));
  /* un fallo del barrido no rompe el resumen pre-viaje */
  fresh({ bookings: [sweepRow('r9', 7)] });
  const origFrom = FAKE.from;
  FAKE.from = function (t) {
    const q = origFrom(t);
    const orig = q.eq;
    if (t === 'bookings') { q.eq = function (k, v) { if (k === 'payment_plan') { q.then = function (ok2) { return Promise.resolve({ data: null, error: { message: 'boom' } }).then(ok2); }; } return orig.apply(q, arguments); }; }
    return q;
  };
  const res9 = mockRes();
  await remindersRun({ method: 'GET', headers: { authorization: 'Bearer ' + process.env.CRON_SECRET } }, res9);
  const j9 = JSON.parse(res9.body);
  ok('11.7 si el barrido falla, el resumen pre-viaje igual responde 200', res9.statusCode === 200 && j9.deposit && j9.deposit.error === true && typeof j9.scanned === 'number');

  /* ---------- M7 · alreadyPaid con chargeCents ---------- */
  const createH = require(BASE + '/api/create-payment-intent.js');
  const ACK = { accepted: true, version: P.DEPOSIT_TERMS_VERSION };
  fresh({ bookings: [], discount_rules: [] });
  let nreq = 0;
  function cpBody(extra) { nreq++; return Object.assign({ request_id: '00000000-0000-4000-8000-' + String(900000000000 + nreq), tour_id: 'kicker', booking_date: shiftYmd(today, 40), guests: 2, customer_name: 'Ana Pérez', customer_email: 'ana@example.com' }, extra || {}); }
  let cb = cpBody({ payment_plan: 'deposit', deposit_ack: ACK });
  await callHandler(createH, cb);
  PI_STATUS = 'succeeded';
  let cr = await callHandler(createH, cb);
  const dRow = FAKE.db.tables.bookings[0];
  ok('12.1 alreadyPaid de un depósito devuelve chargeCents = deposit_cents', cr.status === 200 && cr.json.alreadyPaid === true && cr.json.chargeCents === dRow.deposit_cents && dRow.deposit_cents > 0 && cr.json.paymentPlan === 'deposit');
  fresh({ bookings: [], discount_rules: [] });
  cb = cpBody();
  await callHandler(createH, cb);
  PI_STATUS = 'succeeded';
  cr = await callHandler(createH, cb);
  ok('12.2 alreadyPaid de pago completo devuelve chargeCents = amount_cents', cr.status === 200 && cr.json.alreadyPaid === true && cr.json.chargeCents === FAKE.db.tables.bookings[0].amount_cents && cr.json.paymentPlan === 'full');

  console.error = realError;
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error = realError; console.log('FAIL  excepción: ' + (e && e.stack || e)); process.exit(1); });
