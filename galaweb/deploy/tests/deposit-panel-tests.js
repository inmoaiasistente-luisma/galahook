'use strict';

/* =========================================================
   Pruebas — Tarea 8: deposit_paid en el sistema y la acción
   "saldo pagado por otro medio" (efectivo / transferencia).
   Sin red: Supabase en memoria, Stripe y auditoría simulados.
   ========================================================= */

const path = require('path');
const fs = require('fs');
const BASE = path.resolve(__dirname, '..');
const { createFakeSupabase } = require('./helpers/fake-supabase');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }

process.env.TENANT_ID = 'hook-adventure';
process.env.QR_SIGNING_SECRET = 'test-secret-deposit-panel-0123456789';

const B1 = '11111111-1111-4111-8111-111111111111';
const B2 = '22222222-2222-4222-8222-222222222222';
let FAKE = createFakeSupabase({});
let ROLE = 'owner';
let AUDIT = [];
let STRIPE = null;          // null = Stripe no configurado
let CANCELLED = [];
let PI_STATUS = 'requires_payment_method';

function mockModule(rel, exp) { const p = require.resolve(BASE + rel); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; }
mockModule('/server/lib/supabase.js', { getSupabase: function () { return FAKE; } });
mockModule('/server/lib/admin-auth.js', {
  requireWriter: async function (req, res) {
    if (ROLE !== 'owner') { res.statusCode = 403; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: { code: 'FORBIDDEN' } })); return null; }
    return { user_id: 'u-owner', role: 'owner', tenant_id: 'hook-adventure', email: 'o@x.z' };
  },
  sameOrigin: function () { return true; }
});
mockModule('/server/lib/admin-audit.js', { recordAudit: async function (s, e) { AUDIT.push({ s: s, e: e }); return true; } });
mockModule('/server/lib/stripe.js', { getStripe: function () { if (!STRIPE) throw new Error('no stripe'); return STRIPE; } });

const handler = require(BASE + '/server/admin-handlers/booking-balance-offline.js');
const qr = require(BASE + '/server/lib/booking-qr.js');
const intake = require(BASE + '/server/lib/passenger-intake.js');

const realError = console.error; console.error = function () {};

function makeStripe() {
  return { paymentIntents: {
    retrieve: async function (id) { return { id: id, status: PI_STATUS }; },
    cancel: async function (id) { CANCELLED.push(id); return {}; }
  } };
}
function mockRes() { return { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(s) { this.body = s; } }; }
async function call(body, method) {
  const res = mockRes();
  await handler({ method: method || 'POST', body: body, headers: {} }, res);
  let j = {}; try { j = JSON.parse(res.body); } catch (e) {}
  return { status: res.statusCode, json: j };
}
function row(extra) {
  return Object.assign({ id: B1, tenant_id: 'hook-adventure', payment_plan: 'deposit', payment_status: 'deposit_paid',
    booking_status: 'confirmed', balance_paid_at: null, balance_payment_intent_id: null }, extra || {});
}
function reset(rows) { FAKE = createFakeSupabase({ bookings: rows || [] }); AUDIT = []; CANCELLED = []; STRIPE = null; ROLE = 'owner'; PI_STATUS = 'requires_payment_method'; }
function read(rel) { return fs.readFileSync(path.join(BASE, rel), 'utf8'); }

