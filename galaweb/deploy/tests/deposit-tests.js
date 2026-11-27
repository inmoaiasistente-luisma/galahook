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

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