(async function () {
  /* 1 · éxito */
  reset([row()]);
  let r = await call({ booking_id: B1, method: 'cash', note: '  Pagó en la oficina  ' });
  const saved = FAKE.db.tables.bookings[0];
  ok('1 owner marca saldo en efectivo → 200 {ok:true}', r.status === 200 && r.json.ok === true);
  ok('1b fila actualizada (paid, método, nota recortada, fecha)', saved.payment_status === 'paid' && saved.balance_payment_method === 'cash'
    && saved.balance_offline_note === 'Pagó en la oficina' && !!saved.balance_paid_at);
  ok('1c auditoría booking.balance_offline con id y método', AUDIT.length === 1 && AUDIT[0].e.action === 'booking.balance_offline'
    && AUDIT[0].e.entity_id === B1 && AUDIT[0].e.after.balance_payment_method === 'cash'
    && AUDIT[0].e.before.payment_status === 'deposit_paid' && AUDIT[0].e.after.payment_status === 'paid');

  /* 2 · roles */
  reset([row()]); ROLE = 'admin';
  r = await call({ booking_id: B1, method: 'cash', note: 'abc' });
  ok('2 sesión admin → 403 y sin cambios', r.status === 403 && FAKE.db.tables.bookings[0].payment_status === 'deposit_paid');
  reset([row()]); ROLE = 'staff';
  r = await call({ booking_id: B1, method: 'cash', note: 'abc' });
  ok('2b sesión staff → 403', r.status === 403);

  /* 3 · validación */
  reset([row()]);
  r = await call({ booking_id: B1, method: 'cash' });
  ok('3 sin nota → 400', r.status === 400);
  r = await call({ booking_id: B1, method: 'cash', note: ' a ' });
  ok('3b nota de 1 carácter → 400', r.status === 400);
  r = await call({ booking_id: B1, method: 'cash', note: 'x'.repeat(501) });
  ok('3c nota de 501 → 400', r.status === 400);
  r = await call({ booking_id: B1, method: 'card', note: 'abc' });
  ok('3d método inválido → 400', r.status === 400);
  r = await call({ booking_id: 'nope', method: 'cash', note: 'abc' });
  ok('3e booking_id no UUID → 400', r.status === 400);
  r = await call({ booking_id: B1, method: 'cash', note: 'abc', extra: 1 });
  ok('3f clave desconocida → 400', r.status === 400);
  r = await call({ booking_id: B1, method: 'cash', note: 'abc' }, 'GET');
  ok('3g GET → 405', r.status === 405);
  ok('3h nada se escribió con entradas inválidas', FAKE.db.tables.bookings[0].payment_status === 'deposit_paid' && FAKE.db.writes.length === 0);

  /* 4 · 409 uniforme */
  const casos = [
    ['reserva full', row({ payment_plan: 'full', payment_status: 'paid' })],
    ['saldo ya pagado', row({ payment_status: 'paid', balance_paid_at: '2026-12-01T00:00:00Z' })],
    ['cancelada', row({ booking_status: 'cancelled' })],
    ['otro tenant', row({ tenant_id: 'otro' })],
    ['id desconocido', row({ id: B2 })]
  ];
  for (const c of casos) {
    reset([c[1]]);
    r = await call({ booking_id: B1, method: 'transfer', note: 'abc' });
    ok('4 ' + c[0] + ' → 409 BALANCE_NOT_DUE', r.status === 409 && r.json.error === 'BALANCE_NOT_DUE' && AUDIT.length === 0);
  }

  /* 5 · error de BD */
  reset([row()]); FAKE.db.fail.bookings = { message: 'boom' };
  r = await call({ booking_id: B1, method: 'cash', note: 'abc' });
  ok('5 error de BD → 500', r.status === 500);

  /* 6 · PI de Stripe */
  reset([row({ balance_payment_intent_id: 'pi_bal' })]); STRIPE = makeStripe();
  r = await call({ booking_id: B1, method: 'cash', note: 'abc' });
  ok('6 PI abierto (requires_*) se cancela', r.status === 200 && CANCELLED.join() === 'pi_bal');
  reset([row({ balance_payment_intent_id: 'pi_bal' })]); STRIPE = makeStripe(); PI_STATUS = 'processing';
  r = await call({ booking_id: B1, method: 'cash', note: 'abc' });
  ok('6b PI processing NO se cancela', r.status === 200 && CANCELLED.length === 0);
  reset([row({ balance_payment_intent_id: 'pi_bal' })]); STRIPE = makeStripe(); PI_STATUS = 'succeeded';
  r = await call({ booking_id: B1, method: 'cash', note: 'abc' });
  ok('6c PI succeeded NO se cancela', r.status === 200 && CANCELLED.length === 0);
  reset([row({ balance_payment_intent_id: 'pi_bal' })]); STRIPE = null;
  r = await call({ booking_id: B1, method: 'cash', note: 'abc' });
  ok('6d Stripe sin configurar → 200 igual', r.status === 200 && FAKE.db.tables.bookings[0].payment_status === 'paid');
  reset([row({ balance_payment_intent_id: 'pi_bal' })]);
  STRIPE = { paymentIntents: { retrieve: async function () { throw new Error('stripe down'); }, cancel: async function () {} } };
  r = await call({ booking_id: B1, method: 'cash', note: 'abc' });
  ok('6e error de Stripe → 200 igual', r.status === 200);

  /* 7 · elegibilidad QR / intake */
  const base = { request_type: 'booking', booking_status: 'confirmed', is_test: false, deleted_at: null };
  ok('7 isQrEligible acepta deposit_paid', qr.isQrEligible(Object.assign({ payment_status: 'deposit_paid' }, base)) === true);
  ok('7b isQrEligible sigue aceptando paid y rechaza pending', qr.isQrEligible(Object.assign({ payment_status: 'paid' }, base)) === true
    && qr.isQrEligible(Object.assign({ payment_status: 'pending' }, base)) === false);
  const ie = intake.isIntakeEligible;
  ok('7c isIntakeEligible acepta deposit_paid', typeof ie === 'function' && ie(Object.assign({ payment_status: 'deposit_paid' }, base)) === true);
  ok('7d isIntakeEligible rechaza pending', typeof ie === 'function' && ie(Object.assign({ payment_status: 'pending' }, base)) === false);
  ok('7e lookup de QR acepta deposit_paid', /\['paid', 'deposit_paid'\]\.indexOf\(booking\.payment_status\)/.test(read('api/booking-qr-lookup.js')));

  /* 8 · lista admin / staff */
  const bk = read('server/admin-handlers/bookings.js');
  ok('8 staff ve paid y deposit_paid', /\.in\('payment_status', \['paid', 'deposit_paid'\]\)/.test(bk));
  ok('8b PAYMENT_STATUSES incluye deposit_paid', /PAYMENT_STATUSES = \[[^\]]*'deposit_paid'/.test(bk));
  ok('8c ADMIN_FIELDS con columnas del depósito', ['payment_plan', 'deposit_cents', 'balance_cents', 'balance_due_date', 'balance_paid_at', 'balance_payment_method', 'balance_offline_note', 'needs_review_reason', 'cancel_reason', 'auto_cancelled_at', 'deposit_paid_at'].every(function (c) { return bk.indexOf(c) !== -1; }));
  ok('8d ADMIN_FIELDS no expone balance_payment_intent_id', bk.indexOf('balance_payment_intent_id') === -1);
  ok('8e test-data-list acepta deposit_paid', /PAYMENT_STATUSES = \[[^\]]*'deposit_paid'/.test(read('server/admin-handlers/test-data-list.js')));

  /* 9 · ruteo */
  const vj = JSON.parse(read('vercel.json'));
  ok('9 rewrite admin-booking-balance-offline', vj.rewrites.some(function (x) { return x.source === '/api/admin-booking-balance-offline' && x.destination === '/api/admin-router?action=booking-balance-offline'; }));
  ok('9b router registra booking-balance-offline', /ROUTES\['booking-balance-offline'\] = require\('\.\.\/server\/admin-handlers\/booking-balance-offline'\)/.test(read('api/admin-router.js')));
  const apiFiles = fs.readdirSync(path.join(BASE, 'api')).filter(function (f) { return /\.js$/.test(f); });
  ok('9c api/ mantiene 11 funciones', apiFiles.length === 11);

  console.error = realError;
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
